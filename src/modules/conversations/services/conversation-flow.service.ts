import { Injectable, Logger } from "@nestjs/common";
import {
  ConversationState,
  BotResponse,
  ConversationSession,
} from "../types/conversation.types";
import {
  ParsedInput,
  UserIntent,
  EntityType,
} from "../types/input-parser.types";
import { StateTrigger, ContextKey } from "../types/state-machine.types";
import { StateMachineService } from "./state-machine.service";
import { InputParserService } from "./input-parser.service";
import { ConversationSessionService } from "./conversation-session.service";

@Injectable()
export class ConversationFlowService {
  private readonly logger = new Logger(ConversationFlowService.name);

  constructor(
    private readonly stateMachineService: StateMachineService,
    private readonly inputParserService: InputParserService,
    private readonly sessionService: ConversationSessionService,
  ) {}

  /**
   * Process incoming message and generate response
   */
  async processMessage(
    phoneNumber: string,
    message: string,
  ): Promise<BotResponse> {
    try {
      const validation = this.inputParserService.validateInput(message);
      if (!validation.isValid) {
        return {
          message:
            "Sorry, I couldn't understand your message. Please try again.",
        };
      }

      let session = await this.sessionService.getSession(phoneNumber);
      if (!session) {
        session = await this.sessionService.createSession(phoneNumber);
        if (!session) {
          return {
            message:
              "Sorry, I'm having trouble starting our conversation. Please try again later.",
          };
        }
      }

      const parsedInput = await this.inputParserService.parseInput(message, {
        currentState: session.currentState,
        previousMessages: [session.context[ContextKey.LAST_MESSAGE] || ""],
        sessionContext: session.context,
      });

      session.context[ContextKey.LAST_MESSAGE] = message;

      const response = await this.handleStateFlow(session, parsedInput);

      if (response.nextState && response.nextState !== session.currentState) {
        await this.sessionService.updateState(
          phoneNumber,
          response.nextState,
          response.context || session.context,
        );
      } else if (response.context) {
        await this.sessionService.updateContext(phoneNumber, response.context);
      }

      return response;
    } catch (error) {
      this.logger.error("Error processing message", {
        phoneNumber,
        message,
        error: error.message,
      });
      return {
        message:
          'Sorry, I encountered an error. Please try again or type "help" for assistance.',
      };
    }
  }

  /**
   * Handle conversation flow based on current state
   */
  private async handleStateFlow(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): Promise<BotResponse> {
    const stateHandlers = {
      [ConversationState.GREETING]: this.handleGreetingState.bind(this),
      [ConversationState.BROWSING_PRODUCTS]:
        this.handleBrowsingProductsState.bind(this),
      [ConversationState.ADDING_TO_CART]:
        this.handleAddingToCartState.bind(this),
      [ConversationState.REVIEWING_ORDER]:
        this.handleReviewingOrderState.bind(this),
      [ConversationState.AWAITING_PAYMENT]:
        this.handleAwaitingPaymentState.bind(this),
      [ConversationState.PAYMENT_CONFIRMATION]:
        this.handlePaymentConfirmationState.bind(this),
      [ConversationState.ORDER_COMPLETE]:
        this.handleOrderCompleteState.bind(this),
    };

    const handler = stateHandlers[session.currentState];
    if (handler) return handler(session, parsedInput);

    return {
      message: "I'm not sure what to do right now. Let me start over.",
      nextState: ConversationState.GREETING,
    };
  }

  /**
   * Handle greeting state
   */
  private handleGreetingState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const { intent, trigger } = parsedInput;

    if (intent === UserIntent.GET_HELP) {
      return {
        message: `🤖 **HELP MENU**\n\n1️⃣ View our menu\n2️⃣ Place an order\n3️⃣ Check order status\n4️⃣ Start over\n5️⃣ Contact support\n0️⃣ Go back\n\n💡 **TIPS:**\n• Use numbers (1-5) for quick selection\n• Type "menu" to see products\n• Type "0" to go back anytime\n\nType a number (0-5):`,
      };
    }

