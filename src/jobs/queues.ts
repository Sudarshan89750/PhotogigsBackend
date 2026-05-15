import { Queue } from 'bullmq';
import { config } from '../config';

const redisUrl = config.redis.url || 'redis://localhost:6379';
const connection = {
  host: new URL(redisUrl).hostname,
  port: parseInt(new URL(redisUrl).port || '6379', 10),
  password: new URL(redisUrl).password || undefined,
  tls: redisUrl.startsWith('rediss://') ? {} : undefined,
};

const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: 10000,
};

const mockQueue = {
  add: async () => ({ id: 'mock' }),
  process: () => {},
  on: () => {},
  close: async () => {},
} as any;

export const trendingQueue = config.redis.enabled ? new Queue('trending', { connection, defaultJobOptions }) : mockQueue;
export const emailQueue = config.redis.enabled ? new Queue('email', { connection, defaultJobOptions }) : mockQueue;
export const notificationQueue = config.redis.enabled ? new Queue('notification', { connection, defaultJobOptions }) : mockQueue;
export const paymentQueue = config.redis.enabled ? new Queue('payment', { connection, defaultJobOptions }) : mockQueue;
export const presenceQueue = config.redis.enabled ? new Queue('presence', { connection, defaultJobOptions }) : mockQueue;
export const subscriptionQueue = config.redis.enabled ? new Queue('subscription', { connection, defaultJobOptions }) : mockQueue;
