import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { assertDeviceEnabled } from '../access/access.service';

@Controller('telemetry')
export class TelemetryLatestController {
  constructor(private readonly prisma: PrismaService) {}

  /** Latest raw reading for a device the caller owns (admins: any device). */
  @Get(':deviceId/latest')
  async getLatest(@Req() req, @Param('deviceId') deviceId: string) {
    const device = await this.prisma.device.findFirst({
      where:
        req.user.role === 'admin'
          ? { id: deviceId }
          : { id: deviceId, ownerId: req.user.userId },
      select: { id: true, enabled: true },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'DEVICE_NOT_FOUND',
        message: `Device with ID '${deviceId}' not found`,
        timestamp: new Date().toISOString(),
      });
    }

    assertDeviceEnabled(device, req.user.role);

    // Aggregated rows ({avg,min,max}) have no `metrics` key; only raw rows do.
    const recent = await this.prisma.telemetry.findMany({
      where: { deviceId },
      orderBy: { timestamp: 'desc' },
      take: 20,
      select: { timestamp: true, data: true },
    });
    const row = recent.find((r) => (r.data as any)?.metrics);
    if (!row) {
      throw new NotFoundException({
        code: 'TELEMETRY_NOT_FOUND',
        message: `No telemetry recorded yet for device '${deviceId}'`,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      deviceId,
      ts: row.timestamp.getTime(),
      metrics: (row.data as any)?.metrics ?? {},
    };
  }
}
