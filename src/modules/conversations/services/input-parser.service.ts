import { Injectable, Logger } from "@nestjs/common";
import { ConversationState } from "../types/conversation.types";
import {
  ParsedInput,
  UserIntent,
  InputEntity,
  EntityType,
  InputValidationResult,
  ParsingContext,
} from "../types/input-parser.types";
import { StateTrigger } from "../types/state-machine.types";

@Injectable()
export class InputParserService {
  private readonly logger = new Logger(InputParserService.name);

  /** Parse user input and extract intent and entities */
  async parseInput(
    input: string,
    context: ParsingContext
  ): Promise<ParsedInput> {
    try {
      const sanitizedInput = this.sanitizeInput(input);
      const intent = this.detectIntent(sanitizedInput, context);
      const entities = this.extractEntities(sanitizedInput, intent);
      const trigger = this.mapIntentToTrigger(
        intent,
        context.currentState as ConversationState
      );

      const parsedInput: ParsedInput = {
        originalText: input,
        intent,
        entities,
        confidence: this.calculateConfidence(intent, entities, sanitizedInput),
        trigger,
      };

      this.logger.debug("Parsed user input", {
        input: sanitizedInput,
        intent,
        entitiesCount: entities.length,
        trigger,
        confidence: parsedInput.confidence,
      });

      return parsedInput;
    } catch (error) {
      this.logger.error("Error parsing user input", {
        input,
        error: error.message,
      });

      return {
        originalText: input,
        intent: UserIntent.UNKNOWN,
        entities: [],
        confidence: 0,
      };
    }
  }

