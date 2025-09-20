import { Injectable, Logger } from "@nestjs/common";
import { MessageLogRepository } from "../repositories/message-log.repository";
import { ConversationState } from "../types/conversation.types";
import { CustomersRepository } from "../../customers/customers.repository";

@Injectable()
export class MessageLoggingService {
  private readonly logger = new Logger(MessageLoggingService.name);

  constructor(
    private readonly messageLogRepository: MessageLogRepository,
    private readonly customersRepository: CustomersRepository,
  ) {}

  /**
   * Log an inbound message from customer
   */
  async logInboundMessage(
    phoneNumber: string,
    content: string,
    messageId: string,
    messageType: string = 'text',
    conversationState?: ConversationState,
    sessionContext?: Record<string, any>,
  ): Promise<void> {
    try {
      // Get customer ID for the phone number
      const customerId = await this.getCustomerIdByPhoneNumber(phoneNumber);

      const messageLog = {
        phoneNumber,
        customerId,
        direction: 'inbound' as const,
        content,
        messageType,
        whatsappMessageId: messageId,
        status: 'delivered' as const,
        isProcessed: false,
        conversationState,
        sessionContext,
      };

      await this.messageLogRepository.logMessage(messageLog);
      
      this.logger.debug(`Logged inbound message for ${phoneNumber}`, {
        messageId,
        messageType,
        conversationState,
        customerId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to log inbound message for ${phoneNumber}: ${error.message}`,
        { messageId, error: error.stack },
      );
    }
  }

  /**
   * Log an outbound message to customer
   */
  async logOutboundMessage(
    phoneNumber: string,
    content: string,
    messageId?: string,
    messageType: string = 'text',
    status: 'sent' | 'delivered' | 'read' | 'failed' = 'sent',
    conversationState?: ConversationState,
    sessionContext?: Record<string, any>,
    errorMessage?: string,
  ): Promise<void> {
    try {
      // Get customer ID for the phone number
      const customerId = await this.getCustomerIdByPhoneNumber(phoneNumber);

      const messageLog = {
        phoneNumber,
        customerId,
        direction: 'outbound' as const,
        content,
        messageType,
        whatsappMessageId: messageId,
        status,
        isProcessed: true,
        conversationState,
        sessionContext,
        errorMessage,
      };

      await this.messageLogRepository.logMessage(messageLog);
      
      this.logger.debug(`Logged outbound message for ${phoneNumber}`, {
        messageId,
        messageType,
        status,
        conversationState,
        customerId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to log outbound message for ${phoneNumber}: ${error.message}`,
        { messageId, error: error.stack },
      );
    }
  }

  /**
   * Update message processing status
   */
  async updateMessageProcessingStatus(
    phoneNumber: string,
    messageId: string,
    isProcessed: boolean,
    errorMessage?: string,
  ): Promise<void> {
    try {
      // For now, we'll just log this. In a more complete implementation,
      // we might want to add an update method to the repository
      this.logger.debug(`Message processing status updated for ${phoneNumber}`, {
        messageId,
        isProcessed,
        errorMessage,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update message processing status for ${phoneNumber}: ${error.message}`,
        { messageId, error: error.stack },
      );
    }
  }

  /**
   * Get conversation history for a phone number
   */
  async getConversationHistory(
    phoneNumber: string,
    limit: number = 50,
  ): Promise<any[]> {
    try {
      return await this.messageLogRepository.getConversationHistory(phoneNumber, limit);
    } catch (error) {
      this.logger.error(
        `Failed to get conversation history for ${phoneNumber}: ${error.message}`,
        { error: error.stack },
      );
      return [];
    }
  }

  /**
   * Get customer ID by phone number
   */
  private async getCustomerIdByPhoneNumber(phoneNumber: string): Promise<string | undefined> {
    try {
      const customer = await this.customersRepository.findByPhoneNumber(phoneNumber);
      return customer?.id;
    } catch (error) {
      this.logger.warn(
        `Failed to get customer ID for ${phoneNumber}: ${error.message}`,
        { error: error.stack },
      );
      return undefined;
    }
  }
}