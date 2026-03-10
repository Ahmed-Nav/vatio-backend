import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GetHistoryDto } from './dto/get-history.dto';

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(private prisma: PrismaService) { }

    async getDeviceHistory(userId: string, dto: GetHistoryDto) {
        const { deviceId, start, end, interval } = dto;

        // Verify the authenticated user owns this device
        const device = await this.prisma.device.findFirst({
            where: { id: deviceId, ownerId: userId },
        });
        if (!device) {
            throw new NotFoundException({
                code: 'DEVICE_NOT_FOUND',
                message: `Device with ID '${deviceId}' not found`,
            });
        }
        const bucketMap: Record<string, string> = {
            '1m': '1 minute',
            '5m': '5 minutes',
            '1h': '1 hour',
        };
        const bucket = bucketMap[interval || '5m'];

        try {
            // Attempt TimescaleDB time_bucket query
            const results = await this.prisma.$queryRawUnsafe(
                `SELECT time_bucket($1::interval, "timestamp") AS bucket,
                        "deviceId",
                        "data"
                 FROM "Telemetry"
                 WHERE "deviceId" = $2
                   AND "timestamp" >= $3::timestamp
                   AND "timestamp" <= $4::timestamp
                 ORDER BY bucket ASC`,
                bucket,
                deviceId,
                new Date(start),
                new Date(end),
            );
            return results;
        } catch (err) {
            // Fallback: plain Prisma query if TimescaleDB is not enabled
            this.logger.warn(`time_bucket() query failed, falling back to standard query: ${err.message}`);
            return this.prisma.telemetry.findMany({
                where: {
                    deviceId,
                    timestamp: {
                        gte: new Date(start),
                        lte: new Date(end),
                    },
                },
                orderBy: { timestamp: 'asc' },
                select: {
                    timestamp: true,
                    data: true,
                },
            });
        }
    }
}