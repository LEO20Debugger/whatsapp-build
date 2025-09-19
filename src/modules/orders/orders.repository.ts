import { Injectable, Logger } from '@nestjs/common';
import { eq, desc, asc, and, gte, lte, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service';
import { orders, orderItems, customers, products } from '../../database/schema';
import { Order, NewOrder, OrderStatus, OrderWithItems } from '../../database/types';

export interface OrderSearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'totalAmount' | 'status';
  sortOrder?: 'asc' | 'desc';
  status?: OrderStatus | OrderStatus[];
  customerId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
}

@Injectable()
export class OrdersRepository {
  private readonly logger = new Logger(OrdersRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async create(orderData: NewOrder): Promise<Order> {
    try {
      const [order] = await this.databaseService.db
        .insert(orders)
        .values(orderData)
        .returning();

      this.logger.log(`Created order with ID: ${order.id}`);
      return order;
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`);
      throw error;
    }
  }

  async findById(id: string): Promise<Order | null> {
    try {
      const [order] = await this.databaseService.db
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);

      return order || null;
    } catch (error) {
      this.logger.error(`Failed to find order by ID ${id}: ${error.message}`);
      throw error;
    }
  }

  async findByIdWithItems(id: string): Promise<OrderWithItems | null> {
    try {
      // Get the order
      const order = await this.findById(id);
      if (!order) {
        return null;
      }

      // Get order items
      const items = await this.databaseService.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, id));

      // Get customer
      const [customer] = await this.databaseService.db
        .select()
        .from(customers)
        .where(eq(customers.id, order.customerId))
        .limit(1);

      // Get payments (will be implemented in payment repository)
      const payments = []; // TODO: Implement when payment repository is ready

      return {
        ...order,
        items,
        customer,
        payments,
      } as OrderWithItems;
    } catch (error) {
      this.logger.error(`Failed to find order with items by ID ${id}: ${error.message}`);
      throw error;
    }
  }

  async findByCustomerId(customerId: string, options: OrderSearchOptions = {}): Promise<Order[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        status,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount
      } = options;

      let whereConditions = [eq(orders.customerId, customerId)];

      // Add status filter
      if (status) {
        if (Array.isArray(status)) {
          whereConditions.push(inArray(orders.status, status));
        } else {
          whereConditions.push(eq(orders.status, status));
        }
      }

      // Add date range filters
      if (dateFrom) {
        whereConditions.push(gte(orders.createdAt, dateFrom));
      }
      if (dateTo) {
        whereConditions.push(lte(orders.createdAt, dateTo));
      }

      // Add amount range filters
      if (minAmount !== undefined) {
        whereConditions.push(gte(orders.totalAmount, minAmount.toString()));
      }
      if (maxAmount !== undefined) {
        whereConditions.push(lte(orders.totalAmount, maxAmount.toString()));
      }

      const sortColumn = orders[sortBy];
      const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      const orderList = await this.databaseService.db
        .select()
        .from(orders)
        .where(and(...whereConditions))
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return orderList;
    } catch (error) {
      this.logger.error(`Failed to find orders by customer ID ${customerId}: ${error.message}`);
      throw error;
    }
  }

  async findByStatus(status: OrderStatus | OrderStatus[], options: OrderSearchOptions = {}): Promise<Order[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        customerId,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount
      } = options;

      let whereConditions = [];

      // Add status filter
      if (Array.isArray(status)) {
        whereConditions.push(inArray(orders.status, status));
      } else {
        whereConditions.push(eq(orders.status, status));
      }

      // Add customer filter
      if (customerId) {
        whereConditions.push(eq(orders.customerId, customerId));
      }

      // Add date range filters
      if (dateFrom) {
        whereConditions.push(gte(orders.createdAt, dateFrom));
      }
      if (dateTo) {
        whereConditions.push(lte(orders.createdAt, dateTo));
      }

      // Add amount range filters
      if (minAmount !== undefined) {
        whereConditions.push(gte(orders.totalAmount, minAmount.toString()));
      }
      if (maxAmount !== undefined) {
        whereConditions.push(lte(orders.totalAmount, maxAmount.toString()));
      }

      const sortColumn = orders[sortBy];
      const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      const orderList = await this.databaseService.db
        .select()
        .from(orders)
        .where(and(...whereConditions))
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return orderList;
    } catch (error) {
      this.logger.error(`Failed to find orders by status: ${error.message}`);
      throw error;
    }
  }

  async updateStatus(id: string, status: OrderStatus, notes?: string): Promise<Order> {
    try {
      const updateData: any = { status };
      if (notes) {
        updateData.notes = notes;
      }

      const [order] = await this.databaseService.db
        .update(orders)
        .set(updateData)
        .where(eq(orders.id, id))
        .returning();

      if (!order) {
        throw new Error(`Order with ID ${id} not found`);
      }

      this.logger.log(`Updated order ${id} status to ${status}`);
      return order;
    } catch (error) {
      this.logger.error(`Failed to update order status ${id}: ${error.message}`);
      throw error;
    }
  }

  async updatePaymentReference(id: string, paymentReference: string): Promise<Order> {
    try {
      const [order] = await this.databaseService.db
        .update(orders)
        .set({ paymentReference })
        .where(eq(orders.id, id))
        .returning();

      if (!order) {
        throw new Error(`Order with ID ${id} not found`);
      }

      this.logger.log(`Updated payment reference for order ${id}`);
      return order;
    } catch (error) {
      this.logger.error(`Failed to update payment reference for order ${id}: ${error.message}`);
      throw error;
    }
  }

  async update(id: string, updateData: Partial<NewOrder>): Promise<Order> {
    try {
      const [order] = await this.databaseService.db
        .update(orders)
        .set(updateData)
        .where(eq(orders.id, id))
        .returning();

      if (!order) {
        throw new Error(`Order with ID ${id} not found`);
      }

      this.logger.log(`Updated order with ID: ${id}`);
      return order;
    } catch (error) {
      this.logger.error(`Failed to update order ${id}: ${error.message}`);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.databaseService.db
        .delete(orders)
        .where(eq(orders.id, id));

      // For postgres-js, result is an array with count property
      const deleted = (result as any).count > 0;
      if (deleted) {
        this.logger.log(`Deleted order with ID: ${id}`);
      } else {
        this.logger.warn(`Order with ID ${id} not found for deletion`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete order ${id}: ${error.message}`);
      throw error;
    }
  }

