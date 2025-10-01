import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PaymentsRepository } from "./payments.repository";
import { OrdersRepository } from "../orders/orders.repository";
import {
  Payment,
  NewPayment,
  PaymentMethod,
  PaymentStatus,
  Order,
} from "../../database/types";

export interface PaymentInstructions {
  paymentReference: string;
  amount: number;
  paymentMethod: PaymentMethod;
  accountDetails: PaymentAccountDetails;
  expiresAt: Date;
  instructions: string[];
}

export interface PaymentAccountDetails {
  bankTransfer?: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    routingNumber?: string;
  };
  card?: {
    merchantId: string;
    processorUrl: string;
  };
}

export interface PaymentTimeoutConfig {
  defaultTimeoutMinutes: number;
  reminderIntervals: number[]; // Minutes before expiry to send reminders
  maxRetries: number;
}

export interface CreatePaymentRequest {
  orderId: string;
  paymentMethod: PaymentMethod;
  externalTransactionId?: string;
}

export interface PaymentVerificationRequest {
  paymentId?: string;
  paymentReference?: string;
  externalTransactionId?: string;
  amount?: number;
  verificationData?: Record<string, any>;
}

export interface PaymentVerificationResult {
  success: boolean;
  payment: Payment;
  message: string;
  verificationDetails?: Record<string, any>;
}

export interface PaymentRetryConfig {
  maxRetries: number;
  retryDelayMinutes: number;
  backoffMultiplier: number;
}

export interface PaymentFailureHandling {
  autoRetry: boolean;
  notifyCustomer: boolean;
  escalateAfterRetries: boolean;
}

export interface ReceiptData {
  receiptId: string;
  paymentId: string;
  orderId: string;
  customerInfo: {
    name?: string;
    phoneNumber?: string;
    email?: string;
  };
  orderDetails: {
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
    subtotal: number;
    tax: number;
    total: number;
  };
  paymentDetails: {
    method: PaymentMethod;
    reference: string;
    amount: number;
    verifiedAt: Date;
    externalTransactionId?: string;
  };
  businessInfo: {
    name: string;
    address?: string;
    phone?: string;
    email?: string;
    taxId?: string;
  };
  generatedAt: Date;
  receiptNumber: string;
}

export interface ReceiptFormat {
  format: 'text' | 'html' | 'pdf';
  template?: string;
  styling?: Record<string, any>;
}

export interface ReceiptStorage {
  receiptId: string;
  content: string;
  format: string;
  createdAt: Date;
  metadata?: Record<string, any>;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  
  // Default payment timeout configuration
  private readonly paymentTimeoutConfig: PaymentTimeoutConfig = {
    defaultTimeoutMinutes: 30, // 30 minutes default timeout
    reminderIntervals: [15, 5], // Send reminders at 15 and 5 minutes before expiry
    maxRetries: 3,
  };

  // Payment retry configuration
  private readonly paymentRetryConfig: PaymentRetryConfig = {
    maxRetries: 3,
    retryDelayMinutes: 5,
    backoffMultiplier: 2,
  };

  // Payment failure handling configuration
  private readonly paymentFailureConfig: PaymentFailureHandling = {
    autoRetry: true,
    notifyCustomer: true,
    escalateAfterRetries: true,
  };

  // Business information for receipts
  private readonly businessInfo = {
    name: process.env.BUSINESS_NAME || 'WhatsApp Order Bot',
    address: process.env.BUSINESS_ADDRESS || '123 Business Street, City, Country',
    phone: process.env.BUSINESS_PHONE || '+1234567890',
    email: process.env.BUSINESS_EMAIL || 'orders@business.com',
    taxId: process.env.BUSINESS_TAX_ID || 'TAX123456789',
  };

  // In-memory receipt storage (in production, this would be a database)
  private readonly receiptStorage = new Map<string, ReceiptStorage>();

