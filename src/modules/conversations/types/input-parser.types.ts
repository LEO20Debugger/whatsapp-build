import { StateTrigger } from "./state-machine.types";

/** Parsed user input with intent and entities */
export interface ParsedInput {
  originalText: string;
  intent: UserIntent;
  entities: InputEntity[];
  confidence: number;
  trigger?: StateTrigger;
}

/** User intents that can be detected from messages */
export enum UserIntent {
  // Navigation intents
  START_CONVERSATION = "start_conversation",
  VIEW_MENU = "view_menu",
  GO_BACK = "go_back",
  START_OVER = "start_over",
  GET_HELP = "get_help",

  // Product intents
  VIEW_PRODUCTS = "view_products",
  SEARCH_PRODUCT = "search_product",
  GET_PRODUCT_INFO = "get_product_info",

  // Order intents
  ADD_TO_CART = "add_to_cart",
  REMOVE_FROM_CART = "remove_from_cart",
  VIEW_CART = "view_cart",
  CLEAR_CART = "clear_cart",
  CONFIRM_ORDER = "confirm_order",
  CANCEL_ORDER = "cancel_order",

  // Payment intents
  MAKE_PAYMENT = "make_payment",
  CONFIRM_PAYMENT = "confirm_payment",
  CHECK_PAYMENT_STATUS = "check_payment_status",

  // General intents
  GREETING = "greeting",
  GOODBYE = "goodbye",
  THANK_YOU = "thank_you",
  YES = "yes",
  NO = "no",
  UNKNOWN = "unknown",
}

/** Entities extracted from user input */
export interface InputEntity {
  type: EntityType;
  value: string;
  confidence: number;
  startIndex?: number;
  endIndex?: number;
}

/** Types of entities that can be extracted */
export enum EntityType {
  PRODUCT_NAME = "product_name",
  PRODUCT_ID = "product_id",
  QUANTITY = "quantity",
  PHONE_NUMBER = "phone_number",
  PAYMENT_REFERENCE = "payment_reference",
  AMOUNT = "amount",
  CUSTOMER_NAME = "customer_name",
}

/** Input validation result */
export interface InputValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedInput?: string;
}

/** Context for input parsing */
export interface ParsingContext {
  currentState: string;
  previousMessages: string[];
  sessionContext: Record<string, any>;
}
