import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as path from "path";
const postgres = require("postgres");

@Injectable()
export class MigrationService {
  constructor(private configService: ConfigService) {}

  async runMigrations(): Promise<void> {
    const connectionString = this.configService.get<string>("DATABASE_URL");

    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured");
    }

    // Create a separate connection for migrations
    const migrationClient = postgres(connectionString, { max: 1 });
    const db = drizzle(migrationClient);

    try {
      console.log("Running database migrations...");

      const migrationsFolder = path.join(__dirname, "migrations");
      await migrate(db, { migrationsFolder });

      console.log("Database migrations completed successfully");
    } catch (error) {
      console.error("Migration failed:", error);
      throw error;
    } finally {
      await migrationClient.end();
    }
  }

  async checkMigrationStatus(): Promise<boolean> {
    const connectionString = this.configService.get<string>("DATABASE_URL");

    if (!connectionString) {
      return false;
    }

    const client = postgres(connectionString, { max: 1 });

    try {
      // Check if the drizzle migrations table exists
      const result = await client`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'drizzle' 
          AND table_name = '__drizzle_migrations'
        );
      `;

      return result[0]?.exists || false;
    } catch (error) {
      console.error("Error checking migration status:", error);
      return false;
    } finally {
      await client.end();
    }
  }
}
