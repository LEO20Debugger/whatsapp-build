import { Injectable, Logger } from "@nestjs/common";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { DatabaseService } from "../../../database/database.service";
import { messageLogs } from "../../../database/schema/message-logs.schema";
import {
  MessageLog,
  CreateMessageLog,
  MessageMetrics,
  ProductPopularity,
  ConversionFunnel,
  MessageLogRepository as IMessageLogRepository,
} from "../../../database/types";

@Injectable()
export class MessageLogRepository implements IMessageLogRepository {
  private readonly logger = new Logger(MessageLogRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async logMessage(messageData: CreateMessageLog): Promise<MessageLog> {
    try {
      const [message] = await this.databaseService.db
        .insert(messageLogs)
        .values(messageData)
        .returning();

      this.logger.log(`Logged ${messageData.direction} message for phone: ${messageData.phoneNumber}`);
      return message;
    } catch (error) {
      this.logger.error(`Failed to log message: ${error.message}`);
      throw error;
    }
  }

  async getConversationHistory(phoneNumber: string, limit: number = 50): Promise<MessageLog[]> {
    try {
      const messages = await this.databaseService.db
        .select()
        .from(messageLogs)
        .where(eq(messageLogs.phoneNumber, phoneNumber))
        .orderBy(desc(messageLogs.createdAt))
        .limit(limit);

      this.logger.log(`Retrieved ${messages.length} messages for phone: ${phoneNumber}`);
      return messages;
    } catch (error) {
      this.logger.error(`Failed to get conversation history for ${phoneNumber}: ${error.message}`);
      throw error;
    }
  }

  async getMessagesByDateRange(startDate: Date, endDate: Date): Promise<MessageLog[]> {
    try {
      const messages = await this.databaseService.db
        .select()
        .from(messageLogs)
        .where(
          and(
            gte(messageLogs.createdAt, startDate),
            lte(messageLogs.createdAt, endDate)
          )
        )
        .orderBy(desc(messageLogs.createdAt));

      this.logger.log(`Found ${messages.length} messages in date range`);
      return messages;
    } catch (error) {
      this.logger.error(`Failed to get messages by date range: ${error.message}`);
      throw error;
    }
  }

  // Analytics queries - simplified implementations
  async getMessageMetrics(timeframe: 'day' | 'week' | 'month'): Promise<MessageMetrics> {
    try {
      // Calculate date range based on timeframe
      const now = new Date();
      const startDate = new Date();
      
      switch (timeframe) {
        case 'day':
          startDate.setDate(now.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - 1);
          break;
      }

      // Get all messages in timeframe
      const allMessages = await this.getMessagesByDateRange(startDate, now);

      // Calculate metrics
      const totalMessages = allMessages.length;
      const inboundMessages = allMessages.filter(msg => msg.direction === 'inbound').length;
      const outboundMessages = allMessages.filter(msg => msg.direction === 'outbound').length;
      const failedMessages = allMessages.filter(msg => msg.status === 'failed').length;

      // Calculate average response time (time between inbound and next outbound message)
      const responseTimeCalculations = [];
      for (let i = 0; i < allMessages.length - 1; i++) {
        const currentMsg = allMessages[i];
        const nextMsg = allMessages[i + 1];
        
        if (currentMsg.direction === 'inbound' && nextMsg.direction === 'outbound' && 
            currentMsg.phoneNumber === nextMsg.phoneNumber) {
          const responseTime = nextMsg.createdAt.getTime() - currentMsg.createdAt.getTime();
          responseTimeCalculations.push(responseTime);
        }
      }

      const averageResponseTime = responseTimeCalculations.length > 0
        ? responseTimeCalculations.reduce((sum, time) => sum + time, 0) / responseTimeCalculations.length / 1000 // Convert to seconds
        : 0;

      const errorRate = totalMessages > 0 ? (failedMessages / totalMessages) * 100 : 0;

      const metrics: MessageMetrics = {
        totalMessages,
        inboundMessages,
        outboundMessages,
        averageResponseTime,
        errorRate,
      };

      this.logger.log(`Generated message metrics for ${timeframe}: ${JSON.stringify(metrics)}`);
      return metrics;
    } catch (error) {
      this.logger.error(`Failed to get message metrics: ${error.message}`);
      throw error;
    }
  }

  async getPopularProducts(): Promise<ProductPopularity[]> {
    try {
      // This is a simplified implementation - in a real scenario, you'd need to parse message content
      // to extract product mentions, views, cart additions, etc.
      // For now, we'll return an empty array as this requires more complex message content analysis
      
      this.logger.log('Product popularity analysis requires message content parsing - returning empty results');
      return [];
    } catch (error) {
      this.logger.error(`Failed to get popular products: ${error.message}`);
      throw error;
    }
  }

  async getConversionFunnelData(): Promise<ConversionFunnel[]> {
    try {
      // This is a simplified implementation - conversion funnel analysis would require
      // correlation with conversation sessions and state transitions
      // For now, we'll return an empty array as this requires integration with session data
      
      this.logger.log('Conversion funnel analysis requires session correlation - returning empty results');
      return [];
    } catch (error) {
      this.logger.error(`Failed to get conversion funnel data: ${error.message}`);
      throw error;
    }
  }
}