  async findAll(options: OrderSearchOptions = {}): Promise<Order[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        status,
        customerId,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount
      } = options;

      let whereConditions = [];

      // Add status filter
      if (status) {
        if (Array.isArray(status)) {
          whereConditions.push(inArray(orders.status, status));
        } else {
          whereConditions.push(eq(orders.status, status));
        }
      }

      // Add customer filter
      if (customerId) {
        whereConditions.push(eq(orders.customerId, customerId));
      }

      // Add date range filters
      if (dateFrom) {
        whereConditions.push(gte(orders.createdAt, dateFrom));
      }
      if (dateTo) {
        whereConditions.push(lte(orders.createdAt, dateTo));
      }

      // Add amount range filters
      if (minAmount !== undefined) {
        whereConditions.push(gte(orders.totalAmount, minAmount.toString()));
      }
      if (maxAmount !== undefined) {
        whereConditions.push(lte(orders.totalAmount, maxAmount.toString()));
      }

      const sortColumn = orders[sortBy];
      const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      let query = this.databaseService.db
        .select()
        .from(orders);

      if (whereConditions.length > 0) {
        query = query.where(and(...whereConditions));
      }

      const orderList = await query
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return orderList;
    } catch (error) {
      this.logger.error(`Failed to find orders: ${error.message}`);
      throw error;
    }
  }

  async count(options: OrderSearchOptions = {}): Promise<number> {
    try {
      const {
        status,
        customerId,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount
      } = options;

      let whereConditions = [];

      // Add status filter
      if (status) {
        if (Array.isArray(status)) {
          whereConditions.push(inArray(orders.status, status));
        } else {
          whereConditions.push(eq(orders.status, status));
        }
      }

      // Add customer filter
      if (customerId) {
        whereConditions.push(eq(orders.customerId, customerId));
      }

      // Add date range filters
      if (dateFrom) {
        whereConditions.push(gte(orders.createdAt, dateFrom));
      }
      if (dateTo) {
        whereConditions.push(lte(orders.createdAt, dateTo));
      }

      // Add amount range filters
      if (minAmount !== undefined) {
        whereConditions.push(gte(orders.totalAmount, minAmount.toString()));
      }
      if (maxAmount !== undefined) {
        whereConditions.push(lte(orders.totalAmount, maxAmount.toString()));
      }

      let query = this.databaseService.db
        .select()
        .from(orders);

      if (whereConditions.length > 0) {
        query = query.where(and(...whereConditions));
      }

      const result = await query;
      return result.length;
    } catch (error) {
      this.logger.error(`Failed to count orders: ${error.message}`);
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const order = await this.findById(id);
      return order !== null;
    } catch (error) {
      this.logger.error(`Failed to check if order exists ${id}: ${error.message}`);
      throw error;
    }
  }

  async calculateTotals(orderId: string): Promise<{ subtotal: number; tax: number; total: number }> {
    try {
      const items = await this.databaseService.db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId));

      const subtotal = items.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);
      const tax = subtotal * 0.1; // 10% tax rate - this should be configurable
      const total = subtotal + tax;

      return {
        subtotal: Math.round(subtotal * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        total: Math.round(total * 100) / 100,
      };
    } catch (error) {
      this.logger.error(`Failed to calculate totals for order ${orderId}: ${error.message}`);
      throw error;
    }
  }

  async updateTotals(orderId: string): Promise<Order> {
    try {
      const totals = await this.calculateTotals(orderId);

      const [order] = await this.databaseService.db
        .update(orders)
        .set({
          subtotalAmount: totals.subtotal.toString(),
          taxAmount: totals.tax.toString(),
          totalAmount: totals.total.toString(),
        })
        .where(eq(orders.id, orderId))
        .returning();

      if (!order) {
        throw new Error(`Order with ID ${orderId} not found`);
      }

      this.logger.log(`Updated totals for order ${orderId}: subtotal=${totals.subtotal}, tax=${totals.tax}, total=${totals.total}`);
      return order;
    } catch (error) {
      this.logger.error(`Failed to update totals for order ${orderId}: ${error.message}`);
      throw error;
    }
  }
}