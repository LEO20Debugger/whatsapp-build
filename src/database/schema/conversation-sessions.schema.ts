import { pgTable, uuid, varchar, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';
import { customers } from './customers.schema';

export const conversationStateEnum = pgEnum('conversation_state', [
  'greeting',
  'browsing_products', 
  'adding_to_cart',
  'reviewing_order',
  'awaiting_payment',
  'payment_confirmation',
  'order_complete'
]);

export const conversationSessions = pgTable('conversation_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneNumber: varchar('phone_number', { length: 20 }).notNull(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'cascade' }),
  currentState: conversationStateEnum('current_state').default('greeting').notNull(),
  context: jsonb('context').default('{}').notNull(), // Store conversation context as JSON
  lastActivity: timestamp('last_activity').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
});