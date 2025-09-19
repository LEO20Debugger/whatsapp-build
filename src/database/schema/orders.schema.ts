import { pgTable, uuid, varchar, decimal, timestamp, pgEnum, text } from 'drizzle-orm/pg-core';
import { customers } from './customers.schema';

export const orderStatusEnum = pgEnum('order_status', ['pending', 'confirmed', 'paid', 'processing', 'completed', 'cancelled']);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }).notNull(),
  status: orderStatusEnum('status').default('pending').notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  subtotalAmount: decimal('subtotal_amount', { precision: 10, scale: 2 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 10, scale: 2 }).default('0.00').notNull(),
  paymentReference: varchar('payment_reference', { length: 100 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});