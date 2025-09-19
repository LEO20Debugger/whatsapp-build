import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
const postgres = require('postgres');
import * as schema from './schema';

export interface DatabaseHealthStatus {
  isHealthy: boolean;
  connectionCount?: number;
  lastChecked: Date;
  error?: string;
}

export interface TransactionOptions {
  isolationLevel?: 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';
  accessMode?: 'read write' | 'read only';
  deferrable?: boolean;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private client: any;
  public db: ReturnType<typeof drizzle>;
  private isConnected = false;
  private connectionAttempts = 0;
  private readonly maxRetries = 5;
  private readonly retryDelay = 2000; // 2 seconds

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    const connectionString = this.configService.get<string>('DATABASE_URL');
    
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }

    const isDevelopment = this.configService.get('NODE_ENV') === 'development';

    this.client = postgres(connectionString, {
      max: this.configService.get('DB_POOL_SIZE', 10), // 10 concurrent connections allowed
      idle_timeout: this.configService.get('DB_IDLE_TIMEOUT', 20), // free idle connections after 20s
      connect_timeout: this.configService.get('DB_CONNECT_TIMEOUT', 10), // give up if DB doesn’t respond in 10s
      prepare: !isDevelopment, // Disable prepared statements in development for better debugging
      onnotice: isDevelopment ? this.logger.debug.bind(this.logger) : undefined,
      debug: isDevelopment,
    });

    this.db = drizzle(this.client, { 
      schema,
      logger: isDevelopment,
    });
    
    await this.testConnection();
  }

  private async testConnection(): Promise<void> {
    while (this.connectionAttempts < this.maxRetries) {
      try {
        await this.client`SELECT 1 as test`;
        this.isConnected = true;
        this.connectionAttempts = 0;
        this.logger.log('Database connected successfully');
        return;
      } catch (error) {
        this.connectionAttempts++;
        this.logger.error(
          `Database connection attempt ${this.connectionAttempts}/${this.maxRetries} failed:`,
          error.message
        );

        if (this.connectionAttempts >= this.maxRetries) {
          throw new Error(`Failed to connect to database after ${this.maxRetries} attempts: ${error.message}`);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }
  }

  private async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      try {
        await this.client.end();
        this.isConnected = false;
        this.logger.log('Database disconnected successfully');
      } catch (error) {
        this.logger.error('Error disconnecting from database:', error.message);
      }
    }
  }

  async healthCheck(): Promise<DatabaseHealthStatus> {
    const lastChecked = new Date();
    
    try {
      if (!this.isConnected) {
        return {
          isHealthy: false,
          lastChecked,
          error: 'Database not connected'
        };
      }

      // Test query with timeout
      const result = await Promise.race([
        this.client`SELECT 1 as health_check, current_timestamp as server_time`,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        )
      ]) as any[];

      return {
        isHealthy: true,
        lastChecked,
        connectionCount: this.client.options.max,
      };
    } catch (error) {
      this.logger.error('Database health check failed:', error.message);
      return {
        isHealthy: false,
        lastChecked,
        error: error.message
      };
    }
  }

  async getConnectionInfo(): Promise<{
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
  }> {
    try {
      const result = await this.client`
        SELECT 
          count(*) as total_connections,
          count(*) FILTER (WHERE state = 'active') as active_connections,
          count(*) FILTER (WHERE state = 'idle') as idle_connections
        FROM pg_stat_activity 
        WHERE datname = current_database()
      `;

      return {
        totalConnections: parseInt(result[0].total_connections),
        activeConnections: parseInt(result[0].active_connections),
        idleConnections: parseInt(result[0].idle_connections),
      };
    } catch (error) {
      this.logger.error('Failed to get connection info:', error.message);
      throw error;
    }
  }

  async transaction<T>(
    callback: (tx: any) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    try {
      return await this.db.transaction(callback, options);
    } catch (error) {
      this.logger.error('Transaction failed:', error.message);
      throw error;
    }
  }

  async executeRaw(query: string, params?: any[]): Promise<any[]> {
    try {
      if (params) {
        return await this.client.unsafe(query, params);
      }
      return await this.client.unsafe(query);
    } catch (error) {
      this.logger.error('Raw query execution failed:', error.message);
      throw error;
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  getClient(): any {
    if (!this.isConnected) {
      throw new Error('Database is not connected');
    }
    return this.client;
  }
}