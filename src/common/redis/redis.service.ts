import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isAvailable = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisHost = this.configService.get<string>('REDIS_HOST');
    
    if (!redisHost) {
      this.logger.warn('Redis not configured - queue and session features will be disabled');
      return;
    }

    try {
      this.client = new Redis({
        host: redisHost,
        port: this.configService.get<number>('REDIS_PORT', 6379),
        password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      await this.client.connect();
      this.isAvailable = true;
      this.logger.log('Redis connected successfully');
    } catch (error) {
      this.logger.warn(`Redis connection failed: ${error.message}. Continuing without Redis.`);
      this.client = null;
      this.isAvailable = false;
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  isRedisAvailable(): boolean {
    return this.isAvailable;
  }

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    if (!this.isAvailable || !this.client) {
      this.logger.warn('Redis not available - set operation skipped');
      return false;
    }

    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (error) {
      this.logger.error(`Redis set failed: ${error.message}`);
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable || !this.client) {
      return null;
    }

    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.error(`Redis get failed: ${error.message}`);
      return null;
    }
  }

  async del(key: string): Promise<boolean> {
    if (!this.isAvailable || !this.client) {
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      this.logger.error(`Redis del failed: ${error.message}`);
      return false;
    }
  }

  async healthCheck(): Promise<{ isHealthy: boolean; error?: string }> {
    if (!this.isAvailable || !this.client) {
      return { isHealthy: false, error: 'Redis not configured' };
    }

    try {
      await this.client.ping();
      return { isHealthy: true };
    } catch (error) {
      return { isHealthy: false, error: error.message };
    }
  }
}