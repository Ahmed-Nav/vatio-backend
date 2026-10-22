import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetHistoryDto } from './dto/get-history.dto';
import { GetEnergyDto } from './dto/get-energy.dto';
import { GetSolarProfileDto } from './dto/get-solar-profile.dto';
import { EnergyCalculationService } from './energy-calculation.service';
import { assertDeviceEnabled } from '../access/access.service';

const BUCKET_INTERVAL_SQL: Record<string, string> = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
    '1h': '1 hour',
    '1d': '1 day',
    '1mo': '1 month',
};

const BUCKET_INTERVAL_MS: Record<string, number> = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '1d': 86_400_000,
    '1mo': 2_592_000_000,
};

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(
        private prisma: PrismaService,
        private readonly energyCalc: EnergyCalculationService,
    ) { }

    async getDeviceHistory(userId: string, dto: GetHistoryDto, role?: string) {
        const { deviceId, start, end, interval } = dto;

        // Verify the authenticated user owns this device (admins can see any device)
        const device = await this.prisma.device.findFirst({
            where: role === 'admin' ? { id: deviceId } : { id: deviceId, ownerId: userId },
        });
        if (!device) {
            throw new NotFoundException({
                code: 'DEVICE_NOT_FOUND',
                message: `Device with ID '${deviceId}' not found`,
            });
        }
        assertDeviceEnabled(device, role);

        const key = interval || '5m';
        const bucketSql = BUCKET_INTERVAL_SQL[key];

        try {
            // Aggregate per bucket server-side: average/min/max every numeric metric
            // key found in each row's `data.metrics` JSON, grouped by time_bucket.
            // Returning one row per RAW sample (as a naive SELECT would) floods the
            // frontend's time-series charts with thousands of near-duplicate-timestamp
            // points once telemetry is flowing at a few seconds/sample — this keeps the
            // response to one point per bucket, same as the live WebSocket path.
            const results = await this.prisma.$queryRawUnsafe(
                `WITH expanded AS (
                    SELECT
                        time_bucket($1::interval, t."timestamp") AS bucket,
                        kv.key AS metric_key,
                        (kv.value)::double precision AS metric_value
                    FROM "Telemetry" t,
                    LATERAL jsonb_each_text(t."data"->'metrics') AS kv(key, value)
                    WHERE t."deviceId" = $2
                      AND t."timestamp" >= $3::timestamp
                      AND t."timestamp" <= $4::timestamp
                      AND kv.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
                ),
                aggregated AS (
                    SELECT bucket, metric_key,
                        AVG(metric_value) AS avg_val,
                        MIN(metric_value) AS min_val,
                        MAX(metric_value) AS max_val
                    FROM expanded
                    GROUP BY bucket, metric_key
                )
                SELECT bucket,
                    jsonb_object_agg(metric_key, avg_val) AS avg,
                    jsonb_object_agg(metric_key, min_val) AS min,
                    jsonb_object_agg(metric_key, max_val) AS max
                FROM aggregated
                GROUP BY bucket
                ORDER BY bucket ASC`,
                bucketSql,
                deviceId,
                new Date(start),
                new Date(end),
            );
            return results;
        } catch (err) {
            // Fallback: plain Prisma query + in-process bucketing if TimescaleDB's
            // time_bucket() isn't available. Mirrors AggregationService's reduction.
            this.logger.warn(`time_bucket() query failed, falling back to in-process aggregation: ${err.message}`);
            const rows = await this.prisma.telemetry.findMany({
                where: {
                    deviceId,
                    timestamp: { gte: new Date(start), lte: new Date(end) },
                },
                orderBy: { timestamp: 'asc' },
                select: { timestamp: true, data: true },
            });

            const stepMs = BUCKET_INTERVAL_MS[key] || BUCKET_INTERVAL_MS['5m'];
            const buckets = new Map<number, Record<string, number[]>>();

            for (const row of rows) {
                const bucketTs = Math.floor(row.timestamp.getTime() / stepMs) * stepMs;
                const metrics = (row.data as any)?.metrics || {};
                let perKey = buckets.get(bucketTs);
                if (!perKey) { perKey = {}; buckets.set(bucketTs, perKey); }
                for (const [k, v] of Object.entries(metrics)) {
                    if (typeof v !== 'number') continue;
                    if (!perKey[k]) perKey[k] = [];
                    perKey[k].push(v);
                }
            }

            return Array.from(buckets.entries())
                .sort(([a], [b]) => a - b)
                .map(([bucketTs, perKey]) => {
                    const avg: Record<string, number> = {};
                    const min: Record<string, number> = {};
                    const max: Record<string, number> = {};
                    for (const [k, values] of Object.entries(perKey)) {
                        avg[k] = values.reduce((a, b) => a + b, 0) / values.length;
                        min[k] = Math.min(...values);
                        max[k] = Math.max(...values);
                    }
                    return { bucket: new Date(bucketTs).toISOString(), avg, min, max };
                });
        }
    }

    async getEnergyAnalysis(userId: string, dto: GetEnergyDto, role?: string) {
        const { deviceId, start, end, type } = dto;

        const device = await this.prisma.device.findFirst({
            where: role === 'admin' ? { id: deviceId } : { id: deviceId, ownerId: userId },
        });
        if (!device) {
            throw new NotFoundException({
                code: 'DEVICE_NOT_FOUND',
                message: `Device with ID '${deviceId}' not found`,
            });
        }
        assertDeviceEnabled(device, role);

        const bucketInterval = type === 'hourly' ? '1 hour' : type === 'monthly' ? '1 month' : '1 day';

        const flows = await this.energyCalc.bucketedGridFlow(deviceId, new Date(start), new Date(end), bucketInterval);
        return flows.map((f) => ({ ts: f.ts, value: f.gridImportKwh }));
    }

    /**
     * Grid import/export per bucket, from consecutive-reading deltas on the
     * meter's bidirectional cumulative counters (reset/rollover-safe — see
     * EnergyCalculationService). No register on the installed meter measures
     * solar generation directly, so `solarUsageAvailable` is always false
     * today: there is no reliable self-consumption figure to report, and per
     * Part 10 of the project plan this endpoint returns an explicit
     * "unavailable" signal rather than an invented number. Swap that to a real
     * reading once a generation-side meter/CT exists — the response shape
     * already has a place for it (`solarUsageAvailable`).
     */
    async getSolarProfile(userId: string, dto: GetSolarProfileDto, role?: string) {
        const { deviceId, start, end, type } = dto;

        const device = await this.prisma.device.findFirst({
            where: role === 'admin' ? { id: deviceId } : { id: deviceId, ownerId: userId },
        });
        if (!device) {
            throw new NotFoundException({
                code: 'DEVICE_NOT_FOUND',
                message: `Device with ID '${deviceId}' not found`,
            });
        }
        assertDeviceEnabled(device, role);

        const bucketInterval = type === 'monthly' ? '1 month' : type === 'daily' ? '1 day' : '1 hour';

        const flows = await this.energyCalc.bucketedGridFlow(deviceId, new Date(start), new Date(end), bucketInterval);
        return flows.map((f) => ({
            ts: f.ts,
            gridImportKwh: f.gridImportKwh,
            solarExportKwh: f.solarExportKwh,
            netGridEnergyKwh: Number((f.gridImportKwh - f.solarExportKwh).toFixed(3)),
            solarUsageAvailable: false,
        }));
    }
}