    if (trigger === StateTrigger.VIEW_PRODUCTS) {
      return {
        message: `Great! Let me show you our available products.\n\nPlease wait while I fetch our current menu...`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }

    if (
      trigger === StateTrigger.START_CONVERSATION ||
      intent === UserIntent.GREETING
    ) {
      return {
        message: `Hello! 👋 Welcome to our WhatsApp ordering service!\n\n🍽️ I can help you:\n• Browse our products\n• Place orders\n• Make payments\n\n📱 **QUICK START:**\n• Type "menu" to see our products\n• Type "help" for more options\n• Use numbers (1-5) to order quickly!\n\nWhat would you like to do today?`,
      };
    }

    return {
      message: `Hi there! I'm here to help you place an order.\n\nType "menu" to see our products or "help" for assistance.`,
    };
  }

  /**
   * Handle browsing products state
   */
  private handleBrowsingProductsState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const { intent, trigger, entities } = parsedInput;

    if (trigger === StateTrigger.GO_BACK)
      return {
        message: "Going back to the main menu.",
        nextState: ConversationState.GREETING,
      };

    if (trigger === StateTrigger.ADD_TO_CART) {
      const productEntity = this.inputParserService.getEntityByType(
        entities,
        EntityType.PRODUCT_NAME,
      );
      const quantityEntity = this.inputParserService.getEntityByType(
        entities,
        EntityType.QUANTITY,
      );
      if (productEntity) {
        const quantity = quantityEntity ? parseInt(quantityEntity.value) : 1;
        return {
          message: `✅ Adding ${quantity}x ${productEntity.value} to your cart...\n\nWhat would you like to do next?\n\n1️⃣ Add more items\n2️⃣ Review your order\n3️⃣ Continue browsing\n0️⃣ Go back\n\nType a number (0-3):`,
          nextState: ConversationState.ADDING_TO_CART,
          context: {
            ...session.context,
            [ContextKey.SELECTED_PRODUCTS]: [
              { name: productEntity.value, quantity },
            ],
          },
        };
      } else {
        return {
          message: `Please tell me which product you'd like and how many.\nFor example:\n• "2 pizzas"\n• "1 burger"\n• "3 coffees"\n\nWhat would you like to order?`,
        };
      }
    }

    if (intent === UserIntent.SEARCH_PRODUCT) {
      const productEntity = this.inputParserService.getEntityByType(
        entities,
        EntityType.PRODUCT_NAME,
      );
      if (productEntity) {
        return {
          message: `Searching for "${productEntity.value}"...\n\nHere are the matching products:\n[Product search results would be displayed here]\n\nTo add any item to your cart, just say "add [product name]" or "I want [product name]".`,
        };
      }
    }

