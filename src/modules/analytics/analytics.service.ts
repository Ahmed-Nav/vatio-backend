import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetHistoryDto } from './dto/get-history.dto';

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(private prisma: PrismaService) { }

    /**
     * General Time-Series History
     * Returns AVG, MIN, MAX for all key electrical parameters over a bucketed interval.
     */
    async getDeviceHistory(userId: string, dto: GetHistoryDto) {
        const { deviceId, start, end, interval } = dto;

        const device = await this.prisma.device.findFirst({
            where: { id: deviceId, ownerId: userId },
        });
        if (!device) {
            throw new NotFoundException(`Device '${deviceId}' not found or access denied.`);
        }

        const bucketMap: Record<string, string> = {
            '1m': '1 minute',
            '5m': '5 minutes',
            '1h': '1 hour',
            '1d': '1 day',
            '1mo': '1 month',
        };
        const bucket = bucketMap[interval || '5m'] || '5 minutes';

        try {
            // Using direct columns (V, I, P, PF, THD, Freq) with Avg/Min/Max for charting bands
            const results: any[] = await this.prisma.$queryRawUnsafe(
                `SELECT 
                    date_trunc('${bucket.split(' ')[1]}', "timestamp" AT TIME ZONE 'UTC') as "ts",
                    -- Voltages
                    AVG(voltage) as "v1_avg", MIN(voltage) as "v1_min", MAX(voltage) as "v1_max",
                    AVG(voltage2) as "v2_avg", MIN(voltage2) as "v2_min", MAX(voltage2) as "v2_max",
                    AVG(voltage3) as "v3_avg", MIN(voltage3) as "v3_min", MAX(voltage3) as "v3_max",
                    AVG("vAvgLN") as "vln_avg",
                    AVG("vL12") as "v12_avg", AVG("vL23") as "v23_avg", AVG("vL31") as "v31_avg", AVG("vAvgLL") as "vll_avg",
                    
                    -- Currents
                    AVG(current) as "i1_avg", MIN(current) as "i1_min", MAX(current) as "i1_max",
                    AVG(current2) as "i2_avg", MIN(current2) as "i2_min", MAX(current2) as "i2_max",
                    AVG(current3) as "i3_avg", MIN(current3) as "i3_min", MAX(current3) as "i3_max",
                    AVG("iAvg") as "i_avg_total",

                    -- Power (Active)
                    AVG(power) as "p_avg", MIN(power) as "p_min", MAX(power) as "p_max",
                    AVG(power1) as "p1_avg", AVG(power2) as "p2_avg", AVG(power3) as "p3_avg",

                    -- Power Quality
                    AVG("pfAvg") as "pf_avg", MIN("pfAvg") as "pf_min", MAX("pfAvg") as "pf_max",
                    AVG(frequency) as "f_avg", MIN(frequency) as "f_min", MAX(frequency) as "f_max",
                    MAX(impkwh) as "e_max",
                    AVG("vthdL1") as "vthd1_avg", MIN("vthdL1") as "vthd1_min", MAX("vthdL1") as "vthd1_max",
                    AVG("vthdL2") as "vthd2_avg", MIN("vthdL2") as "vthd2_min", MAX("vthdL2") as "vthd2_max",
                    AVG("vthdL3") as "vthd3_avg", MIN("vthdL3") as "vthd3_min", MAX("vthdL3") as "vthd3_max",
                    AVG("ithdL1") as "ithd1_avg", MIN("ithdL1") as "ithd1_min", MAX("ithdL1") as "ithd1_max",
                    AVG("ithdL2") as "ithd2_avg", MIN("ithdL2") as "ithd2_min", MAX("ithdL2") as "ithd2_max",
                    AVG("ithdL3") as "ithd3_avg", MIN("ithdL3") as "ithd3_min", MAX("ithdL3") as "ithd3_max"

                 FROM "Telemetry"
                 WHERE "deviceId" = $1 
                   AND "timestamp" >= $2::timestamp 
                   AND "timestamp" <= $3::timestamp
                 GROUP BY 1
                 ORDER BY "ts" ASC`,
                deviceId,
                new Date(start),
                new Date(end),
            );

            return results.map(row => ({
                ts: new Date(row.ts).getTime(),
                // Voltage Profile - Flattened for Frontend
                phase1Voltage: row.v1_avg,
                phase2Voltage: row.v2_avg,
                phase3Voltage: row.v3_avg,
                totalVoltage: row.vln_avg,
                v12: row.v12_avg, v23: row.v23_avg, v31: row.v31_avg, vAvgLL: row.vll_avg,

                // Current Profile
                phase1Current: row.i1_avg,
                phase2Current: row.i2_avg,
                phase3Current: row.i3_avg,
                current: row.i_avg_total,
                iAvg: row.i_avg_total,

                // Load Analysis
                phase1Power: row.p1_avg,
                phase2Power: row.p2_avg,
                phase3Power: row.p3_avg,
                power: row.p_avg,

                // Power Quality
                powerFactor: row.pf_avg,
                pfMin: row.pf_min, pfMax: row.pf_max,
                frequency: row.f_avg,
                fMin: row.f_min, fMax: row.f_max,
                energyKwh: row.e_max,
                
                // Advanced Profiles (Min/Avg/Max)
                pMin: row.p_min, pMax: row.p_max,
                iMin: row.i1_min, iMax: row.i1_max,
                vMin: row.v1_min, vMax: row.v1_max,
                
                // Harmonics
                vthd1: row.vthd1_avg, vthd1Min: row.vthd1_min, vthd1Max: row.vthd1_max,
                vthd2: row.vthd2_avg, vthd2Min: row.vthd2_min, vthd2Max: row.vthd2_max,
                vthd3: row.vthd3_avg, vthd3Min: row.vthd3_min, vthd3Max: row.vthd3_max,
                ithd1: row.ithd1_avg, ithd1Min: row.ithd1_min, ithd1Max: row.ithd1_max,
                ithd2: row.ithd2_avg, ithd2Min: row.ithd2_min, ithd2Max: row.ithd2_max,
                ithd3: row.ithd3_avg, ithd3Min: row.ithd3_min, ithd3Max: row.ithd3_max
            }));
        } catch (err) {
            this.logger.error(`Aggregation query failed: ${err.message}`);
            throw err;
        }
    }

    /**
     * Energy Analysis (Hourly/Daily Deltas)
     * Calculates Consumption = MAX(energy) - MIN(energy) per bucket.
     */
    async getEnergyAnalysis(userId: string, deviceId: string, type: 'hourly' | 'daily' | 'monthly', start?: string, end?: string) {
        const bucket = type === 'hourly' ? 'hour' : type === 'monthly' ? 'month' : 'day';
        
        let whereClause = `WHERE "deviceId" = $1`;
        const queryParams: any[] = [deviceId];

        if (start && end) {
            whereClause += ` AND "timestamp" >= $2::timestamp AND "timestamp" <= $3::timestamp`;
            queryParams.push(new Date(start), new Date(end));
        } else {
            const range = type === 'hourly' ? '1 day' : type === 'monthly' ? '1 year' : '30 days';
            const trunc = type === 'monthly' ? 'month' : 'day';
            whereClause += ` AND "timestamp" >= date_trunc('${trunc}', NOW() - INTERVAL '${range}')`;
        }

        const sql = `
            SELECT 
                date_trunc('${bucket}', "timestamp" AT TIME ZONE 'UTC') as ts,
                MAX(impkwh) - MIN(impkwh) as consumption
            FROM "Telemetry"
            ${whereClause}
            GROUP BY 1
            ORDER BY 1 ASC
        `;

        const results: any[] = await this.prisma.$queryRawUnsafe(sql, ...queryParams);
        return results.map(r => ({
            ts: new Date(r.ts).getTime(),
            value: r.consumption || 0
        }));
    }

    /**
     * Solar Analysis: 24-Hour Average Consumption Profile
     * Averages hourly deltas over the last 30 days into 24 bins.
     */
    async getSolarGridProfile(userId: string, deviceId: string) {
        const sql = `
            WITH hourly_deltas AS (
                SELECT 
                    date_trunc('hour', "timestamp" AT TIME ZONE 'UTC') as bucket_ts,
                    EXTRACT(hour from "timestamp" AT TIME ZONE 'UTC') as hour_of_day,
                    MAX(impkwh) - MIN(impkwh) as consumption,
                    MAX("energyExport") - MIN("energyExport") as solar
                FROM "Telemetry"
                WHERE "deviceId" = $1 
                  AND "timestamp" >= date_trunc('day', NOW() - INTERVAL '30 days')
                GROUP BY 1, 2
            )
            SELECT 
                hour_of_day::int as hour,
                AVG(consumption) as avg_consumption,
                AVG(solar) as avg_solar
            FROM hourly_deltas
            GROUP BY 1
            ORDER BY 1 ASC
        `;

        const results: any[] = await this.prisma.$queryRawUnsafe(sql, deviceId);
        return results.map(r => ({
            hour: r.hour,
            consumption: Number(r.avg_consumption) || 0,
            solar: Number(r.avg_solar) || 0
        }));
    }
}