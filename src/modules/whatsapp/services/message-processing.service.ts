import { Injectable, Logger } from "@nestjs/common";
import { IncomingMessage } from "../interfaces/whatsapp.interface";
import { WhatsAppMessageService } from "./whatsapp-message.service";
import { ConversationService } from "../../conversations/services/conversation.service";
import { MessageLoggingService } from "../../conversations/services/message-logging.service";
import { BotResponse } from "../../conversations/types/conversation.types";
import {
  ParsedMessage,
  MessageType,
  ValidationResult,
  MessageProcessingContext,
  MessageProcessingResult,
  ProcessingStatus,
} from "../interfaces/message-processing.interface";

@Injectable()
export class MessageProcessingService {
  private readonly logger = new Logger(MessageProcessingService.name);

  constructor(
    private readonly whatsappMessageService: WhatsAppMessageService,
    private readonly conversationService: ConversationService,
    private readonly messageLoggingService: MessageLoggingService,
  ) {}

  /** Main entry point for processing incoming WhatsApp messages */
  async processMessage(
    message: IncomingMessage,
  ): Promise<MessageProcessingResult> {
    const startTime = Date.now();
    const processingContext: MessageProcessingContext = {
      messageId: message.id,
      phoneNumber: message.from,
      timestamp: message.timestamp || Date.now(),
      processingStartTime: startTime,
    };

    try {
      this.logger.log(`Processing message ${message.id} from ${message.from}`);

      // Validate message structure first
      const structureValidation = this.validateMessageStructure(message);
      if (!structureValidation.isValid) {
        this.logger.warn(
          `Invalid message structure for ${message.id}: ${structureValidation.errors.join(", ")}`,
        );
        await this.sendErrorResponse(
          message.from,
          this.getStructureErrorMessage(structureValidation.errors),
        );
        return this.createProcessingResult(
          processingContext,
          false,
          "STRUCTURE_VALIDATION_FAILED",
          structureValidation.errors,
        );
      }

      // Parse and validate the incoming message content
      const parsedMessage = this.parseIncomingMessage(message);
      if (!parsedMessage) {
        this.logger.warn(`Failed to parse message ${message.id}`);
        await this.sendErrorResponse(
          message.from,
          "Sorry, I couldn't understand your message. Please try again.",
        );
        return this.createProcessingResult(
          processingContext,
          false,
          "PARSING_FAILED",
        );
      }

      // Log inbound message
      await this.logInboundMessage(parsedMessage);

      // Validate parsed content
      const contentValidation = this.validateMessageContent(
        parsedMessage.content,
      );
      if (!contentValidation.isValid) {
        this.logger.warn(
          `Invalid message content for ${message.id}: ${contentValidation.errors.join(", ")}`,
        );
        await this.sendErrorResponse(
          message.from,
          this.getContentErrorMessage(contentValidation.errors),
        );
        return this.createProcessingResult(
          processingContext,
          false,
          "CONTENT_VALIDATION_FAILED",
          contentValidation.errors,
        );
      }

      // Route message to conversation flow
      const response = await this.routeToConversationFlow(
        parsedMessage,
        processingContext,
      );

      // Send response back to user
      await this.sendResponse(message.from, response, processingContext);

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `Successfully processed message ${message.id} in ${processingTime}ms`,
      );

      return this.createProcessingResult(
        processingContext,
        true,
        "SUCCESS",
        [],
        processingTime,
      );
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Error processing message ${message.id} after ${processingTime}ms:`,
        error,
      );
      await this.handleProcessingError(message.from, error, processingContext);
      return this.createProcessingResult(
        processingContext,
        false,
        "PROCESSING_ERROR",
        [error.message],
        processingTime,
      );
    }
  }

  /** Parse incoming WhatsApp message into standardized format */
  private parseIncomingMessage(message: IncomingMessage): ParsedMessage | null {
    try {
      // Validate required fields
      if (!message.from || !message.id) {
        this.logger.warn("Message missing required fields (from, id)");
        return null;
      }

      // Handle different message types
      let content: string;
      let messageType: MessageType;

      if (message.text?.body) {
        content = message.text.body.trim();
        messageType = MessageType.TEXT;
      } else if (message.type) {
        // Handle other message types (image, document, etc.)
        content = `[${message.type.toUpperCase()}]`;
        messageType = this.mapWhatsAppTypeToMessageType(message.type);
      } else {
        this.logger.warn(`Unknown message type for message ${message.id}`);
        return null;
      }

      // Validate content
      if (!content || content.length === 0) {
        this.logger.warn(`Empty message content for message ${message.id}`);
        return null;
      }

      // Check for message length limits
      if (content.length > 4096) {
        this.logger.warn(
          `Message too long (${content.length} chars) for message ${message.id}`,
        );
        content = content.substring(0, 4093) + "...";
      }

      return {
        id: message.id,
        from: message.from,
        content,
        type: messageType,
        timestamp: message.timestamp || Date.now(),
        originalMessage: message,
      };
    } catch (error) {
      this.logger.error(`Error parsing message ${message.id}:`, error);
      return null;
    }
  }

  /** Route parsed message to conversation flow service */
  private async routeToConversationFlow(
    parsedMessage: ParsedMessage,
    processingContext: MessageProcessingContext,
  ): Promise<BotResponse> {
    try {
      // Handle non-text messages
      if (parsedMessage.type !== MessageType.TEXT) {
        return this.handleNonTextMessage(parsedMessage);
      }

      // Process text message through conversation service
      const conversationResult = await this.conversationService.processConversation(
        parsedMessage.from,
        parsedMessage.content,
        {
          phoneNumber: parsedMessage.from,
          messageId: parsedMessage.id,
          timestamp: parsedMessage.timestamp,
        },
      );

      return conversationResult.response;
    } catch (error) {
      this.logger.error(`Error routing message to conversation flow:`, error);

      return {
        message:
          "Sorry, I encountered an error processing your request. Please try again.",
      };
    }
  }

  /** Handle non-text messages (images, documents, etc.) */
  private handleNonTextMessage(parsedMessage: ParsedMessage): BotResponse {
    switch (parsedMessage.type) {
      case MessageType.IMAGE:
        return {
          message:
            "I received your image, but I can only process text messages right now. Please type what you'd like to order.",
        };

      case MessageType.DOCUMENT:
        return {
          message:
            "I received your document, but I can only process text messages right now. Please type what you'd like to order.",
        };

      case MessageType.AUDIO:
        return {
          message:
            "I received your voice message, but I can only process text messages right now. Please type what you'd like to order.",
        };

      default:
        return {
          message:
            "I can only process text messages right now. Please type what you'd like to order.",
        };
    }
  }

  /** Send response back to user via WhatsApp */
  private async sendResponse(
    phoneNumber: string,
    response: BotResponse,
    processingContext?: MessageProcessingContext,
  ): Promise<void> {
    try {
      if (!response.message) {
        this.logger.warn(`Empty response message for ${phoneNumber}`);
        return;
      }

      const apiResponse = await this.whatsappMessageService.sendMessage(phoneNumber, {
        type: "text",
        text: {
          body: response.message,
        },
      });

      // Log outbound message
      await this.logOutboundMessage(
        phoneNumber,
        response.message,
        apiResponse?.messages?.[0]?.id,
        'text',
        'sent',
        processingContext,
      );

      this.logger.log(`Sent response to ${phoneNumber}`);
    } catch (error) {
      this.logger.error(`Error sending response to ${phoneNumber}:`, error);
      
      // Log failed outbound message
      await this.logOutboundMessage(
        phoneNumber,
        response.message,
        undefined,
        'text',
        'failed',
        processingContext,
        error.message,
      );
    }
  }

  /** Send error response to user */
  private async sendErrorResponse(
    phoneNumber: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      const apiResponse = await this.whatsappMessageService.sendMessage(phoneNumber, {
        type: "text",
        text: {
          body: errorMessage,
        },
      });

      // Log error response
      await this.logOutboundMessage(
        phoneNumber,
        errorMessage,
        apiResponse?.messages?.[0]?.id,
        'text',
        'sent',
      );
    } catch (error) {
      this.logger.error(
        `Error sending error response to ${phoneNumber}:`,
        error,
      );
      
      // Log failed error response
      await this.logOutboundMessage(
        phoneNumber,
        errorMessage,
        undefined,
        'text',
        'failed',
        undefined,
        error.message,
      );
    }
  }

  /** Handle processing errors with appropriate user feedback */
  private async handleProcessingError(
    phoneNumber: string,
    error: any,
    processingContext?: MessageProcessingContext,
  ): Promise<void> {
    let errorMessage =
      'Sorry, I encountered an error. Please try again or type "help" for assistance.';

    this.logger.error("Processing error occurred:", {
      phoneNumber,
      error: error.message,
      processingContext,
    });

    await this.sendErrorResponse(phoneNumber, errorMessage);
  }

  /** Map WhatsApp message types to internal message types */
  private mapWhatsAppTypeToMessageType(whatsappType: string): MessageType {
    switch (whatsappType.toLowerCase()) {
      case "text":
        return MessageType.TEXT;
      case "image":
        return MessageType.IMAGE;
      case "document":
        return MessageType.DOCUMENT;
      case "audio":
        return MessageType.AUDIO;
      case "video":
        return MessageType.VIDEO;
      default:
        return MessageType.UNKNOWN;
    }
  }

  /** Validate message structure before processing */
  private validateMessageStructure(message: IncomingMessage): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
    };

    // Check required fields
    if (!message.id) {
      result.isValid = false;
      result.errors.push("Message ID is missing");
    }

    if (!message.from) {
      result.isValid = false;
      result.errors.push("Sender phone number is missing");
    }

    return result;
  }

  /** Validate message content for security and format */
  private validateMessageContent(content: string): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
    };

    // Check for empty content
    if (!content || content.trim().length === 0) {
      result.isValid = false;
      result.errors.push("Message content is empty");
      return result;
    }

    // Check length limits
    if (content.length > 4096) {
      result.isValid = false;
      result.errors.push("Message too long");
    }

    return result;
  }

  /** Get user-friendly error message for structure validation errors */
  private getStructureErrorMessage(errors: string[]): string {
    return "There was an issue with your message. Please try sending it again.";
  }

  /** Get user-friendly error message for content validation errors */
  private getContentErrorMessage(errors: string[]): string {
    if (errors.includes("Message content is empty")) {
      return "Your message appears to be empty. Please send a message with some text.";
    }
    if (errors.includes("Message too long")) {
      return "Your message is too long. Please break it into smaller messages.";
    }
    return "There was an issue with your message content. Please try rephrasing and sending again.";
  }

  /** Create processing result for tracking and debugging */
  private createProcessingResult(
    context: MessageProcessingContext,
    success: boolean,
    status: ProcessingStatus,
    errors: string[] = [],
    processingTime?: number,
  ): MessageProcessingResult {
    return {
      messageId: context.messageId,
      phoneNumber: context.phoneNumber,
      success,
      status,
      errors,
      processingTime:
        processingTime || Date.now() - context.processingStartTime,
      timestamp: context.timestamp,
    };
  }

  /** Log inbound message from customer */
  private async logInboundMessage(parsedMessage: ParsedMessage): Promise<void> {
    try {
      // Get current session to capture conversation state
      const session = await this.conversationService.getConversationSession(parsedMessage.from);
      
      await this.messageLoggingService.logInboundMessage(
        parsedMessage.from,
        parsedMessage.content,
        parsedMessage.id,
        parsedMessage.type.toLowerCase(),
        session?.currentState,
        session?.context,
      );
    } catch (error) {
      this.logger.error(`Failed to log inbound message: ${error.message}`);
    }
  }

  /** Log outbound message to customer */
  private async logOutboundMessage(
    phoneNumber: string,
    content: string,
    messageId?: string,
    messageType: string = 'text',
    status: 'sent' | 'delivered' | 'read' | 'failed' = 'sent',
    processingContext?: MessageProcessingContext,
    errorMessage?: string,
  ): Promise<void> {
    try {
      // Get current session to capture conversation state
      const session = await this.conversationService.getConversationSession(phoneNumber);
      
      await this.messageLoggingService.logOutboundMessage(
        phoneNumber,
        content,
        messageId,
        messageType,
        status,
        session?.currentState,
        session?.context,
        errorMessage,
      );
    } catch (error) {
      this.logger.error(`Failed to log outbound message: ${error.message}`);
    }
  }
}
