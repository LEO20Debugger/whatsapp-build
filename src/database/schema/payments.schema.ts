import { pgTable, uuid, varchar, decimal, timestamp, pgEnum, text } from 'drizzle-orm/pg-core';
import { orders } from './orders.schema';

export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'verified', 'failed', 'refunded']);
export const paymentMethodEnum = pgEnum('payment_method', ['bank_transfer', 'mobile_money', 'card', 'cash']);

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'cascade' }).notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  paymentReference: varchar('payment_reference', { length: 100 }).unique(),
  externalTransactionId: varchar('external_transaction_id', { length: 100 }),
  status: paymentStatusEnum('status').default('pending').notNull(),
  failureReason: text('failure_reason'),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});