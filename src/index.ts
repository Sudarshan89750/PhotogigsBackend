import 'dotenv/config';
import 'reflect-metadata';
import http from 'http';
import mongoose from 'mongoose';
import { Pool } from 'pg';
import { config } from './config';
import { initializeDependencies } from './loaders';
import { loadExpress } from './loaders/express.loader';
import { loadSocket } from './loaders/socket.loader';
import { startWorkers } from './jobs/workers';
import { presenceQueue } from './jobs/queues';
import { Container } from 'typedi';
import logger from './utils/logger';
import { RedisService } from './services/redis.service';

// --- Graceful shutdown -------------------------------------------------------
let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn(signal + ' received — shutting down gracefully');
  const forceExit = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15_000);

  try {
    const stopWorkers = (global as any).__stopWorkers ?? (async () => {});
    await Promise.allSettled([
      stopWorkers(),
      config.redis.enabled ? presenceQueue.close() : Promise.resolve(),
    ]);

    const pgPool = Container.has('pgPool') ? Container.get<Pool>('pgPool') : null;
    const redis = Container.has(RedisService) ? Container.get(RedisService) : null;

    await Promise.allSettled([
      pgPool?.end() ?? Promise.resolve(),
      redis?.close() ?? Promise.resolve(),
      mongoose.disconnect(),
    ]);

    clearTimeout(forceExit);
    logger.warn('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Graceful shutdown failed', { err: (err as Error).message });
    process.exit(1);
  }
};

// --- Bootstrap ───────────────────────────────────────────────────────────────
const bootstrap = async (): Promise<void> => {
  // 1. Initialize DBs first — routes depend on DI container (pgPool etc.)
  // This keeps local dev working. Server starts after deps load (~2-5s).
  await initializeDependencies();

  // 2. Build Express app (routes need pgPool from step 1)
  const app = loadExpress();
  const httpServer = http.createServer(app);

  // 3. Attach Socket.io
  loadSocket(httpServer);

  // 4. Start listening
  const port = parseInt(process.env.PORT || '3000', 10);
  httpServer.listen(port, '0.0.0.0', () => {
    logger.warn('PhotoGigs API running on port ' + port + ' [' + config.env + ']');
  });

  // 5. Start BullMQ workers after server is up
  let stopWorkers = async () => {};
  if (config.redis.enabled) {
    const postModel = Container.get<any>('postModel');
    const notificationModel = Container.get<any>('notificationModel');
    const marketplaceOrderModel = Container.get<any>('marketplaceOrderModel');
    stopWorkers = startWorkers({ postModel, notificationModel, marketplaceOrderModel });

    presenceQueue.add('sync', {}, {
      repeat: { every: 5 * 60 * 1000 },
      jobId: 'presence_sync_default',
    }).catch((err: any) => logger.error('Failed to schedule periodic job', { err: err.message }));
  }

  (global as any).__stopWorkers = stopWorkers;
};

// --- Signal handlers ─────────────────────────────────────────────────────────
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled rejection', { message: reason?.message, stack: reason?.stack });
  if (!config.isProduction) process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});

// --- Start ───────────────────────────────────────────────────────────────────
bootstrap().catch((err) => {
  logger.error('Bootstrap failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});