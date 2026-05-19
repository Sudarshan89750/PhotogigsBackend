import { Queue } from 'bullmq';
import { config } from '../config';

const enabled = config.redis.enabled && config.redis.url;

interface RedisConnection {
  host: string;
  port: number;
  password?: string;
  tls?: Record<string, unknown>;
}

const connection: RedisConnection | null = enabled
  ? {
      host: new URL(config.redis.url).hostname,
      port: parseInt(new URL(config.redis.url).port || '6379', 10),
      password: new URL(config.redis.url).password || undefined,
      tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
    }
  : null;

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

export const trendingQueue = connection ? new Queue('trending', { connection, defaultJobOptions }) : mockQueue;
export const emailQueue = connection ? new Queue('email', { connection, defaultJobOptions }) : mockQueue;
export const notificationQueue = connection ? new Queue('notification', { connection, defaultJobOptions }) : mockQueue;
export const paymentQueue = connection ? new Queue('payment', { connection, defaultJobOptions }) : mockQueue;
export const presenceQueue = connection ? new Queue('presence', { connection, defaultJobOptions }) : mockQueue;
export const subscriptionQueue = connection ? new Queue('subscription', { connection, defaultJobOptions }) : mockQueue;