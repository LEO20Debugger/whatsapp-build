import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { WhatsAppWebhookController } from "./controllers/whatsapp-webhook.controller";
import { WhatsAppMessageService } from "./services/whatsapp-message.service";
import { MessageProcessingService } from "./services/message-processing.service";
import { ConversationsModule } from "../conversations/conversations.module";

@Module({
  imports: [ConfigModule, ConversationsModule],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppMessageService, MessageProcessingService],
  exports: [WhatsAppMessageService, MessageProcessingService],
})
export class WhatsAppModule {}
