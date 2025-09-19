import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpStatus,
  HttpException,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WebhookVerificationDto } from "../dto/webhook-verification.dto";
import { IncomingMessage } from "../interfaces/whatsapp.interface";
import { MessageProcessingService } from "../services/message-processing.service";

@Controller("webhook/whatsapp")
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly messageProcessingService: MessageProcessingService,
  ) {}

  @Get()
  verifyWebhook(@Query() query: WebhookVerificationDto): string {
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    const verifyToken = this.configService.get<string>(
      "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    );

    if (!verifyToken) {
      this.logger.error("WHATSAPP_WEBHOOK_VERIFY_TOKEN not configured");
      throw new HttpException(
        "Webhook verification token not configured",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (mode === "subscribe" && token === verifyToken) {
      this.logger.log("Webhook verified successfully");
      return challenge;
    }

    this.logger.warn(
      `Webhook verification failed. Mode: ${mode}, Token match: ${token === verifyToken}`,
    );
    throw new UnauthorizedException("Webhook verification failed");
  }

  @Post()
  async handleIncomingMessage(
    @Body() payload: any,
  ): Promise<{ status: string }> {
    try {
      this.logger.log(
        "Received WhatsApp webhook payload",
        JSON.stringify(payload),
      );

      // Handle Twilio messages (text or media)
      if (payload.From && (payload.Body || (payload.NumMedia && parseInt(payload.NumMedia) > 0))) {
        const type =
          payload.NumMedia && parseInt(payload.NumMedia) > 0
            ? payload.MediaContentType0.split("/")[0] // image, audio, video, etc.
            : "text";

        const twilioMessage: IncomingMessage = {
          id: payload.MessageSid || `twilio_${Date.now()}`,
          from: payload.From.replace("whatsapp:", ""),
          text: { body: payload.Body || "" },
          type,
          mediaUrls: [],
          timestamp: Math.floor(Date.now() / 1000),
        };

        if (payload.NumMedia && parseInt(payload.NumMedia) > 0) {
          for (let i = 0; i < parseInt(payload.NumMedia); i++) {
            twilioMessage.mediaUrls.push(payload[`MediaUrl${i}`]);
          }
        }

        await this.processIncomingMessage(twilioMessage);
        return { status: "success" };
      }

      // Handle Meta WhatsApp API format
      if (!payload.object || payload.object !== "whatsapp_business_account") {
        throw new BadRequestException("Invalid webhook object type");
      }

      if (!payload.entry || !Array.isArray(payload.entry)) {
        throw new BadRequestException("Invalid webhook entry structure");
      }

      for (const entry of payload.entry) {
        if (!entry.changes || !Array.isArray(entry.changes)) {
          this.logger.warn(`Invalid changes structure in entry ${entry.id}`);
          continue;
        }

        for (const change of entry.changes) {
          if (change.field !== "messages") {
            this.logger.debug(`Skipping non-message change: ${change.field}`);
            continue;
          }

          const { value } = change;

          if (!value.messages || !Array.isArray(value.messages)) {
            this.logger.debug("No messages found in change value");
            continue;
          }

          for (const message of value.messages) {
            await this.processIncomingMessage(message);
          }
        }
      }

      return { status: "success" };
    } catch (error) {
      this.logger.error("Error processing WhatsApp webhook:", error);

      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      throw new HttpException(
        "Internal server error processing webhook",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async processIncomingMessage(
    message: IncomingMessage,
  ): Promise<void> {
    try {
      this.logger.log(`Processing message ${message.id} from ${message.from}`);

      if (!message.from || !message.id) {
        this.logger.warn(
          `Invalid message structure: ${JSON.stringify(message)}`,
        );
        return;
      }

      const result = await this.messageProcessingService.processMessage(message);

      if (result.success) {
        this.logger.log(
          `Message ${message.id} processed successfully in ${result.processingTime}ms`,
        );
      } else {
        this.logger.warn(
          `Message ${message.id} processing failed: ${result.status}`,
          {
            errors: result.errors,
            processingTime: result.processingTime,
          },
        );
      }
    } catch (error) {
      this.logger.error(`Error processing message ${message.id}:`, error);
    }
  }
}
