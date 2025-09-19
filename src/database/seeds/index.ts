import { DatabaseService } from '../database.service';
import { seedProducts } from './products.seed';

export const runSeeds = async (db: DatabaseService) => {
  console.log('Starting database seeding...');
  
  try {
    await seedProducts(db);
    console.log('Database seeding completed successfully');
  } catch (error) {
    console.error('Database seeding failed:', error);
    throw error;
  }
};