import { Module } from '@nestjs/common';
import { ConversationSessionService } from './services/conversation-session.service';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [RedisModule],
  controllers: [],
  providers: [ConversationSessionService],
  exports: [ConversationSessionService],
})
export class ConversationsModule {}