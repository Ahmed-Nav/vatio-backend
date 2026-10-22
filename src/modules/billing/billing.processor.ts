import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { BillingService } from './billing.service';

export const BILLING_QUEUE = 'billing';

@Processor(BILLING_QUEUE)
export class BillingProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(
    @InjectQueue(BILLING_QUEUE) private readonly queue: Queue,
    private readonly billing: BillingService,
  ) {
    super();
  }

  async onModuleInit() {
    try {
      // A repeatable job with a fixed id is registered once however many times the app restarts.
      await this.queue.add('daily-sweep', {}, {
        jobId: 'daily-sweep',
        repeat: { pattern: '0 2 * * *' }, // 02:00 every night
        removeOnComplete: 30,
        removeOnFail: 30,
      });
    } catch (err) {
      this.logger.error(`Could not schedule the daily billing sweep: ${(err as Error).message}`);
    }
  }

  async process(job: Job) {
    if (job.name === 'daily-sweep') return this.billing.runDueSweep();
  }
}
