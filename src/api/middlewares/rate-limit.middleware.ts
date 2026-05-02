import { Request, Response, NextFunction } from 'express';
import { rateLimit, RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Container } from 'typedi';
import { RedisService } from '../../services/redis.service';

/**
 * Creates a rate limiter with Redis store.
 * Use this for endpoint-specific rate limiting.
 */
export const createRateLimiter = (
  windowMs: number = 15 * 60 * 1000,
  maxRequests: number = 100,
  keyPrefix: string = 'rl'
): RateLimitRequestHandler => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request): string => {
      // Use user ID if authenticated, otherwise IP
      return req.currentUser?.userId || req.ip || 'unknown';
    },
    handler: (req: Request, res: Response) => {
      res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
      });
    },
    skip: (req: Request): boolean => {
      // Skip rate limiting for admin users
      return req.currentUser?.role === 'admin';
    },
  });
};

// Pre-configured rate limiters for different endpoints
export const generalLimiter = createRateLimiter(15 * 60 * 1000, 100, 'rl:general');
export const searchLimiter = createRateLimiter(15 * 60 * 1000, 30, 'rl:search');
export const jobLimiter = createRateLimiter(15 * 60 * 1000, 50, 'rl:job');
export const marketplaceLimiter = createRateLimiter(15 * 60 * 1000, 50, 'rl:marketplace');
export const uploadLimiter = createRateLimiter(15 * 60 * 1000, 20, 'rl:upload');
export const writeLimiter = createRateLimiter(15 * 60 * 1000, 30, 'rl:write');