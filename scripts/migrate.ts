import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { MigrationService } from '../src/database/migration.service';
import { runSeeds } from '../src/database/seeds';

async function runMigrations() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    const migrationService = app.get(MigrationService);
    const databaseService = app.get(DatabaseService);

    // Run migrations
    await migrationService.runMigrations();
    
    // Run seeds if requested
    const shouldSeed = process.argv.includes('--seed');
    if (shouldSeed) {
      await runSeeds(databaseService);
    }

    console.log('Migration process completed successfully');
  } catch (error) {
    console.error('Migration process failed:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

runMigrations();