import { Injectable, Inject, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { TelemetryUpdate } from './interfaces/telemetry.interface';
import { PrismaService } from 'src/prisma/prisma.service';
import { TelemetryGateway } from './telemetry.gateway';

@Injectable()
export class AggregationService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AggregationService.name);
    private readonly GROUP_NAME = 'vatio-aggregator';
    private readonly CONSUMER_NAME = 'worker-1';
    private intervalRef: NodeJS.Timeout;

    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
        private readonly prisma: PrismaService,
        private readonly gateway: TelemetryGateway
    ) { }

    async onModuleInit() {
        // Tumbling window: flush every 5 seconds
        this.logger.log('Aggregation Loop Started!');
        this.intervalRef = setInterval(() => this.processWindows(), 5000);
    }

    onModuleDestroy() {
        if (this.intervalRef) {
            clearInterval(this.intervalRef);
            this.logger.log('Aggregation interval cleared safely.');
        }
    }

    async processWindows() {
        let cursor = '0';
        do {
            const [nextCursor, keys] = await this.redis.scan(
                cursor,
                'MATCH', 'vatio:stream:device:*',
                'COUNT', 100
            );
            cursor = nextCursor;

            for (const fullKey of keys) {
                const deviceId = fullKey.split(':').pop();
                if (deviceId) await this.aggregateDeviceData(fullKey, deviceId);
            }
        } while (cursor !== '0');
    }

    private async aggregateDeviceData(fullKey: string, deviceId: string) {
        try {
            // Requirement: Ensure Consumer Group exists 
            await this.redis.xgroup('CREATE', fullKey, this.GROUP_NAME, '0', 'MKSTREAM').catch(() => { });

            const data = await this.redis.xreadgroup(
                'GROUP', this.GROUP_NAME, this.CONSUMER_NAME,
                'COUNT', 1000, 'STREAMS', fullKey, '>'
            ) as any[];

            if (!data || data.length === 0) return;

            const messages = data[0][1];
            const processedMetrics: Record<string, number[]> = {};

            for (const message of messages) {
                const [id, fields] = message;
                // fields[0] is 'payload', fields[1] is the JSON string
                const payload = JSON.parse(fields[1]);
                const metrics = payload.metrics;

                for (const [key, value] of Object.entries(metrics)) {
                    if (!processedMetrics[key]) processedMetrics[key] = [];
                    processedMetrics[key].push(value as number);
                }
            }

            const update: TelemetryUpdate = {
                deviceId,
                timestamp: Date.now(),
                metrics: { avg: {}, min: {}, max: {} }
            };

            for (const [key, values] of Object.entries(processedMetrics)) {
                update.metrics.avg[key] = values.reduce((a, b) => a + b, 0) / values.length;
                update.metrics.min[key] = values.reduce((a, b) => Math.min(a, b));
                update.metrics.max[key] = values.reduce((a, b) => Math.max(a, b));
            }

            const messageIds = messages.map(m => m[0]);
            if (messageIds.length > 0) {
                await this.redis.xack(fullKey, this.GROUP_NAME, ...messageIds);
                this.logger.debug(`Batched XACK for ${messageIds.length} messages`);
            }

            await this.prisma.telemetry.create({
                data: {
                    deviceId: update.deviceId,
                    timestamp: new Date(update.timestamp),
                    data: update.metrics // Prisma automatically handles the JSON conversion
                }
            });
            this.gateway.sendUpdate(deviceId, update);

            this.logger.log(`Aggregated & Saved ${messages.length} msgs for ${deviceId} to DB`);

        } catch (err) {
            this.logger.error(`Aggregation error for ${deviceId}: ${err.message}`);
        }
    }
}