import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { z } from 'zod';
import { AuthService } from '../../services/auth.service';
import { validate } from '../middlewares/validate.middleware';
import { authenticate } from '../middlewares/auth.middleware';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { RedisService } from '../../services/redis.service';

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1).max(20),
  lastName: z.string().min(1).max(25),
  phone: z.string().regex(/^\d{10}$/, 'Phone number must be exactly 10 digits').optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const forgotSchema = z.object({ email: z.string().email() });

const resetSchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  newPassword: z.string().min(8),
});

export default (app: Router): void => {
  app.use('/auth', router);

  const svc = Container.get(AuthService);
  const redisService = Container.get(RedisService);
  const useMemoryStore = redisService.isUsingMemory();

  const authLimiter = rateLimit({
    store: useMemoryStore
      ? undefined
      : new RedisStore({
          // @ts-ignore - The types for rate-limit-redis 4.x can be tricky with ioredis
          sendCommand: (...args: string[]) => redisService.getClient()?.call(...args) ?? [],
          prefix: 'rl:auth:',
        }),
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
      status: 429,
      message: 'Too many requests from this IP, please try again in 15 minutes.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { default: false },
  });

  router.post('/signup', authLimiter, validate(signupSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.signup(req.body);
      res.status(201).json({ success: true, message: 'OTP sent to email' });
    } catch (e) { next(e); }
  });

  router.post('/verify-otp', authLimiter, validate(verifyOtpSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.verifyOtp(req.body);
      res.json({ success: true, data: result });
    } catch (e) { next(e); }
  });

  router.post('/resend-otp', authLimiter, validate(forgotSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.resendOtp(req.body.email);
      res.json({ success: true, message: 'OTP sent if email exists' });
    } catch (e) { next(e); }
  });

  router.post('/login', authLimiter, validate(loginSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.login(req.body);
      res.json({ success: true, data: result });
    } catch (e) { next(e); }
  });

  router.post('/refresh', validate(refreshSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await svc.refresh(req.body.refreshToken);
      res.json({ success: true, data: result });
    } catch (e) { next(e); }
  });

  router.post('/logout', authenticate, validate(refreshSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.logout(req.body.refreshToken);
      res.json({ success: true, message: 'Logged out' });
    } catch (e) { next(e); }
  });

  router.post('/forgot-password', authLimiter, validate(forgotSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.forgotPassword(req.body.email);
      res.json({ success: true, message: 'OTP sent if email exists' });
    } catch (e) { next(e); }
  });

  router.post('/reset-password', authLimiter, validate(resetSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await svc.resetPassword(req.body);
      res.json({ success: true, message: 'Password reset successful' });
    } catch (e) { next(e); }
  });
};
