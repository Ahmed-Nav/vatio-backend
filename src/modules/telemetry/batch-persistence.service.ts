import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AggregationService } from './aggregation.service';

interface BatchRow {
    deviceId: string;
    timestamp: Date;
    data?: any;
    [key: string]: any; 
}

@Injectable()
export class BatchPersistenceService implements OnModuleDestroy {
    private readonly logger = new Logger(BatchPersistenceService.name);
    private buffer: BatchRow[] = [];
    private devicesToCreate: Set<string> = new Set();
    private flushInterval: NodeJS.Timeout;

    private readonly MAX_BUFFER_SIZE = 100;
    private readonly FLUSH_INTERVAL_MS = 10_000; // 10 seconds

    // Cache of device IDs known to exist in the database
    private knownDevices: Set<string> = new Set();

    constructor(
        private readonly prisma: PrismaService,
        private readonly aggregationService: AggregationService,
    ) {
        // Timer-based flush: every 30 seconds, flush whatever is in the buffer
        this.flushInterval = setInterval(() => this.flush('timer'), this.FLUSH_INTERVAL_MS);
    }

    /**
     * Add an aggregated telemetry row to the in-memory buffer.
     * Triggers an immediate flush if the buffer reaches MAX_BUFFER_SIZE.
     */
    async addToBatch(deviceId: string, timestamp: Date, data: any): Promise<void> {
        // Check local cache first to avoid DB hit
        if (!this.knownDevices.has(deviceId)) {
          const device = await this.prisma.device.findUnique({
              where: { id: deviceId },
              select: { id: true }
          });

          if (!device) {
              this.devicesToCreate.add(deviceId);
              this.logger.log(`📝 Marked device ${deviceId} for auto-registration`);
          } else {
              this.knownDevices.add(deviceId);
          }
        }

        const row = {
            deviceId,
            timestamp,
            // Direct Mapping from Aggregator Output (No manual renaming/null checks needed)
            ...data
        };
        this.buffer.push(row);

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
        const devicesToCreate = Array.from(this.devicesToCreate);
        this.devicesToCreate.clear();

        const count = batch.length;

        try {
            await this.prisma.$transaction(async (tx) => {
                // Create any missing devices first
                if (devicesToCreate.length > 0) {
                    const defaultOwnerId = '66fce60c-71bc-40b6-af92-71a243142a32'; // admin@vatio.in

                    const deviceCreates = devicesToCreate.map(deviceId => ({
                        id: deviceId,
                        name: `Auto-registered Device ${deviceId}`,
                        location: 'Auto-detected',
                        type: 'IoT Device',
                        status: 'active',
                        ownerId: defaultOwnerId,
                    }));

                    await tx.device.createMany({
                        data: deviceCreates,
                        skipDuplicates: true, // In case of race conditions
                    });

                    // Add to cache after creation
                    devicesToCreate.forEach(id => this.knownDevices.add(id));
                    this.logger.log(`🔧 Auto-registered ${devicesToCreate.length} new devices: ${devicesToCreate.join(', ')}`);
                }

                // Insert telemetry data
                await tx.telemetry.createMany({ data: batch as any });

                // Incremental Aggregation: Update summarized stats tables
                try {
                  await this.aggregationService.updateHourlyStats(batch, tx);
                } catch (aggError) {
                  this.logger.error(`Aggregation failed but telemetry saved: ${aggError.message}`);
                  // Don't fail the whole batch - telemetry is more important than aggregation
                }
            });

            this.logger.log(`Batch flushed (${trigger}): ${count} rows persisted + aggregated`);
        } catch (err) {
            this.logger.warn(`Batch insert failed (${count} rows), retrying once: ${err.message}`);

            // Retry once after a short delay
            try {
                await new Promise((r) => setTimeout(r, 1000));

                await this.prisma.$transaction(async (tx) => {
                    // Create any missing devices first (retry)
                    if (devicesToCreate.length > 0) {
                        const defaultOwnerId = '66fce60c-71bc-40b6-af92-71a243142a32'; // admin@vatio.in

                        const deviceCreates = devicesToCreate.map(deviceId => ({
                            id: deviceId,
                            name: `Auto-registered Device ${deviceId}`,
                            location: 'Auto-detected',
                            type: 'IoT Device',
                            status: 'active',
                            ownerId: defaultOwnerId,
                        }));

                        await tx.device.createMany({
                            data: deviceCreates,
                            skipDuplicates: true,
                        });

                        this.logger.log(`🔧 Auto-registered ${devicesToCreate.length} new devices (retry): ${devicesToCreate.join(', ')}`);
                    }

                    await tx.telemetry.createMany({ data: batch as any });
                    await this.aggregationService.updateHourlyStats(batch, tx);
                });

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
