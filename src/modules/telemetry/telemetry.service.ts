import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { Ctx, MessagePattern, Payload, MqttContext } from '@nestjs/microservices';
import Redis from 'ioredis';
import { TelemetryDto } from './dto/telemetry.dto';
import { PrismaService } from 'src/prisma/prisma.service';

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

        try {
            await this.redis.xadd(
                streamKey,
                'MAXLEN', '~', 100000,
                '*',
                'payload', JSON.stringify(data)
            );

            const deviceExists = await this.prisma.device.findUnique({ where: { id: deviceId } });

            if (!deviceExists) {
                this.logger.warn(`Telemetry ignored: Device ${deviceId} not registered in database.`);
                return;
            }

            await this.prisma.telemetry.create({
                data: {
                    deviceId: deviceId,
                    timestamp: new Date(),
                    data: data as any,
                },
            });
        } catch (error) {
            this.logger.error(`Failed to write to Redis: ${error.message}`);
        }
    }

    onModuleDestroy() {
        if (this.intervalRef) clearInterval(this.intervalRef);
    }
}