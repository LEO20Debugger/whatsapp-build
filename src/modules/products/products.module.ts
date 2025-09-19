import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProductsRepository } from './products.repository';

@Module({
  imports: [DatabaseModule],
  providers: [ProductsRepository],
  exports: [ProductsRepository],
})
export class ProductsModule {}