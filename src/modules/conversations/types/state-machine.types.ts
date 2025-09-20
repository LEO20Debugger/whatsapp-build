import { ConversationState } from "./conversation.types";

/**
 * Represents a state transition with validation rules
 */
export interface StateTransition {
  from: ConversationState;
  to: ConversationState;
  trigger: string;
  condition?: (context: Record<string, any>) => boolean;
  action?: (context: Record<string, any>) => Record<string, any>;
}

/**
 * State machine configuration
 */
export interface StateMachineConfig {
  initialState: ConversationState;
  transitions: StateTransition[];
  states: StateDefinition[];
}

/**
 * Definition of a conversation state
 */
export interface StateDefinition {
  state: ConversationState;
  description: string;
  allowedTransitions: ConversationState[];
  isTerminal?: boolean;
  timeout?: number; // in seconds
}

/**
 * Result of a state transition attempt
 */
export interface TransitionResult {
  success: boolean;
  newState?: ConversationState;
  error?: string;
  context?: Record<string, any>;
}

/**
 * State machine validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Triggers for state transitions
 */
export enum StateTrigger {
  // User actions
  START_CONVERSATION = "start_conversation",
  VIEW_PRODUCTS = "view_products",
  ADD_TO_CART = "add_to_cart",
  REMOVE_FROM_CART = "remove_from_cart",
  REVIEW_ORDER = "review_order",
  CONFIRM_ORDER = "confirm_order",
  CANCEL_ORDER = "cancel_order",
  MAKE_PAYMENT = "make_payment",
  CONFIRM_PAYMENT = "confirm_payment",
  REQUEST_HELP = "request_help",

  // System actions
  PAYMENT_TIMEOUT = "payment_timeout",
  PAYMENT_VERIFIED = "payment_verified",
  PAYMENT_FAILED = "payment_failed",
  ORDER_COMPLETED = "order_completed",
  SESSION_TIMEOUT = "session_timeout",
  ERROR_OCCURRED = "error_occurred",

  // Navigation
  GO_BACK = "go_back",
  START_OVER = "start_over",
}

/**
 * Context keys used in state machine
 */
export enum ContextKey {
  CURRENT_ORDER = "currentOrder",
  SELECTED_PRODUCTS = "selectedProducts",
  SELECTED_PRODUCT_FOR_QUANTITY = "selectedProductForQuantity",
  PAYMENT_REFERENCE = "paymentReference",
  ORDER_ID = "orderId",
  ORDER_TOTAL = "orderTotal",
  CUSTOMER_INFO = "customerInfo",
  CUSTOMER_NAME = "customerName",
  IS_NEW_CUSTOMER = "isNewCustomer",
  ERROR_COUNT = "errorCount",
  LAST_MESSAGE = "lastMessage",
  RETRY_COUNT = "retryCount",
  ORDER_VALIDATION_ERRORS = "orderValidationErrors",
}
