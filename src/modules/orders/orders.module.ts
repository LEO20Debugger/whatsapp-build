import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { OrdersRepository } from './orders.repository';
import { OrderItemsRepository } from './order-items.repository';

@Module({
  imports: [DatabaseModule],
  providers: [OrdersRepository, OrderItemsRepository],
  exports: [OrdersRepository, OrderItemsRepository],
})
export class OrdersModule {}