  /** Sanitize user input */
  private sanitizeInput(input: string): string {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^\w\s\d.,!?-]/g, "") // Remove special characters except basic punctuation
      .replace(/\s+/g, " "); // Normalize whitespace
  }

  /**
   * Detect user intent from input
   */
  private detectIntent(input: string, context: ParsingContext): UserIntent {
    // Number selection patterns (1-5 for menu items, 0 for back)
    if (/^[0-5]$/.test(input.trim())) {
      if (input.trim() === "0") {
        return UserIntent.GO_BACK;
      }
      return UserIntent.ADD_TO_CART;
    }

    // Number with item patterns (e.g., "1 pizza", "2 burgers")
    if (/^[1-5]\s*(pizza|burger|salad|coffee|soda)s?$/i.test(input.trim())) {
      return UserIntent.ADD_TO_CART;
    }

    // Option selection patterns (e.g., "option 1", "I want option 3")
    if (/option\s*[1-5]/i.test(input)) {
      return UserIntent.ADD_TO_CART;
    }

    // Greeting patterns
    if (
      this.matchesPatterns(input, [
        "hi",
        "hello",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
      ])
    ) {
      return UserIntent.GREETING;
    }

    // Navigation patterns
    if (
      this.matchesPatterns(input, [
        "menu",
        "show menu",
        "view menu",
        "what can i order",
      ])
    ) {
      return UserIntent.VIEW_MENU;
    }

    if (this.matchesPatterns(input, ["back", "go back", "previous"])) {
      return UserIntent.GO_BACK;
    }

    if (
      this.matchesPatterns(input, [
        "start over",
        "restart",
        "begin again",
        "new order",
      ])
    ) {
      return UserIntent.START_OVER;
    }

    if (
      this.matchesPatterns(input, [
        "help",
        "how to",
        "what do i do",
        "commands",
      ])
    ) {
      return UserIntent.GET_HELP;
    }

    // Product patterns
    if (
      this.matchesPatterns(input, [
        "products",
        "show products",
        "what do you have",
        "catalog",
        "items",
      ])
    ) {
      return UserIntent.VIEW_PRODUCTS;
    }

    if (this.matchesPatterns(input, ["search", "find", "look for"])) {
      return UserIntent.SEARCH_PRODUCT;
    }

    // Order patterns
    if (
      this.matchesPatterns(input, [
        "add",
        "i want",
        "order",
        "buy",
        "get me",
        "add to cart",
      ])
    ) {
      return UserIntent.ADD_TO_CART;
    }

    if (
      this.matchesPatterns(input, [
        "remove",
        "delete",
        "take out",
        "remove from cart",
        "dont want",
      ])
    ) {
      return UserIntent.REMOVE_FROM_CART;
    }

    if (
      this.matchesPatterns(input, [
        "cart",
        "my order",
        "what do i have",
        "show cart",
      ])
    ) {
      return UserIntent.VIEW_CART;
    }

    if (
      this.matchesPatterns(input, ["clear cart", "empty cart", "remove all"])
    ) {
      return UserIntent.CLEAR_CART;
    }

    if (
      this.matchesPatterns(input, [
        "confirm",
        "yes confirm",
        "place order",
        "proceed",
        "checkout",
      ])
    ) {
      return UserIntent.CONFIRM_ORDER;
    }

    if (
      this.matchesPatterns(input, [
        "cancel",
        "cancel order",
        "dont want",
        "stop",
      ])
    ) {
      return UserIntent.CANCEL_ORDER;
    }

    // Payment patterns
    if (
      this.matchesPatterns(input, [
        "pay",
        "payment",
        "how to pay",
        "payment details",
      ])
    ) {
      return UserIntent.MAKE_PAYMENT;
    }

    if (
      this.matchesPatterns(input, [
        "paid",
        "payment done",
        "sent payment",
        "transferred",
        "confirm payment",
      ])
    ) {
      return UserIntent.CONFIRM_PAYMENT;
    }

    if (
      this.matchesPatterns(input, [
        "payment status",
        "check payment",
        "payment received",
      ])
    ) {
      return UserIntent.CHECK_PAYMENT_STATUS;
    }

    // General responses
    if (
      this.matchesPatterns(input, ["yes", "yeah", "yep", "ok", "okay", "sure"])
    ) {
      return UserIntent.YES;
    }

    if (this.matchesPatterns(input, ["no", "nope", "not now", "cancel"])) {
      return UserIntent.NO;
    }

    if (this.matchesPatterns(input, ["thanks", "thank you", "appreciate"])) {
      return UserIntent.THANK_YOU;
    }

    if (this.matchesPatterns(input, ["bye", "goodbye", "see you", "later"])) {
      return UserIntent.GOODBYE;
    }

    // Context-specific intents
    const currentState = context.currentState as ConversationState;

    // In greeting state, any product-related text might be starting conversation
    if (currentState === ConversationState.GREETING && input.length > 0) {
      return UserIntent.START_CONVERSATION;
    }

    return UserIntent.UNKNOWN;
  }

  /** Extract entities from input */
  private extractEntities(input: string, intent: UserIntent): InputEntity[] {
    const entities: InputEntity[] = [];

    // Extract quantities
    const quantityMatches = input.match(/(\d+)\s*(x|pieces?|items?)?/gi);
    if (quantityMatches) {
      quantityMatches.forEach((match) => {
        const quantity = match.match(/\d+/)?.[0];
        if (quantity) {
          entities.push({
            type: EntityType.QUANTITY,
            value: quantity,
            confidence: 0.9,
          });
        }
      });
    }

    // Extract product names from numbers or text
    if (
      intent === UserIntent.ADD_TO_CART ||
      intent === UserIntent.SEARCH_PRODUCT
    ) {
      // Handle numbered selections (1-5)
      const numberMatch = input.match(/^([1-5])(?:\s|$)/);
      if (numberMatch) {
        const menuItems = {
          "1": "Pizza",
          "2": "Burger",
          "3": "Salad",
          "4": "Coffee",
          "5": "Soda",
        };

        const productName = menuItems[numberMatch[1]];
        if (productName) {
          entities.push({
            type: EntityType.PRODUCT_NAME,
            value: productName,
            confidence: 0.95,
          });
        }
      }

      // Handle "option X" patterns
      const optionMatch = input.match(/option\s*([1-5])/i);
      if (optionMatch) {
        const menuItems = {
          "1": "Pizza",
          "2": "Burger",
          "3": "Salad",
          "4": "Coffee",
          "5": "Soda",
        };

        const productName = menuItems[optionMatch[1]];
        if (productName) {
          entities.push({
            type: EntityType.PRODUCT_NAME,
            value: productName,
            confidence: 0.9,
          });
        }
      }

      // Handle text-based product names
      const productPatterns = {
        pizza: "Pizza",
        burger: "Burger",
        salad: "Salad",
        coffee: "Coffee",
        soda: "Soda",
      };

      for (const [pattern, product] of Object.entries(productPatterns)) {
        if (input.toLowerCase().includes(pattern)) {
          entities.push({
            type: EntityType.PRODUCT_NAME,
            value: product,
            confidence: 0.8,
          });
          break; // Only match first product found
        }
      }

      // Fallback: Remove common words and extract potential product names
      if (
        entities.filter((e) => e.type === EntityType.PRODUCT_NAME).length === 0
      ) {
        const commonWords = [
          "i",
          "want",
          "to",
          "order",
          "buy",
          "get",
          "me",
          "a",
          "an",
          "the",
          "some",
        ];
        const words = input
          .split(" ")
          .filter(
            (word) =>
              word.length > 2 &&
              !commonWords.includes(word) &&
              !/^\d+$/.test(word)
          );

        if (words.length > 0) {
          entities.push({
            type: EntityType.PRODUCT_NAME,
            value: words.join(" "),
            confidence: 0.6,
          });
        }
      }
    }

    // Extract phone numbers
    const phoneMatches = input.match(
      /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g
    );
    if (phoneMatches) {
      phoneMatches.forEach((phone) => {
        entities.push({
          type: EntityType.PHONE_NUMBER,
          value: phone.replace(/\D/g, ""), // Remove non-digits
          confidence: 0.95,
        });
      });
    }

    // Extract payment references
    const paymentRefMatches = input.match(/PAY-[A-Z0-9-]+/gi);
    if (paymentRefMatches) {
      paymentRefMatches.forEach((ref) => {
        entities.push({
          type: EntityType.PAYMENT_REFERENCE,
          value: ref.toUpperCase(),
          confidence: 0.95,
        });
      });
    }

    // Extract amounts/prices
    const amountMatches = input.match(/\$?(\d+(?:\.\d{2})?)/g);
    if (
      amountMatches &&
      (intent === UserIntent.CONFIRM_PAYMENT ||
        intent === UserIntent.MAKE_PAYMENT)
    ) {
      amountMatches.forEach((amount) => {
        const numericAmount = amount.replace("$", "");
        entities.push({
          type: EntityType.AMOUNT,
          value: numericAmount,
          confidence: 0.8,
        });
      });
    }

    return entities;
  }

  /** Map intent to state machine trigger */
  private mapIntentToTrigger(
    intent: UserIntent,
    currentState: ConversationState
  ): StateTrigger | undefined {
    const intentToTriggerMap: Record<UserIntent, StateTrigger> = {
      [UserIntent.START_CONVERSATION]: StateTrigger.START_CONVERSATION,
      [UserIntent.VIEW_MENU]: StateTrigger.VIEW_PRODUCTS,
      [UserIntent.VIEW_PRODUCTS]: StateTrigger.VIEW_PRODUCTS,
      [UserIntent.ADD_TO_CART]: StateTrigger.ADD_TO_CART,
      [UserIntent.REMOVE_FROM_CART]: StateTrigger.REMOVE_FROM_CART,
      [UserIntent.CONFIRM_ORDER]: StateTrigger.CONFIRM_ORDER,
      [UserIntent.CANCEL_ORDER]: StateTrigger.CANCEL_ORDER,
      [UserIntent.MAKE_PAYMENT]: StateTrigger.MAKE_PAYMENT,
      [UserIntent.CONFIRM_PAYMENT]: StateTrigger.CONFIRM_PAYMENT,
      [UserIntent.GO_BACK]: StateTrigger.GO_BACK,
      [UserIntent.START_OVER]: StateTrigger.START_OVER,
      [UserIntent.GET_HELP]: StateTrigger.REQUEST_HELP,
      [UserIntent.VIEW_CART]: StateTrigger.REVIEW_ORDER,
      [UserIntent.SEARCH_PRODUCT]: StateTrigger.VIEW_PRODUCTS,
      [UserIntent.GET_PRODUCT_INFO]: StateTrigger.VIEW_PRODUCTS,
      [UserIntent.CLEAR_CART]: StateTrigger.CANCEL_ORDER,
      [UserIntent.CHECK_PAYMENT_STATUS]: StateTrigger.CONFIRM_PAYMENT,
      [UserIntent.GREETING]: StateTrigger.START_CONVERSATION,
      [UserIntent.GOODBYE]: StateTrigger.START_OVER,
      [UserIntent.THANK_YOU]: StateTrigger.START_OVER,
      [UserIntent.YES]: this.getContextualYesTrigger(currentState),
      [UserIntent.NO]: this.getContextualNoTrigger(currentState),
      [UserIntent.UNKNOWN]: undefined,
    };

    return intentToTriggerMap[intent];
  }

  /** Get contextual trigger for "yes" responses */
  private getContextualYesTrigger(
    currentState: ConversationState
  ): StateTrigger {
    switch (currentState) {
      case ConversationState.REVIEWING_ORDER:
        return StateTrigger.CONFIRM_ORDER;
      case ConversationState.AWAITING_PAYMENT:
        return StateTrigger.MAKE_PAYMENT;
      case ConversationState.PAYMENT_CONFIRMATION:
        return StateTrigger.PAYMENT_VERIFIED;
      default:
        return StateTrigger.START_CONVERSATION;
    }
  }

  /** Get contextual trigger for "no" responses */
  private getContextualNoTrigger(
    currentState: ConversationState
  ): StateTrigger {
    switch (currentState) {
      case ConversationState.REVIEWING_ORDER:
        return StateTrigger.GO_BACK;
      case ConversationState.AWAITING_PAYMENT:
        return StateTrigger.CANCEL_ORDER;
      case ConversationState.PAYMENT_CONFIRMATION:
        return StateTrigger.GO_BACK;
      default:
        return StateTrigger.START_OVER;
    }
  }

  /** Check if input matches any of the given patterns */
  private matchesPatterns(input: string, patterns: string[]): boolean {
    return patterns.some(
      (pattern) =>
        input.includes(pattern) ||
        input.startsWith(pattern) ||
        new RegExp(`\\b${pattern}\\b`).test(input)
    );
  }

  /** Calculate confidence score for parsed input */
  private calculateConfidence(
    intent: UserIntent,
    entities: InputEntity[],
    input: string
  ): number {
    let confidence = 0.5; // Base confidence

    // Boost confidence for known intents
    if (intent !== UserIntent.UNKNOWN) {
      confidence += 0.3;
    }

    // Boost confidence for extracted entities
    if (entities.length > 0) {
      const avgEntityConfidence =
        entities.reduce((sum, entity) => sum + entity.confidence, 0) /
        entities.length;
      confidence += avgEntityConfidence * 0.2;
    }

    // Boost confidence for longer, more specific inputs
    if (input.length > 10) {
      confidence += 0.1;
    }

    // Cap at 1.0
    return Math.min(confidence, 1.0);
  }

  /** Validate user input */
  validateInput(input: string): InputValidationResult {
    const errors: string[] = [];

    // Check if input is empty
    if (!input || input.trim().length === 0) {
      errors.push("Input cannot be empty");
    }

    // Check input length
    if (input.length > 500) {
      errors.push("Input is too long (maximum 500 characters)");
    }

    // Check for potentially harmful content
    const harmfulPatterns = [/<script/i, /javascript:/i, /on\w+\s*=/i];

    if (harmfulPatterns.some((pattern) => pattern.test(input))) {
      errors.push("Input contains potentially harmful content");
    }

    return {
      isValid: errors.length === 0,
      errors,
      sanitizedInput:
        errors.length === 0 ? this.sanitizeInput(input) : undefined,
    };
  }

  /** Get entity by type */
  getEntityByType(
    entities: InputEntity[],
    type: EntityType
  ): InputEntity | undefined {
    return entities.find((entity) => entity.type === type);
  }

  /** Get all entities by type */
  getEntitiesByType(entities: InputEntity[], type: EntityType): InputEntity[] {
    return entities.filter((entity) => entity.type === type);
  }
}
