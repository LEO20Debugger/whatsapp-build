import { Processor, Process } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { QUEUE_NAMES } from "../constants/queue-names.constants";
import { ReceiptGenerationData } from "../services/queue.service";

export interface Receipt {
  id: string;
  orderId: string;
  customerPhone: string;
  generatedAt: Date;
  content: {
    orderNumber: string;
    customerInfo: {
      phone: string;
      name?: string;
    };
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
    summary: {
      subtotal: number;
      tax: number;
      total: number;
    };
    payment: {
      method: string;
      reference: string;
      verifiedAt: Date;
    };
    deliveryInfo?: {
      estimatedTime: string;
      trackingNumber?: string;
    };
  };
  format: "text" | "pdf" | "html";
}

@Processor(QUEUE_NAMES.RECEIPT_GENERATION)
export class ReceiptGenerationProcessor {
  private readonly logger = new Logger(ReceiptGenerationProcessor.name);

  @Process("generate-receipt")
  async handleReceiptGeneration(
    job: Job<ReceiptGenerationData>,
  ): Promise<Receipt> {
    const { data } = job;
    const { orderId, customerPhone, sendViaWhatsApp } = data;

    this.logger.log(`Processing receipt generation`, {
      jobId: job.id,
      orderId,
      customerPhone,
      sendViaWhatsApp,
      attempt: job.attemptsMade,
    });

    try {
      // TODO: This will be implemented when order and payment services are available
      // For now, we'll simulate the receipt generation
      const receipt = await this.generateReceipt(data);

      this.logger.log(`Receipt generated successfully`, {
        jobId: job.id,
        receiptId: receipt.id,
        orderId,
        customerPhone,
      });

      // Store receipt in database
      await this.storeReceipt(receipt);

      // Send via WhatsApp if requested
      if (sendViaWhatsApp) {
        await this.sendReceiptViaWhatsApp(receipt);
      }

      return receipt;
    } catch (error) {
      this.logger.error(`Receipt generation failed`, {
        jobId: job.id,
        orderId,
        customerPhone,
        attempt: job.attemptsMade,
        error: error.message,
      });

      // Re-throw to trigger Bull's retry mechanism
      throw error;
    }
  }

  /**
   * Generate receipt content - will be replaced with actual order/payment service calls
   */
  private async generateReceipt(data: ReceiptGenerationData): Promise<Receipt> {
    // Simulate database queries
    await new Promise((resolve) => setTimeout(resolve, 100));

    // TODO: Fetch actual order and payment data from services
    const mockOrderData = await this.fetchOrderData(data.orderId);
    const mockPaymentData = await this.fetchPaymentData(data.orderId);

    const receipt: Receipt = {
      id: `RCP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      orderId: data.orderId,
      customerPhone: data.customerPhone,
      generatedAt: new Date(),
      content: {
        orderNumber: `ORD-${data.orderId.substr(-8).toUpperCase()}`,
        customerInfo: {
          phone: data.customerPhone,
          name: mockOrderData.customerName,
        },
        items: mockOrderData.items,
        summary: mockOrderData.summary,
        payment: mockPaymentData,
        deliveryInfo: {
          estimatedTime: "2-3 business days",
          trackingNumber: `TRK${Date.now()}`,
        },
      },
      format: "text",
    };

    return receipt;
  }

  /**
   * Fetch order data - mock implementation
   */
  private async fetchOrderData(orderId: string) {
    // TODO: Replace with actual order service call
    return {
      customerName: "John Doe",
      items: [
        {
          name: "Product A",
          quantity: 2,
          unitPrice: 25.0,
          totalPrice: 50.0,
        },
        {
          name: "Product B",
          quantity: 1,
          unitPrice: 15.0,
          totalPrice: 15.0,
        },
      ],
      summary: {
        subtotal: 65.0,
        tax: 6.5,
        total: 71.5,
      },
    };
  }

  /**
   * Fetch payment data - mock implementation
   */
  private async fetchPaymentData(orderId: string) {
    // TODO: Replace with actual payment service call
    return {
      method: "Bank Transfer",
      reference: `PAY_${orderId.substr(-8)}`,
      verifiedAt: new Date(),
    };
  }

  /**
   * Store receipt in database - mock implementation
   */
  private async storeReceipt(receipt: Receipt): Promise<void> {
    // TODO: Replace with actual database storage
    this.logger.debug(`Storing receipt in database`, {
      receiptId: receipt.id,
      orderId: receipt.orderId,
    });

    // Simulate database write
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * Send receipt via WhatsApp - mock implementation
   */
  private async sendReceiptViaWhatsApp(receipt: Receipt): Promise<void> {
    // TODO: Replace with actual WhatsApp service call
    this.logger.debug(`Sending receipt via WhatsApp`, {
      receiptId: receipt.id,
      customerPhone: receipt.customerPhone,
    });

    // Format receipt as text message
    const receiptText = this.formatReceiptAsText(receipt);

    // Simulate WhatsApp message sending
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.logger.log(`Receipt sent via WhatsApp`, {
      receiptId: receipt.id,
      customerPhone: receipt.customerPhone,
    });
  }

  /**
   * Format receipt as text for WhatsApp
   */
  private formatReceiptAsText(receipt: Receipt): string {
    const { content } = receipt;

    let text = `🧾 *RECEIPT*\n\n`;
    text += `Order: ${content.orderNumber}\n`;
    text += `Customer: ${content.customerInfo.name || content.customerInfo.phone}\n`;
    text += `Date: ${receipt.generatedAt.toLocaleDateString()}\n\n`;

    text += `*ITEMS:*\n`;
    content.items.forEach((item) => {
      text += `• ${item.name} x${item.quantity} - $${item.totalPrice.toFixed(2)}\n`;
    });

    text += `\n*SUMMARY:*\n`;
    text += `Subtotal: $${content.summary.subtotal.toFixed(2)}\n`;
    text += `Tax: $${content.summary.tax.toFixed(2)}\n`;
    text += `*Total: $${content.summary.total.toFixed(2)}*\n\n`;

    text += `*PAYMENT:*\n`;
    text += `Method: ${content.payment.method}\n`;
    text += `Reference: ${content.payment.reference}\n`;
    text += `Verified: ${content.payment.verifiedAt.toLocaleDateString()}\n\n`;

    if (content.deliveryInfo) {
      text += `*DELIVERY:*\n`;
      text += `Estimated: ${content.deliveryInfo.estimatedTime}\n`;
      if (content.deliveryInfo.trackingNumber) {
        text += `Tracking: ${content.deliveryInfo.trackingNumber}\n`;
      }
    }

    text += `\nThank you for your order! 🙏`;

    return text;
  }

  /**
   * Handle job completion
   */
  async onCompleted(
    job: Job<ReceiptGenerationData>,
    result: Receipt,
  ): Promise<void> {
    this.logger.log(`Receipt generation job completed`, {
      jobId: job.id,
      receiptId: result.id,
      orderId: job.data.orderId,
      attempts: job.attemptsMade,
    });
  }

  /**
   * Handle job failure
   */
  async onFailed(job: Job<ReceiptGenerationData>, error: Error): Promise<void> {
    this.logger.error(`Receipt generation job failed permanently`, {
      jobId: job.id,
      orderId: job.data.orderId,
      customerPhone: job.data.customerPhone,
      attempts: job.attemptsMade,
      error: error.message,
    });

    // TODO: Implement notification system for failed receipt generations
    // This might involve notifying customer service or sending alerts
  }
}
