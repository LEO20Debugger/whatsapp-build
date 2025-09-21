export enum ConversationState {
  GREETING = "greeting",
  COLLECTING_NAME = "collecting_name",
  MAIN_MENU = "main_menu",
  BROWSING_PRODUCTS = "browsing_products",
  ADDING_TO_CART = "adding_to_cart",
  COLLECTING_QUANTITY = "collecting_quantity",
  REVIEWING_ORDER = "reviewing_order",
  AWAITING_PAYMENT = "awaiting_payment",
  PAYMENT_CONFIRMATION = "payment_confirmation",
  ORDER_COMPLETE = "order_complete",
}

// Re-export types from other modules for convenience
export * from "./state-machine.types";
export * from "./input-parser.types";

export interface OrderItem {
  productId: string;
  quantity: number;
  name: string;
  price: number;
}

export interface CurrentOrder {
  items: OrderItem[];
  totalAmount?: number;
}

export interface ConversationSession {
  phoneNumber: string;
  currentState: ConversationState;
  currentOrder?: CurrentOrder;
  lastActivity: Date;
  context: Record<string, any>;
  customerId?: string;
}

export interface SessionStorageOptions {
  ttl?: number; // Time to live in seconds
}

export interface BotResponse {
  message: string;
  nextState?: ConversationState;
  context?: Record<string, any>;
  processingMetadata?: {
    messageId: string;
    processedAt: number;
    processingTime: number;
  };
}
