import { Injectable, Inject, OnModuleInit, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.provider';
import { TelemetryUpdate } from './interfaces/telemetry.interface';
import { BatchPersistenceService } from './batch-persistence.service';
import { TelemetryGateway } from './telemetry.gateway';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AggregationService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AggregationService.name);
    private readonly GROUP_NAME = 'vatio-aggregator';
    private readonly CONSUMER_NAME = 'worker-1';
    private intervalRef: NodeJS.Timeout;

    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
        private readonly batchService: BatchPersistenceService,
        private readonly gateway: TelemetryGateway,
        private readonly prisma: PrismaService
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
            const failedIds: string[] = [];

            for (const message of messages) {
                const [id, fields] = message;
                try {
                    // fields[1] is the raw JSON string pushed from the controller
                    const payload = JSON.parse(fields[1]);

                    // Helper functions for Data Sanitization
                    const clampPos = (v: any) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
                    const clampAny = (v: any) => (typeof v === 'number' && isFinite(v) ? v : 0);
                    const toW = (kw: any) => clampAny(kw) * 1000;
                    
                    // Sanitize Active Power (Cannot exceed 150 kW per phase)
                    const MAX_W = 150_000;
                    const guard = (v: number) => Math.abs(v) > MAX_W ? 0 : v;

                    // Execute the precise 38-field mapping
                    const mappedMetrics: Record<string, number> = {
                        // Energy
                        impkwh: clampPos(payload.Import_kWh),
                        energyExport: clampAny(payload.Export_kWh),
                        energyNet: clampAny(payload.Net_kWh),
                        energyTotal: clampPos(payload.Total_kWh),
                        energyKVAh: clampPos(payload.Total_kVAh),
                        energyImpKVArh: clampPos(payload.Import_kVArh),
                        energyExpKVArh: clampAny(payload.Export_kVArh),

                        // Phase-to-Neutral Voltages
                        voltage: clampPos(payload.V_L1N),
                        voltage2: clampPos(payload.V_L2N),
                        voltage3: clampPos(payload.V_L3N),
                        vAvgLN: clampPos(payload.V_Avg_LN),

                        // Line-to-Line Voltages
                        vL12: clampPos(payload.V_L12),
                        vL23: clampPos(payload.V_L23),
                        vL31: clampPos(payload.V_L31),
                        vAvgLL: clampPos(payload.V_Avg_LL),

                        // Currents
                        current: clampAny(payload.I_L1),
                        current2: clampAny(payload.I_L2),
                        current3: clampAny(payload.I_L3),
                        iAvg: clampAny(payload.I_Avg),

                        // Active Power (Converted to Watts)
                        power: toW(payload.Total_kW),
                        power1: guard(toW(payload.kW_L1)),
                        power2: guard(toW(payload.kW_L2)),
                        power3: guard(toW(payload.kW_L3)),

                        // Apparent Power (Converted to VA)
                        kva: toW(payload.Total_kVA),
                        kva1: guard(toW(payload.kVA_L1)),
                        kva2: guard(toW(payload.kVA_L2)),
                        kva3: guard(toW(payload.kVA_L3)),

                        // Reactive Power (Converted to VAr)
                        kvar: toW(payload.Total_kVAr),
                        kvar1: guard(toW(payload.kVAr_L1)),
                        kvar2: guard(toW(payload.kVAr_L2)),
                        kvar3: guard(toW(payload.kVAr_L3)),

                        // Power Factor
                        pf1: clampAny(payload.PF_L1),
                        pf2: clampAny(payload.PF_L2),
                        pf3: clampAny(payload.PF_L3),
                        pfAvg: clampAny(payload.PF_Avg),

                        // Power Quality
                        frequency: clampPos(payload.Frequency) || 50.0,
                        vthdL1: clampAny(payload.VTHD_L1),
                        vthdL2: clampAny(payload.VTHD_L2),
                        vthdL3: clampAny(payload.VTHD_L3),
                        ithdL1: clampAny(payload.ITHD_L1),
                        ithdL2: clampAny(payload.ITHD_L2),
                        ithdL3: clampAny(payload.ITHD_L3),
                    };

                    for (const [key, value] of Object.entries(mappedMetrics)) {
                        if (!processedMetrics[key]) processedMetrics[key] = [];
                        processedMetrics[key].push(value);
                    }
                } catch (parseErr) {
                    failedIds.push(id);
                    this.logger.warn(
                        `Dead-letter: failed to process message ${id} for ${deviceId}: ${parseErr.message} | Raw: ${fields[1]}`,
                    );
                }
            }

            // ACK all messages (successful + failed) to prevent reprocessing loops
            const messageIds = messages.map(m => m[0]);
            if (messageIds.length > 0) {
                await this.redis.xack(fullKey, this.GROUP_NAME, ...messageIds);
                this.logger.debug(`XACK for ${messageIds.length} messages (${failedIds.length} dead-lettered)`);
            }

            // Only compute aggregation if at least one message parsed successfully
            const successCount = messages.length - failedIds.length;
            if (successCount === 0) {
                this.logger.warn(`All ${messages.length} messages dead-lettered for ${deviceId}, skipping aggregation`);
                return;
            }

            const update: TelemetryUpdate = {
                deviceId,
                timestamp: Date.now(),
                localTime: new Date(Date.now() - (new Date().getTimezoneOffset() * 60000)).toISOString().replace('T', ' ').substring(0, 19),
                metrics: { avg: {}, min: {}, max: {} }
            };

            for (const [key, values] of Object.entries(processedMetrics)) {
                update.metrics.avg[key] = values.reduce((a, b) => a + b, 0) / values.length;
                update.metrics.min[key] = values.reduce((a, b) => Math.min(a, b));
                update.metrics.max[key] = values.reduce((a, b) => Math.max(a, b));
            }

            // Energy meters are cumulative (kWh). For correct `MAX(energy)-MIN(energy)` deltas,
            // the persisted row should represent the latest/highest reading within the aggregation window,
            // not the window average.
            const persistedMetrics = {
                ...update.metrics.avg,
                impkwh: update.metrics.max.impkwh,
                localTime: update.localTime,
                energyExport: update.metrics.max.energyExport,
                energyNet: update.metrics.max.energyNet,
                energyTotal: update.metrics.max.energyTotal,
                energyKVAh: update.metrics.max.energyKVAh,
                energyImpKVArh: update.metrics.max.energyImpKVArh,
                energyExpKVArh: update.metrics.max.energyExpKVArh,
            };

            this.batchService.addToBatch(
                update.deviceId,
                new Date(update.timestamp),
                persistedMetrics
            );
            this.gateway.sendUpdate(deviceId, {
                deviceId,
                timestamp: update.timestamp,
                voltage: update.metrics.avg.voltage || 0,
                current: update.metrics.avg.current || 0,
                power: update.metrics.avg.power || 0,
                energy: update.metrics.max.impkwh || 0,
                frequency: update.metrics.avg.frequency || 50,
                powerFactor: update.metrics.avg.pfAvg || 0.98,
            });

            this.logger.log(`Aggregated ${successCount}/${messages.length} msgs for ${deviceId} (${failedIds.length} dead-lettered)`);
            
            // Update Device Status/LastSeen
            await this.prisma.device.update({
                where: { id: deviceId },
                data: { lastSeen: new Date(), status: 'online' }
            }).catch(e => this.logger.warn(`Failed to update lastSeen for ${deviceId}: ${e.message}`));

        } catch (err) {
            this.logger.error(`Aggregation error for ${deviceId}: ${err.message}`);
        }
    }
}