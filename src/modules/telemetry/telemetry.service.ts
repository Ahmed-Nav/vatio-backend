import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, MqttContext } from '@nestjs/microservices';
import Redis from 'ioredis';
import { TelemetryDto } from './dto/telemetry.dto';

@Injectable()
export class TelemetryService implements OnModuleDestroy { // Added cleanup
    private readonly logger = new Logger(TelemetryService.name);
    private ingestionCount = 0;
    private intervalRef: NodeJS.Timeout;

    constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {
        this.intervalRef = setInterval(() => {
            if (this.ingestionCount > 0) {
                this.logger.log(`Ingestion Rate: ${this.ingestionCount} msg/sec`);
                this.ingestionCount = 0;
            }
        }, 1000);
    }

    async ingestData(data: TelemetryDto) {
        this.ingestionCount++;
        const deviceId = data.deviceId || 'UNKNOWN_DEVICE';
        const streamKey = `vatio:stream:device:${deviceId}`;

        try {
            await this.redis.xadd(
                streamKey,
                'MAXLEN', '~', 100000,
                '*',
                'payload', JSON.stringify(data)
            );
        } catch (error) {
            this.logger.error(`Failed to write to Redis: ${error.message}`);
        }
    }

    onModuleDestroy() {
        if (this.intervalRef) clearInterval(this.intervalRef);
    }
}