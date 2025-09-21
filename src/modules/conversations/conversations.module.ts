import { Module } from "@nestjs/common";
import { ConversationSessionService } from "./services/conversation-session.service";
import { StateMachineService } from "./services/state-machine.service";
import { InputParserService } from "./services/input-parser.service";
import { ConversationFlowService } from "./services/conversation-flow.service";
import { ConversationService } from "./services/conversation.service";
import { OrderFlowService } from "./services/order-flow.service";
import { HybridSessionManager } from "./services/hybrid-session-manager.service";
import { MessageLoggingService } from "./services/message-logging.service";
import { ConversationSessionRepository } from "./repositories/conversation-session.repository";
import { MessageLogRepository } from "./repositories/message-log.repository";
import { RedisModule } from "../../common/redis/redis.module";
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [RedisModule, ProductsModule, OrdersModule, CustomersModule],
  controllers: [],
  providers: [
    ConversationSessionService,
    StateMachineService,
    InputParserService,
    ConversationFlowService,
    ConversationService,
    OrderFlowService,
    HybridSessionManager,
    MessageLoggingService,
    ConversationSessionRepository,
    MessageLogRepository,
  ],
  exports: [
    ConversationSessionService,
    StateMachineService,
    InputParserService,
    ConversationFlowService,
    ConversationService,
    OrderFlowService,
    HybridSessionManager,
    MessageLoggingService,
    ConversationSessionRepository,
    MessageLogRepository,
  ],
})
export class ConversationsModule {}
