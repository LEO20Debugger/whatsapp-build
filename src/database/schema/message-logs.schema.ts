import { pgTable, uuid, varchar, text, timestamp, pgEnum, boolean } from 'drizzle-orm/pg-core';
import { customers } from './customers.schema';

export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);
export const messageStatusEnum = pgEnum('message_status', ['sent', 'delivered', 'read', 'failed']);

export const messageLogs = pgTable('message_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  phoneNumber: varchar('phone_number', { length: 20 }).notNull(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  direction: messageDirectionEnum('direction').notNull(),
  content: text('content').notNull(),
  messageType: varchar('message_type', { length: 50 }).default('text').notNull(),
  whatsappMessageId: varchar('whatsapp_message_id', { length: 100 }),
  status: messageStatusEnum('status').default('sent').notNull(),
  isProcessed: boolean('is_processed').default(false).notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull()
});