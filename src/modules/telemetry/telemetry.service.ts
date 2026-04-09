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
            // 1. Map Raw Metrics to Schema Fields
            const mappedData = {
                voltage: data.V_L1N || (data.metrics?.voltage) || 0,
                voltage2: data.V_L2N || 0,
                voltage3: data.V_L3N || 0,
                vAvgLN: data.V_Avg_LN || 0,
                vL12: data.V_L12 || 0,
                vL23: data.V_L23 || 0,
                vL31: data.V_L31 || 0,
                vAvgLL: data.V_Avg_LL || 0,
                current: data.I_L1 || (data.metrics?.current) || 0,
                current2: data.I_L2 || 0,
                current3: data.I_L3 || 0,
                iAvg: data.I_Avg || 0,
                power: (data.Total_kW || (data.metrics?.power) || 0) * 1000, // Convert kW to W
                power1: (data.kW_L1 || 0) * 1000,
                power2: (data.kW_L2 || 0) * 1000,
                power3: (data.kW_L3 || 0) * 1000,
                kva: (data.Total_kVA || 0) * 1000,
                kva1: (data.kVA_L1 || 0) * 1000,
                kva2: (data.kVA_L2 || 0) * 1000,
                kva3: (data.kVA_L3 || 0) * 1000,
                kvar: (data.Total_kVAr || 0) * 1000,
                kvar1: (data.kVAr_L1 || 0) * 1000,
                kvar2: (data.kVAr_L2 || 0) * 1000,
                kvar3: (data.kVAr_L3 || 0) * 1000,
                pfAvg: data.PF_Avg || 0,
                pf1: data.PF_L1 || 0,
                pf2: data.PF_L2 || 0,
                pf3: data.PF_L3 || 0,
                frequency: data.Frequency || 50.0,
                impkwh: data.Import_kWh || 0,
                energyExport: data.Export_kWh || 0,
                energyKVAh: data.Total_kVAh || 0,
                energyImpKVArh: data.Import_kVArh || 0,
                energyExpKVArh: data.Export_kVArh || 0,
                vthdL1: data.VTHD_L1 || 0,
                vthdL2: data.VTHD_L2 || 0,
                vthdL3: data.VTHD_L3 || 0,
                ithdL1: data.ITHD_L1 || 0,
                ithdL2: data.ITHD_L2 || 0,
                ithdL3: data.ITHD_L3 || 0,
            };

            // 2. Buffer for Database Persistence (Async)
            await this.persistence.addToBatch(deviceId, new Date(), mappedData);

            // 3. Redis Buffering (Fast Cache)
            // Reduced MAXLEN to 1000 (~1.5 hours of history) for scalability
            await Promise.all([
                this.redis.xadd(
                    streamKey,
                    'MAXLEN', '~', 1000,
                    '*',
                    'payload', JSON.stringify(mappedData)
                ),
                this.redis.set(`vatio:latest:${deviceId}`, JSON.stringify(mappedData), 'EX', 86400)
            ]);

            // 4. Emit "Instant" update to UI
            this.gateway.sendUpdate(deviceId, {
                deviceId,
                timestamp: Date.now(),
                ...mappedData
            });
        } catch (error) {
            this.logger.error(`Failed to ingest telemetry for ${deviceId}: ${error.message}`);
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