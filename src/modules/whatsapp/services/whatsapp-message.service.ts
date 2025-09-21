import { Injectable, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  MessageContent,
  TemplateMessage,
  WhatsAppApiResponse,
} from "../interfaces/message.interface";
import * as twilio from "twilio";

@Injectable()
export class WhatsAppMessageService {
  private readonly logger = new Logger(WhatsAppMessageService.name);
  private twilioClient: twilio.Twilio;

  constructor(private readonly configService: ConfigService) {
    const accountSid = this.configService.get<string>("TWILIO_ACCOUNT_SID");
    const authToken = this.configService.get<string>("TWILIO_AUTH_TOKEN");

    if (!accountSid || !authToken) {
      throw new Error("Twilio credentials not configured");
    }

    this.twilioClient = twilio(accountSid, authToken);
  }

  async sendMessage(
    to: string,
    content: MessageContent,
  ): Promise<WhatsAppApiResponse> {
    try {
      this.validatePhoneNumber(to);
      this.validateMessageContent(content);

      // Extract message body from content
      let messageBody = "";
      if (content.type === "text" && content.text?.body) {
        messageBody = content.text.body;
      } else if (content.type === "template" && content.template) {
        // For templates, we'll use a simple text message for now
        messageBody = `Template: ${content.template.name}`;
      } else {
        messageBody = "Hello from your order bot!";
      }

      // Check if development mode is enabled
      const devMode = this.configService.get<string>("WHATSAPP_DEV_MODE") === "true";
      const nodeEnv = this.configService.get<string>("NODE_ENV");
      
      if (devMode || nodeEnv === "development") {
        // Development mode: Log message instead of sending
        this.logger.log(`🚀 DEV MODE - Would send message to ${to}:`);
        this.logger.log(`📱 Message: ${messageBody}`);
        this.logger.log(`📊 Content Type: ${content.type}`);
        
        // Return mock response for development
        return {
          messaging_product: "whatsapp",
          contacts: [{ input: to, wa_id: to }],
          messages: [{ id: `dev_${Date.now()}` }],
        };
      }

      const fromNumber = this.configService.get<string>(
        "TWILIO_WHATSAPP_NUMBER",
      );

      if (!fromNumber) {
        throw new HttpException(
          "Twilio WhatsApp number not configured",
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Format phone numbers for WhatsApp
      const toNumber = this.formatWhatsAppNumber(to);

      this.logger.log(`Sending ${content.type} message to ${to}`);

      const message = await this.twilioClient.messages.create({
        from: fromNumber,
        to: toNumber,
        body: messageBody,
      });

      this.logger.log(`Message sent successfully. Message ID: ${message.sid}`);

      // Return in WhatsApp API format for compatibility
      return {
        messaging_product: "whatsapp",
        contacts: [{ input: to, wa_id: to }],
        messages: [{ id: message.sid }],
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      // Check if it's a rate limit error and handle gracefully in dev mode
      if (error.code === 63038 || error.status === 429) {
        const devMode = this.configService.get<string>("WHATSAPP_DEV_MODE") === "true";
        const nodeEnv = this.configService.get<string>("NODE_ENV");
        
        if (devMode || nodeEnv === "development") {
          this.logger.warn(`⚠️ Rate limit hit - switching to dev mode for: ${to}`);
          this.logger.log(`📱 Would send: ${content.text?.body || "Message content"}`);
          
          // Return mock response when rate limited in dev
          return {
            messaging_product: "whatsapp",
            contacts: [{ input: to, wa_id: to }],
            messages: [{ id: `rate_limited_${Date.now()}` }],
          };
        }
      }
      
      this.handleApiError(error, to, content?.type || "unknown");
      throw error;
    }
  }

  async sendTextMessage(
    to: string,
    text: string,
    previewUrl?: boolean,
  ): Promise<WhatsAppApiResponse> {
    const textContent: any = {
      body: text,
    };

    if (previewUrl !== undefined) {
      textContent.preview_url = previewUrl;
    }

    const content: MessageContent = {
      type: "text",
      text: textContent,
    };

    return this.sendMessage(to, content);
  }

  async sendTemplate(
    to: string,
    template: TemplateMessage,
  ): Promise<WhatsAppApiResponse> {
    const content: MessageContent = {
      type: "template",
      template,
    };

    return this.sendMessage(to, content);
  }

  private validatePhoneNumber(phoneNumber: string): void {
    if (!phoneNumber || typeof phoneNumber !== "string") {
      throw new HttpException("Invalid phone number", HttpStatus.BAD_REQUEST);
    }

    // Remove any non-digit characters for validation
    const cleanNumber = phoneNumber.replace(/\D/g, "");

    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      throw new HttpException(
        "Phone number must be between 10 and 15 digits",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private validateMessageContent(content: MessageContent): void {
    if (!content || !content.type) {
      throw new HttpException(
        "Invalid message content",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (content.type === "text") {
      if (!content.text?.body || content.text.body.trim().length === 0) {
        throw new HttpException(
          "Text message body cannot be empty",
          HttpStatus.BAD_REQUEST,
        );
      }

      if (content.text.body.length > 1600) {
        // Twilio WhatsApp limit
        throw new HttpException(
          "Text message body exceeds maximum length of 1600 characters",
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (content.type === "template") {
      if (!content.template?.name || !content.template?.language?.code) {
        throw new HttpException(
          "Template message must have name and language",
          HttpStatus.BAD_REQUEST,
        );
      }
    }
  }

  private formatWhatsAppNumber(phoneNumber: string): string {
    // Clean phone number and format for WhatsApp
    let cleanPhoneNumber = phoneNumber.replace(/[^\d+]/g, "");

    if (!cleanPhoneNumber.startsWith("+")) {
      // Assume Nigerian number if no country code
      if (cleanPhoneNumber.startsWith("0")) {
        cleanPhoneNumber = "+234" + cleanPhoneNumber.substring(1);
      } else if (cleanPhoneNumber.startsWith("234")) {
        cleanPhoneNumber = "+" + cleanPhoneNumber;
      } else {
        // Default to Nigerian country code for numbers without country code
        cleanPhoneNumber = "+234" + cleanPhoneNumber;
      }
    }

    return `whatsapp:${cleanPhoneNumber}`;
  }

  private handleApiError(error: any, to: string, messageType: string): void {
    this.logger.error(`Twilio API error sending ${messageType} to ${to}:`, {
      message: error.message,
      code: error.code,
      status: error.status,
    });

    if (error.code === 21211) {
      throw new HttpException(
        "Invalid phone number format",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (error.code === 21614) {
      throw new HttpException(
        "Phone number not verified for WhatsApp sandbox",
        HttpStatus.BAD_REQUEST,
      );
    }

    if (error.status === 401) {
      throw new HttpException(
        "Twilio authentication failed",
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (error.status === 429) {
      throw new HttpException(
        "Twilio rate limit exceeded",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    throw new HttpException(
      "Twilio API request failed",
      HttpStatus.BAD_GATEWAY,
    );
  }
}
