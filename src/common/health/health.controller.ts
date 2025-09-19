import { Controller, Get } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { RedisService } from "../redis/redis.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  async getHealth() {
    const dbHealth = await this.databaseService.healthCheck();
    const connectionInfo = dbHealth.isHealthy
      ? await this.databaseService.getConnectionInfo().catch(() => null)
      : null;

    const redisHealth = await this.redisService.healthCheck();

    return {
      status: dbHealth.isHealthy ? "ok" : "error",
      timestamp: new Date().toISOString(),
      service: "whatsapp-chat-bot",
      version: process.env.npm_package_version || "1.0.0",
      database: {
        status: dbHealth.isHealthy ? "connected" : "disconnected",
        lastChecked: dbHealth.lastChecked,
        error: dbHealth.error,
        connections: connectionInfo,
      },
      redis: {
        status: redisHealth.isHealthy ? "connected" : "disconnected",
        available: this.redisService.isRedisAvailable(),
        error: redisHealth.error,
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  @Get("database")
  async getDatabaseHealth() {
    const health = await this.databaseService.healthCheck();
    const connectionInfo = health.isHealthy
      ? await this.databaseService.getConnectionInfo().catch(() => null)
      : null;

    return {
      ...health,
      connections: connectionInfo,
    };
  }

  @Get("ready")
  async getReadiness() {
    const dbHealth = await this.databaseService.healthCheck();

    if (!dbHealth.isHealthy) {
      throw new Error("Service not ready: Database is not healthy");
    }

    return {
      status: "ready",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("redis")
  async getRedisHealth() {
    const health = await this.redisService.healthCheck();

    return {
      ...health,
      available: this.redisService.isRedisAvailable(),
    };
  }

  @Get("live")
  getLiveness() {
    return {
      status: "alive",
      timestamp: new Date().toISOString(),
    };
  }
}
