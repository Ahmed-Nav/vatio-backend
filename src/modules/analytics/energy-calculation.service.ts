import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface BucketedFlow {
    ts: number;
    gridImportKwh: number;
    solarExportKwh: number;
}

/**
 * Converts cumulative meter counters (Import_kWh / Export_kWh style) into
 * real per-bucket energy deltas.
 *
 * A naive `MAX(value) - MIN(value)` per time bucket silently UNDERSTATES
 * energy whenever the counter resets mid-bucket (firmware restart, meter
 * re-provision, etc.) — it just measures the post-reset spread and quietly
 * drops the pre-reset portion. This service instead walks CONSECUTIVE raw
 * readings in timestamp order and sums positive deltas, treating any
 * decrease between two readings as a reset point (the post-reset value
 * itself is counted as that step's delta, not a negative number).
 *
 * This also makes duplicate/out-of-order messages harmless by construction:
 * two readings with the same value anywhere in the sequence contribute a
 * delta of 0 between them, and sorting by timestamp before diffing means
 * ingestion order never matters.
 */
@Injectable()
export class EnergyCalculationService {
    private readonly logger = new Logger(EnergyCalculationService.name);

    constructor(private readonly prisma: PrismaService) { }

    async bucketedGridFlow(
        deviceId: string,
        start: Date,
        end: Date,
        bucketInterval: string,
    ): Promise<BucketedFlow[]> {
        try {
            const results: any[] = await this.prisma.$queryRawUnsafe(
                `WITH readings AS (
                    SELECT
                        t."timestamp",
                        COALESCE(
                            (t."data"->'metrics'->>'importKwh')::double precision,
                            (t."data"->'metrics'->>'Import_kWh')::double precision
                        ) AS import_val,
                        COALESCE(
                            (t."data"->'metrics'->>'exportKwh')::double precision,
                            (t."data"->'metrics'->>'Export_kWh')::double precision
                        ) AS export_val
                    FROM "Telemetry" t
                    WHERE t."deviceId" = $1
                      AND t."timestamp" >= $2::timestamp
                      AND t."timestamp" <= $3::timestamp
                      -- Only raw per-reading rows carry a metrics object with real
                      -- counter values. Rows written by the 5s AggregationService have
                      -- an avg/min/max shape instead — no metrics key at all — and
                      -- must be excluded here, not defaulted to 0: a 0-default creates
                      -- a real-value -> 0 -> real-value sawtooth that the reset-safe
                      -- delta logic below would misread as genuine growth on every
                      -- jump back up, wildly inflating totals.
                      AND t."data" ? 'metrics'
                      AND (
                        (t."data"->'metrics' ? 'importKwh') OR (t."data"->'metrics' ? 'Import_kWh')
                      )
                ),
                with_prev AS (
                    SELECT
                        "timestamp",
                        import_val,
                        export_val,
                        LAG(import_val) OVER (ORDER BY "timestamp") AS prev_import,
                        LAG(export_val) OVER (ORDER BY "timestamp") AS prev_export
                    FROM readings
                ),
                deltas AS (
                    SELECT
                        time_bucket($4::interval, "timestamp") AS bucket,
                        -- A decrease means the counter reset: count the new
                        -- (post-reset) reading itself as that step's delta.
                        CASE
                            WHEN prev_import IS NULL THEN 0
                            WHEN import_val >= prev_import THEN import_val - prev_import
                            ELSE import_val
                        END AS import_delta,
                        CASE
                            WHEN prev_export IS NULL THEN 0
                            WHEN export_val >= prev_export THEN export_val - prev_export
                            ELSE export_val
                        END AS export_delta
                    FROM with_prev
                )
                SELECT
                    bucket,
                    ROUND(SUM(import_delta)::numeric, 3)::double precision AS grid_import,
                    ROUND(SUM(export_delta)::numeric, 3)::double precision AS solar_export
                FROM deltas
                GROUP BY bucket
                ORDER BY bucket ASC`,
                deviceId,
                start,
                end,
                bucketInterval,
            );

            return results.map((r) => ({
                ts: new Date(r.bucket).getTime(),
                gridImportKwh: r.grid_import ?? 0,
                solarExportKwh: r.solar_export ?? 0,
            }));
        } catch (err) {
            this.logger.warn(`time_bucket() grid-flow query fallback: ${err.message}`);
            return this.bucketedGridFlowFallback(deviceId, start, end, bucketInterval);
        }
    }

    private async bucketedGridFlowFallback(
        deviceId: string,
        start: Date,
        end: Date,
        bucketInterval: string,
    ): Promise<BucketedFlow[]> {
        const rows = await this.prisma.telemetry.findMany({
            where: { deviceId, timestamp: { gte: start, lte: end } },
            orderBy: { timestamp: 'asc' },
            select: { timestamp: true, data: true },
        });

        const stepMs =
            bucketInterval === '1 month' ? 2_592_000_000 :
                bucketInterval === '1 day' ? 86_400_000 :
                    3_600_000;

        // Defensive sort: diffing must follow reading order, not arrival/insert
        // order. The query already asks for `orderBy: timestamp asc`, but don't
        // rely solely on that holding — sort again here.
        const sortedRows = [...rows].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        const buckets = new Map<number, { gridImportKwh: number; solarExportKwh: number }>();
        let prevImport: number | null = null;
        let prevExport: number | null = null;

        for (const row of sortedRows) {
            const metrics = (row.data as any)?.metrics;
            // Skip aggregated rows ({avg,min,max} shape, no `metrics` object) —
            // see the matching comment in the SQL path above for why defaulting
            // these to 0 instead of skipping them inflates totals badly.
            if (!metrics || (metrics.importKwh === undefined && metrics.Import_kWh === undefined)) continue;

            const importVal = Number(metrics.importKwh ?? metrics.Import_kWh);
            const exportVal = Number(metrics.exportKwh ?? metrics.Export_kWh ?? 0);

            const importDelta = prevImport === null ? 0 : (importVal >= prevImport ? importVal - prevImport : importVal);
            const exportDelta = prevExport === null ? 0 : (exportVal >= prevExport ? exportVal - prevExport : exportVal);
            prevImport = importVal;
            prevExport = exportVal;

            const bucketTs = Math.floor(row.timestamp.getTime() / stepMs) * stepMs;
            if (!buckets.has(bucketTs)) buckets.set(bucketTs, { gridImportKwh: 0, solarExportKwh: 0 });
            const b = buckets.get(bucketTs)!;
            b.gridImportKwh += importDelta;
            b.solarExportKwh += exportDelta;
        }

        return Array.from(buckets.entries())
            .sort(([a], [b]) => a - b)
            .map(([ts, v]) => ({
                ts,
                gridImportKwh: Number(v.gridImportKwh.toFixed(3)),
                solarExportKwh: Number(v.solarExportKwh.toFixed(3)),
            }));
    }
}
