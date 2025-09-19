import { Module } from "@nestjs/common";
import { ConversationSessionService } from "./services/conversation-session.service";
import { StateMachineService } from "./services/state-machine.service";
import { InputParserService } from "./services/input-parser.service";
import { ConversationFlowService } from "./services/conversation-flow.service";
import { RedisModule } from "../../common/redis/redis.module";
import { ProductsModule } from 'src/modules/products/products.module';

@Module({
  imports: [RedisModule, ProductsModule],
  controllers: [],
  providers: [
    ConversationSessionService,
    StateMachineService,
    InputParserService,
    ConversationFlowService,
  ],
  exports: [
    ConversationSessionService,
    StateMachineService,
    InputParserService,
    ConversationFlowService,
  ],
})
export class ConversationsModule {}
