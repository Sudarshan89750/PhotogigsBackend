import { Queue } from 'bullmq';
import { config } from '../config';

const connection = {
  host: new URL(config.redis.url).hostname,
  port: parseInt(new URL(config.redis.url).port || '6379', 10),
  password: new URL(config.redis.url).password || undefined,
  tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
};

const defaultJobOptions = {
  removeOnComplete: true,
  removeOnFail: 10000,
};

export const trendingQueue = new Queue('trending', { connection, defaultJobOptions });
export const emailQueue = new Queue('email', { connection, defaultJobOptions });
export const notificationQueue = new Queue('notification', { connection, defaultJobOptions });
export const paymentQueue = new Queue('payment', { connection, defaultJobOptions });
export const presenceQueue = new Queue('presence', { connection, defaultJobOptions });
export const subscriptionQueue = new Queue('subscription', { connection, defaultJobOptions });
