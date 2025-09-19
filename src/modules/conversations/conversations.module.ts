import { Module } from '@nestjs/common';
import { ConversationSessionService } from './services/conversation-session.service';
import { StateMachineService } from './services/state-machine.service';
import { InputParserService } from './services/input-parser.service';
import { ConversationFlowService } from './services/conversation-flow.service';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [RedisModule],
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