import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { TelemetryUpdate } from './interfaces/telemetry.interface';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AggregationService implements OnModuleInit {
    private readonly logger = new Logger(AggregationService.name);
    private readonly GROUP_NAME = 'vatio-aggregator';
    private readonly CONSUMER_NAME = 'worker-1';

    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
        private readonly prisma: PrismaService
    ) { }

    async onModuleInit() {
        // Tumbling window: flush every 5 seconds
        console.log('Aggregation Loop Started!');
        setInterval(() => this.processWindows(), 5000);
    }

    async processWindows() {
        const streamKeys = await this.redis.keys(`vatio:stream:device:*`);

        for (const fullKey of streamKeys) {
            const deviceId = fullKey.split(':').pop();
            if (deviceId) {
                await this.aggregateDeviceData(fullKey, deviceId);
            }
        }
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

                // Requirement: XACK called after processing 
                await this.redis.xack(fullKey, this.GROUP_NAME, id);
            }

            const update: TelemetryUpdate = {
                deviceId,
                timestamp: Date.now(),
                metrics: { avg: {}, min: {}, max: {} }
            };

            for (const [key, values] of Object.entries(processedMetrics)) {
                update.metrics.avg[key] = values.reduce((a, b) => a + b, 0) / values.length;
                update.metrics.min[key] = Math.min(...values);
                update.metrics.max[key] = Math.max(...values);
            }

            await this.prisma.telemetry.create({
                data: {
                    deviceId: update.deviceId,
                    timestamp: new Date(update.timestamp),
                    data: update.metrics // Prisma automatically handles the JSON conversion
                }
            });

            this.logger.log(`Aggregated & Saved ${messages.length} msgs for ${deviceId} to DB`);

        } catch (err) {
            this.logger.error(`Aggregation error for ${deviceId}: ${err.message}`);
        }
    }
}