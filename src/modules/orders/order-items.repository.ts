import { Injectable, Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { orderItems, products } from '../../database/schema';
import { OrderItem, NewOrderItem, OrderItemWithProduct } from '../../database/types';

@Injectable()
export class OrderItemsRepository {
  private readonly logger = new Logger(OrderItemsRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async create(orderItemData: NewOrderItem): Promise<OrderItem> {
    try {
      const [orderItem] = await this.databaseService.db
        .insert(orderItems)
        .values(orderItemData)
        .returning();

      this.logger.log(`Created order item with ID: ${orderItem.id}`);
      return orderItem;
    } catch (error) {
      this.logger.error(`Failed to create order item: ${error.message}`);
      throw error;
    }
  }

  async createFromProduct(
    orderId: string,
    productId: string,
    quantity: number
  ): Promise<OrderItem> {
    try {
      // Get product details
      const [product] = await this.databaseService.db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);

      if (!product) {
        throw new Error(`Product with ID ${productId} not found`);
      }

      if (!product.available) {
        throw new Error(`Product ${product.name} is not available`);
      }

      if (product.stockQuantity < quantity) {
        throw new Error(`Insufficient stock for product ${product.name}. Available: ${product.stockQuantity}, Requested: ${quantity}`);
      }

      const unitPrice = parseFloat(product.price);
      const totalPrice = unitPrice * quantity;

      const orderItemData: NewOrderItem = {
        orderId,
        productId,
        productName: product.name,
        quantity,
        unitPrice: unitPrice.toString(),
        totalPrice: totalPrice.toString(),
      };

      const orderItem = await this.create(orderItemData);
      this.logger.log(`Created order item for product ${product.name} with quantity ${quantity}`);
      return orderItem;
    } catch (error) {
      this.logger.error(`Failed to create order item from product ${productId}: ${error.message}`);
      throw error;
    }
  }

  async findById(id: string): Promise<OrderItem | null> {
    try {
      const [orderItem] = await this.databaseService.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.id, id))
        .limit(1);

      return orderItem || null;
    } catch (error) {
      this.logger.error(`Failed to find order item by ID ${id}: ${error.message}`);
      throw error;
    }
  }

  async findByOrderId(orderId: string): Promise<OrderItem[]> {
    try {
      const items = await this.databaseService.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      return items;
    } catch (error) {
      this.logger.error(`Failed to find order items by order ID ${orderId}: ${error.message}`);
      throw error;
    }
  }

  async findByOrderIdWithProducts(orderId: string): Promise<OrderItemWithProduct[]> {
    try {
      const items = await this.databaseService.db
        .select({
          id: orderItems.id,
          orderId: orderItems.orderId,
          productId: orderItems.productId,
          productName: orderItems.productName,
          quantity: orderItems.quantity,
          unitPrice: orderItems.unitPrice,
          totalPrice: orderItems.totalPrice,
          product: {
            id: products.id,
            name: products.name,
            description: products.description,
            price: products.price,
            available: products.available,
            category: products.category,
            stockQuantity: products.stockQuantity,
            sku: products.sku,
            createdAt: products.createdAt,
            updatedAt: products.updatedAt,
          }
        })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(eq(orderItems.orderId, orderId));

      return items.map(item => ({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        product: item.product,
      })) as OrderItemWithProduct[];
    } catch (error) {
      this.logger.error(`Failed to find order items with products by order ID ${orderId}: ${error.message}`);
      throw error;
    }
  }

  async findByProductId(productId: string): Promise<OrderItem[]> {
    try {
      const items = await this.databaseService.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.productId, productId));

      return items;
    } catch (error) {
      this.logger.error(`Failed to find order items by product ID ${productId}: ${error.message}`);
      throw error;
    }
  }

  async updateQuantity(id: string, quantity: number): Promise<OrderItem> {
    try {
      // Get current order item to recalculate total
      const currentItem = await this.findById(id);
      if (!currentItem) {
        throw new Error(`Order item with ID ${id} not found`);
      }

      const unitPrice = parseFloat(currentItem.unitPrice);
      const totalPrice = unitPrice * quantity;

      const [orderItem] = await this.databaseService.db
        .update(orderItems)
        .set({
          quantity,
          totalPrice: totalPrice.toString(),
        })
        .where(eq(orderItems.id, id))
        .returning();

      if (!orderItem) {
        throw new Error(`Order item with ID ${id} not found`);
      }

      this.logger.log(`Updated quantity for order item ${id} to ${quantity}`);
      return orderItem;
    } catch (error) {
      this.logger.error(`Failed to update quantity for order item ${id}: ${error.message}`);
      throw error;
    }
  }

  async update(id: string, updateData: Partial<NewOrderItem>): Promise<OrderItem> {
    try {
      // If quantity or unitPrice is being updated, recalculate totalPrice
      if (updateData.quantity !== undefined || updateData.unitPrice !== undefined) {
        const currentItem = await this.findById(id);
        if (!currentItem) {
          throw new Error(`Order item with ID ${id} not found`);
        }

        const quantity = updateData.quantity ?? currentItem.quantity;
        const unitPrice = updateData.unitPrice ? parseFloat(updateData.unitPrice) : parseFloat(currentItem.unitPrice);
        const totalPrice = unitPrice * quantity;

        updateData.totalPrice = totalPrice.toString();
      }

      const [orderItem] = await this.databaseService.db
        .update(orderItems)
        .set(updateData)
        .where(eq(orderItems.id, id))
        .returning();

      if (!orderItem) {
        throw new Error(`Order item with ID ${id} not found`);
      }

      this.logger.log(`Updated order item with ID: ${id}`);
      return orderItem;
    } catch (error) {
      this.logger.error(`Failed to update order item ${id}: ${error.message}`);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.databaseService.db
        .delete(orderItems)
        .where(eq(orderItems.id, id));

      // For postgres-js, result is an array with count property
      const deleted = (result as any).count > 0;
      if (deleted) {
        this.logger.log(`Deleted order item with ID: ${id}`);
      } else {
        this.logger.warn(`Order item with ID ${id} not found for deletion`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete order item ${id}: ${error.message}`);
      throw error;
    }
  }

  async deleteByOrderId(orderId: string): Promise<number> {
    try {
      const result = await this.databaseService.db
        .delete(orderItems)
        .where(eq(orderItems.orderId, orderId));

      // For postgres-js, result is an array with count property
      const deletedCount = (result as any).count || 0;
      this.logger.log(`Deleted ${deletedCount} order items for order ${orderId}`);
      return deletedCount;
    } catch (error) {
      this.logger.error(`Failed to delete order items for order ${orderId}: ${error.message}`);
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const orderItem = await this.findById(id);
      return orderItem !== null;
    } catch (error) {
      this.logger.error(`Failed to check if order item exists ${id}: ${error.message}`);
      throw error;
    }
  }

  async getOrderTotal(orderId: string): Promise<number> {
    try {
      const items = await this.findByOrderId(orderId);
      const total = items.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);
      return Math.round(total * 100) / 100; // Round to 2 decimal places
    } catch (error) {
      this.logger.error(`Failed to calculate order total for order ${orderId}: ${error.message}`);
      throw error;
    }
  }

  async getOrderItemCount(orderId: string): Promise<number> {
    try {
      const items = await this.findByOrderId(orderId);
      return items.reduce((sum, item) => sum + item.quantity, 0);
    } catch (error) {
      this.logger.error(`Failed to get item count for order ${orderId}: ${error.message}`);
      throw error;
    }
  }

  async validateOrderItem(orderId: string, productId: string, quantity: number): Promise<{
    isValid: boolean;
    errors: string[];
  }> {
    try {
      const errors: string[] = [];

      // Check if product exists and is available
      const [product] = await this.databaseService.db
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);

      if (!product) {
        errors.push(`Product with ID ${productId} not found`);
        return { isValid: false, errors };
      }

      if (!product.available) {
        errors.push(`Product ${product.name} is not available`);
      }

      if (quantity <= 0) {
        errors.push('Quantity must be greater than 0');
      }

      if (product.stockQuantity < quantity) {
        errors.push(`Insufficient stock for product ${product.name}. Available: ${product.stockQuantity}, Requested: ${quantity}`);
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      this.logger.error(`Failed to validate order item: ${error.message}`);
      return {
        isValid: false,
        errors: [`Validation error: ${error.message}`],
      };
    }
  }

  async addMultipleItems(orderId: string, items: Array<{ productId: string; quantity: number }>): Promise<OrderItem[]> {
    try {
      const createdItems: OrderItem[] = [];

      // Validate all items first
      for (const item of items) {
        const validation = await this.validateOrderItem(orderId, item.productId, item.quantity);
        if (!validation.isValid) {
          throw new Error(`Validation failed for product ${item.productId}: ${validation.errors.join(', ')}`);
        }
      }

      // Create all items
      for (const item of items) {
        const orderItem = await this.createFromProduct(orderId, item.productId, item.quantity);
        createdItems.push(orderItem);
      }

      this.logger.log(`Added ${createdItems.length} items to order ${orderId}`);
      return createdItems;
    } catch (error) {
      this.logger.error(`Failed to add multiple items to order ${orderId}: ${error.message}`);
      throw error;
    }
  }
}