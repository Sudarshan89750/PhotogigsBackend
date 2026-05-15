import { Service } from 'typedi';
import Redis from 'ioredis';
import { config } from '../config';
import logger from '../utils/logger';

interface CacheStore {
  [key: string]: {
    value: string;
    expires?: number;
  };
}

@Service()
export class RedisService {
  private client: Redis | null = null;
  private memoryStore: CacheStore = {};
  private useMemory = false;

  constructor() {
    const redisEnabled = config.redis.enabled && config.redis.url;
    
    if (redisEnabled) {
      try {
        this.client = new Redis(config.redis.url, {
          tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
          maxRetriesPerRequest: 3,
          lazyConnect: false,
          retryStrategy: (times) => {
            if (times > 3) {
              logger.warn('Redis connection failed, falling back to memory');
              return null;
            }
            return Math.min(times * 200, 2000);
          },
        });

        this.client.on('error', (err) => {
          logger.error('Redis error', { err: err.message });
        });
        this.client.on('connect', () => logger.info('✌️ Redis connected'));
      } catch (err) {
        logger.warn('Redis init failed, using in-memory fallback');
        this.useMemory = true;
      }
    } else {
      logger.info('📦 Using in-memory cache (Redis disabled for dev)');
      this.useMemory = true;
    }
  }

  private isExpired(key: string): boolean {
    const entry = this.memoryStore[key];
    if (!entry || !entry.expires) return false;
    return Date.now() > entry.expires;
  }

  async get(key: string): Promise<string | null> {
    if (this.useMemory || !this.client) {
      if (this.isExpired(key)) {
        delete this.memoryStore[key];
        return null;
      }
      return this.memoryStore[key]?.value ?? null;
    }
    try {
      return await this.client.get(key);
    } catch (err) {
      logger.error('Redis get failed', { key, err });
      return this.memoryStore[key]?.value ?? null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK' | null> {
    if (this.useMemory || !this.client) {
      this.memoryStore[key] = {
        value,
        expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
      };
      return 'OK';
    }
    try {
      if (ttlSeconds) return await this.client.set(key, value, 'EX', ttlSeconds);
      return await this.client.set(key, value);
    } catch (err) {
      logger.error('Redis set failed', { key, err });
      this.memoryStore[key] = { value, expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined };
      return 'OK';
    }
  }

  async del(key: string): Promise<number> {
    if (this.useMemory || !this.client) {
      const existed = this.memoryStore[key] ? 1 : 0;
      delete this.memoryStore[key];
      return existed;
    }
    try {
      return await this.client.del(key);
    } catch (err) {
      logger.error('Redis del failed', { key, err });
      delete this.memoryStore[key];
      return 1;
    }
  }

  async incr(key: string): Promise<number> {
    if (this.useMemory || !this.client) {
      const current = parseInt(this.memoryStore[key]?.value ?? '0', 10) + 1;
      this.memoryStore[key] = { value: String(current) };
      return current;
    }
    try {
      return await this.client.incr(key);
    } catch (err) {
      logger.error('Redis incr failed', { key, err });
      const current = parseInt(this.memoryStore[key]?.value ?? '0', 10) + 1;
      this.memoryStore[key] = { value: String(current) };
      return current;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    if (this.useMemory || !this.client) {
      if (this.memoryStore[key]) {
        this.memoryStore[key].expires = Date.now() + ttlSeconds * 1000;
        return 1;
      }
      return 0;
    }
    return this.client.expire(key, ttlSeconds);
  }

  async exists(key: string): Promise<number> {
    if (this.useMemory || !this.client) {
      if (this.isExpired(key)) {
        delete this.memoryStore[key];
        return 0;
      }
      return this.memoryStore[key] ? 1 : 0;
    }
    return this.client.exists(key);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (this.useMemory || !this.client) {
      const set = new Set(this.memoryStore[key]?.value.split(',').filter(Boolean) ?? []);
      members.forEach(m => set.add(m));
      this.memoryStore[key] = { value: Array.from(set).join(',') };
      return members.length;
    }
    return this.client.sadd(key, ...members);
  }

  async sismember(key: string, member: string): Promise<number> {
    if (this.useMemory || !this.client) {
      const set = this.memoryStore[key]?.value.split(',').filter(Boolean) ?? [];
      return set.includes(member) ? 1 : 0;
    }
    return this.client.sismember(key, member);
  }

  pipeline() {
    if (this.useMemory || !this.client) {
      return {
        get: () => this,
        set: () => this,
        del: () => this,
        incr: () => this,
        expire: () => this,
        exists: () => this,
        sadd: () => this,
        sismember: () => this,
        exec: async () => [],
      };
    }
    return this.client.pipeline();
  }

  getClient(): Redis | null {
    return this.client;
  }

  duplicate(): Redis | null {
    return this.client ? this.client.duplicate() : null;
  }

  isUsingMemory(): boolean {
    return this.useMemory;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
    this.memoryStore = {};
  }
}