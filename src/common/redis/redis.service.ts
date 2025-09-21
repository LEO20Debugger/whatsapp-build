import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis, { RedisOptions } from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isAvailable = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly reconnectDelay = 1000; // Start with 1 second

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeRedisConnection();
  }

  async onModuleDestroy() {
    if (this.client) {
      this.logger.log("Closing Redis connection...");
      await this.client.quit();
      this.client = null;
      this.isAvailable = false;
    }
  }

  private async initializeRedisConnection(): Promise<void> {
    const redisHost = this.configService.get<string>("REDIS_HOST");

    if (!redisHost) {
      this.logger.warn(
        "Redis not configured - queue and session features will be disabled"
      );
      return;
    }

    const redisOptions: RedisOptions = {
      host: redisHost,
      port: this.configService.get<number>("REDIS_PORT", 6379),
      password: this.configService.get<string>("REDIS_PASSWORD") || undefined,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableReadyCheck: true,
      connectTimeout: 10000,
      commandTimeout: 5000,
    };

    try {
      this.client = new Redis(redisOptions);

      // Set up event listeners for connection management
      this.setupEventListeners();

      await this.client.connect();
      this.isAvailable = true;
      this.reconnectAttempts = 0;
      this.logger.log("Redis connected successfully");
    } catch (error) {
      this.logger.error(`Redis initial connection failed: ${error.message}`);
      await this.handleConnectionError(error);
    }
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    this.client.on("connect", () => {
      this.logger.log("Redis connection established");
      this.isAvailable = true;
      this.reconnectAttempts = 0;
    });

    this.client.on("ready", () => {
      this.logger.log("Redis connection ready for commands");
      this.isAvailable = true;
    });

    this.client.on("error", (error) => {
      this.logger.error(`Redis connection error: ${error.message}`);
      this.isAvailable = false;
    });

    this.client.on("close", () => {
      this.logger.warn("Redis connection closed");
      this.isAvailable = false;
    });

    this.client.on("reconnecting", (delay) => {
      this.reconnectAttempts++;
      this.logger.log(
        `Redis reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
      );
    });

    this.client.on("end", () => {
      this.logger.warn("Redis connection ended");
      this.isAvailable = false;
    });
  }

  private async handleConnectionError(error: Error): Promise<void> {
    this.isAvailable = false;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Redis connection failed after ${this.maxReconnectAttempts} attempts. Giving up.`
      );
      this.client = null;
      return;
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );
    this.logger.warn(
      `Redis connection failed: ${error.message}. Retrying in ${delay}ms...`
    );

    setTimeout(async () => {
      this.reconnectAttempts++;
      await this.initializeRedisConnection();
    }, delay);
  }

  getClient(): Redis | null {
    return this.client;
  }

  isRedisAvailable(): boolean {
    return this.isAvailable && this.client !== null;
  }

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    return this.executeWithRetry(
      async () => {
        if (!this.isAvailable || !this.client) {
          throw new Error("Redis not available");
        }

        if (ttl) {
          await this.client.setex(key, ttl, value);
        } else {
          await this.client.set(key, value);
        }
        return true;
      },
      "set",
      { key, ttl }
    );
  }

  async get(key: string): Promise<string | null> {
    return this.executeWithRetry(
      async () => {
        if (!this.isAvailable || !this.client) {
          return null;
        }

        return await this.client.get(key);
      },
      "get",
      { key }
    );
  }

  async del(key: string): Promise<boolean> {
    return this.executeWithRetry(
      async () => {
        if (!this.isAvailable || !this.client) {
          return false;
        }

        const result = await this.client.del(key);
        return result > 0;
      },
      "del",
      { key }
    );
  }

  async exists(key: string): Promise<boolean> {
    return this.executeWithRetry(
      async () => {
        if (!this.isAvailable || !this.client) {
          return false;
        }

        const result = await this.client.exists(key);
        return result === 1;
      },
      "exists",
      { key }
    );
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    return this.executeWithRetry(
      async () => {
        if (!this.isAvailable || !this.client) {
          return false;
        }

        const result = await this.client.expire(key, seconds);
        return result === 1;
      },
      "expire",
      { key, seconds }
    );
  }

  async ttl(key: string): Promise<number> {
    return this.executeWithRetry(
      async () => {
        if (!this.isAvailable || !this.client) {
          return -1;
        }

        return await this.client.ttl(key);
      },
      "ttl",
      { key }
    );
  }

  async keys(pattern: string): Promise<string[]> {
    return this.executeWithRetry(
      async () => {
        if (!this.isAvailable || !this.client) {
          return [];
        }

        return await this.client.keys(pattern);
      },
      "keys",
      { pattern }
    );
  }

  async flushdb(): Promise<boolean> {
    return this.executeWithRetry(
      async () => {
        if (!this.isAvailable || !this.client) {
          return false;
        }

        await this.client.flushdb();
        return true;
      },
      "flushdb",
      {}
    );
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    params: Record<string, any>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();

        // Log successful operation if it was retried
        if (attempt > 1) {
          this.logger.log(
            `Redis ${operationName} succeeded on attempt ${attempt}`,
            { params }
          );
        }

        return result;
      } catch (error) {
        lastError = error;

        this.logger.warn(
          `Redis ${operationName} failed on attempt ${attempt}/${maxRetries}: ${error.message}`,
          { params, attempt, error: error.message }
        );

        // If this is the last attempt, don't wait
        if (attempt === maxRetries) {
          break;
        }

        // Wait before retrying with exponential backoff
        const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // All retries failed
    this.logger.error(
      `Redis ${operationName} failed after ${maxRetries} attempts: ${lastError.message}`,
      { params, error: lastError.message }
    );

    // Return default values for failed operations
    if (operationName === "get") return null as T;
    if (
      operationName === "exists" ||
      operationName === "set" ||
      operationName === "del" ||
      operationName === "expire" ||
      operationName === "flushdb"
    )
      return false as T;
    if (operationName === "ttl") return -1 as T;
    if (operationName === "keys") return [] as T;

    throw lastError;
  }

  async healthCheck(): Promise<{
    isHealthy: boolean;
    error?: string;
    details?: any;
  }> {
    if (!this.client) {
      return {
        isHealthy: false,
        error: "Redis not configured",
        details: { configured: false },
      };
    }

    if (!this.isAvailable) {
      return {
        isHealthy: false,
        error: "Redis not available",
        details: {
          configured: true,
          available: false,
          reconnectAttempts: this.reconnectAttempts,
        },
      };
    }

    try {
      const start = Date.now();
      const pong = await this.client.ping();
      const responseTime = Date.now() - start;

      if (pong !== "PONG") {
        return {
          isHealthy: false,
          error: `Unexpected ping response: ${pong}`,
          details: { responseTime },
        };
      }

      return {
        isHealthy: true,
        details: {
          responseTime,
          configured: true,
          available: true,
          reconnectAttempts: this.reconnectAttempts,
        },
      };
    } catch (error) {
      return {
        isHealthy: false,
        error: error.message,
        details: {
          configured: true,
          available: false,
          reconnectAttempts: this.reconnectAttempts,
        },
      };
    }
  }
}
