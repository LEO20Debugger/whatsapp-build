import { Injectable, Logger } from "@nestjs/common";
import { OrdersService, CreateOrderRequest } from "../../orders/orders.service";
import { ProductsService } from "../../products/products.service";
import { CustomersRepository } from "../../customers/customers.repository";
import {
  ConversationSession,
  CurrentOrder,
  OrderItem,
  BotResponse,
  ConversationState,
} from "../types/conversation.types";
import { ContextKey } from "../types/state-machine.types";

export interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface CartSummary {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface OrderFlowResult {
  success: boolean;
  orderId?: string;
  error?: string;
  cartSummary?: CartSummary;
}

@Injectable()
export class OrderFlowService {
  private readonly logger = new Logger(OrderFlowService.name);
  private readonly TAX_RATE = 0.1; // 10% tax rate

  constructor(
    private readonly ordersService: OrdersService,
    private readonly productsService: ProductsService,
    private readonly customersRepository: CustomersRepository,
  ) {}

  /**
   * Add item to cart with validation
   * Requirements: 1.2, 1.3
   */
  async addItemToCart(
    session: ConversationSession,
    productId: string,
    quantity: number,
  ): Promise<OrderFlowResult> {
    try {
      this.logger.log(
        `Adding item to cart: ${productId} x${quantity} for ${session.phoneNumber}`,
      );

      // Validate product exists and is available
      const product = await this.productsService.getProductById(productId);
      if (!product.available) {
        return {
          success: false,
          error: `${product.name} is currently not available`,
        };
      }

      // Check stock availability
      const isAvailable = await this.productsService.isProductAvailable(
        productId,
        quantity,
      );
      if (!isAvailable) {
        return {
          success: false,
          error: `Insufficient stock for ${product.name}. Please try a smaller quantity.`,
        };
      }

      // Get current order or create new one
      let currentOrder = session.context[ContextKey.CURRENT_ORDER] as CurrentOrder;
      if (!currentOrder) {
        currentOrder = { items: [] };
      }

      // Check if item already exists in cart
      const existingItemIndex = currentOrder.items.findIndex(
        (item) => item.productId === productId,
      );

      if (existingItemIndex >= 0) {
        // Update existing item quantity
        const newQuantity = currentOrder.items[existingItemIndex].quantity + quantity;
        
        // Validate total quantity
        const totalAvailable = await this.productsService.isProductAvailable(
          productId,
          newQuantity,
        );
        if (!totalAvailable) {
          return {
            success: false,
            error: `Cannot add ${quantity} more ${product.name}. Total would exceed available stock.`,
          };
        }

        currentOrder.items[existingItemIndex].quantity = newQuantity;
      } else {
        // Add new item to cart
        const newItem: OrderItem = {
          productId,
          quantity,
          name: product.name,
          price: parseFloat(product.price),
        };
        currentOrder.items.push(newItem);
      }

      // Recalculate totals
      currentOrder.totalAmount = this.calculateCartTotal(currentOrder.items);

      // Update session context
      session.context[ContextKey.CURRENT_ORDER] = currentOrder;

      const cartSummary = this.generateCartSummary(currentOrder.items);

      this.logger.log(
        `Item added to cart successfully for ${session.phoneNumber}`,
        { productId, quantity, cartTotal: currentOrder.totalAmount },
      );

      return {
        success: true,
        cartSummary,
      };
    } catch (error) {
      this.logger.error(
        `Failed to add item to cart for ${session.phoneNumber}: ${error.message}`,
      );
      return {
        success: false,
        error: "Failed to add item to cart. Please try again.",
      };
    }
  }

  /**
   * Remove item from cart
   * Requirements: 1.2, 1.3
   */
  async removeItemFromCart(
    session: ConversationSession,
    productId: string,
    quantityToRemove?: number,
  ): Promise<OrderFlowResult> {
    try {
      this.logger.log(
        `Removing item from cart: ${productId} for ${session.phoneNumber}`,
      );

      const currentOrder = session.context[ContextKey.CURRENT_ORDER] as CurrentOrder;
      if (!currentOrder || !currentOrder.items || currentOrder.items.length === 0) {
        return {
          success: false,
          error: "Your cart is empty",
        };
      }

      const itemIndex = currentOrder.items.findIndex(
        (item) => item.productId === productId,
      );

      if (itemIndex === -1) {
        return {
          success: false,
          error: "Item not found in cart",
        };
      }

      const item = currentOrder.items[itemIndex];

      if (quantityToRemove && quantityToRemove < item.quantity) {
        // Reduce quantity
        currentOrder.items[itemIndex].quantity -= quantityToRemove;
      } else {
        // Remove entire item
        currentOrder.items.splice(itemIndex, 1);
      }

      // Recalculate totals
      currentOrder.totalAmount = this.calculateCartTotal(currentOrder.items);

      // Update session context
      session.context[ContextKey.CURRENT_ORDER] = currentOrder;

      const cartSummary = this.generateCartSummary(currentOrder.items);

      this.logger.log(
        `Item removed from cart successfully for ${session.phoneNumber}`,
        { productId, remainingItems: currentOrder.items.length },
      );

      return {
        success: true,
        cartSummary,
      };
    } catch (error) {
      this.logger.error(
        `Failed to remove item from cart for ${session.phoneNumber}: ${error.message}`,
      );
      return {
        success: false,
        error: "Failed to remove item from cart. Please try again.",
      };
    }
  }

  /**
   * Clear entire cart
   * Requirements: 1.2, 1.3
   */
  async clearCart(session: ConversationSession): Promise<OrderFlowResult> {
    try {
      this.logger.log(`Clearing cart for ${session.phoneNumber}`);

      // Clear cart from session
      delete session.context[ContextKey.CURRENT_ORDER];
      delete session.context[ContextKey.SELECTED_PRODUCTS];

      return {
        success: true,
        cartSummary: {
          items: [],
          itemCount: 0,
          subtotal: 0,
          tax: 0,
          total: 0,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to clear cart for ${session.phoneNumber}: ${error.message}`,
      );
      return {
        success: false,
        error: "Failed to clear cart. Please try again.",
      };
    }
  }

  /**
   * Get current cart summary
   * Requirements: 1.2, 1.3
   */
  getCartSummary(session: ConversationSession): CartSummary {
    const currentOrder = session.context[ContextKey.CURRENT_ORDER] as CurrentOrder;
    
    if (!currentOrder || !currentOrder.items || currentOrder.items.length === 0) {
      return {
        items: [],
        itemCount: 0,
        subtotal: 0,
        tax: 0,
        total: 0,
      };
    }

    return this.generateCartSummary(currentOrder.items);
  }

  /**
   * Validate cart before order creation
   * Requirements: 1.2, 1.5
   */
  async validateCart(session: ConversationSession): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const currentOrder = session.context[ContextKey.CURRENT_ORDER] as CurrentOrder;
      
      if (!currentOrder || !currentOrder.items || currentOrder.items.length === 0) {
        errors.push("Cart is empty");
        return { isValid: false, errors, warnings };
      }

      // Validate each item
      for (const item of currentOrder.items) {
        try {
          const product = await this.productsService.getProductById(item.productId);
          
          if (!product.available) {
            errors.push(`${item.name} is no longer available`);
            continue;
          }

          const isAvailable = await this.productsService.isProductAvailable(
            item.productId,
            item.quantity,
          );
          
          if (!isAvailable) {
            errors.push(
              `Insufficient stock for ${item.name}. Requested: ${item.quantity}`,
            );
            continue;
          }

          // Check for price changes
          const currentPrice = parseFloat(product.price);
          if (Math.abs(currentPrice - item.price) > 0.01) {
            warnings.push(
              `Price changed for ${item.name}: was ₦${item.price}, now ₦${currentPrice}`,
            );
          }

          // Check for low stock warning
          if (product.stockQuantity <= item.quantity * 2) {
            warnings.push(`Low stock warning for ${item.name}`);
          }
        } catch (error) {
          errors.push(`Error validating ${item.name}: ${error.message}`);
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      this.logger.error(
        `Failed to validate cart for ${session.phoneNumber}: ${error.message}`,
      );
      return {
        isValid: false,
        errors: [`Cart validation failed: ${error.message}`],
        warnings,
      };
    }
  }

  /**
   * Create order from cart
   * Requirements: 1.2, 1.5
   */
  async createOrderFromCart(
    session: ConversationSession,
    customerId: string,
  ): Promise<OrderFlowResult> {
    try {
      this.logger.log(`Creating order from cart for ${session.phoneNumber}`);

      // Validate cart first
      const validation = await this.validateCart(session);
      if (!validation.isValid) {
        return {
          success: false,
          error: `Order validation failed: ${validation.errors.join(", ")}`,
        };
      }

      const currentOrder = session.context[ContextKey.CURRENT_ORDER] as CurrentOrder;

      // Create order request
      const createOrderRequest: CreateOrderRequest = {
        customerId,
        items: currentOrder.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        notes: `Order placed via WhatsApp from ${session.phoneNumber}`,
      };

      // Create the order
      const order = await this.ordersService.createOrder(createOrderRequest);

      // Store order ID in session
      session.context[ContextKey.ORDER_ID] = order.id;

      this.logger.log(
        `Order created successfully from cart for ${session.phoneNumber}: ${order.id}`,
        {
          orderId: order.id,
          itemCount: order.items?.length || 0,
          totalAmount: order.totalAmount,
        },
      );

      return {
        success: true,
        orderId: order.id,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create order from cart for ${session.phoneNumber}: ${error.message}`,
      );
      return {
        success: false,
        error: "Failed to create order. Please try again.",
      };
    }
  }

  /**
   * Generate formatted cart summary for display
   * Requirements: 1.2, 1.3
   */
  formatCartSummary(cartSummary: CartSummary): string {
    if (cartSummary.itemCount === 0) {
      return "🛒 Your cart is empty";
    }

    let summary = "🛒 **Your Cart:**\n\n";
    
    cartSummary.items.forEach((item, index) => {
      summary += `${index + 1}. ${item.productName}\n`;
      summary += `   Qty: ${item.quantity} × ₦${item.unitPrice.toFixed(2)} = ₦${item.totalPrice.toFixed(2)}\n\n`;
    });

    summary += `📊 **Summary:**\n`;
    summary += `Items: ${cartSummary.itemCount}\n`;
    summary += `Subtotal: ₦${cartSummary.subtotal.toFixed(2)}\n`;
    summary += `Tax (${(this.TAX_RATE * 100).toFixed(0)}%): ₦${cartSummary.tax.toFixed(2)}\n`;
    summary += `**Total: ₦${cartSummary.total.toFixed(2)}**`;

    return summary;
  }

  /**
   * Generate order confirmation message
   * Requirements: 1.5
   */
  formatOrderConfirmation(orderId: string, cartSummary: CartSummary): string {
    let confirmation = "✅ **Order Confirmed!**\n\n";
    confirmation += `Order ID: ${orderId}\n\n`;
    confirmation += this.formatCartSummary(cartSummary);
    confirmation += "\n\n📞 We'll contact you shortly with payment details.";
    
    return confirmation;
  }

  /**
   * Calculate total for cart items
   */
  private calculateCartTotal(items: OrderItem[]): number {
    const subtotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    return Math.round(subtotal * 100) / 100;
  }

  /**
   * Generate cart summary with tax calculations
   */
  private generateCartSummary(items: OrderItem[]): CartSummary {
    const cartItems: CartItem[] = items.map((item) => ({
      productId: item.productId,
      productName: item.name,
      quantity: item.quantity,
      unitPrice: item.price,
      totalPrice: item.price * item.quantity,
    }));

    const subtotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const tax = subtotal * this.TAX_RATE;
    const total = subtotal + tax;

    return {
      items: cartItems,
      itemCount: cartItems.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: Math.round(subtotal * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: Math.round(total * 100) / 100,
    };
  }
}