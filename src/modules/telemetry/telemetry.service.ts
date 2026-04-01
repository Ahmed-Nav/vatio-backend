import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { TelemetryDto } from './dto/telemetry.dto';
import { TelemetryGateway } from './telemetry.gateway';
import { BatchPersistenceService } from './batch-persistence.service';

@Injectable()
export class TelemetryService implements OnModuleDestroy { // Added cleanup
    private readonly logger = new Logger(TelemetryService.name);
    private ingestionCount = 0;
    private intervalRef: NodeJS.Timeout;

    constructor(
        @Inject('REDIS_CLIENT') private readonly redis: Redis,
        private readonly gateway: TelemetryGateway,
        private readonly persistence: BatchPersistenceService
    ) {
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
            // 1 & 2. Run Redis operations in parallel to save network round-trips (90ms vs 180ms)
            await Promise.all([
                this.redis.xadd(
                    streamKey,
                    'MAXLEN', '~', 100000,
                    '*',
                    'payload', JSON.stringify(data)
                ),
                this.redis.set(`vatio:latest:${deviceId}`, JSON.stringify(data), 'EX', 86400)
            ]);

            // 3. Emit "Instant" update to UI
            const metrics = data.metrics || {};
            this.gateway.sendUpdate(deviceId, {
                deviceId,
                timestamp: Date.now(),
                voltage: data.V_L1N || 0,
                current: data.I_L1 || 0,
                power: (data.Total_kW || 0) * 1000,
                energy: data.Import_kWh || 0,
                frequency: data.Frequency || 50.0,
                powerFactor: data.PF_Avg || 0.98,
            });


        } catch (error) {
            this.logger.error(`Failed to write to Redis: ${error.message}`);
        }
    }

    async getLatest(deviceId: string) {
        const cached = await this.redis.get(`vatio:latest:${deviceId}`);
        if (!cached) return null;
        try {
            const data = JSON.parse(cached);
            const metrics = data.metrics || {};
            // Flatten/Format for frontend
            return {
                ...data,
                voltage: metrics.voltage || metrics.phase1Voltage || 0,
                current: metrics.current || metrics.phase1Current || 0,
                power: metrics.power || 0,
                energy: metrics.energy || metrics.energyKwh || 0,
                timestamp: data.timestamp || new Date().toISOString()
            };
        } catch (e) {
            return null;
        }
    }

    onModuleDestroy() {
        if (this.intervalRef) clearInterval(this.intervalRef);
    }
}