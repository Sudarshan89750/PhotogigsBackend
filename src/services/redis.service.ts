import { Service } from 'typedi';
import Redis from 'ioredis';
import { config } from '../config';
import logger from '../utils/logger';

@Service()
export class RedisService {
  private client: Redis;

  constructor() {
    this.client = new Redis(config.redis.url, {
      tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    this.client.on('error', (err) => logger.error('Redis error', { err: err.message }));
    this.client.on('connect', () => logger.info('✌️ Redis connected'));
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null> {
    if (ttlSeconds) return this.client.set(key, value, 'EX', ttlSeconds);
    return this.client.set(key, value);
  }

  del(key: string): Promise<number> {
    return this.client.del(key);
  }

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  expire(key: string, ttlSeconds: number): Promise<number> {
    return this.client.expire(key, ttlSeconds);
  }

  exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(key, ...members);
  }

  sismember(key: string, member: string): Promise<number> {
    return this.client.sismember(key, member);
  }

  // FIX: pipeline for batching multiple commands in one round-trip
  pipeline() {
    return this.client.pipeline();
  }

  // FIX: expose raw client for rate-limit-redis and socket.io adapter
  getClient(): Redis {
    return this.client;
  }

  // Needed for socket.io redis adapter (requires a duplicate connection)
  duplicate(): Redis {
    return this.client.duplicate();
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