  // Payment account details - should be configurable via environment
  private readonly paymentAccounts: Record<PaymentMethod, PaymentAccountDetails> = {
    bank_transfer: {
      bankTransfer: {
        accountName: process.env.BANK_ACCOUNT_NAME || "Business Account",
        accountNumber: process.env.BANK_ACCOUNT_NUMBER || "1234567890",
        bankName: process.env.BANK_NAME || "Main Bank",
        routingNumber: process.env.BANK_ROUTING_NUMBER,
      },
    },
    card: {
      card: {
        merchantId: process.env.CARD_MERCHANT_ID || "MERCHANT123",
        processorUrl: process.env.CARD_PROCESSOR_URL || "https://payments.example.com",
      },
    },
  };

  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly ordersRepository: OrdersRepository,
  ) {}

  /**
   * Generate payment instructions for an order
   * Requirements: 2.1, 2.2
   */
  async generatePaymentInstructions(
    orderId: string,
    paymentMethod: PaymentMethod,
  ): Promise<PaymentInstructions> {
    try {
      this.logger.log(
        `Generating payment instructions for order ${orderId} using ${paymentMethod}`,
      );

      // Validate order exists
      const order = await this.ordersRepository.findById(orderId);
      if (!order) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      // Check if order is in valid state for payment
      if (!this.isOrderPayable(order)) {
        throw new BadRequestException(
          `Order ${orderId} is not in a payable state. Current status: ${order.status}`,
        );
      }

      // Generate unique payment reference
      const paymentReference = await this.generatePaymentReference(orderId);

      // Calculate expiry time
      const expiresAt = this.calculatePaymentExpiry();

      // Get account details for payment method
      const accountDetails = this.getAccountDetails(paymentMethod);

      // Generate instructions text
      const instructions = this.generateInstructionText(
        paymentMethod,
        parseFloat(order.totalAmount),
        paymentReference,
        accountDetails,
      );

      const paymentInstructions: PaymentInstructions = {
        paymentReference,
        amount: parseFloat(order.totalAmount),
        paymentMethod,
        accountDetails,
        expiresAt,
        instructions,
      };

      this.logger.log(
        `Generated payment instructions for order ${orderId} with reference ${paymentReference}`,
      );

      return paymentInstructions;
    } catch (error) {
      this.logger.error(
        `Failed to generate payment instructions for order ${orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Create a payment record for an order
   * Requirements: 2.1, 2.2
   */
  async createPayment(request: CreatePaymentRequest): Promise<Payment> {
    try {
      const { orderId, paymentMethod, externalTransactionId } = request;

      this.logger.log(`Creating payment for order ${orderId}`);

      // Validate order exists
      const order = await this.ordersRepository.findById(orderId);
      if (!order) {
        throw new NotFoundException(`Order with ID ${orderId} not found`);
      }

      // Check if payment already exists for this order
      const existingPayments = await this.paymentsRepository.findByOrderId(orderId);
      const pendingPayment = existingPayments.find(p => p.status === 'pending');
      
      if (pendingPayment) {
        this.logger.warn(`Pending payment already exists for order ${orderId}`);
        return pendingPayment;
      }

      // Generate payment reference if not provided
      const paymentReference = await this.generatePaymentReference(orderId);

      // Create payment record
      const paymentData: NewPayment = {
        orderId,
        amount: order.totalAmount,
        paymentMethod,
        ...(paymentReference && { paymentReference }),
        ...(externalTransactionId && { externalTransactionId }),
      };

      const payment = await this.paymentsRepository.create(paymentData);

      this.logger.log(
        `Created payment ${payment.id} for order ${orderId} with reference ${paymentReference}`,
      );

      return payment;
    } catch (error) {
      this.logger.error(
        `Failed to create payment for order ${request.orderId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Generate unique payment reference number
   * Requirements: 2.2
   */
  async generatePaymentReference(orderId: string): Promise<string> {
    try {
      const timestamp = Date.now().toString(36).toUpperCase();
      const orderPrefix = orderId.slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      
      let paymentReference = `PAY-${orderPrefix}-${timestamp}-${randomSuffix}`;
      
      // Ensure uniqueness by checking database
      let attempts = 0;
      const maxAttempts = 5;
      
      while (attempts < maxAttempts) {
        const exists = await this.paymentsRepository.paymentReferenceExists(paymentReference);
        if (!exists) {
          break;
        }
        
        attempts++;
        const newSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        paymentReference = `PAY-${orderPrefix}-${timestamp}-${newSuffix}`;
      }
      
      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique payment reference after maximum attempts');
      }

      this.logger.log(`Generated payment reference: ${paymentReference}`);
      return paymentReference;
    } catch (error) {
      this.logger.error(`Failed to generate payment reference: ${error.message}`);
      throw error;
    }
  }

  /**
   * Calculate payment expiry time
   * Requirements: 2.3
   */
  calculatePaymentExpiry(customTimeoutMinutes?: number): Date {
    const timeoutMinutes = customTimeoutMinutes || this.paymentTimeoutConfig.defaultTimeoutMinutes;
    const expiryTime = new Date();
    expiryTime.setMinutes(expiryTime.getMinutes() + timeoutMinutes);
    
    this.logger.log(`Payment expiry calculated: ${expiryTime.toISOString()}`);
    return expiryTime;
  }

  /**
   * Verify payment confirmation
   * Requirements: 3.1, 3.2
   */
  async verifyPayment(request: PaymentVerificationRequest): Promise<PaymentVerificationResult> {
    try {
      this.logger.log('Processing payment verification request', { 
        paymentId: request.paymentId,
        paymentReference: request.paymentReference,
        externalTransactionId: request.externalTransactionId 
      });

      // Find payment by ID, reference, or external transaction ID
      const payment = await this.findPaymentForVerification(request);
      if (!payment) {
        return {
          success: false,
          payment: null as any,
          message: 'Payment not found for verification',
        };
      }

      // Validate payment status
      const statusValidation = this.validatePaymentForVerification(payment);
      if (!statusValidation.isValid) {
        return {
          success: false,
          payment,
          message: statusValidation.message,
        };
      }

      // Validate payment amount if provided
      if (request.amount && parseFloat(payment.amount) !== request.amount) {
        this.logger.warn(`Payment amount mismatch: expected ${request.amount}, got ${payment.amount}`);
        return {
          success: false,
          payment,
          message: `Payment amount mismatch: expected ${request.amount}, got ${payment.amount}`,
        };
      }

      // Process verification
      const verifiedPayment = await this.paymentsRepository.verifyPayment(
        payment.id,
        request.externalTransactionId || payment.externalTransactionId,
      );

      this.logger.log(`Successfully verified payment ${payment.id}`);
      return {
        success: true,
        payment: verifiedPayment,
        message: 'Payment verified successfully',
        verificationDetails: request.verificationData,
      };
    } catch (error) {
      this.logger.error(`Failed to verify payment: ${error.message}`);
      return {
        success: false,
        payment: null as any,
        message: `Payment verification failed: ${error.message}`,
      };
    }
  }

  /**
   * Generate digital receipt for verified payment
   * Requirements: 4.1, 4.2
   */
  async generateReceipt(paymentId: string, format: ReceiptFormat = { format: 'text' }): Promise<ReceiptData> {
    try {
      this.logger.log(`Generating receipt for payment ${paymentId}`);

      // Get payment details
      const payment = await this.paymentsRepository.findById(paymentId);
      if (!payment) {
        throw new NotFoundException(`Payment with ID ${paymentId} not found`);
      }

      if (payment.status !== 'verified') {
        throw new BadRequestException('Receipt can only be generated for verified payments');
      }

      // Get order details with items
      const orderWithItems = await this.ordersRepository.findByIdWithItems(payment.orderId);
      if (!orderWithItems) {
        throw new NotFoundException(`Order with ID ${payment.orderId} not found`);
      }

      // Generate receipt ID and number
      const receiptId = this.generateReceiptId();
      const receiptNumber = this.generateReceiptNumber(payment.orderId);

      // Build receipt data
      const receiptData: ReceiptData = {
        receiptId,
        paymentId: payment.id,
        orderId: payment.orderId,
        customerInfo: {
          phoneNumber: orderWithItems.customer?.phoneNumber,
          name: orderWithItems.customer?.name,
          email: undefined, // Email not available in customer schema
        },
        orderDetails: {
          items: orderWithItems.items.map(item => ({
            name: item.productName || 'Unknown Product',
            quantity: item.quantity,
            unitPrice: parseFloat(item.unitPrice),
            totalPrice: parseFloat(item.totalPrice),
          })),
          subtotal: parseFloat(orderWithItems.subtotalAmount),
          tax: parseFloat(orderWithItems.taxAmount),
          total: parseFloat(orderWithItems.totalAmount),
        },
        paymentDetails: {
          method: payment.paymentMethod,
          reference: payment.paymentReference || '',
          amount: parseFloat(payment.amount),
          verifiedAt: payment.verifiedAt!,
          externalTransactionId: payment.externalTransactionId || undefined,
        },
        businessInfo: this.businessInfo,
        generatedAt: new Date(),
        receiptNumber,
      };

      // Generate formatted receipt content
      const receiptContent = this.formatReceipt(receiptData, format);

      // Store receipt
      await this.storeReceipt(receiptId, receiptContent, format.format, payment.id);

      this.logger.log(`Generated receipt ${receiptId} for payment ${paymentId}`);
      return receiptData;
    } catch (error) {
      this.logger.error(`Failed to generate receipt for payment ${paymentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get receipt by payment ID
   * Requirements: 4.3
   */
  async getReceiptByPaymentId(paymentId: string): Promise<ReceiptStorage | null> {
    try {
      this.logger.log(`Finding receipt for payment ${paymentId}`);

      // Find receipt by payment ID in metadata
      for (const [receiptId, receipt] of this.receiptStorage.entries()) {
        if (receipt.metadata?.paymentId === paymentId) {
          return receipt;
        }
      }

      this.logger.warn(`No receipt found for payment ${paymentId}`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to find receipt for payment ${paymentId}: ${error.message}`);
      throw error;
    }
  }

  // Private helper methods
  private getAccountDetails(paymentMethod: PaymentMethod): PaymentAccountDetails {
    const accountDetails = this.paymentAccounts[paymentMethod];
    if (!accountDetails) {
      throw new BadRequestException(`No account details configured for payment method: ${paymentMethod}`);
    }
    return accountDetails;
  }

  private generateInstructionText(
    paymentMethod: PaymentMethod,
    amount: number,
    paymentReference: string,
    accountDetails: PaymentAccountDetails,
  ): string[] {
    const instructions: string[] = [];
    
    switch (paymentMethod) {
      case 'bank_transfer':
        if (accountDetails.bankTransfer) {
          instructions.push(
            `Please transfer ${amount.toFixed(2)} to the following bank account:`,
            `Bank: ${accountDetails.bankTransfer.bankName}`,
            `Account Name: ${accountDetails.bankTransfer.accountName}`,
            `Account Number: ${accountDetails.bankTransfer.accountNumber}`,
          );
          if (accountDetails.bankTransfer.routingNumber) {
            instructions.push(`Routing Number: ${accountDetails.bankTransfer.routingNumber}`);
          }
          instructions.push(
            `Payment Reference: ${paymentReference}`,
            `IMPORTANT: Include the payment reference in your transfer description.`,
          );
        }
        break;
        
      case 'card':
        if (accountDetails.card) {
          instructions.push(
            `Please complete your card payment of ${amount.toFixed(2)}:`,
            `Payment Reference: ${paymentReference}`,
            `You will be redirected to our secure payment processor.`,
          );
        }
        break;
        
      default:
        instructions.push(
          `Payment of ${amount.toFixed(2)} required.`,
          `Payment Reference: ${paymentReference}`,
        );
    }
    
    return instructions;
  }

  private isOrderPayable(order: Order): boolean {
    const payableStatuses = ['pending', 'confirmed'];
    return payableStatuses.includes(order.status);
  }

  private async findPaymentForVerification(request: PaymentVerificationRequest): Promise<Payment | null> {
    try {
      if (request.paymentId) {
        return await this.paymentsRepository.findById(request.paymentId);
      }

      if (request.paymentReference) {
        return await this.paymentsRepository.findByPaymentReference(request.paymentReference);
      }

      if (request.externalTransactionId) {
        return await this.paymentsRepository.findByExternalTransactionId(request.externalTransactionId);
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to find payment for verification: ${error.message}`);
      return null;
    }
  }

  private validatePaymentForVerification(payment: Payment): { isValid: boolean; message: string } {
    if (payment.status === 'verified') {
      return {
        isValid: false,
        message: 'Payment is already verified',
      };
    }

    if (payment.status === 'failed') {
      return {
        isValid: false,
        message: 'Cannot verify a failed payment',
      };
    }

    if (payment.status === 'refunded') {
      return {
        isValid: false,
        message: 'Cannot verify a refunded payment',
      };
    }

    if (payment.status !== 'pending') {
      return {
        isValid: false,
        message: `Payment status '${payment.status}' is not eligible for verification`,
      };
    }

    return {
      isValid: true,
      message: 'Payment is valid for verification',
    };
  }

  private generateReceiptId(): string {
    return `receipt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  private generateReceiptNumber(orderId: string): string {
    const orderSuffix = orderId.slice(-4).toUpperCase();
    const timestamp = Date.now().toString(36).toUpperCase();
    return `RCP-${orderSuffix}-${timestamp}`;
  }

  private formatReceipt(receiptData: ReceiptData, format: ReceiptFormat): string {
    // Simple text format for now
    let content = `Receipt #${receiptData.receiptNumber}\n`;
    content += `Date: ${receiptData.generatedAt.toLocaleDateString()}\n`;
    content += `Customer: ${receiptData.customerInfo.name || 'N/A'}\n`;
    content += `Phone: ${receiptData.customerInfo.phoneNumber}\n\n`;
    
    content += `Order Details:\n`;
    receiptData.orderDetails.items.forEach((item, index) => {
      content += `${index + 1}. ${item.name} x${item.quantity} - $${item.totalPrice.toFixed(2)}\n`;
    });
    
    content += `\nTotal: $${receiptData.orderDetails.total.toFixed(2)}\n`;
    content += `Payment Method: ${receiptData.paymentDetails.method.replace('_', ' ').toUpperCase()}\n`;
    content += `Reference: ${receiptData.paymentDetails.reference}\n`;
    
    return content;
  }

  private async storeReceipt(receiptId: string, content: string, format: string, paymentId: string): Promise<void> {
    const receiptStorage: ReceiptStorage = {
      receiptId,
      content,
      format,
      createdAt: new Date(),
      metadata: { paymentId },
    };
    
    this.receiptStorage.set(receiptId, receiptStorage);
  }
}