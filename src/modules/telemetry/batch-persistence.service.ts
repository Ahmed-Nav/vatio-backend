import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface BatchRow {
    deviceId: string;
    timestamp: Date;
    data: any;
}

@Injectable()
export class BatchPersistenceService implements OnModuleDestroy {
    private readonly logger = new Logger(BatchPersistenceService.name);
    private buffer: BatchRow[] = [];
    private flushInterval: NodeJS.Timeout;

    private readonly MAX_BUFFER_SIZE = 500;
    private readonly FLUSH_INTERVAL_MS = 30_000; // 30 seconds

    constructor(private readonly prisma: PrismaService) {
        // Timer-based flush: every 30 seconds, flush whatever is in the buffer
        this.flushInterval = setInterval(() => this.flush('timer'), this.FLUSH_INTERVAL_MS);
    }

    /**
     * Add an aggregated telemetry row to the in-memory buffer.
     * Triggers an immediate flush if the buffer reaches MAX_BUFFER_SIZE.
     */
    addToBatch(deviceId: string, timestamp: Date, data: any): void {
        this.buffer.push({ deviceId, timestamp, data });

        if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
            this.flush('size').catch((err) =>
                this.logger.error(`Size-triggered flush failed: ${err.message}`),
            );
        }
    }

    /**
     * Flush all buffered rows to the database in a single multi-row INSERT.
     * Retries once on failure. If the retry also fails, discards the batch.
     */
    private async flush(trigger: 'timer' | 'size'): Promise<void> {
        if (this.buffer.length === 0) return;

        // Drain the buffer atomically
        const batch = this.buffer.splice(0);
        const count = batch.length;

        try {
            await this.prisma.telemetry.createMany({ data: batch });
            this.logger.log(`Batch flushed (${trigger}): ${count} rows persisted`);
        } catch (err) {
            this.logger.warn(`Batch insert failed (${count} rows), retrying once: ${err.message}`);

            // Retry once after a short delay
            try {
                await new Promise((r) => setTimeout(r, 1000));
                await this.prisma.telemetry.createMany({ data: batch });
                this.logger.log(`Batch retry succeeded: ${count} rows persisted`);
            } catch (retryErr) {
                this.logger.error(
                    `Batch retry failed — discarding ${count} rows. Error: ${retryErr.message}`,
                );
                this.logger.error(`Discarded batch sample: ${JSON.stringify(batch.slice(0, 3))}`);
            }
        }
    }

    async onModuleDestroy() {
        if (this.flushInterval) clearInterval(this.flushInterval);

        // Flush any remaining buffered rows on shutdown
        if (this.buffer.length > 0) {
            this.logger.log(`Shutdown: flushing ${this.buffer.length} remaining rows`);
            await this.flush('timer');
        }
    }
}
