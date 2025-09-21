import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { ProductsModule } from "../products/products.module";
import { OrdersRepository } from "./orders.repository";
import { OrderItemsRepository } from "./order-items.repository";
import { OrdersService } from "./orders.service";

@Module({
  imports: [DatabaseModule, ProductsModule],
  providers: [OrdersRepository, OrderItemsRepository, OrdersService],
  exports: [OrdersRepository, OrderItemsRepository, OrdersService],
})
export class OrdersModule {}
