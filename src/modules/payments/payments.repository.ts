import { Injectable, Logger } from "@nestjs/common";
import { eq, desc, asc, and, gte, lte, isNull, isNotNull } from "drizzle-orm";
import { DatabaseService } from "../../database/database.service";
import { payments, orders } from "../../database/schema";
import {
  Payment,
  NewPayment,
  UpdatePayment,
  PaymentStatus,
  PaymentMethod,
} from "../../database/types";

export interface PaymentSearchOptions {
  limit?: number;
  offset?: number;
  sortBy?: "createdAt" | "amount" | "verifiedAt";
  sortOrder?: "asc" | "desc";
  status?: PaymentStatus | PaymentStatus[];
  paymentMethod?: PaymentMethod | PaymentMethod[];
  orderId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  minAmount?: number;
  maxAmount?: number;
  verifiedOnly?: boolean;
}

@Injectable()
export class PaymentsRepository {
  private readonly logger = new Logger(PaymentsRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async create(paymentData: NewPayment): Promise<Payment> {
    try {
      const [payment] = await this.databaseService.db
        .insert(payments)
        .values(paymentData)
        .returning();

      this.logger.log(`Created payment with ID: ${payment.id}`);
      return payment;
    } catch (error) {
      this.logger.error(`Failed to create payment: ${error.message}`);
      throw error;
    }
  }

  async createForOrder(
    orderId: string,
    amount: number,
    paymentMethod: PaymentMethod,
    paymentReference?: string,
    externalTransactionId?: string,
  ): Promise<Payment> {
    try {
      const paymentData = {
        orderId,
        amount: amount.toString(),
        paymentMethod,
        status: "pending" as const,
        ...(paymentReference && { paymentReference }),
        ...(externalTransactionId && { externalTransactionId }),
      } as NewPayment;

      const payment = await this.create(paymentData);
      this.logger.log(
        `Created payment for order ${orderId} with amount ${amount}`,
      );
      return payment;
    } catch (error) {
      this.logger.error(
        `Failed to create payment for order ${orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  async findById(id: string): Promise<Payment | null> {
    try {
      const [payment] = await this.databaseService.db
        .select()
        .from(payments)
        .where(eq(payments.id, id))
        .limit(1);

      return payment || null;
    } catch (error) {
      this.logger.error(`Failed to find payment by ID ${id}: ${error.message}`);
      throw error;
    }
  }

  async findByPaymentReference(
    paymentReference: string,
  ): Promise<Payment | null> {
    try {
      const [payment] = await this.databaseService.db
        .select()
        .from(payments)
        .where(eq(payments.paymentReference, paymentReference))
        .limit(1);

      return payment || null;
    } catch (error) {
      this.logger.error(
        `Failed to find payment by reference ${paymentReference}: ${error.message}`,
      );
      throw error;
    }
  }

  async findByExternalTransactionId(
    externalTransactionId: string,
  ): Promise<Payment | null> {
    try {
      const [payment] = await this.databaseService.db
        .select()
        .from(payments)
        .where(eq(payments.externalTransactionId, externalTransactionId))
        .limit(1);

      return payment || null;
    } catch (error) {
      this.logger.error(
        `Failed to find payment by external transaction ID ${externalTransactionId}: ${error.message}`,
      );
      throw error;
    }
  }

  async findByOrderId(orderId: string): Promise<Payment[]> {
    try {
      const paymentList = await this.databaseService.db
        .select()
        .from(payments)
        .where(eq(payments.orderId, orderId))
        .orderBy(desc(payments.createdAt));

      return paymentList;
    } catch (error) {
      this.logger.error(
        `Failed to find payments by order ID ${orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  async findByStatus(
    status: PaymentStatus | PaymentStatus[],
    options: PaymentSearchOptions = {},
  ): Promise<Payment[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = "createdAt",
        sortOrder = "desc",
        paymentMethod,
        orderId,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
      } = options;

      let whereConditions = [];

      // Add status filter
      if (Array.isArray(status)) {
        whereConditions.push(
          `status IN (${status.map((s) => `'${s}'`).join(",")})`,
        );
      } else {
        whereConditions.push(eq(payments.status, status));
      }

      // Add payment method filter
      if (paymentMethod) {
        if (Array.isArray(paymentMethod)) {
          whereConditions.push(
            `payment_method IN (${paymentMethod.map((m) => `'${m}'`).join(",")})`,
          );
        } else {
          whereConditions.push(eq(payments.paymentMethod, paymentMethod));
        }
      }

      // Add order filter
      if (orderId) {
        whereConditions.push(eq(payments.orderId, orderId));
      }

      // Add date range filters
      if (dateFrom) {
        whereConditions.push(gte(payments.createdAt, dateFrom));
      }
      if (dateTo) {
        whereConditions.push(lte(payments.createdAt, dateTo));
      }

      // Add amount range filters
      if (minAmount !== undefined) {
        whereConditions.push(gte(payments.amount, minAmount.toString()));
      }
      if (maxAmount !== undefined) {
        whereConditions.push(lte(payments.amount, maxAmount.toString()));
      }

      const sortColumn = payments[sortBy];
      const orderByClause =
        sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

      const paymentList = await this.databaseService.db
        .select()
        .from(payments)
        .where(and(...whereConditions.filter((c) => typeof c !== "string"))) // Filter out string conditions for now
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return paymentList;
    } catch (error) {
      this.logger.error(`Failed to find payments by status: ${error.message}`);
      throw error;
    }
  }

  async updateStatus(
    id: string,
    status: PaymentStatus,
    failureReason?: string,
    externalTransactionId?: string,
  ): Promise<Payment> {
    try {
      const updateData: any = { status };

      if (status === "verified") {
        updateData.verifiedAt = new Date();
      }

      if (failureReason) {
        updateData.failureReason = failureReason;
      }

      if (externalTransactionId) {
        updateData.externalTransactionId = externalTransactionId;
      }

      const [payment] = await this.databaseService.db
        .update(payments)
        .set(updateData)
        .where(eq(payments.id, id))
        .returning();

      if (!payment) {
        throw new Error(`Payment with ID ${id} not found`);
      }

      this.logger.log(`Updated payment ${id} status to ${status}`);
      return payment;
    } catch (error) {
      this.logger.error(
        `Failed to update payment status ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  async verifyPayment(
    id: string,
    externalTransactionId?: string,
  ): Promise<Payment> {
    try {
      const updateData: any = {
        status: "verified" as PaymentStatus,
        verifiedAt: new Date(),
      };

      if (externalTransactionId) {
        updateData.externalTransactionId = externalTransactionId;
      }

      const [payment] = await this.databaseService.db
        .update(payments)
        .set(updateData)
        .where(eq(payments.id, id))
        .returning();

      if (!payment) {
        throw new Error(`Payment with ID ${id} not found`);
      }

      this.logger.log(`Verified payment ${id}`);
      return payment;
    } catch (error) {
      this.logger.error(`Failed to verify payment ${id}: ${error.message}`);
      throw error;
    }
  }

  async markAsFailed(id: string, failureReason: string): Promise<Payment> {
    try {
      const [payment] = await this.databaseService.db
        .update(payments)
        .set({
          status: "failed" as PaymentStatus,
          failureReason,
        } as UpdatePayment)
        .where(eq(payments.id, id))
        .returning();

      if (!payment) {
        throw new Error(`Payment with ID ${id} not found`);
      }

      this.logger.log(`Marked payment ${id} as failed: ${failureReason}`);
      return payment;
    } catch (error) {
      this.logger.error(
        `Failed to mark payment as failed ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  async refundPayment(id: string, refundReason?: string): Promise<Payment> {
    try {
      const updateData: any = {
        status: "refunded" as PaymentStatus,
      };

      if (refundReason) {
        updateData.failureReason = refundReason;
      }

      const [payment] = await this.databaseService.db
        .update(payments)
        .set(updateData)
        .where(eq(payments.id, id))
        .returning();

      if (!payment) {
        throw new Error(`Payment with ID ${id} not found`);
      }

      this.logger.log(`Refunded payment ${id}`);
      return payment;
    } catch (error) {
      this.logger.error(`Failed to refund payment ${id}: ${error.message}`);
      throw error;
    }
  }

  async update(id: string, updateData: Partial<NewPayment>): Promise<Payment> {
    try {
      const [payment] = await this.databaseService.db
        .update(payments)
        .set(updateData)
        .where(eq(payments.id, id))
        .returning();

      if (!payment) {
        throw new Error(`Payment with ID ${id} not found`);
      }

      this.logger.log(`Updated payment with ID: ${id}`);
      return payment;
    } catch (error) {
      this.logger.error(`Failed to update payment ${id}: ${error.message}`);
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.databaseService.db
        .delete(payments)
        .where(eq(payments.id, id));

      // For postgres-js, result is an array with count property
      const deleted = (result as any).count > 0;
      if (deleted) {
        this.logger.log(`Deleted payment with ID: ${id}`);
      } else {
        this.logger.warn(`Payment with ID ${id} not found for deletion`);
      }

      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete payment ${id}: ${error.message}`);
      throw error;
    }
  }

  async findAll(options: PaymentSearchOptions = {}): Promise<Payment[]> {
    try {
      const {
        limit = 50,
        offset = 0,
        sortBy = "createdAt",
        sortOrder = "desc",
        status,
        paymentMethod,
        orderId,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        verifiedOnly = false,
      } = options;

      let whereConditions = [];

      // Add status filter
      if (status) {
        if (Array.isArray(status)) {
          // Handle array of statuses - would need custom SQL for this
          whereConditions.push(eq(payments.status, status[0])); // Simplified for now
        } else {
          whereConditions.push(eq(payments.status, status));
        }
      }

      // Add payment method filter
      if (paymentMethod) {
        if (Array.isArray(paymentMethod)) {
          // Handle array of payment methods - would need custom SQL for this
          whereConditions.push(eq(payments.paymentMethod, paymentMethod[0])); // Simplified for now
        } else {
          whereConditions.push(eq(payments.paymentMethod, paymentMethod));
        }
      }

      // Add order filter
      if (orderId) {
        whereConditions.push(eq(payments.orderId, orderId));
      }

      // Add verified filter
      if (verifiedOnly) {
        whereConditions.push(isNotNull(payments.verifiedAt));
      }

      // Add date range filters
      if (dateFrom) {
        whereConditions.push(gte(payments.createdAt, dateFrom));
      }
      if (dateTo) {
        whereConditions.push(lte(payments.createdAt, dateTo));
      }

      // Add amount range filters
      if (minAmount !== undefined) {
        whereConditions.push(gte(payments.amount, minAmount.toString()));
      }
      if (maxAmount !== undefined) {
        whereConditions.push(lte(payments.amount, maxAmount.toString()));
      }

      const sortColumn = payments[sortBy];
      const orderByClause =
        sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

      const baseQuery = this.databaseService.db.select().from(payments);

      const paymentList = await (
        whereConditions.length > 0
          ? baseQuery.where(and(...whereConditions))
          : baseQuery
      )
        .orderBy(orderByClause)
        .limit(limit)
        .offset(offset);

      return paymentList;
    } catch (error) {
      this.logger.error(`Failed to find payments: ${error.message}`);
      throw error;
    }
  }

  async count(options: PaymentSearchOptions = {}): Promise<number> {
    try {
      const {
        status,
        paymentMethod,
        orderId,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        verifiedOnly = false,
      } = options;

      let whereConditions = [];

      // Add status filter
      if (status) {
        if (Array.isArray(status)) {
          whereConditions.push(eq(payments.status, status[0])); // Simplified for now
        } else {
          whereConditions.push(eq(payments.status, status));
        }
      }

      // Add payment method filter
      if (paymentMethod) {
        if (Array.isArray(paymentMethod)) {
          whereConditions.push(eq(payments.paymentMethod, paymentMethod[0])); // Simplified for now
        } else {
          whereConditions.push(eq(payments.paymentMethod, paymentMethod));
        }
      }

      // Add order filter
      if (orderId) {
        whereConditions.push(eq(payments.orderId, orderId));
      }

      // Add verified filter
      if (verifiedOnly) {
        whereConditions.push(isNotNull(payments.verifiedAt));
      }

      // Add date range filters
      if (dateFrom) {
        whereConditions.push(gte(payments.createdAt, dateFrom));
      }
      if (dateTo) {
        whereConditions.push(lte(payments.createdAt, dateTo));
      }

      // Add amount range filters
      if (minAmount !== undefined) {
        whereConditions.push(gte(payments.amount, minAmount.toString()));
      }
      if (maxAmount !== undefined) {
        whereConditions.push(lte(payments.amount, maxAmount.toString()));
      }

      const baseQuery = this.databaseService.db.select().from(payments);

      const result = await (whereConditions.length > 0
        ? baseQuery.where(and(...whereConditions))
        : baseQuery);
      return result.length;
    } catch (error) {
      this.logger.error(`Failed to count payments: ${error.message}`);
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      const payment = await this.findById(id);
      return payment !== null;
    } catch (error) {
      this.logger.error(
        `Failed to check if payment exists ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  async paymentReferenceExists(paymentReference: string): Promise<boolean> {
    try {
      const payment = await this.findByPaymentReference(paymentReference);
      return payment !== null;
    } catch (error) {
      this.logger.error(
        `Failed to check if payment reference exists ${paymentReference}: ${error.message}`,
      );
      throw error;
    }
  }

  async isPaymentVerified(id: string): Promise<boolean> {
    try {
      const payment = await this.findById(id);
      return payment ? payment.status === "verified" : false;
    } catch (error) {
      this.logger.error(
        `Failed to check if payment is verified ${id}: ${error.message}`,
      );
      throw error;
    }
  }

  async getOrderPaymentTotal(orderId: string): Promise<number> {
    try {
      const payments = await this.findByOrderId(orderId);
      const verifiedPayments = payments.filter((p) => p.status === "verified");
      const total = verifiedPayments.reduce(
        (sum, payment) => sum + parseFloat(payment.amount),
        0,
      );
      return Math.round(total * 100) / 100; // Round to 2 decimal places
    } catch (error) {
      this.logger.error(
        `Failed to calculate payment total for order ${orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  async hasVerifiedPayment(orderId: string): Promise<boolean> {
    try {
      const payments = await this.findByOrderId(orderId);
      return payments.some((p) => p.status === "verified");
    } catch (error) {
      this.logger.error(
        `Failed to check if order has verified payment ${orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  async getPendingPayments(
    options: PaymentSearchOptions = {},
  ): Promise<Payment[]> {
    try {
      return await this.findByStatus("pending", options);
    } catch (error) {
      this.logger.error(`Failed to get pending payments: ${error.message}`);
      throw error;
    }
  }

  async getVerifiedPayments(
    options: PaymentSearchOptions = {},
  ): Promise<Payment[]> {
    try {
      return await this.findByStatus("verified", options);
    } catch (error) {
      this.logger.error(`Failed to get verified payments: ${error.message}`);
      throw error;
    }
  }

  async getFailedPayments(
    options: PaymentSearchOptions = {},
  ): Promise<Payment[]> {
    try {
      return await this.findByStatus("failed", options);
    } catch (error) {
      this.logger.error(`Failed to get failed payments: ${error.message}`);
      throw error;
    }
  }
}
