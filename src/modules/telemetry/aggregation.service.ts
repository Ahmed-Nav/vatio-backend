import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Process a batch of telemetry and update HourlyDeviceStats incrementally.
   */
  async updateHourlyStats(batch: any[], tx?: any) {
    const prisma = tx || this.prisma;
    if (!batch.length) return;

    // Group batch by deviceId and hour
    const groups = new Map<string, any[]>();
    for (const row of batch) {
      const ts = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
      const hour = new Date(ts);
      hour.setMinutes(0, 0, 0); 
      const key = `${row.deviceId}||${hour.toISOString()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    // Process each group
    for (const [key, rows] of groups.entries()) {
      const [deviceId, hourStr] = key.split('||');
      const timestamp = new Date(hourStr);

      const batchCount = rows.length;
      
      // Totals
      const bAvgV = this.avg(rows, 'voltage');
      const bAvgI = this.avg(rows, 'current');
      const bAvgP = this.avg(rows, 'power');
      const bAvgPF = this.avg(rows, 'pfAvg');
      const bAvgF = this.avg(rows, 'frequency');

      // Phases
      const bAvgV1 = this.avg(rows, 'voltage');
      const bAvgV2 = this.avg(rows, 'voltage2');
      const bAvgV3 = this.avg(rows, 'voltage3');
      const bAvgI1 = this.avg(rows, 'current');
      const bAvgI2 = this.avg(rows, 'current2');
      const bAvgI3 = this.avg(rows, 'current3');
      const bAvgP1 = this.avg(rows, 'power1');
      const bAvgP2 = this.avg(rows, 'power2');
      const bAvgP3 = this.avg(rows, 'power3');

      // Bands
      const bMinV = this.min(rows, 'voltage');
      const bMaxV = this.max(rows, 'voltage');
      const bMinI = this.min(rows, 'current');
      const bMaxI = this.max(rows, 'current');
      const bMinP = this.min(rows, 'power');
      const bMaxP = this.max(rows, 'power');

      // Robust Energy Delta (Sum of positive increments)
      const sortedRows = rows
        .filter(r => r.impkwh != null)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      
      let energyImport = 0;
      for (let i = 1; i < sortedRows.length; i++) {
        const prev = sortedRows[i - 1].impkwh;
        const curr = sortedRows[i].impkwh;
        const delta = curr - prev;
        
        // Only count if it's a realistic increase (e.g., < 100 kWh jump between messages)
        // and ignore backward jumps (resets).
        if (delta > 0 && delta < 100) {
          energyImport += delta;
        }
      }

      try {
        if (tx) {
          // Use the provided transaction
          const existing = await tx.hourlyDeviceStats.findUnique({
            where: { deviceId_timestamp: { deviceId, timestamp } }
          });

          if (existing) {
            const n = existing.count || 0;
            const m = batchCount;
            const newCount = n + m;

            await tx.hourlyDeviceStats.update({
              where: { id: existing.id },
              data: {
                count: newCount,
                avgVoltage: (existing.avgVoltage * n + bAvgV * m) / newCount,
                avgCurrent: (existing.avgCurrent * n + bAvgI * m) / newCount,
                avgPower: (existing.avgPower * n + bAvgP * m) / newCount,
                avgPF: (existing.avgPF * n + bAvgPF * m) / newCount,
                avgFreq: (existing.avgFreq * n + bAvgF * m) / newCount,

                // Phase Averages
                avgV1: (existing.avgV1 * n + bAvgV1 * m) / newCount,
                avgV2: (existing.avgV2 * n + bAvgV2 * m) / newCount,
                avgV3: (existing.avgV3 * n + bAvgV3 * m) / newCount,
                avgI1: (existing.avgI1 * n + bAvgI1 * m) / newCount,
                avgI2: (existing.avgI2 * n + bAvgI2 * m) / newCount,
                avgI3: (existing.avgI3 * n + bAvgI3 * m) / newCount,
                avgP1: (existing.avgP1 * n + bAvgP1 * m) / newCount,
                avgP2: (existing.avgP2 * n + bAvgP2 * m) / newCount,
                avgP3: (existing.avgP3 * n + bAvgP3 * m) / newCount,

                minVoltage: Math.min(existing.minVoltage ?? Infinity, bMinV),
                maxVoltage: Math.max(existing.maxVoltage ?? -Infinity, bMaxV),
                minCurrent: Math.min(existing.minCurrent ?? Infinity, bMinI),
                maxCurrent: Math.max(existing.maxCurrent ?? -Infinity, bMaxI),
                minPower: Math.min(existing.minPower ?? Infinity, bMinP),
                maxPower: Math.max(existing.maxPower ?? -Infinity, bMaxP),
                energyImport: Number(((existing.energyImport || 0) + energyImport).toFixed(4))
              }
            });
          } else {
            try {
              await tx.hourlyDeviceStats.create({
                data: {
                  deviceId, timestamp, count: batchCount,
                  avgVoltage: bAvgV, avgCurrent: bAvgI, avgPower: bAvgP, avgPF: bAvgPF, avgFreq: bAvgF,
                  avgV1: bAvgV1, avgV2: bAvgV2, avgV3: bAvgV3,
                  avgI1: bAvgI1, avgI2: bAvgI2, avgI3: bAvgI3,
                  avgP1: bAvgP1, avgP2: bAvgP2, avgP3: bAvgP3,
                  minVoltage: bMinV !== Infinity ? bMinV : null,
                  maxVoltage: bMaxV !== -Infinity ? bMaxV : null,
                  minCurrent: bMinI !== Infinity ? bMinI : null,
                  maxCurrent: bMaxI !== -Infinity ? bMaxI : null,
                  minPower: bMinP !== Infinity ? bMinP : null,
                  maxPower: bMaxP !== -Infinity ? bMaxP : null,
                  energyImport: Number(energyImport.toFixed(4))
                }
              });
            } catch (fkError) {
              this.logger.warn(`FK constraint or unique constraint failed for ${deviceId} - skipping aggregation group: ${fkError.message}`);
              if (tx) break;
            }
          }
        } else {
          // Create our own transaction
          await this.prisma.$transaction(async (innerTx: any) => {
            const existing = await innerTx.hourlyDeviceStats.findUnique({
              where: { deviceId_timestamp: { deviceId, timestamp } }
            });

            if (existing) {
              const n = existing.count || 0;
              const m = batchCount;
              const newCount = n + m;

              await innerTx.hourlyDeviceStats.update({
                where: { id: existing.id },
                data: {
                  count: newCount,
                  avgVoltage: (existing.avgVoltage * n + bAvgV * m) / newCount,
                  avgCurrent: (existing.avgCurrent * n + bAvgI * m) / newCount,
                  avgPower: (existing.avgPower * n + bAvgP * m) / newCount,
                  avgPF: (existing.avgPF * n + bAvgPF * m) / newCount,
                  avgFreq: (existing.avgFreq * n + bAvgF * m) / newCount,

                  // Phase Averages
                  avgV1: (existing.avgV1 * n + bAvgV1 * m) / newCount,
                  avgV2: (existing.avgV2 * n + bAvgV2 * m) / newCount,
                  avgV3: (existing.avgV3 * n + bAvgV3 * m) / newCount,
                  avgI1: (existing.avgI1 * n + bAvgI1 * m) / newCount,
                  avgI2: (existing.avgI2 * n + bAvgI2 * m) / newCount,
                  avgI3: (existing.avgI3 * n + bAvgI3 * m) / newCount,
                  avgP1: (existing.avgP1 * n + bAvgP1 * m) / newCount,
                  avgP2: (existing.avgP2 * n + bAvgP2 * m) / newCount,
                  avgP3: (existing.avgP3 * n + bAvgP3 * m) / newCount,

                  minVoltage: Math.min(existing.minVoltage ?? Infinity, bMinV),
                  maxVoltage: Math.max(existing.maxVoltage ?? -Infinity, bMaxV),
                  minCurrent: Math.min(existing.minCurrent ?? Infinity, bMinI),
                  maxCurrent: Math.max(existing.maxCurrent ?? -Infinity, bMaxI),
                  minPower: Math.min(existing.minPower ?? Infinity, bMinP),
                  maxPower: Math.max(existing.maxPower ?? -Infinity, bMaxP),
                  energyImport: Number(((existing.energyImport || 0) + energyImport).toFixed(4))
                }
              });
            } else {
              await innerTx.hourlyDeviceStats.create({
                data: {
                  deviceId, timestamp, count: batchCount,
                  avgVoltage: bAvgV, avgCurrent: bAvgI, avgPower: bAvgP, avgPF: bAvgPF, avgFreq: bAvgF,
                  avgV1: bAvgV1, avgV2: bAvgV2, avgV3: bAvgV3,
                  avgI1: bAvgI1, avgI2: bAvgI2, avgI3: bAvgI3,
                  avgP1: bAvgP1, avgP2: bAvgP2, avgP3: bAvgP3,
                  minVoltage: bMinV !== Infinity ? bMinV : null,
                  maxVoltage: bMaxV !== -Infinity ? bMaxV : null,
                  minCurrent: bMinI !== Infinity ? bMinI : null,
                  maxCurrent: bMaxI !== -Infinity ? bMaxI : null,
                  minPower: bMinP !== Infinity ? bMinP : null,
                  maxPower: bMaxP !== -Infinity ? bMaxP : null,
                  energyImport: Number(energyImport.toFixed(4))
                }
              });
            }
          });
        }
      } catch (err) {
        this.logger.error(`Failed to update hourly stats for ${deviceId}: ${err.message}`);
        if (tx) break;
      }
    }

    // NEW: Update Device Status/LastSeen (matching production pattern but safer)
    try {
      const deviceIds = Array.from(new Set(batch.map(r => r.deviceId)));
      await prisma.device.updateMany({
        where: { id: { in: deviceIds } },
        data: { lastSeen: new Date() }
      });
    } catch (e) {
      this.logger.warn(`Failed to update lastSeen: ${e.message}`);
    }
  }

  private avg(rows: any[], key: string): number {
    const vals = rows.map(r => r[key]).filter(v => v != null);
    if (!vals.length) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  private min(rows: any[], key: string): number {
    const vals = rows.map(r => r[key]).filter(v => v != null);
    return vals.length ? Math.min(...vals) : Infinity;
  }

  private max(rows: any[], key: string): number {
    const vals = rows.map(r => r[key]).filter(v => v != null);
    return vals.length ? Math.max(...vals) : -Infinity;
  }
}