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
import { ProductsRepository } from "src/modules/products/products.repository";

@Injectable()
export class ConversationFlowService {
  private readonly logger = new Logger(ConversationFlowService.name);

  constructor(
    private readonly stateMachineService: StateMachineService,
    private readonly inputParserService: InputParserService,
    private readonly sessionService: ConversationSessionService,
    private readonly productsRepository: ProductsRepository,
  ) {}

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

  private handleGreetingState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const { intent, trigger } = parsedInput;

    if (intent === UserIntent.GET_HELP) {
      return {
        message: `🤖 **HELP MENU**\n\n1️⃣ Browse products\n2️⃣ Place an order\n3️⃣ Check order status\n4️⃣ Start over\n5️⃣ Contact support\n0️⃣ Go back\n\nType a number (0-5):`,
      };
    }

    if (trigger === StateTrigger.VIEW_PRODUCTS) {
      return {
        message: `Great! Let me show you our available products...\nPlease wait while I fetch our current menu...`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }

    if (
      trigger === StateTrigger.START_CONVERSATION ||
      intent === UserIntent.GREETING
    ) {
      return {
        message: `Hello! 👋 Welcome to our WhatsApp ordering service!\n\n📱 **MAIN MENU**\n1️⃣ Browse products\n2️⃣ Place an order\n3️⃣ Make payment\n4️⃣ Get help\n0️⃣ Exit\n\nType the number of your choice:`,
      };
    }

    return {
      message: `Hi there! I'm here to help you place an order.\n\nType a number from the main menu or "help" for assistance.`,
    };
  }

  private async handleBrowsingProductsState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): Promise<BotResponse> {
    const { trigger, entities } = parsedInput;

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

        // fetch dynamic price from repository
        const products = await this.productsRepository.findAll({
          availableOnly: true,
          limit: 50,
        });
        const matchedProduct = products.find(
          (p) => p.name.toLowerCase() === productEntity.value.toLowerCase(),
        );

        const price = matchedProduct?.price ?? null;

        if (price === null) {
          return {
            message: `Sorry, I couldn't find "${productEntity.value}" in our menu.`,
          };
        }

        session.context[ContextKey.SELECTED_PRODUCTS] = [
          { name: productEntity.value, quantity, price },
        ];

        return {
          message: `✅ Adding ${quantity}x ${productEntity.value} to your cart...\n\n1️⃣ Add more items\n2️⃣ Review your order\n3️⃣ Continue browsing\n0️⃣ Go back\n\nType a number (0-3):`,
          nextState: ConversationState.ADDING_TO_CART,
          context: session.context,
        };
      } else {
        return {
          message: `Please tell me which product you'd like and how many.\nFor example:\n• "2 pizzas"\n• "1 burger"\n\nWhat would you like to order?`,
        };
      }
    }

    // Display menu dynamically
    const products = await this.productsRepository.findAvailableProducts({
      limit: 50,
      sortBy: "name",
    });
    const menu = products
      .map((p, i) => `${i + 1}️⃣ ${p.name} - ₦${p.price}`)
      .join("\n");

    return {
      message: `🍽️ **OUR MENU**\n\n${menu}\n\nType the number to add to cart or 0 to go back.`,
    };
  }

  private async handleAddingToCartState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): Promise<BotResponse> {
    const { trigger } = parsedInput;

    const selectedProducts =
      session.context[ContextKey.SELECTED_PRODUCTS] || [];
    let currentOrder = session.context[ContextKey.CURRENT_ORDER] || {
      items: [],
    };

    for (const product of selectedProducts) {
      const existing = currentOrder.items.find(
        (i: any) => i.name === product.name,
      );
      if (existing) existing.quantity += product.quantity;
      else currentOrder.items.push(product);
    }

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

    return {
      message: `🛒 **CART OPTIONS**\n\n1️⃣ Add more items\n2️⃣ Remove items\n3️⃣ Review my order\n4️⃣ Keep shopping\n5️⃣ Checkout now\n0️⃣ Go back\n\nType a number (0-5):`,
    };
  }

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
        message: `Perfect! Your order has been confirmed.\n\n${this.formatOrderSummary(currentOrder)}\n\n💳 Payment Details:\nReference: ${paymentReference}\nAmount: ₦${currentOrder.totalAmount || "0.00"}\n\nPlease send your payment and reply with "paid" when done.`,
        nextState: ConversationState.AWAITING_PAYMENT,
        context: {
          ...session.context,
          [ContextKey.PAYMENT_REFERENCE]: paymentReference,
        },
      };
    }

    return {
      message: `${this.formatOrderSummary(currentOrder)}\n\n📋 **ORDER REVIEW**\n\n1️⃣ Confirm & place order\n2️⃣ Add more items\n3️⃣ Remove items\n4️⃣ Cancel order\n0️⃣ Go back\n\nType a number (0-4):`,
    };
  }

  private handleAwaitingPaymentState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const { trigger } = parsedInput;

    if (trigger === StateTrigger.CONFIRM_PAYMENT) {
      return {
        message: `Thank you! I'm verifying your payment...\n\nReference: ${session.context[ContextKey.PAYMENT_REFERENCE]}\nPlease wait while I confirm your payment.`,
        nextState: ConversationState.PAYMENT_CONFIRMATION,
      };
    }

    return {
      message: `Waiting for your payment...\n\n💳 Reference: ${session.context[ContextKey.PAYMENT_REFERENCE]}\nAmount: ₦${session.context[ContextKey.CURRENT_ORDER]?.totalAmount || "0.00"}\n\nReply "paid" when done or "cancel" to cancel the order.`,
    };
  }

  private handlePaymentConfirmationState(
    session: ConversationSession,
    parsedInput: ParsedInput,
  ): BotResponse {
    const isPaymentVerified = Math.random() > 0.2; // demo

    if (isPaymentVerified) {
      return {
        message: `🎉 Payment confirmed! Your order is being prepared.\n\nOrder Details:\n${this.formatOrderSummary(session.context[ContextKey.CURRENT_ORDER])}\n⏰ Estimated delivery: 30-45 minutes\n\nThank you for your order!\n\nType "new order" to place another order.`,
        nextState: ConversationState.ORDER_COMPLETE,
      };
    }

    return {
      message: `❌ Payment verification failed.\nPlease try again or contact support.\nReference: ${session.context[ContextKey.PAYMENT_REFERENCE]}`,
      nextState: ConversationState.AWAITING_PAYMENT,
    };
  }

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

  private formatOrderSummary(order: any): string {
    if (!order?.items?.length) return "Your cart is empty.";
    let summary = "📋 Your Order:\n";
    order.items.forEach((item: any, i: number) => {
      const itemTotal = (item.price || 0) * (item.quantity || 1);
      summary += `${i + 1}. ${item.name} x${item.quantity} - ₦${itemTotal.toFixed(2)}\n`;
    });
    summary += `\n💰 Total: ₦${order.totalAmount?.toFixed(2) || "0.00"}`;
    return summary;
  }

  private generatePaymentReference(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `PAY-${timestamp}-${random}`.toUpperCase();
  }
}
