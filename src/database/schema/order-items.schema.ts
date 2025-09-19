import { pgTable, uuid, integer, decimal, varchar } from 'drizzle-orm/pg-core';
import { orders } from './orders.schema';
import { products } from './products.schema';

export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }).notNull(),
  productName: varchar('product_name', { length: 200 }).notNull(), // Store product name at time of order
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal('total_price', { precision: 10, scale: 2 }).notNull()
});