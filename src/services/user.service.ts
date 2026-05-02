import { Service, Inject } from 'typedi';
import { Pool } from 'pg';
import { UpdateProfileDto } from '../interfaces/IUser';
import { NotFoundError, ForbiddenError, PaymentRequiredError } from '../utils/errors';

@Service()
export class UserService {
  constructor(
    @Inject('pgPool') private db: Pool,
    @Inject('logger') private logger: any
  ) {}

  async getById(userId: string) {
    const { rows } = await this.db.query(
      `SELECT id, email, first_name, last_name, phone, city, state, country,
              latitude, longitude, status, role, avatar_url, bio, skills,
              hourly_rate, portfolio_urls, average_rating, total_reviews,
              membership_tier, has_used_trial, base_image_limit, addon_image_limit, used_images,
              created_at
       FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] ?? null;
  }

  async getPublicProfile(userId: string) {
    const { rows } = await this.db.query(
      `SELECT id, first_name, last_name, city, state, country,
              avatar_url, bio, skills, hourly_rate, portfolio_urls,
              average_rating, total_reviews, created_at
       FROM users WHERE id = $1 AND status = 'approved'`,
      [userId]
    );
    if (!rows[0]) throw new NotFoundError('User not found');
    return rows[0];
  }

  async updateProfile(dto: UpdateProfileDto) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const updatable = [
      'firstName', 'lastName', 'phone', 'city', 'state', 'country',
      'latitude', 'longitude', 'bio', 'skills', 'hourlyRate', 'portfolioUrls',
    ] as const;

    const colMap: Record<string, string> = {
      firstName: 'first_name',
      lastName: 'last_name',
      phone: 'phone',
      city: 'city',
      state: 'state',
      country: 'country',
      latitude: 'latitude',
      longitude: 'longitude',
      bio: 'bio',
      skills: 'skills',
      hourlyRate: 'hourly_rate',
      portfolioUrls: 'portfolio_urls',
    };

    for (const key of updatable) {
      if (dto[key] !== undefined) {
        fields.push(`${colMap[key]} = $${idx++}`);
        values.push(dto[key]);
      }
    }

    if (fields.length === 0) return this.getById(dto.userId);

    fields.push(`updated_at = NOW()`);
    values.push(dto.userId);

    const { rows } = await this.db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING
       id, email, first_name, last_name, phone, city, state, country,
       latitude, longitude, status, role, avatar_url, bio, skills,
       hourly_rate, portfolio_urls, average_rating, total_reviews,
       membership_tier, has_used_trial, base_image_limit, addon_image_limit, used_images,
       created_at`,
      values
    );
    return rows[0];
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    const { rows } = await this.db.query(
      `UPDATE users SET avatar_url = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, first_name, last_name, avatar_url, status`,
      [avatarUrl, userId]
    );
    return rows[0];
  }

  async uploadIdDocument(userId: string, idDocUrl: string) {
    const { rows } = await this.db.query(
      `UPDATE users
       SET id_document_url = $1, status = 'pending_approval', updated_at = NOW()
       WHERE id = $2 AND status = 'pending_id'
       RETURNING id, email, first_name, last_name, status`,
      [idDocUrl, userId]
    );
    if (!rows[0]) throw new ForbiddenError('Account is not in pending_id state');
    return rows[0];
  }

  async registerFcmToken(
    userId: string,
    token: string,
    deviceId: string
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO fcm_tokens (user_id, token, device_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, device_id) DO UPDATE SET token = EXCLUDED.token`,
      [userId, token, deviceId]
    );
  }

  async getUsersByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await this.db.query(
      `SELECT id, first_name, last_name, avatar_url, city, average_rating, skills
       FROM users WHERE id IN (${placeholders})`,
      ids
    );
    return rows;
  }

  async updateRating(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE users u
       SET average_rating = (
         SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE reviewee_id = $1
       ),
       total_reviews = (
         SELECT COUNT(*) FROM reviews WHERE reviewee_id = $1
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
  }

  async checkImageQuota(userId: string, additionalImages = 1): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT role, used_images, base_image_limit, addon_image_limit
       FROM users WHERE id = $1`,
      [userId]
    );

    if (!rows[0]) return;

    const { role, used_images, base_image_limit, addon_image_limit } = rows[0];
    // Admin accounts are intentionally unrestricted for moderation/support workflows.
    if (role === 'admin') return;
    const totalLimit = base_image_limit + addon_image_limit;

    if (used_images + additionalImages > totalLimit) {
      throw new PaymentRequiredError(
        `You have reached your image quota limit of ${totalLimit}. Please purchase an add-on or upgrade your plan.`
      );
    }
  }
}
