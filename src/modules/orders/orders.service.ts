import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { OrdersRepository, OrderSearchOptions } from "./orders.repository";
import { OrderItemsRepository } from "./order-items.repository";
import { ProductsRepository } from "../products/products.repository";
import {
  Order,
  NewOrder,
  OrderItem,
  OrderStatus,
  OrderWithItems,
} from "../../database/types";

export interface CreateOrderRequest {
  customerId: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  notes?: string;
}

export interface OrderTotals {
  subtotal: number;
  tax: number;
  total: number;
}

export interface OrderValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly TAX_RATE = 0.1; // 10% tax rate - should be configurable

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly orderItemsRepository: OrderItemsRepository,
    private readonly productsRepository: ProductsRepository,
  ) {}

  /**
   * Create a new order with item validation
   * Requirements: 1.2, 1.5, 6.1
   */
  async createOrder(
    createOrderRequest: CreateOrderRequest,
  ): Promise<OrderWithItems> {
    try {
      const { customerId, items, notes } = createOrderRequest;

      this.logger.log(
        `Creating order for customer ${customerId} with ${items.length} items`,
      );

      // Validate customer ID
      if (!customerId || customerId.trim().length === 0) {
        throw new BadRequestException("Customer ID is required");
      }

      // Validate items
      if (!items || items.length === 0) {
        throw new BadRequestException("Order must contain at least one item");
      }

      // Validate all products and calculate totals
      const validation = await this.validateOrderItems(items);
      if (!validation.isValid) {
        throw new BadRequestException(
          `Order validation failed: ${validation.errors.join(", ")}`,
        );
      }

      // Calculate order totals
      const totals = await this.calculateOrderTotals(items);

      // Create the order
      const orderData = {
        customerId: customerId.trim(),
        subtotalAmount: totals.subtotal.toString(),
        taxAmount: totals.tax.toString(),
        totalAmount: totals.total.toString(),
        notes: notes?.trim() || null,
      };

      const order = await this.ordersRepository.create(orderData);

      // Create order items
      const orderItems = await this.orderItemsRepository.addMultipleItems(
        order.id,
        items,
      );

      // Get the complete order with items
      const orderWithItems = await this.getOrderWithItems(order.id);
      if (!orderWithItems) {
        throw new Error("Failed to retrieve created order");
      }

      this.logger.log(
        `Successfully created order ${order.id} with ${orderItems.length} items`,
      );
      return orderWithItems;
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculate order totals including tax
   * Requirements: 1.3, 6.1
   */
  async calculateOrderTotals(
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<OrderTotals> {
    try {
      this.logger.log(`Calculating totals for ${items.length} items`);

      let subtotal = 0;

      for (const item of items) {
        const product = await this.productsRepository.findById(item.productId);
        if (!product) {
          throw new BadRequestException(
            `Product with ID ${item.productId} not found`,
          );
        }

        const itemTotal = parseFloat(product.price) * item.quantity;
        subtotal += itemTotal;
      }

      const tax = subtotal * this.TAX_RATE;
      const total = subtotal + tax;

      const totals = {
        subtotal: Math.round(subtotal * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        total: Math.round(total * 100) / 100,
      };

      this.logger.log(
        `Calculated totals: subtotal=${totals.subtotal}, tax=${totals.tax}, total=${totals.total}`,
      );
      return totals;
    } catch (error) {
      this.logger.error(`Failed to calculate order totals: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update order status
   * Requirements: 3.2, 6.3
   */
  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    notes?: string,
  ): Promise<Order> {
    try {
      if (!orderId || orderId.trim().length === 0) {
        throw new BadRequestException("Order ID is required");
      }

      this.logger.log(`Updating order ${orderId} status to ${status}`);

      // Validate that order exists
      const existingOrder = await this.ordersRepository.findById(
        orderId.trim(),
      );
      if (!existingOrder) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      // Validate status transition
      this.validateStatusTransition(existingOrder.status, status);

      const updatedOrder = await this.ordersRepository.updateStatus(
        orderId.trim(),
        status,
        notes,
      );

      this.logger.log(
        `Successfully updated order ${orderId} status from ${existingOrder.status} to ${status}`,
      );
      return updatedOrder;
    } catch (error) {
      this.logger.error(`Failed to update order status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get order by ID
   * Requirements: 6.1
   */
  async getOrderById(orderId: string): Promise<Order> {
    try {
      if (!orderId || orderId.trim().length === 0) {
        throw new BadRequestException("Order ID is required");
      }

      this.logger.log(`Retrieving order ${orderId}`);

      const order = await this.ordersRepository.findById(orderId.trim());
      if (!order) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      return order;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve order ${orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get order with items by ID
   * Requirements: 6.1
   */
  async getOrderWithItems(orderId: string): Promise<OrderWithItems | null> {
    try {
      if (!orderId || orderId.trim().length === 0) {
        throw new BadRequestException("Order ID is required");
      }

      this.logger.log(`Retrieving order with items ${orderId}`);

      const orderWithItems = await this.ordersRepository.findByIdWithItems(
        orderId.trim(),
      );
      if (!orderWithItems) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      return orderWithItems;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve order with items ${orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get orders by customer ID
   * Requirements: 6.1
   */
  async getOrdersByCustomerId(
    customerId: string,
    options: OrderSearchOptions = {},
  ): Promise<Order[]> {
    try {
      if (!customerId || customerId.trim().length === 0) {
        throw new BadRequestException("Customer ID is required");
      }

      this.logger.log(`Retrieving orders for customer ${customerId}`);

      const orders = await this.ordersRepository.findByCustomerId(
        customerId.trim(),
        options,
      );

      this.logger.log(
        `Retrieved ${orders.length} orders for customer ${customerId}`,
      );
      return orders;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve orders for customer ${customerId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get orders by status
   * Requirements: 6.3
   */
  async getOrdersByStatus(
    status: OrderStatus | OrderStatus[],
    options: OrderSearchOptions = {},
  ): Promise<Order[]> {
    try {
      this.logger.log(
        `Retrieving orders with status: ${Array.isArray(status) ? status.join(", ") : status}`,
      );

      const orders = await this.ordersRepository.findByStatus(status, options);

      this.logger.log(
        `Retrieved ${orders.length} orders with specified status`,
      );
      return orders;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve orders by status: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Update payment reference for order
   * Requirements: 3.2
   */
  async updatePaymentReference(
    orderId: string,
    paymentReference: string,
  ): Promise<Order> {
    try {
      if (!orderId || orderId.trim().length === 0) {
        throw new BadRequestException("Order ID is required");
      }

      if (!paymentReference || paymentReference.trim().length === 0) {
        throw new BadRequestException("Payment reference is required");
      }

      this.logger.log(`Updating payment reference for order ${orderId}`);

      // Validate that order exists
      const existingOrder = await this.ordersRepository.findById(
        orderId.trim(),
      );
      if (!existingOrder) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      const updatedOrder = await this.ordersRepository.updatePaymentReference(
        orderId.trim(),
        paymentReference.trim(),
      );

      this.logger.log(
        `Successfully updated payment reference for order ${orderId}`,
      );
      return updatedOrder;
    } catch (error) {
      this.logger.error(
        `Failed to update payment reference for order ${orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Recalculate and update order totals
   * Requirements: 1.3, 6.1
   */
  async recalculateOrderTotals(orderId: string): Promise<Order> {
    try {
      if (!orderId || orderId.trim().length === 0) {
        throw new BadRequestException("Order ID is required");
      }

      this.logger.log(`Recalculating totals for order ${orderId}`);

      // Validate that order exists
      const existingOrder = await this.ordersRepository.findById(
        orderId.trim(),
      );
      if (!existingOrder) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      const updatedOrder = await this.ordersRepository.updateTotals(
        orderId.trim(),
      );

      this.logger.log(`Successfully recalculated totals for order ${orderId}`);
      return updatedOrder;
    } catch (error) {
      this.logger.error(
        `Failed to recalculate totals for order ${orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Cancel an order
   * Requirements: 6.3
   */
  async cancelOrder(orderId: string, reason?: string): Promise<Order> {
    try {
      if (!orderId || orderId.trim().length === 0) {
        throw new BadRequestException("Order ID is required");
      }

      this.logger.log(`Cancelling order ${orderId}`);

      // Validate that order exists and can be cancelled
      const existingOrder = await this.ordersRepository.findById(
        orderId.trim(),
      );
      if (!existingOrder) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      // Check if order can be cancelled
      if (!this.canCancelOrder(existingOrder.status)) {
        throw new BadRequestException(
          `Order with status '${existingOrder.status}' cannot be cancelled`,
        );
      }

      const notes = reason ? `Cancelled: ${reason}` : "Order cancelled";
      const cancelledOrder = await this.ordersRepository.updateStatus(
        orderId.trim(),
        "cancelled",
        notes,
      );

      this.logger.log(`Successfully cancelled order ${orderId}`);
      return cancelledOrder;
    } catch (error) {
      this.logger.error(`Failed to cancel order ${orderId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get order count with filters
   * Requirements: 6.1
   */
  async getOrderCount(options: OrderSearchOptions = {}): Promise<number> {
    try {
      this.logger.log("Counting orders with filters");

      const count = await this.ordersRepository.count(options);

      this.logger.log(`Order count: ${count}`);
      return count;
    } catch (error) {
      this.logger.error(`Failed to count orders: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate order items before creation
   * Requirements: 1.2, 1.5
   */
  private async validateOrderItems(
    items: Array<{ productId: string; quantity: number }>,
  ): Promise<OrderValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check for duplicate products
      const productIds = items.map((item) => item.productId);
      const uniqueProductIds = new Set(productIds);
      if (productIds.length !== uniqueProductIds.size) {
        errors.push("Duplicate products found in order");
      }

      // Validate each item
      for (const item of items) {
        if (!item.productId || item.productId.trim().length === 0) {
          errors.push("Product ID is required for all items");
          continue;
        }

        if (!item.quantity || item.quantity < 1) {
          errors.push(
            `Invalid quantity for product ${item.productId}: must be at least 1`,
          );
          continue;
        }

        // Validate product exists and is available
        const product = await this.productsRepository.findById(item.productId);
        if (!product) {
          errors.push(`Product with ID ${item.productId} not found`);
          continue;
        }

        if (!product.available) {
          errors.push(`Product ${product.name} is not available`);
          continue;
        }

        if (product.stockQuantity < item.quantity) {
          errors.push(
            `Insufficient stock for product ${product.name}. Available: ${product.stockQuantity}, Requested: ${item.quantity}`,
          );
          continue;
        }

        // Add warning for low stock
        if (product.stockQuantity <= item.quantity * 2) {
          warnings.push(`Low stock warning for product ${product.name}`);
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      this.logger.error(`Failed to validate order items: ${error.message}`);
      return {
        isValid: false,
        errors: [`Validation error: ${error.message}`],
        warnings,
      };
    }
  }

  /**
   * Validate status transition
   * Requirements: 6.3
   */
  private validateStatusTransition(
    currentStatus: OrderStatus,
    newStatus: OrderStatus,
  ): void {
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      pending: ["confirmed", "cancelled"],
      confirmed: ["paid", "cancelled"],
      paid: ["processing", "cancelled"],
      processing: ["completed", "cancelled"],
      completed: [], // Final state
      cancelled: [], // Final state
    };

    const allowedTransitions = validTransitions[currentStatus] || [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedTransitions.join(", ")}`,
      );
    }
  }

  /**
   * Check if order can be cancelled
   * Requirements: 6.3
   */
  private canCancelOrder(status: OrderStatus): boolean {
    const cancellableStatuses: OrderStatus[] = ["pending", "confirmed", "paid"];
    return cancellableStatuses.includes(status);
  }
}
