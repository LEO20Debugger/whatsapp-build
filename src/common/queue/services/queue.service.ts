import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue, JobOptions } from "bull";
import { QUEUE_NAMES } from "../constants/queue-names.constants";

export interface QueuedMessage {
  to: string;
  content: any;
  messageType: "text" | "template" | "interactive";
  originalJobId?: string;
  retryCount?: number;
}

export interface PaymentVerificationData {
  orderId: string;
  paymentReference: string;
  amount: number;
  customerPhone: string;
  paymentMethod?: string;
}

export interface ReceiptGenerationData {
  orderId: string;
  customerPhone: string;
  sendViaWhatsApp: boolean;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.MESSAGE_RETRY)
    private messageRetryQueue: Queue<QueuedMessage>,

    @InjectQueue(QUEUE_NAMES.PAYMENT_VERIFICATION)
    private paymentVerificationQueue: Queue<PaymentVerificationData>,

    @InjectQueue(QUEUE_NAMES.RECEIPT_GENERATION)
    private receiptGenerationQueue: Queue<ReceiptGenerationData>,
  ) {}

  /**
   * Add a message to the retry queue
   */
  async addMessageToQueue(
    message: QueuedMessage,
    options?: JobOptions,
  ): Promise<void> {
    try {
      const job = await this.messageRetryQueue.add("retry-message", message, {
        delay: options?.delay || 0,
        priority: options?.priority || 0,
        ...options,
      });

      this.logger.log(`Message queued for retry`, {
        jobId: job.id,
        to: message.to,
        messageType: message.messageType,
        retryCount: message.retryCount || 0,
      });
    } catch (error) {
      this.logger.error(`Failed to queue message for retry: ${error.message}`, {
        message,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Add payment verification to queue
   */
  async addPaymentVerificationToQueue(
    paymentData: PaymentVerificationData,
    options?: JobOptions,
  ): Promise<void> {
    try {
      const job = await this.paymentVerificationQueue.add(
        "verify-payment",
        paymentData,
        {
          delay: options?.delay || 0,
          priority: options?.priority || 0,
          ...options,
        },
      );

      this.logger.log(`Payment verification queued`, {
        jobId: job.id,
        orderId: paymentData.orderId,
        paymentReference: paymentData.paymentReference,
        amount: paymentData.amount,
      });
    } catch (error) {
      this.logger.error(
        `Failed to queue payment verification: ${error.message}`,
        {
          paymentData,
          error: error.message,
        },
      );
      throw error;
    }
  }

  /**
   * Add receipt generation to queue
   */
  async addReceiptGenerationToQueue(
    receiptData: ReceiptGenerationData,
    options?: JobOptions,
  ): Promise<void> {
    try {
      const job = await this.receiptGenerationQueue.add(
        "generate-receipt",
        receiptData,
        {
          delay: options?.delay || 0,
          priority: options?.priority || 0,
          ...options,
        },
      );

      this.logger.log(`Receipt generation queued`, {
        jobId: job.id,
        orderId: receiptData.orderId,
        customerPhone: receiptData.customerPhone,
        sendViaWhatsApp: receiptData.sendViaWhatsApp,
      });
    } catch (error) {
      this.logger.error(
        `Failed to queue receipt generation: ${error.message}`,
        {
          receiptData,
          error: error.message,
        },
      );
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    try {
      const [
        messageRetryStats,
        paymentVerificationStats,
        receiptGenerationStats,
      ] = await Promise.all([
        this.getQueueStatistics(this.messageRetryQueue, "message-retry"),
        this.getQueueStatistics(
          this.paymentVerificationQueue,
          "payment-verification",
        ),
        this.getQueueStatistics(
          this.receiptGenerationQueue,
          "receipt-generation",
        ),
      ]);

      return {
        messageRetry: messageRetryStats,
        paymentVerification: paymentVerificationStats,
        receiptGeneration: receiptGenerationStats,
      };
    } catch (error) {
      this.logger.error(`Failed to get queue statistics: ${error.message}`);
      throw error;
    }
  }

  private async getQueueStatistics(queue: Queue, queueName: string) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    return {
      name: queueName,
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Pause all queues
   */
  async pauseAllQueues(): Promise<void> {
    await Promise.all([
      this.messageRetryQueue.pause(),
      this.paymentVerificationQueue.pause(),
      this.receiptGenerationQueue.pause(),
    ]);
    this.logger.log("All queues paused");
  }

  /**
   * Resume all queues
   */
  async resumeAllQueues(): Promise<void> {
    await Promise.all([
      this.messageRetryQueue.resume(),
      this.paymentVerificationQueue.resume(),
      this.receiptGenerationQueue.resume(),
    ]);
    this.logger.log("All queues resumed");
  }

  /**
   * Clean completed and failed jobs from all queues
   */
  async cleanAllQueues(): Promise<void> {
    const cleanOptions = {
      grace: 1000,
      limit: 100,
    };

    await Promise.all([
      this.messageRetryQueue.clean(
        5 * 60 * 1000,
        "completed",
        cleanOptions.limit,
      ),
      this.messageRetryQueue.clean(
        24 * 60 * 60 * 1000,
        "failed",
        cleanOptions.limit,
      ),
      this.paymentVerificationQueue.clean(
        5 * 60 * 1000,
        "completed",
        cleanOptions.limit,
      ),
      this.paymentVerificationQueue.clean(
        24 * 60 * 60 * 1000,
        "failed",
        cleanOptions.limit,
      ),
      this.receiptGenerationQueue.clean(
        5 * 60 * 1000,
        "completed",
        cleanOptions.limit,
      ),
      this.receiptGenerationQueue.clean(
        24 * 60 * 60 * 1000,
        "failed",
        cleanOptions.limit,
      ),
    ]);

    this.logger.log("All queues cleaned");
  }
}
