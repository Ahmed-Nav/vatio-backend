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
                    totalVoltage: data.vAvgLN,
                    current: data.current,
                    phase1Current: data.current, // Simplified for Redis live view
                    power: data.power,
                    phase1Power: data.power1,
                    powerFactor: data.pfAvg,
                    frequency: data.frequency,
                    energyKwh: data.impkwh,
                    pMin: data.power, pMax: data.power, // No bands in raw stream
                    vMin: data.voltage, vMax: data.voltage,
                    iMin: data.current, iMax: data.current
                };
            })
            .filter(d => d.ts >= start && d.ts <= end)
            .reverse();
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

        if (type === 'hourly') {
            const results = await this.prisma.hourlyDeviceStats.findMany({
                where: { deviceId, timestamp: { gte: start ? new Date(start) : undefined, lte: end ? new Date(end) : undefined } },
                orderBy: { timestamp: 'asc' }
            });
            return results.map(r => ({ ts: r.timestamp.getTime(), value: r.energyImport || 0 }));
        }

        // Default to Daily Summaries
        const results = await this.prisma.dailyDeviceStats.findMany({
            where: { deviceId, timestamp: { gte: start ? new Date(start) : undefined, lte: end ? new Date(end) : undefined } },
            orderBy: { timestamp: 'asc' }
        });
        return results.map(r => ({ ts: r.timestamp.getTime(), value: r.energyImport || 0 }));
    }

    /**
     * Solar Analysis: Uses Summary Tables for instant loading of 30-day profile.
     */
    async getSolarGridProfile(userId: string, deviceId: string) {
        // Security Check
        const device = await this.prisma.device.findFirst({
            where: { id: deviceId, ownerId: userId },
        });
        if (!device) throw new NotFoundException('Device not found');

        // Note: For a "perfect" 24h profile, we average the hourly summaries grouping by the hour of day.
        const results: any[] = await this.prisma.$queryRawUnsafe(`
            SELECT 
                EXTRACT(hour from timestamp AT TIME ZONE 'UTC')::int as hour,
                AVG("energyImport") as avg_consumption,
                AVG("energyExport") as avg_solar
            FROM "HourlyDeviceStats"
            WHERE "deviceId" = $1 
              AND "timestamp" >= date_trunc('day', NOW() - INTERVAL '30 days')
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