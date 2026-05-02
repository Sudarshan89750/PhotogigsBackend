import express, { Router, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import crypto from 'crypto';
import { config } from '../config';
import { errorHandler } from '../api/middlewares/error.middleware';
import logger from '../utils/logger';
import { RedisService } from '../services/redis.service';
import { Container } from 'typedi';

// Route modules
import loadAuthRoutes from '../api/routes/auth.routes';
import loadUserRoutes from '../api/routes/user.routes';
import loadJobRoutes from '../api/routes/job.routes';
import loadProposalRoutes from '../api/routes/proposal.routes';
import loadMarketplaceRoutes from '../api/routes/marketplace.routes';
import loadCommunityRoutes from '../api/routes/community.routes';
import loadFeedRoutes from '../api/routes/feed.routes';
import loadNotificationRoutes from '../api/routes/notification.routes';
import loadChatRoutes from '../api/routes/chat.routes';
import loadDisputeRoutes from '../api/routes/dispute.routes';
import loadAdminRoutes from '../api/routes/admin.routes';
import loadSearchRoutes from '../api/routes/search.routes';
import loadAnalyticsRoutes from '../api/routes/analytics.routes';
import loadWebhookRoutes from '../api/routes/webhook.routes';
import loadCampaignRoutes from '../api/routes/campaign.routes';
import loadSubscriptionRoutes from '../api/routes/subscription.routes';

export const loadExpress = (): express.Application => {
  const app = express();
  const redis = Container.get(RedisService);
  const allowedOrigins = new Set(config.corsOrigins);

  // ─── Security ─────────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProduction
        ? { maxAge: 15552000, includeSubDomains: true, preload: true }
        : false,
    })
  );
  app.disable('x-powered-by');
  // Trust Railway / Render reverse proxy so rate limiting uses real client IP
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: config.isProduction
        ? (origin, callback) => {
            if (!origin) return callback(null, true);
            if (allowedOrigins.has(origin)) return callback(null, true);
            return callback(new Error('Not allowed by CORS'));
          }
        : (origin, callback) => {
            // Allow any localhost port in development (Flutter web uses random ports)
            if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
              callback(null, true);
            } else {
              callback(null, false);
            }
          },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    })
  );

  // ─── FIX #1: Redis-backed rate limiter (works across multiple pods) ────────
  const makeRedisStore = (prefix: string) =>
    new RedisStore({
      // rate-limit-redis v4 sendCommand API
      sendCommand: (...args: string[]) =>
        redis.getClient().call(args[0], ...args.slice(1)) as Promise<number>,
      prefix,
    });

  const globalLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('rl:global:'),
    message: { success: false, status: 429, message: 'Too many requests', code: 'RATE_LIMITED' },
  });

  // Tighter limit on auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    store: makeRedisStore('rl:auth:'),
    message: { success: false, status: 429, message: 'Too many auth attempts', code: 'RATE_LIMITED' },
  });

  app.use(globalLimiter);

  // ─── Body parsing ─────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // ─── FIX #11: Request correlation ID ─────────────────────────────────────
  app.use((req: Request, _res, next) => {
    (req as any).requestId = crypto.randomUUID();
    next();
  });

  // ─── Logging ──────────────────────────────────────────────────────────────
  app.use(
    morgan(':method :url :status :response-time ms', {
      stream: { write: (msg) => logger.warn(msg.trim()) },
      skip: (req) => req.url === '/health',
    })
  );

  // ─── FIX #13: Deep health check ───────────────────────────────────────────
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const { Pool } = await import('pg');
      const pg = Container.get<InstanceType<typeof Pool>>('pgPool' as any);
      const redisClient = redis.getClient();

      const [pgOk, redisOk] = await Promise.allSettled([
        pg.query('SELECT 1'),
        redisClient.ping(),
      ]);

      const healthy =
        pgOk.status === 'fulfilled' && redisOk.status === 'fulfilled';

      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        checks: {
          postgres: pgOk.status === 'fulfilled' ? 'ok' : 'down',
          redis: redisOk.status === 'fulfilled' ? 'ok' : 'down',
        },
      });
    } catch (err) {
      res.status(503).json({ status: 'error' });
    }
  });

  // ─── API Routes ───────────────────────────────────────────────────────────
  const apiRouter = Router();
  app.use('/api/v1', apiRouter);

  apiRouter.use('/auth', authLimiter);

  loadAuthRoutes(apiRouter);
  loadUserRoutes(apiRouter);
  loadJobRoutes(apiRouter);
  loadProposalRoutes(apiRouter);
  loadMarketplaceRoutes(apiRouter);
  loadCommunityRoutes(apiRouter);
  loadFeedRoutes(apiRouter);
  loadNotificationRoutes(apiRouter);
  loadChatRoutes(apiRouter);
  loadDisputeRoutes(apiRouter);
  loadAdminRoutes(apiRouter);
  loadSearchRoutes(apiRouter);
  loadAnalyticsRoutes(apiRouter);
  loadWebhookRoutes(apiRouter);
  loadCampaignRoutes(apiRouter);
  loadSubscriptionRoutes(apiRouter);

  // ─── 404 ──────────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, status: 404, message: 'Not found', code: 'NOT_FOUND' });
  });

  app.use(errorHandler);

  return app;
};
