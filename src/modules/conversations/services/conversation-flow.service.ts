import { Injectable, Logger } from '@nestjs/common';
import { ConversationState, BotResponse, ConversationSession } from '../types/conversation.types';
import { ParsedInput, UserIntent, EntityType } from '../types/input-parser.types';
import { StateTrigger, ContextKey, TransitionResult } from '../types/state-machine.types';
import { StateMachineService } from './state-machine.service';
import { InputParserService } from './input-parser.service';
import { ConversationSessionService } from './conversation-session.service';

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
    message: string
  ): Promise<BotResponse> {
    try {
      // Validate input
      const validation = this.inputParserService.validateInput(message);
      if (!validation.isValid) {
        return {
          message: 'Sorry, I couldn\'t understand your message. Please try again.',
        };
      }

      // Get or create session
      let session = await this.sessionService.getSession(phoneNumber);
      if (!session) {
        session = await this.sessionService.createSession(phoneNumber);
        if (!session) {
          return {
            message: 'Sorry, I\'m having trouble starting our conversation. Please try again later.',
          };
        }
      }

      // Parse user input
      const parsedInput = await this.inputParserService.parseInput(message, {
        currentState: session.currentState,
        previousMessages: [session.context[ContextKey.LAST_MESSAGE] || ''],
        sessionContext: session.context,
      });

      // Update last message in context
      session.context[ContextKey.LAST_MESSAGE] = message;

      // Process based on current state
      const response = await this.handleStateFlow(session, parsedInput);

      // Update session if state changed
      if (response.nextState && response.nextState !== session.currentState) {
        await this.sessionService.updateState(
          phoneNumber,
          response.nextState,
          response.context || session.context
        );
      } else if (response.context) {
        await this.sessionService.updateContext(phoneNumber, response.context);
      }

      return response;
    } catch (error) {
      this.logger.error('Error processing message', {
        phoneNumber,
        message,
        error: error.message,
      });

      return {
        message: 'Sorry, I encountered an error. Please try again or type "help" for assistance.',
      };
    }
  }

  /**
   * Handle conversation flow based on current state
   */
  private async handleStateFlow(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): Promise<BotResponse> {
    const currentState = session.currentState;

    switch (currentState) {
      case ConversationState.GREETING:
        return this.handleGreetingState(session, parsedInput);
      
      case ConversationState.BROWSING_PRODUCTS:
        return this.handleBrowsingProductsState(session, parsedInput);
      
      case ConversationState.ADDING_TO_CART:
        return this.handleAddingToCartState(session, parsedInput);
      
      case ConversationState.REVIEWING_ORDER:
        return this.handleReviewingOrderState(session, parsedInput);
      
      case ConversationState.AWAITING_PAYMENT:
        return this.handleAwaitingPaymentState(session, parsedInput);
      
      case ConversationState.PAYMENT_CONFIRMATION:
        return this.handlePaymentConfirmationState(session, parsedInput);
      
      case ConversationState.ORDER_COMPLETE:
        return this.handleOrderCompleteState(session, parsedInput);
      
      default:
        return {
          message: 'I\'m not sure what to do right now. Let me start over.',
          nextState: ConversationState.GREETING,
        };
    }
  }

  /**
   * Handle greeting state
   */
  private handleGreetingState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): BotResponse {
    const { intent, trigger } = parsedInput;

    // Handle help requests
    if (intent === UserIntent.GET_HELP) {
      return {
        message: `Hi! I'm your WhatsApp ordering assistant. Here's what I can help you with:

🛍️ View our products - Type "menu" or "products"
📱 Place an order - Just tell me what you'd like
❓ Get help - Type "help" anytime
🔄 Start over - Type "restart"

What would you like to do today?`,
      };
    }

    // Handle product viewing
    if (trigger === StateTrigger.VIEW_PRODUCTS) {
      return {
        message: `Great! Let me show you our available products. 

Please wait while I fetch our current menu...`,
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }

    // Handle start conversation
    if (trigger === StateTrigger.START_CONVERSATION || intent === UserIntent.GREETING) {
      return {
        message: `Hello! 👋 Welcome to our WhatsApp ordering service!

I can help you:
• Browse our products
• Place orders
• Make payments

Type "menu" to see our products or "help" for more options.

What would you like to do?`,
      };
    }

    // Default greeting response
    return {
      message: `Hi there! I'm here to help you place an order.

Type "menu" to see our products or "help" for assistance.`,
    };
  }

  /**
   * Handle browsing products state
   */
  private handleBrowsingProductsState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): BotResponse {
    const { intent, trigger, entities } = parsedInput;

    // Handle going back
    if (trigger === StateTrigger.GO_BACK) {
      return {
        message: 'Going back to the main menu.',
        nextState: ConversationState.GREETING,
      };
    }

    // Handle adding to cart
    if (trigger === StateTrigger.ADD_TO_CART) {
      const productEntity = this.inputParserService.getEntityByType(entities, EntityType.PRODUCT_NAME);
      const quantityEntity = this.inputParserService.getEntityByType(entities, EntityType.QUANTITY);

      if (productEntity) {
        const quantity = quantityEntity ? parseInt(quantityEntity.value) : 1;
        
        return {
          message: `Adding ${quantity}x ${productEntity.value} to your cart...

Would you like to:
• Add more items
• Review your order
• Continue browsing

Just tell me what you'd like to do!`,
          nextState: ConversationState.ADDING_TO_CART,
          context: {
            ...session.context,
            [ContextKey.SELECTED_PRODUCTS]: [{
              name: productEntity.value,
              quantity: quantity,
            }],
          },
        };
      } else {
        return {
          message: `I'd be happy to add something to your cart! 

Please tell me which product you'd like and how many. For example:
• "2 pizzas"
• "1 burger"
• "3 coffees"

What would you like to order?`,
        };
      }
    }

    // Handle search
    if (intent === UserIntent.SEARCH_PRODUCT) {
      const productEntity = this.inputParserService.getEntityByType(entities, EntityType.PRODUCT_NAME);
      
      if (productEntity) {
        return {
          message: `Searching for "${productEntity.value}"...

Here are the matching products:
[Product search results would be displayed here]

To add any item to your cart, just say "add [product name]" or "I want [product name]".`,
        };
      }
    }

    // Default browsing response
    return {
      message: `Here's our menu:

🍕 Pizza - $12.99
🍔 Burger - $8.99  
🥗 Salad - $7.99
☕ Coffee - $3.99
🥤 Soda - $2.99

To order, just tell me what you'd like! For example:
• "I want 2 pizzas"
• "Add 1 burger to cart"
• "Order 3 coffees"

What catches your eye?`,
    };
  }

  /**
   * Handle adding to cart state
   */
  private handleAddingToCartState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): BotResponse {
    const { intent, trigger, entities } = parsedInput;

    // Handle reviewing order
    if (trigger === StateTrigger.REVIEW_ORDER) {
      const currentOrder = session.context[ContextKey.CURRENT_ORDER];
      
      if (currentOrder && currentOrder.items && currentOrder.items.length > 0) {
        return {
          message: this.formatOrderSummary(currentOrder),
          nextState: ConversationState.REVIEWING_ORDER,
        };
      } else {
        return {
          message: 'Your cart is empty. Would you like to browse our products?',
          nextState: ConversationState.BROWSING_PRODUCTS,
        };
      }
    }

    // Handle adding more items
    if (trigger === StateTrigger.ADD_TO_CART) {
      const productEntity = this.inputParserService.getEntityByType(entities, EntityType.PRODUCT_NAME);
      const quantityEntity = this.inputParserService.getEntityByType(entities, EntityType.QUANTITY);

      if (productEntity) {
        const quantity = quantityEntity ? parseInt(quantityEntity.value) : 1;
        
        return {
          message: `Added ${quantity}x ${productEntity.value} to your cart! 

Your cart now has:
• ${productEntity.value} (${quantity})

Would you like to:
• Add more items
• Review your complete order
• Continue shopping`,
          context: {
            ...session.context,
            // This would update the current order in a real implementation
          },
        };
      }
    }

    // Handle removing items
    if (trigger === StateTrigger.REMOVE_FROM_CART) {
      const productEntity = this.inputParserService.getEntityByType(entities, EntityType.PRODUCT_NAME);
      
      if (productEntity) {
        return {
          message: `Removed ${productEntity.value} from your cart.

Would you like to:
• Add different items
• Review your order
• Continue shopping`,
        };
      } else {
        return {
          message: 'Which item would you like to remove from your cart?',
        };
      }
    }

    // Handle going back to browsing
    if (trigger === StateTrigger.VIEW_PRODUCTS) {
      return {
        message: 'Let me show you our products again.',
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }

    // Default adding to cart response
    return {
      message: `Great! You can:

• Add more items - "add 2 pizzas"
• Remove items - "remove burger"  
• Review order - "show my order"
• Keep shopping - "show menu"

What would you like to do?`,
    };
  }

  /**
   * Handle reviewing order state
   */
  private handleReviewingOrderState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): BotResponse {
    const { trigger } = parsedInput;

    // Handle order confirmation
    if (trigger === StateTrigger.CONFIRM_ORDER) {
      const currentOrder = session.context[ContextKey.CURRENT_ORDER];
      
      if (currentOrder && currentOrder.items && currentOrder.items.length > 0) {
        const paymentReference = this.generatePaymentReference();
        
        return {
          message: `Perfect! Your order has been confirmed. 

${this.formatOrderSummary(currentOrder)}

💳 Payment Details:
Reference: ${paymentReference}
Amount: $${currentOrder.totalAmount || '0.00'}

Please send your payment and reply with "paid" when done.
Payment methods: [Bank transfer details would be here]`,
          nextState: ConversationState.AWAITING_PAYMENT,
          context: {
            ...session.context,
            [ContextKey.PAYMENT_REFERENCE]: paymentReference,
          },
        };
      }
    }

    // Handle going back to add more items
    if (trigger === StateTrigger.ADD_TO_CART) {
      return {
        message: 'Let me help you add more items to your order.',
        nextState: ConversationState.ADDING_TO_CART,
      };
    }

    // Handle cancellation
    if (trigger === StateTrigger.CANCEL_ORDER) {
      return {
        message: 'Order cancelled. Would you like to start a new order?',
        nextState: ConversationState.GREETING,
        context: {
          // Clear order context
        },
      };
    }

    // Default review response
    const currentOrder = session.context[ContextKey.CURRENT_ORDER];
    return {
      message: `${this.formatOrderSummary(currentOrder)}

Is this correct?
• Say "confirm" to place your order
• Say "add more" to keep shopping  
• Say "cancel" to start over`,
    };
  }

  /**
   * Handle awaiting payment state
   */
  private handleAwaitingPaymentState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): BotResponse {
    const { trigger } = parsedInput;

    // Handle payment confirmation
    if (trigger === StateTrigger.CONFIRM_PAYMENT) {
      return {
        message: `Thank you! I'm verifying your payment...

Reference: ${session.context[ContextKey.PAYMENT_REFERENCE]}

Please wait while I confirm your payment. This usually takes 1-2 minutes.`,
        nextState: ConversationState.PAYMENT_CONFIRMATION,
      };
    }

    // Handle going back to review
    if (trigger === StateTrigger.GO_BACK) {
      return {
        message: 'Going back to order review.',
        nextState: ConversationState.REVIEWING_ORDER,
      };
    }

    // Handle cancellation
    if (trigger === StateTrigger.CANCEL_ORDER) {
      return {
        message: 'Order cancelled. Your payment (if sent) will be refunded within 24 hours.',
        nextState: ConversationState.GREETING,
      };
    }

    // Default payment waiting response
    return {
      message: `Waiting for your payment...

💳 Payment Details:
Reference: ${session.context[ContextKey.PAYMENT_REFERENCE]}
Amount: $${session.context[ContextKey.CURRENT_ORDER]?.totalAmount || '0.00'}

After sending payment, reply with "paid" or "payment sent".
Need help? Type "help" or "cancel" to cancel the order.`,
    };
  }

  /**
   * Handle payment confirmation state
   */
  private handlePaymentConfirmationState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): BotResponse {
    const { trigger } = parsedInput;

    // Simulate payment verification (in real app, this would check with payment provider)
    const isPaymentVerified = Math.random() > 0.2; // 80% success rate for demo

    if (isPaymentVerified) {
      return {
        message: `🎉 Payment confirmed! Your order is being prepared.

Order Details:
${this.formatOrderSummary(session.context[ContextKey.CURRENT_ORDER])}

📧 You'll receive updates via WhatsApp
⏰ Estimated delivery: 30-45 minutes

Thank you for your order! 

Type "new order" to place another order.`,
        nextState: ConversationState.ORDER_COMPLETE,
      };
    } else {
      return {
        message: `❌ Payment verification failed. 

This could be because:
• Payment is still processing
• Incorrect reference number
• Payment amount doesn't match

Please try again or contact support.
Reference: ${session.context[ContextKey.PAYMENT_REFERENCE]}`,
        nextState: ConversationState.AWAITING_PAYMENT,
      };
    }
  }

  /**
   * Handle order complete state
   */
  private handleOrderCompleteState(
    session: ConversationSession,
    parsedInput: ParsedInput
  ): BotResponse {
    const { trigger } = parsedInput;

    // Handle starting new order
    if (trigger === StateTrigger.VIEW_PRODUCTS) {
      return {
        message: 'Great! Let me show you our menu for your new order.',
        nextState: ConversationState.BROWSING_PRODUCTS,
      };
    }

    // Handle starting over
    if (trigger === StateTrigger.START_OVER) {
      return {
        message: 'Welcome back! How can I help you today?',
        nextState: ConversationState.GREETING,
      };
    }

    // Default order complete response
    return {
      message: `Your order is complete! 🎉

Would you like to:
• Place a new order - "new order"
• View menu - "menu"  
• Get help - "help"

I'm here whenever you're ready!`,
    };
  }

  /**
   * Format order summary for display
   */
  private formatOrderSummary(order: any): string {
    if (!order || !order.items || order.items.length === 0) {
      return 'Your cart is empty.';
    }

    let summary = '📋 Your Order:\n';
    let total = 0;

    order.items.forEach((item: any, index: number) => {
      const itemTotal = (item.price || 0) * (item.quantity || 1);
      total += itemTotal;
      summary += `${index + 1}. ${item.name} x${item.quantity} - $${itemTotal.toFixed(2)}\n`;
    });

    summary += `\n💰 Total: $${total.toFixed(2)}`;
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
}