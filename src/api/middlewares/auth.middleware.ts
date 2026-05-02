import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../../utils/jwt';
import { UnauthorizedError, ForbiddenError } from '../../utils/errors';
import { UserStatus } from '../../interfaces/IAuth';
import { Container } from 'typedi';
import { RedisService } from '../../services/redis.service';

// Presence tracking sampling rate (1 in N requests)
const PRESENCE_SAMPLE_RATE = 10;

/**
 * Validates Bearer token and attaches claims to req.currentUser.
 */
export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or malformed Authorization header'));
  }

  try {
    const user = verifyAccessToken(header.slice(7));
    req.currentUser = user;

    const redis = Container.get(RedisService);

    // 1. Session Revocation Check (Lightning-fast Redis check)
    const isRevoked = await redis.get(`user:revoked:${user.userId}`);
    if (isRevoked) {
      return next(new ForbiddenError('Your account has been blocked or session revoked.'));
    }

    // 2. Presence Buffering (sampled to reduce Redis load)
    // Only update presence 1 in 10 requests to prevent Redis bottleneck
    if (Math.random() < (1 / PRESENCE_SAMPLE_RATE)) {
      await redis.sadd('presence:pending_sync', user.userId);
    }

    next();
  } catch (err) {
    if (err instanceof ForbiddenError) return next(err);
    next(new UnauthorizedError('Invalid or expired access token'));
  }
};

/**
 * Optional auth – attaches user if token present, continues if not.
 */
export const optionalAuthenticate = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.currentUser = verifyAccessToken(header.slice(7));
    } catch {
      // Ignore – optional auth
    }
  }
  next();
};

/**
 * Requires user status = 'approved'.
 * Must be used AFTER authenticate.
 * Admin bypasses all status checks.
 */
export const requireApproved = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  const user = req.currentUser;
  if (!user) return next(new UnauthorizedError());

  // Admin bypasses all status checks
  if (user.role === 'admin') return next();

  const allowedStatuses: UserStatus[] = ['approved'];
  if (!allowedStatuses.includes(user.status)) {
    return next(
      new ForbiddenError(
        `Action requires an approved account. Current status: ${user.status}`
      )
    );
  }
  next();
};

/**
 * Requires admin role.
 */
export const requireAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.currentUser) return next(new UnauthorizedError());
  if (req.currentUser.role !== 'admin') {
    return next(new ForbiddenError('Admin access required'));
  }
  next();
};

/**
 * Requires pro membership.
 */
export const requireProMembership = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (req.currentUser?.role === 'admin') return next();
  if (req.currentUser?.membershipTier === 'free') {
    return next(new ForbiddenError('Upgrade to Pro to unlock this feature.'));
  }
  next();
};
