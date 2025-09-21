import { InferSelectModel, InferInsertModel } from "drizzle-orm";
import {
  customers,
  products,
  orders,
  orderItems,
  payments,
  conversationSessions,
  messageLogs,
} from "./schema";

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
export type NewConversationSession = InferInsertModel<
  typeof conversationSessions
>;
export type NewMessageLog = InferInsertModel<typeof messageLogs>;

// Update types (for updating existing records)
export type UpdateCustomer = Partial<Omit<Customer, "id" | "createdAt">>;
export type UpdateProduct = Partial<Omit<Product, "id" | "createdAt">>;
export type UpdateOrder = Partial<Omit<Order, "id" | "createdAt">>;
export type UpdateOrderItem = Partial<Omit<OrderItem, "id">>;
export type UpdatePayment = Partial<Omit<Payment, "id" | "createdAt">>;
export type UpdateConversationSession = Partial<
  Omit<ConversationSession, "id" | "createdAt">
>;
export type UpdateMessageLog = Partial<Omit<MessageLog, "id" | "createdAt">>;

// Enum types
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "paid"
  | "processing"
  | "completed"
  | "cancelled";
export type PaymentStatus = "pending" | "verified" | "failed" | "refunded";
export type PaymentMethod = "bank_transfer" | "mobile_money" | "card" | "cash";
export type ConversationState =
  | "greeting"
  | "browsing_products"
  | "adding_to_cart"
  | "reviewing_order"
  | "awaiting_payment"
  | "payment_confirmation"
  | "order_complete";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "sent" | "delivered" | "read" | "failed";

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

// Conversation-specific types for repositories
export type CreateConversationSession = Omit<NewConversationSession, "id" | "createdAt" | "updatedAt">;
export type CreateMessageLog = Omit<NewMessageLog, "id" | "createdAt">;

// Enhanced conversation session with computed fields for analytics
export type ConversationSessionWithMetrics = ConversationSession & {
  duration?: number;
  messageCount?: number;
  stateTransitions?: StateTransition[];
};

export type MessageLogWithContext = MessageLog & {
  conversationState?: ConversationState;
  sessionContext?: Record<string, any>;
};

// State transition tracking
export interface StateTransition {
  fromState: ConversationState;
  toState: ConversationState;
  timestamp: Date;
  trigger?: string;
}

// Analytics types
export interface SessionMetrics {
  totalSessions: number;
  activeSessions: number;
  completedOrders: number;
  averageDuration: number;
  conversionRate: number;
  sessionsByState: Record<ConversationState, number>;
}

export interface MessageMetrics {
  totalMessages: number;
  inboundMessages: number;
  outboundMessages: number;
  averageResponseTime: number;
  errorRate: number;
}

export interface ProductPopularity {
  productId: string;
  productName: string;
  viewCount: number;
  addToCartCount: number;
  purchaseCount: number;
  conversionRate: number;
}

export interface ConversionFunnel {
  stage: ConversationState;
  count: number;
  conversionRate: number;
}

export interface CustomerJourney {
  phoneNumber: string;
  sessions: ConversationSession[];
  totalMessages: number;
  averageSessionDuration: number;
  conversionRate: number;
  lastActivity: Date;
}

export interface DashboardMetrics {
  sessionMetrics: SessionMetrics;
  messageMetrics: MessageMetrics;
  popularProducts: ProductPopularity[];
  conversionFunnel: ConversionFunnel[];
}

export interface ProductPerformance {
  productId: string;
  productName: string;
  totalViews: number;
  totalAddedToCart: number;
  totalPurchased: number;
  conversionRate: number;
  averageTimeToDecision: number;
}

export interface ConversionAnalysis {
  overallConversionRate: number;
  conversionByState: Record<ConversationState, number>;
  dropOffPoints: DropOffPoint[];
  averageTimeToConversion: number;
}

export interface DropOffPoint {
  state: ConversationState;
  dropOffRate: number;
  commonReasons: string[];
  suggestedImprovements: string[];
}

// Repository interfaces
export interface ConversationSessionRepository {
  create(session: CreateConversationSession): Promise<ConversationSession>;
  findByPhoneNumber(phoneNumber: string): Promise<ConversationSession | null>;
  findById(id: string): Promise<ConversationSession | null>;
  update(id: string, updates: UpdateConversationSession): Promise<ConversationSession>;
  delete(id: string): Promise<boolean>;
  
  // Analytics queries
  findActiveSessions(): Promise<ConversationSession[]>;
  findByDateRange(startDate: Date, endDate: Date): Promise<ConversationSession[]>;
  getSessionsByState(state: ConversationState): Promise<ConversationSession[]>;
  getSessionMetrics(timeframe: 'day' | 'week' | 'month'): Promise<SessionMetrics>;
}

export interface MessageLogRepository {
  logMessage(message: CreateMessageLog): Promise<MessageLog>;
  getConversationHistory(phoneNumber: string, limit?: number): Promise<MessageLog[]>;
  getMessagesByDateRange(startDate: Date, endDate: Date): Promise<MessageLog[]>;
  
  // Analytics queries
  getMessageMetrics(timeframe: 'day' | 'week' | 'month'): Promise<MessageMetrics>;
  getPopularProducts(): Promise<ProductPopularity[]>;
  getConversionFunnelData(): Promise<ConversionFunnel[]>;
}

export interface HybridSessionManager {
  // Session Management
  getSession(phoneNumber: string): Promise<ConversationSession | null>;
  createSession(phoneNumber: string, initialState?: ConversationState): Promise<ConversationSession>;
  updateSession(session: ConversationSession): Promise<boolean>;
  deleteSession(phoneNumber: string): Promise<boolean>;
  
  // Recovery Operations
  restoreSessionFromDatabase(phoneNumber: string): Promise<ConversationSession | null>;
  syncActiveSessionsToDatabase(): Promise<number>;
  
  // Analytics Support
  getSessionHistory(phoneNumber: string, limit?: number): Promise<ConversationSession[]>;
  getActiveSessionsCount(): Promise<number>;
}

export interface ConversationAnalyticsService {
  getDashboardMetrics(): Promise<DashboardMetrics>;
  getCustomerJourneyAnalysis(phoneNumber: string): Promise<CustomerJourney>;
  getProductPerformanceReport(): Promise<ProductPerformance[]>;
  getConversionRateAnalysis(): Promise<ConversionAnalysis>;
  getDropOffAnalysis(): Promise<DropOffPoint[]>;
}
