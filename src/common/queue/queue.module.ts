import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { QueueService } from './services/queue.service';
import { MessageRetryProcessor } from './processors/message-retry.processor';
import { PaymentVerificationProcessor } from './processors/payment-verification.processor';
import { ReceiptGenerationProcessor } from './processors/receipt-generation.processor';
import { QueueHealthService } from './services/queue-health.service';
import { QUEUE_NAMES } from './constants/queue-names.constants';

@Module({
  imports: [
    BullModule.registerQueueAsync(
      {
        name: QUEUE_NAMES.MESSAGE_RETRY,
        useFactory: (configService: ConfigService) => ({
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: 10,
            removeOnFail: 5,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: QUEUE_NAMES.PAYMENT_VERIFICATION,
        useFactory: (configService: ConfigService) => ({
          defaultJobOptions: {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            removeOnComplete: 20,
            removeOnFail: 10,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: QUEUE_NAMES.RECEIPT_GENERATION,
        useFactory: (configService: ConfigService) => ({
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
            removeOnComplete: 50,
            removeOnFail: 10,
          },
        }),
        inject: [ConfigService],
      },
    ),
  ],
  providers: [
    QueueService,
    QueueHealthService,
    MessageRetryProcessor,
    PaymentVerificationProcessor,
    ReceiptGenerationProcessor,
  ],
  exports: [QueueService, QueueHealthService],
})
export class QueueModule {}