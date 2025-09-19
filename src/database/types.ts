import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { 
  customers, 
  products, 
  orders, 
  orderItems, 
  payments,
  conversationSessions,
  messageLogs
} from './schema';

// Select types (for reading from database)
export type Customer = InferSelectModel<typeof customers>;
export type Product = InferSelectModel<typeof products>;
export type Order = InferSelectModel<typeof orders>;
export type OrderItem = InferSelectModel<typeof orderItems>;
export type Payment = InferSelectModel<typeof payments>;
export type ConversationSession = InferSelectModel<typeof conversationSessions>;
export type MessageLog = InferSelectModel<typeof messageLogs>;

// Insert types (for creating new records)
export type NewCustomer = InferInsertModel<typeof customers>;
export type NewProduct = InferInsertModel<typeof products>;
export type NewOrder = InferInsertModel<typeof orders>;
export type NewOrderItem = InferInsertModel<typeof orderItems>;
export type NewPayment = InferInsertModel<typeof payments>;
export type NewConversationSession = InferInsertModel<typeof conversationSessions>;
export type NewMessageLog = InferInsertModel<typeof messageLogs>;

// Update types (for updating existing records)
export type UpdateCustomer = Partial<Omit<Customer, 'id' | 'createdAt'>>;
export type UpdateProduct = Partial<Omit<Product, 'id' | 'createdAt'>>;
export type UpdateOrder = Partial<Omit<Order, 'id' | 'createdAt'>>;
export type UpdateOrderItem = Partial<Omit<OrderItem, 'id'>>;
export type UpdatePayment = Partial<Omit<Payment, 'id' | 'createdAt'>>;
export type UpdateConversationSession = Partial<Omit<ConversationSession, 'id' | 'createdAt'>>;
export type UpdateMessageLog = Partial<Omit<MessageLog, 'id' | 'createdAt'>>;

// Enum types
export type OrderStatus = 'pending' | 'confirmed' | 'paid' | 'processing' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'verified' | 'failed' | 'refunded';
export type PaymentMethod = 'bank_transfer' | 'mobile_money' | 'card' | 'cash';
export type ConversationState = 'greeting' | 'browsing_products' | 'adding_to_cart' | 'reviewing_order' | 'awaiting_payment' | 'payment_confirmation' | 'order_complete';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

// Extended types with relations
export type OrderWithItems = Order & {
  items: OrderItem[];
  customer: Customer;
  payments: Payment[];
};

export type OrderItemWithProduct = OrderItem & {
  product: Product;
};

export type CustomerWithOrders = Customer & {
  orders: Order[];
};