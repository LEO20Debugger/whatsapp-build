import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const postgres = require('postgres');

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('DATABASE_URL is not configured');
    process.exit(1);
  }

  console.log('Connecting to database...');
  
  // Create a separate connection for migrations
  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);

  try {
    console.log('Running database migrations...');
    
    const migrationsFolder = path.join(__dirname, '..', 'src', 'database', 'migrations');
    console.log('Migrations folder:', migrationsFolder);
    
    await migrate(db, { migrationsFolder });
    
    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await migrationClient.end();
    console.log('Database connection closed');
  }
}

runMigrations();