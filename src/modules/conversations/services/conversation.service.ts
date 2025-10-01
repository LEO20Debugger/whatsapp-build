import { Injectable, Logger } from "@nestjs/common";
import {
  ConversationState,
  BotResponse,
  ConversationSession,
  CurrentOrder,
  OrderItem,
} from "../types/conversation.types";
import { ConversationFlowService } from "./conversation-flow.service";
import { ConversationSessionService } from "./conversation-session.service";
import { OrderFlowService } from "./order-flow.service";
import { OrdersService, CreateOrderRequest } from "../../orders/orders.service";
import { ProductsService } from "../../products/products.service";
import { CustomersRepository } from "../../customers/customers.repository";
import { PaymentsService } from "../../payments/payments.service";
import { ContextKey } from "../types/state-machine.types";

export interface ConversationContext {
  phoneNumber: string;
  messageId?: string;
  timestamp?: number;
}

export interface ConversationResult {
  response: BotResponse;
  session: ConversationSession;
  orderCreated?: string; // Order ID if order was created
  paymentRequired?: boolean;
  processingMetadata?: {
    processingTime: number;
    stateTransition?: {
      from: ConversationState;
      to: ConversationState;
    };
  };
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly conversationFlowService: ConversationFlowService,
    private readonly sessionService: ConversationSessionService,
    private readonly orderFlowService: OrderFlowService,
    private readonly ordersService: OrdersService,
    private readonly productsService: ProductsService,
    private readonly customersRepository: CustomersRepository,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * Main entry point for processing conversation messages
   * Integrates state machine with message processing and business logic
   * Requirements: 1.1, 1.2, 1.3, 7.4
   */
  async processConversation(
    phoneNumber: string,
    message: string,
    context: ConversationContext = { phoneNumber },
  ): Promise<ConversationResult> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`Processing conversation for ${phoneNumber}: "${message}"`);

      // Get or create session with customer memory
      let session = await this.sessionService.getSession(phoneNumber);
      const isNewSession = !session;
      
      if (!session) {
        // Create session and load customer data from database
        session = await this.createSessionWithCustomerData(phoneNumber);
        if (!session) {
          throw new Error("Failed to create conversation session");
        }
      }

      const previousState = session.currentState;

      // Process message through conversation flow
      const response = await this.conversationFlowService.processMessage(
        phoneNumber,
        message,
      );

      // Update session with response
      if (response.nextState && response.nextState !== session.currentState) {
        await this.sessionService.updateState(
          phoneNumber,
          response.nextState,
          response.context || session.context,
        );
        session.currentState = response.nextState;
        session.context = { ...session.context, ...(response.context || {}) };
      } else if (response.context) {
        await this.sessionService.updateContext(phoneNumber, response.context);
        session.context = { ...session.context, ...response.context };
      }

      // Handle business logic based on state transitions
      const businessLogicResult = await this.handleBusinessLogic(
        session,
        previousState,
        context,
      );

      const processingTime = Date.now() - startTime;

      // Add processing metadata to response
      const enhancedResponse: BotResponse = {
        ...response,
        processingMetadata: {
          messageId: context.messageId || `msg_${Date.now()}`,
          processedAt: Date.now(),
          processingTime,
        },
      };

      const result: ConversationResult = {
        response: enhancedResponse,
        session,
        ...businessLogicResult,
        processingMetadata: {
          processingTime,
          stateTransition: previousState !== session.currentState ? {
            from: previousState,
            to: session.currentState,
          } : undefined,
        },
      };

      this.logger.log(
        `Conversation processed successfully for ${phoneNumber} in ${processingTime}ms`,
        {
          previousState,
          currentState: session.currentState,
          isNewSession,
          orderCreated: result.orderCreated,
          paymentRequired: result.paymentRequired,
        },
      );

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Error processing conversation for ${phoneNumber}: ${error.message}`,
        {
          message,
          processingTime,
          error: error.stack,
        },
      );

      // Return error response
      const errorSession: ConversationSession = {
        phoneNumber,
        currentState: ConversationState.GREETING,
        lastActivity: new Date(),
        context: {},
      };

      return {
        response: {
          message: 'Sorry, I encountered an error. Please try again or type "help" for assistance.',
          processingMetadata: {
            messageId: context.messageId || `msg_${Date.now()}`,
            processedAt: Date.now(),
            processingTime,
          },
        },
        session: errorSession,
        processingMetadata: {
          processingTime,
        },
      };
    }
  }

  /**
   * Handle business logic based on conversation state and transitions
   * Requirements: 1.2, 1.3, 1.5
   */
  private async handleBusinessLogic(
    session: ConversationSession,
    previousState: ConversationState,
    context: ConversationContext,
  ): Promise<Partial<ConversationResult>> {
    const result: Partial<ConversationResult> = {};

    try {
      // Handle cart operations when in adding to cart state
      if (session.currentState === ConversationState.ADDING_TO_CART) {
        await this.handleCartOperations(session, context);
      }

      // Handle order creation when transitioning to awaiting payment
      if (
        previousState === ConversationState.REVIEWING_ORDER &&
        session.currentState === ConversationState.AWAITING_PAYMENT
      ) {
        const orderResult = await this.handleOrderCreation(session, context);
        if (orderResult.orderCreated) {
          result.orderCreated = orderResult.orderCreated;
          result.paymentRequired = true;
        }
      }

      // Handle payment flow transitions
      if (
        previousState === ConversationState.AWAITING_PAYMENT &&
        session.currentState === ConversationState.PAYMENT_CONFIRMATION
      ) {
        await this.handlePaymentInitiation(session, context);
      }

      // Handle payment confirmation transitions
      if (
        previousState === ConversationState.PAYMENT_CONFIRMATION &&
        session.currentState === ConversationState.ORDER_COMPLETE
      ) {
        await this.handlePaymentCompletion(session, context);
      }

      // Handle cart management during adding to cart state (legacy support)
      if (session.currentState === ConversationState.ADDING_TO_CART) {
        await this.handleCartManagement(session, context);
      }

      return result;
    } catch (error) {
      this.logger.error(
        `Error in business logic handling for ${session.phoneNumber}: ${error.message}`,
        {
          previousState,
          currentState: session.currentState,
          error: error.stack,
        },
      );
      return result;
    }
  }

  /**
   * Handle order creation when customer confirms order
   * Requirements: 1.2, 1.5
   */
  private async handleOrderCreation(
    session: ConversationSession,
    context: ConversationContext,
  ): Promise<{ orderCreated?: string }> {
    try {
      const currentOrder = session.context[ContextKey.CURRENT_ORDER] as CurrentOrder;
      
      if (!currentOrder || !currentOrder.items || currentOrder.items.length === 0) {
        this.logger.warn(`No order items found for ${session.phoneNumber}`);
        return {};
      }

      // Ensure customer exists
      const customer = await this.ensureCustomerExists(session.phoneNumber);
      if (!customer) {
        this.logger.error(`Failed to create/find customer for ${session.phoneNumber}`);
        return {};
      }

      // Use order flow service to create order from cart
      const orderResult = await this.orderFlowService.createOrderFromCart(
        session,
        customer.id,
      );

      if (!orderResult.success) {
        this.logger.warn(
          `Order creation failed for ${session.phoneNumber}`,
          { error: orderResult.error },
        );
        // Update session context with validation errors
        session.context[ContextKey.ORDER_VALIDATION_ERRORS] = [orderResult.error];
        await this.sessionService.updateContext(session.phoneNumber, session.context);
        return {};
      }

      // Update session with order ID
      await this.sessionService.updateContext(session.phoneNumber, session.context);

      this.logger.log(
        `Order created successfully for ${session.phoneNumber}: ${orderResult.orderId}`,
        {
          orderId: orderResult.orderId,
        },
      );

      return { orderCreated: orderResult.orderId };
    } catch (error) {
      this.logger.error(
        `Failed to create order for ${session.phoneNumber}: ${error.message}`,
        { error: error.stack },
      );
      return {};
    }
  }

  /**
   * Handle payment initiation when transitioning to payment confirmation
   * Requirements: 2.1, 2.2, 2.3
   */
  private async handlePaymentInitiation(
    session: ConversationSession,
    context: ConversationContext,
  ): Promise<void> {
    try {
      const orderId = session.context[ContextKey.ORDER_ID];
      
      if (!orderId) {
        this.logger.warn(`No order ID found for payment initiation: ${session.phoneNumber}`);
        return;
      }

      this.logger.log(
        `Payment initiated for order ${orderId} by ${session.phoneNumber}`,
      );

      // Payment instructions will be generated by the conversation flow service
      // when the user selects a payment method
    } catch (error) {
      this.logger.error(
        `Failed to handle payment initiation for ${session.phoneNumber}: ${error.message}`,
        { error: error.stack },
      );
    }
  }

  /**
   * Handle payment completion when order is complete
   * Requirements: 3.1, 3.2, 4.1
   */
  private async handlePaymentCompletion(
    session: ConversationSession,
    context: ConversationContext,
  ): Promise<void> {
    try {
      const orderId = session.context[ContextKey.ORDER_ID];
      
      if (!orderId) {
        this.logger.warn(`No order ID found for payment completion: ${session.phoneNumber}`);
        return;
      }

      // Update order status to completed
      await this.ordersService.updateOrderStatus(orderId, "completed", "Payment verified and order completed");

      this.logger.log(
        `Payment completed successfully for ${session.phoneNumber}: ${orderId}`,
      );

      // Keep order context for receipt access but clear payment reference
      delete session.context[ContextKey.PAYMENT_REFERENCE];
      
      await this.sessionService.updateContext(session.phoneNumber, session.context);

    } catch (error) {
      this.logger.error(
        `Failed to handle payment completion for ${session.phoneNumber}: ${error.message}`,
        { error: error.stack },
      );
    }
  }

  /**
   * Handle order completion when payment is confirmed (legacy method)
   * Requirements: 3.2, 4.1
   */
  private async handleOrderCompletion(
    session: ConversationSession,
    context: ConversationContext,
  ): Promise<void> {
    // Delegate to payment completion handler
    await this.handlePaymentCompletion(session, context);
  }

  /**
   * Handle cart operations using OrderFlowService
   * Requirements: 1.2, 1.3
   */
  private async handleCartOperations(
    session: ConversationSession,
    context: ConversationContext,
  ): Promise<void> {
    try {
      const selectedProducts = session.context[ContextKey.SELECTED_PRODUCTS];
      
      if (selectedProducts && selectedProducts.length > 0) {
        // Process each selected product
        for (const product of selectedProducts) {
          if (product.productId) {
            const result = await this.orderFlowService.addItemToCart(
              session,
              product.productId,
              product.quantity || 1,
            );
            
            if (result.success) {
              this.logger.log(
                `Successfully added ${product.name} to cart for ${session.phoneNumber}`,
              );
            } else {
              this.logger.warn(
                `Failed to add ${product.name} to cart: ${result.error}`,
              );
            }
          }
        }
        
        // Clear selected products after processing
        session.context[ContextKey.SELECTED_PRODUCTS] = [];
        await this.sessionService.updateContext(session.phoneNumber, session.context);
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle cart operations for ${session.phoneNumber}: ${error.message}`,
        { error: error.stack },
      );
    }
  }

  /**
   * Handle cart management during conversation (legacy support)
   * Requirements: 1.2, 1.3
   */
  private async handleCartManagement(
    session: ConversationSession,
    context: ConversationContext,
  ): Promise<void> {
    try {
      const currentOrder = session.context[ContextKey.CURRENT_ORDER] as CurrentOrder;
      
      if (!currentOrder || !currentOrder.items) {
        return;
      }

      // Recalculate totals based on current product prices
      let totalAmount = 0;
      const updatedItems: OrderItem[] = [];

      for (const item of currentOrder.items) {
        try {
          const product = await this.productsService.getProductById(item.productId);
          const updatedItem: OrderItem = {
            ...item,
            price: parseFloat(product.price),
            name: product.name,
          };
          updatedItems.push(updatedItem);
          totalAmount += updatedItem.price * updatedItem.quantity;
        } catch (error) {
          this.logger.warn(
            `Product ${item.productId} not found or unavailable, removing from cart`,
          );
          // Skip unavailable products
        }
      }

      // Update order with current prices and available items
      const updatedOrder: CurrentOrder = {
        items: updatedItems,
        totalAmount: Math.round(totalAmount * 100) / 100,
      };

      session.context[ContextKey.CURRENT_ORDER] = updatedOrder;
      await this.sessionService.updateContext(session.phoneNumber, session.context);

    } catch (error) {
      this.logger.error(
        `Failed to manage cart for ${session.phoneNumber}: ${error.message}`,
        { error: error.stack },
      );
    }
  }

  /**
   * Create session with customer data from database
   * Requirements: 1.1, 1.5, 7.4
   */
  private async createSessionWithCustomerData(phoneNumber: string): Promise<ConversationSession | null> {
    try {
      // Check if customer exists in database
      const existingCustomer = await this.customersRepository.findByPhoneNumber(phoneNumber);
      
      let initialState = ConversationState.GREETING;
      const sessionContext: Record<string, any> = {};
      
      if (existingCustomer) {
        // Returning customer - load their data
        sessionContext[ContextKey.CUSTOMER_INFO] = existingCustomer;
        sessionContext[ContextKey.CUSTOMER_NAME] = existingCustomer.name;
        sessionContext[ContextKey.IS_NEW_CUSTOMER] = false;
        initialState = ConversationState.MAIN_MENU; // Skip greeting for returning customers
        
        this.logger.log(`Loaded existing customer data for ${phoneNumber}: ${existingCustomer.name || 'No name'}`);
      } else {
        // New customer - will need to collect name
        sessionContext[ContextKey.IS_NEW_CUSTOMER] = true;
        initialState = ConversationState.GREETING;
        
        this.logger.log(`New customer detected: ${phoneNumber}`);
      }
      
      // Create session with appropriate initial state and customer ID
      const session = await this.sessionService.createSession(
        phoneNumber, 
        initialState, 
        {}, 
        existingCustomer?.id
      );
      if (session) {
        // Update session context with customer data
        session.context = { ...session.context, ...sessionContext };
        await this.sessionService.updateContext(phoneNumber, session.context);
      }
      
      return session;
    } catch (error) {
      this.logger.error(
        `Failed to create session with customer data for ${phoneNumber}: ${error.message}`,
        { error: error.stack },
      );
      return null;
    }
  }

  /**
   * Ensure customer exists in database
   * Requirements: 1.5, 6.5
   */
  private async ensureCustomerExists(phoneNumber: string): Promise<{ id: string } | null> {
    try {
      // Try to find existing customer
      let customer = await this.customersRepository.findByPhoneNumber(phoneNumber);
      
      if (!customer) {
        // Create new customer
        customer = await this.customersRepository.create({
          phoneNumber,
        });
        
        // Update the session with the new customer ID
        await this.sessionService.updateSessionCustomerId(phoneNumber, customer.id);
        
        this.logger.log(`Created new customer for phone number: ${phoneNumber} with ID: ${customer.id}`);
      }

      return customer;
    } catch (error) {
      this.logger.error(
        `Failed to ensure customer exists for ${phoneNumber}: ${error.message}`,
        { error: error.stack },
      );
      return null;
    }
  }

  /**
   * Get conversation session
   * Requirements: 7.4
   */
  async getConversationSession(phoneNumber: string): Promise<ConversationSession | null> {
    return this.sessionService.getSession(phoneNumber);
  }

  /**
   * Reset conversation to initial state
   * Requirements: 7.4
   */
  async resetConversation(phoneNumber: string): Promise<boolean> {
    try {
      await this.sessionService.deleteSession(phoneNumber);
      const newSession = await this.sessionService.createSession(phoneNumber);
      
      this.logger.log(`Reset conversation for ${phoneNumber}`);
      return !!newSession;
    } catch (error) {
      this.logger.error(
        `Failed to reset conversation for ${phoneNumber}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Get conversation statistics
   * Requirements: 7.4
   */
  async getConversationStats(): Promise<{
    totalSessions: number;
    sessionsByState: Record<ConversationState, number>;
  }> {
    return this.sessionService.getSessionStats();
  }

  /**
   * Add item to cart
   * Requirements: 1.2, 1.3
   */
  async addToCart(
    phoneNumber: string,
    productId: string,
    quantity: number,
  ): Promise<{
    success: boolean;
    message: string;
    cartSummary?: any;
  }> {
    try {
      const session = await this.sessionService.getSession(phoneNumber);
      if (!session) {
        return {
          success: false,
          message: "Session not found. Please start a new conversation.",
        };
      }

      const result = await this.orderFlowService.addItemToCart(
        session,
        productId,
        quantity,
      );

      if (result.success) {
        // Update session with new cart data
        await this.sessionService.updateContext(phoneNumber, session.context);
        
        return {
          success: true,
          message: "Item added to cart successfully!",
          cartSummary: result.cartSummary,
        };
      } else {
        return {
          success: false,
          message: result.error || "Failed to add item to cart",
        };
      }
    } catch (error) {
      this.logger.error(
        `Failed to add item to cart for ${phoneNumber}: ${error.message}`,
      );
      return {
        success: false,
        message: "Failed to add item to cart. Please try again.",
      };
    }
  }

  /**
   * Remove item from cart
   * Requirements: 1.2, 1.3
   */
  async removeFromCart(
    phoneNumber: string,
    productId: string,
    quantity?: number,
  ): Promise<{
    success: boolean;
    message: string;
    cartSummary?: any;
  }> {
    try {
      const session = await this.sessionService.getSession(phoneNumber);
      if (!session) {
        return {
          success: false,
          message: "Session not found. Please start a new conversation.",
        };
      }

      const result = await this.orderFlowService.removeItemFromCart(
        session,
        productId,
        quantity,
      );

      if (result.success) {
        // Update session with new cart data
        await this.sessionService.updateContext(phoneNumber, session.context);
        
        return {
          success: true,
          message: "Item removed from cart successfully!",
          cartSummary: result.cartSummary,
        };
      } else {
        return {
          success: false,
          message: result.error || "Failed to remove item from cart",
        };
      }
    } catch (error) {
      this.logger.error(
        `Failed to remove item from cart for ${phoneNumber}: ${error.message}`,
      );
      return {
        success: false,
        message: "Failed to remove item from cart. Please try again.",
      };
    }
  }

  /**
   * Get current cart summary
   * Requirements: 1.2, 1.3
   */
  async getCartSummary(phoneNumber: string): Promise<{
    success: boolean;
    cartSummary?: any;
    formattedSummary?: string;
  }> {
    try {
      const session = await this.sessionService.getSession(phoneNumber);
      if (!session) {
        return {
          success: false,
        };
      }

      const cartSummary = this.orderFlowService.getCartSummary(session);
      const formattedSummary = this.orderFlowService.formatCartSummary(cartSummary);

      return {
        success: true,
        cartSummary,
        formattedSummary,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get cart summary for ${phoneNumber}: ${error.message}`,
      );
      return {
        success: false,
      };
    }
  }

  /**
   * Clear cart
   * Requirements: 1.2, 1.3
   */
  async clearCart(phoneNumber: string): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      const session = await this.sessionService.getSession(phoneNumber);
      if (!session) {
        return {
          success: false,
          message: "Session not found. Please start a new conversation.",
        };
      }

      const result = await this.orderFlowService.clearCart(session);

      if (result.success) {
        // Update session with cleared cart
        await this.sessionService.updateContext(phoneNumber, session.context);
        
        return {
          success: true,
          message: "Cart cleared successfully!",
        };
      } else {
        return {
          success: false,
          message: result.error || "Failed to clear cart",
        };
      }
    } catch (error) {
      this.logger.error(
        `Failed to clear cart for ${phoneNumber}: ${error.message}`,
      );
      return {
        success: false,
        message: "Failed to clear cart. Please try again.",
      };
    }
  }

  /**
   * Validate cart before order creation
   * Requirements: 1.2, 1.5
   */
  async validateCartForOrder(phoneNumber: string): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    try {
      const session = await this.sessionService.getSession(phoneNumber);
      if (!session) {
        return {
          isValid: false,
          errors: ["Session not found"],
          warnings: [],
        };
      }

      return await this.orderFlowService.validateCart(session);
    } catch (error) {
      this.logger.error(
        `Failed to validate cart for ${phoneNumber}: ${error.message}`,
      );
      return {
        isValid: false,
        errors: [`Validation failed: ${error.message}`],
        warnings: [],
      };
    }
  }
}