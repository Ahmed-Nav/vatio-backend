import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, MqttContext } from '@nestjs/microservices';
import Redis from 'ioredis';
import { TelemetryDto } from './dto/telemetry.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeMetrics } from './metric-aliases';

@Injectable()
export class TelemetryService implements OnModuleDestroy { // Added cleanup
    private readonly logger = new Logger(TelemetryService.name);
    private ingestionCount = 0;
    private intervalRef: NodeJS.Timeout;

    constructor(
        @Inject('REDIS_CLIENT') private readonly redis: Redis,
        private readonly prisma: PrismaService
    ) {
        this.intervalRef = setInterval(() => {
            if (this.ingestionCount > 0) {
                this.logger.log(`Ingestion Rate: ${this.ingestionCount} msg/sec`);
                this.ingestionCount = 0;
            }
        }, 1000);
    }

    async ingestData(deviceId: string, data: TelemetryDto) {
        this.ingestionCount++;
        const streamKey = `vatio:stream:device:${deviceId}`;

        // Real hardware doesn't actually wrap its fields in a `metrics` key
        // the way TelemetryDto/Part 14's firmware fix assumed — it publishes
        // them flat at the top level (confirmed against live payloads on
        // test.enarxi.com). AggregationService already defensively handles
        // both shapes (`payload.metrics || payload`); mirror that here so
        // the raw row written to Postgres isn't left with an empty
        // `metrics: {}` next to the real fields sitting one level up.
        const { deviceId: _ignoredDeviceId, metrics: rawMetrics, ...rest } = (data as any) || {};
        const sourceMetrics = rawMetrics && typeof rawMetrics === 'object' ? rawMetrics : rest;
        const normalized: TelemetryDto = { deviceId, metrics: normalizeMetrics(sourceMetrics) };

        try {
            await this.redis.xadd(
                streamKey,
                'MAXLEN', '~', 100000,
                '*',
                'payload', JSON.stringify(normalized)
            );

            const deviceExists = await this.prisma.device.findUnique({ where: { id: deviceId } });

            if (!deviceExists) {
                this.logger.warn(`Telemetry ignored: Device ${deviceId} not registered in database.`);
                return;
            }

            if (!deviceExists.enabled) {
                // Switched off by an admin: drop the reading instead of storing/streaming it.
                return;
            }

            await this.prisma.telemetry.create({
                data: {
                    deviceId: deviceId,
                    timestamp: new Date(),
                    data: normalized as any,
                },
            });

            // Nothing else in the codebase ever wrote lastSeen/status, so the
            // frontend's online badge was permanently stuck on "Offline" /
            // "Never seen" regardless of how much real data was flowing in.
            await this.prisma.device.update({
                where: { id: deviceId },
                data: { lastSeen: new Date(), status: 'active' },
            });
        } catch (error) {
            this.logger.error(`Failed to write to Redis: ${error.message}`);
        }
    }

    onModuleDestroy() {
        if (this.intervalRef) clearInterval(this.intervalRef);
    }
}
