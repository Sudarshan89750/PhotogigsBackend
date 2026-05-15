import { Worker } from 'bullmq';
import { Container } from 'typedi';
import { config } from '../config';
import logger from '../utils/logger';
import { PhonePeService } from '../services/phonepe.service';
import { RedisService } from '../services/redis.service';
import { Pool } from 'pg';

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379', 10),
  password: new URL(config.redis.url).password || undefined,
  tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
};

/**
 * Trending score formula:
 *   score = likes*3 + comments*2 + shares*2 + saves*1
 *   Decayed by age: score / (ageHours + 2)^1.5
 */
const computeTrendingScore = (post: {
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  createdAt: Date;
}): number => {
  const rawScore =
    post.likesCount * 3 +
    post.commentsCount * 2 +
    post.sharesCount * 2 +
    post.savesCount * 1;
  const ageHours =
    (Date.now() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);
  return rawScore / Math.pow(ageHours + 2, 1.5);
};

export const startWorkers = (models: {
  postModel: any;
  notificationModel: any;
  marketplaceOrderModel: any;
}): (() => Promise<void>) => {
  // ─── Trending worker ──────────────────────────────────────────────────────
  const trendingWorker = new Worker(
    'trending',
    async (job) => {
      const { postId } = job.data;
      const post = await models.postModel.findById(postId);
      if (!post) return;

      const score = computeTrendingScore(post);
      await models.postModel.findByIdAndUpdate(postId, { trendingScore: score });
      logger.debug('Trending score updated', { postId, score: score.toFixed(4) });
    },
    { connection, concurrency: 5 }
  );

  trendingWorker.on('failed', (job, err) =>
    logger.error('Trending worker failed', { jobId: job?.id, err: err.message })
  );

  // ─── Notification bulk worker ─────────────────────────────────────────────
  const notificationWorker = new Worker(
    'notification',
    async (job) => {
      const { userIds, type, title, body, referenceId } = job.data;
      const docs = userIds.map((userId: string) => ({
        userId,
        type,
        title,
        body,
        referenceId,
      }));
      await models.notificationModel.insertMany(docs, { ordered: false });
      logger.debug('Bulk notifications created', { count: userIds.length, type });
    },
    { connection, concurrency: 2 }
  );

  notificationWorker.on('failed', (job, err) =>
    logger.error('Notification worker failed', { jobId: job?.id, err: err.message })
  );

  // ─── Payment/Refund worker ─────────────────────────────────────────────
  const paymentWorker = new Worker(
    'payment',
    async (job) => {
      const { orderId, transactionId, amount } = job.data;
      const phonepe = Container.get(PhonePeService);
      const db = Container.get<Pool>('pgPool');

      logger.info('Processing background refund', { orderId, transactionId });

      // 1. Idempotency Check: Don't refund twice if the worker retries
      const order = await models.marketplaceOrderModel.findById(orderId);
      if (!order) return;
      if (order.status === 'refunded') {
        logger.warn('Order already refunded, skipping', { orderId });
        return;
      }

      // 2. Deterministic Refund ID: Ensures PhonePe treats retries as the same request
      const refundId = `REF_${orderId}`;

      const success = await phonepe.initiateRefund({
        originalTransactionId: transactionId,
        refundTransactionId: refundId,
        amount,
      });

      if (!success) {
        throw new Error('PhonePe refund failed');
      }

      await models.marketplaceOrderModel.findByIdAndUpdate(orderId, { 
        status: 'refunded',
        refundTransactionId: refundId 
      });

      logger.info('Refund successful and order updated', { orderId });
    },
    { connection, concurrency: 2 }
  );

  // ─── Presence Sync worker ──────────────────────────────────────────────
  const presenceWorker = new Worker(
    'presence',
    async () => {
      const redisSvc = Container.get(RedisService);
      const pool = Container.get<Pool>('pgPool');
      const redis = redisSvc.getClient();
      if (!redis) return;

      // Pop up to 5000 user IDs to process in this batch
      const userIds = await redis.spop('presence:pending_sync', 5000);
      if (!userIds || userIds.length === 0) return;

      logger.debug('Starting batch presence sync', { count: userIds.length });

      try {
        // Use a single optimized query to update multiple rows in one round-trip
        // This is extremely efficient for Postgres compared to N single updates.
        await pool.query(
          `UPDATE users 
           SET last_active_at = NOW() 
           WHERE id = ANY($1::uuid[])`,
          [userIds]
        );
        logger.info('Batch presence sync complete', { count: userIds.length });
      } catch (err) {
        logger.error('Batch presence sync failed', { err: (err as any).message });
        // Re-add to set so they aren't lost (optional, but safer)
        if (redis) await redis.sadd('presence:pending_sync', ...userIds);
        throw err;
      }
    },
    { connection, concurrency: 1 }
  );

  presenceWorker.on('failed', (job, err) =>
    logger.error('Presence worker failed', { err: (err as any).message })
  );

  // ─── Subscription worker ──────────────────────────────────────────────
  const subscriptionWorker = new Worker(
    'subscription',
    async (job) => {
      const pool = Container.get<Pool>('pgPool');
      const { action } = job.data;

      if (action === 'expire_check') {
        logger.info('Running subscription expiration check');
        
        await pool.query('BEGIN');
        try {
          const { rows } = await pool.query(
            `UPDATE subscriptions 
             SET status = 'expired'
             WHERE status IN ('trialing', 'active') AND expires_at <= NOW()
             RETURNING user_id`
          );

          if (rows.length > 0) {
            const userIds = rows.map(r => r.user_id);
            await pool.query(
              `UPDATE users SET membership_tier = 'free' WHERE id = ANY($1::uuid[])`,
              [userIds]
            );

            // Notify them (optional, skip if simple implementation)
            logger.info('Downgraded expired users', { count: rows.length });
          }
          await pool.query('COMMIT');
        } catch (e) {
          await pool.query('ROLLBACK');
          throw e;
        }
      }
    },
    { connection, concurrency: 1 }
  );

  subscriptionWorker.on('failed', (job, err) =>
    logger.error('Subscription worker failed', { err: (err as any).message })
  );

  const allWorkers = [
    trendingWorker,
    notificationWorker,
    paymentWorker,
    presenceWorker,
    subscriptionWorker,
  ];

  logger.info('✌️ BullMQ workers started');

  return async () => {
    logger.info('Closing BullMQ workers');
    await Promise.allSettled(allWorkers.map((worker) => worker.close()));
    logger.info('BullMQ workers closed');
  };
};