    return {
      message: `🍽️ **OUR MENU**\n\n1️⃣ Pizza - ₦4,500\n2️⃣ Burger - ₦3,200\n3️⃣ Salad - ₦2,800\n4️⃣ Coffee - ₦1,400\n5️⃣ Soda - ₦900\n\n📱 **HOW TO ORDER:**\n• Type the number: "1" for Pizza\n• Or type: "1 pizza" or "2 burgers"\n• Or say: "I want option 3"\n\n🛒 Type a number to add to cart!\n🔙 Type "0" to go back\n\nWhat would you like to order?`,
    };
  }

  /**
   * Handle adding to cart state
   */
  private async handleAddingToCartState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): Promise<BotResponse> {
    const { trigger, entities } = parsedInput;

    // Merge selected products into current order
    const selectedProducts =
      session.context[ContextKey.SELECTED_PRODUCTS] || [];
    let currentOrder = session.context[ContextKey.CURRENT_ORDER] || {
      items: [],
    };

    selectedProducts.forEach((product: any) => {
      const existing = currentOrder.items.find(
        (i: any) => i.name === product.name,
      );
      if (existing) existing.quantity += product.quantity;
      else
        currentOrder.items.push({
          ...product,
          price: this.getProductPrice(product.name),
        });
    });

    currentOrder.totalAmount = currentOrder.items.reduce(
      (sum, item) => sum + (item.price || 0) * (item.quantity || 1),
      0,
    );
    session.context[ContextKey.CURRENT_ORDER] = currentOrder;
    session.context[ContextKey.SELECTED_PRODUCTS] = [];
    await this.sessionService.updateContext(
      session.phoneNumber,
      session.context,
    );

    if (trigger === StateTrigger.REVIEW_ORDER) {
      if (currentOrder.items.length > 0)
        return {
          message: this.formatOrderSummary(currentOrder),
          nextState: ConversationState.REVIEWING_ORDER,
        };
      return {
        message: "Your cart is empty. Would you like to browse our products?",
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }

    if (trigger === StateTrigger.ADD_TO_CART) {
      const productEntity = this.inputParserService.getEntityByType(
        entities,
        EntityType.PRODUCT_NAME,
      );
      const quantityEntity = this.inputParserService.getEntityByType(
        entities,
        EntityType.QUANTITY,
      );
      if (productEntity) {
        const quantity = quantityEntity ? parseInt(quantityEntity.value) : 1;
        const existing = currentOrder.items.find(
          (i: any) => i.name === productEntity.value,
        );
        if (existing) existing.quantity += quantity;
        else
          currentOrder.items.push({
            name: productEntity.value,
            quantity,
            price: this.getProductPrice(productEntity.value),
          });

        currentOrder.totalAmount = currentOrder.items.reduce(
          (sum, item) => sum + (item.price || 0) * (item.quantity || 1),
          0,
        );
        session.context[ContextKey.CURRENT_ORDER] = currentOrder;
        await this.sessionService.updateContext(
          session.phoneNumber,
          session.context,
        );

        return {
          message: `Added ${quantity}x ${productEntity.value} to your cart!\n\nYour cart now has:\n${this.formatOrderSummary(currentOrder)}\n\nWould you like to:\n• Add more items\n• Review your complete order\n• Continue shopping`,
        };
      }
    }

    if (trigger === StateTrigger.REMOVE_FROM_CART) {
      const productEntity = this.inputParserService.getEntityByType(
        entities,
        EntityType.PRODUCT_NAME,
      );
      if (productEntity) {
        currentOrder.items = currentOrder.items.filter(
          (i) => i.name !== productEntity.value,
        );
        currentOrder.totalAmount = currentOrder.items.reduce(
          (sum, item) => sum + (item.price || 0) * (item.quantity || 1),
          0,
        );
        session.context[ContextKey.CURRENT_ORDER] = currentOrder;
        await this.sessionService.updateContext(
          session.phoneNumber,
          session.context,
        );
        return {
          message: `Removed ${productEntity.value} from your cart.\n\nYour updated cart:\n${this.formatOrderSummary(currentOrder)}`,
        };
      } else {
        return {
          message: "Which item would you like to remove from your cart?",
        };
      }
    }

    if (trigger === StateTrigger.VIEW_PRODUCTS)
      return {
        message: "Let me show you our products again.",
        nextState: ConversationState.BROWSING_PRODUCTS,
      };

    return {
      message: `🛒 **CART OPTIONS**\n\n1️⃣ Add more items\n2️⃣ Remove items\n3️⃣ Review my order\n4️⃣ Keep shopping\n5️⃣ Checkout now\n0️⃣ Go back\n\nType a number (0-5):`,
    };
  }

  /**
   * Handle reviewing order state
   */
  private handleReviewingOrderState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const { trigger } = parsedInput;
    const currentOrder = session.context[ContextKey.CURRENT_ORDER];

    if (
      trigger === StateTrigger.CONFIRM_ORDER &&
      currentOrder?.items?.length > 0
    ) {
      const paymentReference = this.generatePaymentReference();
      return {
        message: `Perfect! Your order has been confirmed.\n\n${this.formatOrderSummary(currentOrder)}\n\n💳 Payment Details:\nReference: ${paymentReference}\nAmount: $${currentOrder.totalAmount || "0.00"}\n\nPlease send your payment and reply with "paid" when done.`,
        nextState: ConversationState.AWAITING_PAYMENT,
        context: {
          ...session.context,
          [ContextKey.PAYMENT_REFERENCE]: paymentReference,
        },
      };
    }

    if (trigger === StateTrigger.ADD_TO_CART)
      return {
        message: "Let me help you add more items to your order.",
        nextState: ConversationState.ADDING_TO_CART,
      };
    if (trigger === StateTrigger.CANCEL_ORDER)
      return {
        message: "Order cancelled. Would you like to start a new order?",
        nextState: ConversationState.GREETING,
        context: {},
      };

    return {
      message: `${this.formatOrderSummary(currentOrder)}\n\n📋 **ORDER REVIEW**\n\n1️⃣ Confirm & place order\n2️⃣ Add more items\n3️⃣ Remove items\n4️⃣ Cancel order\n0️⃣ Go back\n\nType a number (0-4):`,
    };
  }

  /**
   * Handle awaiting payment state
   */
  private handleAwaitingPaymentState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const { trigger } = parsedInput;

    if (trigger === StateTrigger.CONFIRM_PAYMENT) {
      return {
        message: `Thank you! I'm verifying your payment...\n\nReference: ${session.context[ContextKey.PAYMENT_REFERENCE]}\n\nPlease wait while I confirm your payment. This usually takes 1-2 minutes.`,
        nextState: ConversationState.PAYMENT_CONFIRMATION,
      };
    }

    if (trigger === StateTrigger.GO_BACK)
      return {
        message: "Going back to order review.",
        nextState: ConversationState.REVIEWING_ORDER,
      };
    if (trigger === StateTrigger.CANCEL_ORDER)
      return {
        message:
          "Order cancelled. Your payment (if sent) will be refunded within 24 hours.",
        nextState: ConversationState.GREETING,
      };

    return {
      message: `Waiting for your payment...\n\n💳 Payment Details:\nReference: ${session.context[ContextKey.PAYMENT_REFERENCE]}\nAmount: $${session.context[ContextKey.CURRENT_ORDER]?.totalAmount || "0.00"}\n\nAfter sending payment, reply with "paid" or "payment sent".\nNeed help? Type "help" or "cancel" to cancel the order.`,
    };
  }

  /**
   * Handle payment confirmation state
   */
  private handlePaymentConfirmationState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const isPaymentVerified = Math.random() > 0.2; // 80% success demo

    if (isPaymentVerified) {
      return {
        message: `🎉 Payment confirmed! Your order is being prepared.\n\nOrder Details:\n${this.formatOrderSummary(session.context[ContextKey.CURRENT_ORDER])}\n\n📧 You'll receive updates via WhatsApp\n⏰ Estimated delivery: 30-45 minutes\n\nThank you for your order!\n\nType "new order" to place another order.`,
        nextState: ConversationState.ORDER_COMPLETE,
      };
    }

    return {
      message: `❌ Payment verification failed.\n\nThis could be because:\n• Payment is still processing\n• Incorrect reference number\n• Payment amount doesn't match\n\nPlease try again or contact support.\nReference: ${session.context[ContextKey.PAYMENT_REFERENCE]}`,
      nextState: ConversationState.AWAITING_PAYMENT,
    };
  }

  /**
   * Handle order complete state
   */
  private handleOrderCompleteState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const { trigger } = parsedInput;

    if (trigger === StateTrigger.VIEW_PRODUCTS)
      return {
        message: "Great! Let me show you our menu for your new order.",
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    if (trigger === StateTrigger.START_OVER)
      return {
        message: "Welcome back! How can I help you today?",
        nextState: ConversationState.GREETING,
      };

    return {
      message: `🎉 **ORDER COMPLETE!**\n\n**WHAT'S NEXT?**\n\n1️⃣ Place a new order\n2️⃣ View menu\n3️⃣ Order status\n4️⃣ Get help\n5️⃣ Contact support\n0️⃣ Exit\n\nType a number (0-5):`,
    };
  }

  /**
   * Format order summary for display
   */
  private formatOrderSummary(order: any): string {
    if (!order?.items?.length) return "Your cart is empty.";
    let summary = "📋 Your Order:\n";
    order.items.forEach((item: any, i: number) => {
      const itemTotal = (item.price || 0) * (item.quantity || 1);
      summary += `${i + 1}. ${item.name} x${item.quantity} - $${itemTotal.toFixed(2)}\n`;
    });
    summary += `\n💰 Total: $${order.totalAmount?.toFixed(2) || "0.00"}`;
    return summary;
  }

  /**
   * Generate payment reference
   */
  private generatePaymentReference(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `PAY-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Get product price
   */
  private getProductPrice(productName: string): number {
    const priceMap: Record<string, number> = {
      Pizza: 4500,
      Burger: 3200,
      Salad: 2800,
      Coffee: 1400,
      Soda: 900,
    };
    return priceMap[productName] || 1000;
  }
}
