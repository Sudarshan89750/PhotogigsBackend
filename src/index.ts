import 'dotenv/config';
// Forced restart for port clearance
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

const bootstrap = async (): Promise<void> => {
  // 1. Initialize all DB / cache connections + DI registrations
  await initializeDependencies();

  // 2. Build Express app
  const app = loadExpress();

  // 3. Wrap in HTTP server so Socket.io can attach
  const httpServer = http.createServer(app);

  // 4. Attach Socket.io (with Redis adapter)
  loadSocket(httpServer);

  // 5. Start BullMQ workers
  const postModel = Container.get<any>('postModel');
  const notificationModel = Container.get<any>('notificationModel');
  const marketplaceOrderModel = Container.get<any>('marketplaceOrderModel');
  // FIX: Pass orderModel to workers for resilient refunds
  const stopWorkers = startWorkers({ postModel, notificationModel, marketplaceOrderModel });
  
  // 6. Schedule Periodic Jobs (Batch Presence Sync Every 5 mins)
  presenceQueue.add('sync', {}, {
    repeat: { every: 5 * 60 * 1000 },
    jobId: 'presence_sync_default'
  });

  // 6. Start listening
  httpServer.listen(config.port, () => {
    logger.warn(`✌️ PhotoGigs API running on port ${config.port} [${config.env}]`);
  });

  // ─── Graceful shutdown ──────────────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.warn(`${signal} received – shutting down gracefully`);
    const forceExit = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000);

    try {
      await Promise.allSettled([
        stopWorkers(),
        presenceQueue.close(),
      ]);

      const pgPool = Container.has('pgPool') ? Container.get<Pool>('pgPool') : null;
      const redis = Container.has(RedisService) ? Container.get(RedisService) : null;

      await Promise.allSettled([
        pgPool?.end() ?? Promise.resolve(),
        redis?.close() ?? Promise.resolve(),
        mongoose.disconnect(),
      ]);

      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });

      clearTimeout(forceExit);
      logger.warn('HTTP server closed');
      process.exit(0);
    } catch (err) {
      logger.error('Graceful shutdown failed', { err: (err as Error).message });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
    if (!config.isProduction) process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err: (err as Error).message, stack: (err as Error).stack });
    process.exit(1);
  });
};

bootstrap().catch((err) => {
  logger.error('Bootstrap failed', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
