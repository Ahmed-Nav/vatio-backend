import { Injectable, Inject, Logger, Controller } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, MqttContext } from '@nestjs/microservices';
import Redis from 'ioredis';

@Controller()
@Injectable()
export class TelemetryService {
    private readonly logger = new Logger(TelemetryService.name);
    private ingestionCount = 0;

    constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {
        // Deliverable: Basic logging of ingestion rate (messages/sec) in a rolling window
        setInterval(() => {
            if (this.ingestionCount > 0) {
                this.logger.log(`Ingestion Rate: ${this.ingestionCount} msg/sec`);
                this.ingestionCount = 0; // Reset window
            }
        }, 1000);
    }

    // Deliverable: NestJS MQTT consumer subscribing to device topics 
    // We use a wildcard '+' to listen to ALL devices publishing to this pattern
    @MessagePattern('vatio/devices/+/telemetry')
    async handleTelemetry(@Payload() data: any, @Ctx() context: MqttContext) {
        this.ingestionCount++;

        // Fallback ID if the device doesn't send one in the payload
        const deviceId = data.deviceId || 'UNKNOWN_DEVICE';

        // Deliverable: Stream key naming convention
        const streamKey = `vatio:stream:device:${deviceId}`;

        try {
            // Deliverable: XADD command with MAXLEN ~ 100000 applied
            // Using '~' tells Redis to trim approximately, which is much faster than exact trimming
            await this.redis.xadd(
                streamKey,
                'MAXLEN', '~', 100000,
                '*', // '*' tells Redis to auto-generate the timestamp ID
                'payload', JSON.stringify(data)
            );
        } catch (error) {
            this.logger.error(`Failed to write to Redis Stream for ${deviceId}: ${error.message}`);
        }
    }
}