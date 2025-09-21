import { Processor, Process } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { QUEUE_NAMES } from "../constants/queue-names.constants";
import { QueuedMessage } from "../services/queue.service";

@Processor(QUEUE_NAMES.MESSAGE_RETRY)
export class MessageRetryProcessor {
  private readonly logger = new Logger(MessageRetryProcessor.name);

  @Process("retry-message")
  async handleMessageRetry(job: Job<QueuedMessage>): Promise<void> {
    const { data } = job;
    const { to, content, messageType, retryCount = 0 } = data;

    this.logger.log(`Processing message retry`, {
      jobId: job.id,
      to,
      messageType,
      retryCount,
      attempt: job.attemptsMade,
    });

    try {
      // TODO: This will be implemented when WhatsApp service is available
      // For now, we'll simulate the message sending
      await this.sendMessage(data);

      this.logger.log(`Message retry successful`, {
        jobId: job.id,
        to,
        messageType,
        retryCount,
      });
    } catch (error) {
      this.logger.error(`Message retry failed`, {
        jobId: job.id,
        to,
        messageType,
        retryCount,
        attempt: job.attemptsMade,
        error: error.message,
      });

      // Re-throw to trigger Bull's retry mechanism
      throw error;
    }
  }

  /**
   * Simulate message sending - will be replaced with actual WhatsApp service call
   */
  private async sendMessage(message: QueuedMessage): Promise<void> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Simulate occasional failures for testing retry logic
    if (Math.random() < 0.1) {
      // 10% failure rate for testing
      throw new Error("Simulated WhatsApp API failure");
    }

    this.logger.debug(`Message sent successfully`, {
      to: message.to,
      messageType: message.messageType,
    });
  }

  /**
   * Handle job completion
   */
  async onCompleted(job: Job<QueuedMessage>): Promise<void> {
    this.logger.log(`Message retry job completed`, {
      jobId: job.id,
      to: job.data.to,
      attempts: job.attemptsMade,
    });
  }

  /**
   * Handle job failure
   */
  async onFailed(job: Job<QueuedMessage>, error: Error): Promise<void> {
    this.logger.error(`Message retry job failed permanently`, {
      jobId: job.id,
      to: job.data.to,
      attempts: job.attemptsMade,
      error: error.message,
    });

    // TODO: Implement dead letter queue or notification system
    // for messages that failed permanently
  }
}
