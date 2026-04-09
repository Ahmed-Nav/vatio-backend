import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cleanup task: Runs every day at 1 AM.
   * Deletes raw telemetry older than 14 days.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async pruneOldTelemetry() {
    this.logger.log('Starting raw telemetry pruning task...');
    
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    try {
      const deleted = await this.prisma.telemetry.deleteMany({
        where: {
          timestamp: {
            lt: fourteenDaysAgo
          }
        }
      });
      this.logger.log(`Pruning complete: Removed ${deleted.count} old telemetry records.`);
    } catch (err) {
      this.logger.error(`Pruning failed: ${err.message}`);
    }
  }
}
