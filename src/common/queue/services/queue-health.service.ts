import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_NAMES } from '../constants/queue-names.constants';

export interface QueueHealthStatus {
  name: string;
  isHealthy: boolean;
  error?: string;
  details: {
    isActive: boolean;
    isPaused: boolean;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

export interface OverallQueueHealth {
  isHealthy: boolean;
  queues: QueueHealthStatus[];
  summary: {
    totalQueues: number;
    healthyQueues: number;
    unhealthyQueues: number;
  };
}

@Injectable()
export class QueueHealthService {
  private readonly logger = new Logger(QueueHealthService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.MESSAGE_RETRY)
    private messageRetryQueue: Queue,
    
    @InjectQueue(QUEUE_NAMES.PAYMENT_VERIFICATION)
    private paymentVerificationQueue: Queue,
    
    @InjectQueue(QUEUE_NAMES.RECEIPT_GENERATION)
    private receiptGenerationQueue: Queue,
  ) {}

  /**
   * Check health of all queues
   */
  async checkQueueHealth(): Promise<OverallQueueHealth> {
    const queues = [
      { name: 'message-retry', queue: this.messageRetryQueue },
      { name: 'payment-verification', queue: this.paymentVerificationQueue },
      { name: 'receipt-generation', queue: this.receiptGenerationQueue },
    ];

    const queueHealthStatuses = await Promise.all(
      queues.map(({ name, queue }) => this.checkSingleQueueHealth(name, queue))
    );

    const healthyQueues = queueHealthStatuses.filter(status => status.isHealthy).length;
    const unhealthyQueues = queueHealthStatuses.length - healthyQueues;

    return {
      isHealthy: unhealthyQueues === 0,
      queues: queueHealthStatuses,
      summary: {
        totalQueues: queueHealthStatuses.length,
        healthyQueues,
        unhealthyQueues,
      },
    };
  }

  /**
   * Check health of a single queue
   */
  private async checkSingleQueueHealth(name: string, queue: Queue): Promise<QueueHealthStatus> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed(),
      ]);

      const isPaused = await queue.isPaused();
      
      // Consider queue unhealthy if:
      // 1. It has too many failed jobs (more than 50)
      // 2. It has jobs stuck in active state for too long (more than 100)
      // 3. It's paused unexpectedly
      const tooManyFailedJobs = failed.length > 50;
      const tooManyActiveJobs = active.length > 100;
      
      const isHealthy = !tooManyFailedJobs && !tooManyActiveJobs;
      
      let error: string | undefined;
      if (tooManyFailedJobs) {
        error = `Too many failed jobs: ${failed.length}`;
      } else if (tooManyActiveJobs) {
        error = `Too many active jobs: ${active.length}`;
      } else if (isPaused) {
        error = 'Queue is paused';
      }

      return {
        name,
        isHealthy,
        error,
        details: {
          isActive: !isPaused,
          isPaused,
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to check health for queue ${name}: ${error.message}`);
      
      return {
        name,
        isHealthy: false,
        error: `Health check failed: ${error.message}`,
        details: {
          isActive: false,
          isPaused: true,
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
        },
      };
    }
  }

  /**
   * Get detailed queue metrics
   */
  async getQueueMetrics() {
    try {
      const health = await this.checkQueueHealth();
      
      return {
        timestamp: new Date().toISOString(),
        overall: {
          isHealthy: health.isHealthy,
          totalQueues: health.summary.totalQueues,
          healthyQueues: health.summary.healthyQueues,
          unhealthyQueues: health.summary.unhealthyQueues,
        },
        queues: health.queues.map(queue => ({
          name: queue.name,
          isHealthy: queue.isHealthy,
          error: queue.error,
          metrics: queue.details,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get queue metrics: ${error.message}`);
      throw error;
    }
  }

  /**
   * Monitor queue performance and log warnings
   */
  async monitorQueues(): Promise<void> {
    try {
      const health = await this.checkQueueHealth();
      
      for (const queueStatus of health.queues) {
        if (!queueStatus.isHealthy) {
          this.logger.warn(`Queue ${queueStatus.name} is unhealthy: ${queueStatus.error}`, {
            queue: queueStatus.name,
            details: queueStatus.details,
          });
        }

        // Log warnings for concerning metrics
        const { details } = queueStatus;
        
        if (details.failed > 10) {
          this.logger.warn(`Queue ${queueStatus.name} has ${details.failed} failed jobs`);
        }
        
        if (details.waiting > 100) {
          this.logger.warn(`Queue ${queueStatus.name} has ${details.waiting} waiting jobs`);
        }
        
        if (details.active > 50) {
          this.logger.warn(`Queue ${queueStatus.name} has ${details.active} active jobs`);
        }
      }
    } catch (error) {
      this.logger.error(`Queue monitoring failed: ${error.message}`);
    }
  }
}