import { Service, Inject, Container } from 'typedi';
import { Pool } from 'pg';
import crypto from 'crypto';
import {
  SignupDto,
  LoginDto,
  VerifyOtpDto,
  ResetPasswordDto,
  IUserClaims,
} from '../interfaces/IAuth';
import {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
} from '../utils/password';
import { generateOtp, storeOtp, verifyAndConsumeOtp } from '../utils/otp';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { EmailService } from './email.service';
import { RedisService } from './redis.service';
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
} from '../utils/errors';

const REFRESH_TOKEN_TTL_DAYS = 7;
const REFRESH_PREFIX = 'rt:';

@Service()
export class AuthService {
  private email: EmailService;
  private redis: RedisService;

  constructor(
    @Inject('pgPool') private db: Pool,
    @Inject('logger') private logger: any
  ) {
    this.email = Container.get(EmailService);
    this.redis = Container.get(RedisService);
  }

  // ─── Signup ────────────────────────────────────────────────────────────────

  async signup(dto: SignupDto): Promise<void> {
    if (!validatePasswordStrength(dto.password)) {
      throw new BadRequestError(
        'Password must be 8+ chars with uppercase, lowercase, digit, and special character'
      );
    }

    const { rows: existing } = await this.db.query(
      'SELECT id FROM users WHERE email = $1',
      [dto.email.toLowerCase()]
    );
    if (existing.length > 0) throw new ConflictError('Email already registered');

    const passwordHash = await hashPassword(dto.password);
    const otp = generateOtp();

    // FIX #12: ON CONFLICT DO NOTHING RETURNING id — detect the race condition
    const { rows } = await this.db.query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, phone, city, state, country,
          latitude, longitude, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_otp')
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [
        dto.email.toLowerCase(),
        passwordHash,
        dto.firstName,
        dto.lastName,
        dto.phone ?? null,
        dto.city ?? null,
        dto.state ?? null,
        dto.country ?? null,
        dto.latitude ?? null,
        dto.longitude ?? null,
      ]
    );

    // If insert was silently skipped (concurrent signup race), throw conflict
    if (!rows[0]) throw new ConflictError('Email already registered');

    await storeOtp(dto.email.toLowerCase(), otp);
    await this.email.sendOtp(dto.email, otp);
  }

  // ─── Verify OTP ────────────────────────────────────────────────────────────

  async verifyOtp(dto: VerifyOtpDto) {
    const email = dto.email.toLowerCase();
    const valid = await verifyAndConsumeOtp(email, dto.otp);
    if (!valid) throw new BadRequestError('Invalid or expired OTP');

    const { rows } = await this.db.query(
      `UPDATE users SET status = 'pending_id', updated_at = NOW()
       WHERE email = $1 AND status = 'pending_otp'
       RETURNING id, email, first_name, last_name, status, role, membership_tier`,
      [email]
    );
    if (!rows[0]) throw new BadRequestError('Account not found or already verified');

    return this.issueTokenPair(rows[0]);
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const { rows } = await this.db.query(
      `SELECT id, email, password_hash, first_name, last_name, status, role, membership_tier
       FROM users WHERE email = $1`,
      [email]
    );

    const user = rows[0];

    // Timing-safe: always hash even if user not found
    const hash = user?.password_hash ?? '$2a$12$invalidhashpadding000000000000000';
    const match = await comparePassword(dto.password, hash);

    if (!user || !match) throw new UnauthorizedError('Invalid email or password');
    if (user.status === 'blocked') throw new ForbiddenError('Account is blocked');

    if (user.status === 'pending_otp') {
      throw new ForbiddenError('Email not verified. Please check your email for the OTP.');
    }

    return this.issueTokenPair(user);
  }

  // ─── Resend OTP ────────────────────────────────────────────────────────────

  async resendOtp(email: string): Promise<void> {
    const normalised = email.toLowerCase();
    const { rows } = await this.db.query(
      'SELECT status FROM users WHERE email = $1',
      [normalised]
    );
    if (!rows[0] || rows[0].status !== 'pending_otp') return; // Do not reveal if email exists or status

    const otp = generateOtp();
    await storeOtp(normalised, otp);
    await this.email.sendOtp(normalised, otp);
  }

  // ─── Refresh Token ─────────────────────────────────────────────────────────

  async refresh(refreshToken: string) {
    let payload: { userId: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.redis.get(`${REFRESH_PREFIX}${tokenHash}`);
    if (!stored || stored !== payload.userId) {
      throw new UnauthorizedError('Refresh token revoked or not found');
    }

    // Rotate: invalidate old, issue new
    await this.redis.del(`${REFRESH_PREFIX}${tokenHash}`);

    const { rows } = await this.db.query(
      `SELECT id, email, first_name, last_name, status, role, membership_tier FROM users WHERE id = $1`,
      [payload.userId]
    );
    if (!rows[0]) throw new UnauthorizedError('User not found');
    if (rows[0].status === 'blocked') throw new ForbiddenError('Account is blocked');

    return this.issueTokenPair(rows[0]);
  }

  // ─── Logout ────────────────────────────────────────────────────────────────

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.redis.del(`${REFRESH_PREFIX}${tokenHash}`);
  }

  // ─── Forgot / Reset Password ───────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const normalised = email.toLowerCase();
    const { rows } = await this.db.query(
      'SELECT id FROM users WHERE email = $1',
      [normalised]
    );
    // Always respond success to avoid email enumeration
    if (!rows[0]) return;

    const otp = generateOtp();
    await storeOtp(`reset:${normalised}`, otp);
    await this.email.sendPasswordResetOtp(normalised, otp);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    if (!validatePasswordStrength(dto.newPassword)) {
      throw new BadRequestError('Password does not meet strength requirements');
    }

    const email = dto.email.toLowerCase();
    const valid = await verifyAndConsumeOtp(`reset:${email}`, dto.otp);
    if (!valid) throw new BadRequestError('Invalid or expired OTP');

    const passwordHash = await hashPassword(dto.newPassword);
    await this.db.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2`,
      [passwordHash, email]
    );
  }

  // ─── Google OAuth ──────────────────────────────────────────────────────────

  async handleGoogleOAuth(profile: {
    googleId: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
  }) {
    const email = profile.email.toLowerCase();

    const { rows } = await this.db.query(
      `INSERT INTO users (email, google_id, first_name, last_name, avatar_url, status)
       VALUES ($1, $2, $3, $4, $5, 'pending_id')
       ON CONFLICT (email) DO UPDATE
         SET google_id = EXCLUDED.google_id,
             updated_at = NOW()
       RETURNING id, email, first_name, last_name, status, role, membership_tier`,
      [email, profile.googleId, profile.firstName, profile.lastName, profile.avatarUrl ?? null]
    );

    const user = rows[0];
    if (user.status === 'blocked') throw new ForbiddenError('Account is blocked');

    return this.issueTokenPair(user);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async issueTokenPair(user: {
    id: string;
    email: string;
    status: string;
    role: string;
    membership_tier: string;
  }) {
    const claims: IUserClaims = {
      userId: user.id,
      role: user.role as 'user' | 'admin',
      status: user.status as any,
      membershipTier: (user.membership_tier || 'free') as 'free' | 'pro',
    };

    const accessToken = signAccessToken(claims);
    const refreshToken = signRefreshToken(user.id);

    const tokenHash = this.hashToken(refreshToken);
    await this.redis.set(
      `${REFRESH_PREFIX}${tokenHash}`,
      user.id,
      REFRESH_TOKEN_TTL_DAYS * 86400
    );

    return { accessToken, refreshToken, user: claims };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
