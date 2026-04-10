import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetHistoryDto } from './dto/get-history.dto';
import Redis from 'ioredis';

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(
        private prisma: PrismaService,
        @Inject('REDIS_CLIENT') private readonly redis: Redis,
    ) { }

    /**
     * Hybrid Time-Series History
     * Combines high-speed Redis data (last 15m) with summarized DB data (historical).
     */
    async getDeviceHistory(userId: string, dto: GetHistoryDto) {
        const { deviceId, start, end, interval } = dto;

        // 1. Security Check
        const device = await this.prisma.device.findFirst({
            where: { id: deviceId, ownerId: userId },
        });
        if (!device) {
            throw new NotFoundException(`Device '${deviceId}' not found or access denied.`);
        }

        const startTime = new Date(start).getTime();
        const endTime = new Date(end).getTime();
        const now = Date.now();

        // 2. Decide Strategy
        // If range is within the last 15 minutes, pull from Redis for 0ms latency.
        const isLiveRequest = (now - startTime) < (15 * 60 * 1000);
        
        if (isLiveRequest) {
            return this.fetchFromRedis(deviceId, startTime, endTime);
        }

        // 3. Fetch from Hourly Summaries (High Performance)
        return this.fetchFromSummaries(deviceId, start, end);
    }

    private async fetchFromRedis(deviceId: string, start: number, end: number) {
        const streamKey = `vatio:stream:device:${deviceId}`;
        // Fetch last 1000 items from Redis Stream
        const entries = await this.redis.xrevrange(streamKey, '+', '-', 'COUNT', 1000);
        
        return entries
            .map(([id, fields]) => {
                const data = JSON.parse(fields[1]);
                return {
                    ts: parseInt(id.split('-')[0]),
                    phase1Voltage: data.voltage,
                    phase2Voltage: data.voltage2,
                    phase3Voltage: data.voltage3,
                    totalVoltage: data.vAvgLN || data.voltage,
                    v12: data.vL12 || 0,
                    v23: data.vL23 || 0,
                    v31: data.vL31 || 0,
                    current: data.current,
                    phase1Current: data.current,
                    phase2Current: data.current2 || 0,
                    phase3Current: data.current3 || 0,
                    power: data.power,
                    phase1Power: data.power1,
                    phase2Power: data.power2 || 0,
                    phase3Power: data.power3 || 0,
                    powerFactor: data.pfAvg || 1,
                    phase1PF: data.pf1 || 1,
                    phase2PF: data.pf2 || 1,
                    phase3PF: data.pf3 || 1,
                    pfMin: data.pfAvg || 1, pfMax: data.pfAvg || 1,
                    frequency: data.frequency,
                    energyKwh: data.impkwh,
                    solarKwh: data.energyExport || 0,
                    pMin: data.power, pMax: data.power,
                    vMin: data.voltage, vMax: data.voltage,
                    iMin: data.current, iMax: data.current,
                    vthd1: data.vthdL1 || 0,
                    vthd2: data.vthdL2 || 0,
                    vthd3: data.vthdL3 || 0,
                    vthd1Max: data.vthdL1 || 0,
                    vthd2Max: data.vthdL2 || 0,
                    vthd3Max: data.vthdL3 || 0,
                };
            })
            .filter(d => d.ts >= start && d.ts <= end)
            .reverse();
    }

    async getTelemetryHistory(deviceId: string, start: string, end: string, interval: string) {
        // Validate interval to prevent SQL injection (though $queryRaw is better, we use date_trunc)
        const validIntervals = ['1s', '5s', '1m', '5m', '15m', '30m', '1h', '1d'];
        const pgInterval = validIntervals.includes(interval) ? interval : '5m';

        // We use raw SQL with date_trunc to get accurate high-resolution averages
        // This fixes the missing THD and Phase-specific PF fields in HourlyDeviceStats
        const results: any[] = await this.prisma.$queryRawUnsafe(`
            SELECT 
                date_trunc('minute', "timestamp") + (EXTRACT(minute FROM "timestamp")::int / 1) * interval '1 minute' as bucket, -- Dynamic bucket placeholder
                AVG("vAvgLN") as "avgVoltage",
                AVG("iAvg") as "avgCurrent",
                AVG("power") as "avgPower",
                AVG("pfAvg") as "avgPF",
                AVG("frequency") as "avgFreq",
                AVG("voltage") as "avgV1",
                AVG("voltage2") as "avgV2",
                AVG("voltage3") as "avgV3",
                AVG("current") as "avgI1",
                AVG("current2") as "avgI2",
                AVG("current3") as "avgI3",
                AVG("power1") as "avgP1",
                AVG("power2") as "avgP2",
                AVG("power3") as "avgP3",
                AVG("pf1") as "avgPF1",
                AVG("pf2") as "avgPF2",
                AVG("pf3") as "avgPF3",
                AVG("vthdL1") as "avgVthd1",
                AVG("vthdL2") as "avgVthd2",
                AVG("vthdL3") as "avgVthd3",
                MIN("power") as "minPower", MAX("power") as "maxPower",
                MIN("iAvg") as "minCurrent", MAX("iAvg") as "maxCurrent",
                MIN("vAvgLN") as "minVoltage", MAX("vAvgLN") as "maxVoltage",
                MAX("vthdL1") as "vthd1Max", MAX("vthdL2") as "vthd2Max", MAX("vthdL3") as "vthd3Max"
            FROM "Telemetry"
            WHERE "deviceId" = $1 AND "timestamp" >= $2::timestamp AND "timestamp" <= $3::timestamp
            GROUP BY 1
            ORDER BY 1 ASC
        `, deviceId, new Date(start), new Date(end));

        return results.map(row => ({
            ts: new Date(row.bucket).getTime(),
            phase1Voltage: Number(row.avgV1) || 0,
            phase2Voltage: Number(row.avgV2) || 0,
            phase3Voltage: Number(row.avgV3) || 0,
            totalVoltage: Number(row.avgVoltage) || 0,
            
            phase1Current: Number(row.avgI1) || 0,
            phase2Current: Number(row.avgI2) || 0,
            phase3Current: Number(row.avgI3) || 0,
            current: Number(row.avgCurrent) || 0,
            iAvg: Number(row.avgCurrent) || 0,

            phase1Power: Number(row.avgP1) || 0,
            phase2Power: Number(row.avgP2) || 0,
            phase3Power: Number(row.avgP3) || 0,
            power: Number(row.avgPower) || 0,

            powerFactor: Number(row.avgPF) || 0,
            phase1PF: Number(row.avgPF1) || 0,
            phase2PF: Number(row.avgPF2) || 0,
            phase3PF: Number(row.avgPF3) || 0,

            frequency: Number(row.avgFreq) || 0,
            
            vthd1: Number(row.avgVthd1) || 0,
            vthd2: Number(row.avgVthd2) || 0,
            vthd3: Number(row.avgVthd3) || 0,
            vthd1Max: Number(row.vthd1Max) || 0,
            vthd2Max: Number(row.vthd2Max) || 0,
            vthd3Max: Number(row.vthd3Max) || 0,

            pMin: Number(row.minPower) || 0, pMax: Number(row.maxPower) || 0,
            iMin: Number(row.minCurrent) || 0, iMax: Number(row.maxCurrent) || 0,
            vMin: Number(row.minVoltage) || 0, vMax: Number(row.maxVoltage) || 0,
        }));
    }

    private async fetchFromSummaries(deviceId: string, start: string, end: string) {
        const results = await this.prisma.hourlyDeviceStats.findMany({
            where: {
                deviceId,
                timestamp: {
                    gte: new Date(start),
                    lte: new Date(end)
                }
            },
            orderBy: { timestamp: 'asc' }
        });

        return results.map(row => ({
            ts: row.timestamp.getTime(),
            phase1Voltage: row.avgV1,
            phase2Voltage: row.avgV2,
            phase3Voltage: row.avgV3,
            totalVoltage: row.avgVoltage,
            v12: 0, v23: 0, v31: 0, vAvgLL: 0, // Simplified for summaries

            phase1Current: row.avgI1,
            phase2Current: row.avgI2,
            phase3Current: row.avgI3,
            current: row.avgCurrent,
            iAvg: row.avgCurrent,

            phase1Power: row.avgP1,
            phase2Power: row.avgP2,
            phase3Power: row.avgP3,
            power: row.avgPower,

            powerFactor: row.avgPF,
            frequency: row.avgFreq,
            energyKwh: row.energyImport,
            
            pMin: row.minPower, pMax: row.maxPower,
            iMin: row.minCurrent, iMax: row.maxCurrent,
            vMin: row.minVoltage, vMax: row.maxVoltage,
        }));
    }

    /**
     * Optimized Energy Analysis
     * Queries DailyDeviceStats instead of raw Telemetry.
     */
    async getEnergyAnalysis(userId: string, deviceId: string, type: 'hourly' | 'daily' | 'monthly', start?: string, end?: string) {
        // Security Check
        const device = await this.prisma.device.findFirst({
            where: { id: deviceId, ownerId: userId },
        });
        if (!device) throw new NotFoundException('Device not found');

        const startDate = start ? new Date(start) : new Date(0);
        const endDate = end ? new Date(end) : new Date();

        if (type === 'hourly') {
            const results: any[] = await this.prisma.$queryRawUnsafe(`
                SELECT 
                    date_trunc('hour', "timestamp") as ts,
                    MAX("impkwh") - MIN("impkwh") as value,
                    MAX("energyExport") - MIN("energyExport") as solar
                FROM "Telemetry"
                WHERE "deviceId" = $1 AND "timestamp" >= $2::timestamp AND "timestamp" <= $3::timestamp
                GROUP BY 1
                ORDER BY 1 ASC
            `, deviceId, startDate, endDate);
            
            return results.map(r => ({ ts: new Date(r.ts).getTime(), value: Number(r.value) || 0, solar: Number(r.solar) || 0 }));
        }

        // Daily
        const results: any[] = await this.prisma.$queryRawUnsafe(`
            SELECT 
                date_trunc('day', "timestamp") as ts,
                MAX("impkwh") - MIN("impkwh") as value,
                MAX("energyExport") - MIN("energyExport") as solar
            FROM "Telemetry"
            WHERE "deviceId" = $1 AND "timestamp" >= $2::timestamp AND "timestamp" <= $3::timestamp
            GROUP BY 1
            ORDER BY 1 ASC
        `, deviceId, startDate, endDate);
        
        return results.map(r => ({ ts: new Date(r.ts).getTime(), value: Number(r.value) || 0, solar: Number(r.solar) || 0 }));
    }

    /**
     * Solar Analysis: Tracks the true load profile using exact interval deltas.
     */
    async getSolarGridProfile(userId: string, deviceId: string) {
        // Security Check
        const device = await this.prisma.device.findFirst({
            where: { id: deviceId, ownerId: userId },
        });
        if (!device) throw new NotFoundException('Device not found');

        const results: any[] = await this.prisma.$queryRawUnsafe(`
            WITH HourlyDeltas AS (
                SELECT 
                    date_trunc('hour', "timestamp") as block,
                    EXTRACT(hour from "timestamp" AT TIME ZONE 'UTC')::int as hour_of_day,
                    MAX("impkwh") - MIN("impkwh") as block_consumption,
                    MAX("energyExport") - MIN("energyExport") as block_solar
                FROM "Telemetry"
                WHERE "deviceId" = $1 
                  AND "timestamp" >= date_trunc('day', NOW() - INTERVAL '30 days')
                GROUP BY 1, 2
            )
            SELECT 
                hour_of_day as hour,
                AVG(block_consumption) as avg_consumption,
                AVG(block_solar) as avg_solar
            FROM HourlyDeltas
            GROUP BY 1
            ORDER BY 1 ASC
        `, deviceId);

        return results.map(r => ({
            hour: r.hour,
            consumption: Number(r.avg_consumption) || 0,
            solar: Number(r.avg_solar) || 0
        }));
    }
}