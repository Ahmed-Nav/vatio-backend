import { Test, TestingModule } from '@nestjs/testing';
import { EnergyCalculationService } from './energy-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Exercises the JS fallback path (bucketedGridFlowFallback) by making
 * $queryRawUnsafe reject, so every case here runs the same row-by-row
 * consecutive-delta logic the SQL path implements with LAG(). The two
 * implementations are intentionally mirror images of each other.
 */
describe('EnergyCalculationService', () => {
    let service: EnergyCalculationService;
    let findManyMock: jest.Mock;

    function row(isoTimestamp: string, importKwh: number, exportKwh: number) {
        return {
            timestamp: new Date(isoTimestamp),
            data: { metrics: { importKwh, exportKwh } },
        };
    }

    /** An AggregationService-style row — {avg,min,max} shape, no `metrics` key. */
    function aggregatedRow(isoTimestamp: string) {
        return {
            timestamp: new Date(isoTimestamp),
            data: { avg: { power: 1234 }, min: { power: 1000 }, max: { power: 1500 } },
        };
    }

    async function run(rows: Array<ReturnType<typeof row> | ReturnType<typeof aggregatedRow>>, bucketInterval = '1 hour') {
        findManyMock.mockResolvedValue(rows);
        return service.bucketedGridFlow('DEV-001', new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T23:59:59Z'), bucketInterval);
    }

    beforeEach(async () => {
        findManyMock = jest.fn();
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EnergyCalculationService,
                {
                    provide: PrismaService,
                    useValue: {
                        $queryRawUnsafe: jest.fn().mockRejectedValue(new Error('time_bucket unavailable in test')),
                        telemetry: { findMany: findManyMock },
                    },
                },
            ],
        }).compile();

        service = module.get<EnergyCalculationService>(EnergyCalculationService);
    });

    it('is defined', () => {
        expect(service).toBeDefined();
    });

    it('sums consecutive positive deltas within a bucket', async () => {
        const result = await run([
            row('2026-01-01T10:00:00Z', 100, 10),
            row('2026-01-01T10:10:00Z', 101, 10),
            row('2026-01-01T10:20:00Z', 103, 12),
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].gridImportKwh).toBeCloseTo(3, 3); // 100->101->103
        expect(result[0].solarExportKwh).toBeCloseTo(2, 3); // 10->10->12
    });

    it('treats a counter decrease as a reset, not a negative delta', async () => {
        const result = await run([
            row('2026-01-01T10:00:00Z', 100, 0),
            row('2026-01-01T10:10:00Z', 105, 0), // +5
            row('2026-01-01T10:20:00Z', 2, 0),   // reset: counts as +2, not -103
            row('2026-01-01T10:30:00Z', 4, 0),   // +2 post-reset
        ]);
        // 0 (first reading has no predecessor) + 5 + 2 (post-reset value itself) + 2 = 9
        expect(result[0].gridImportKwh).toBeCloseTo(9, 3);
    });

    it('contributes zero delta for an exact duplicate reading', async () => {
        const result = await run([
            row('2026-01-01T10:00:00Z', 50, 5),
            row('2026-01-01T10:05:00Z', 50, 5), // duplicate value
            row('2026-01-01T10:10:00Z', 52, 6),
        ]);
        expect(result[0].gridImportKwh).toBeCloseTo(2, 3); // 50->50 (0) ->52 (2)
        expect(result[0].solarExportKwh).toBeCloseTo(1, 3);
    });

    it('splits deltas across bucket boundaries by the timestamp of the later reading', async () => {
        const result = await run([
            row('2026-01-01T10:50:00Z', 10, 0),
            row('2026-01-01T11:10:00Z', 15, 0), // delta of 5 lands in the 11:00 bucket
            row('2026-01-01T11:40:00Z', 18, 0),
        ]);
        expect(result).toHaveLength(2);
        const bucket10 = result.find((r) => new Date(r.ts).getUTCHours() === 10)!;
        const bucket11 = result.find((r) => new Date(r.ts).getUTCHours() === 11)!;
        expect(bucket10.gridImportKwh).toBeCloseTo(0, 3); // first reading, no predecessor
        expect(bucket11.gridImportKwh).toBeCloseTo(8, 3); // 15-10 + 18-15
    });

    it('sorts by timestamp before diffing regardless of row order received', async () => {
        const result = await run([
            row('2026-01-01T10:20:00Z', 30, 0),
            row('2026-01-01T10:00:00Z', 20, 0),
            row('2026-01-01T10:10:00Z', 25, 0),
        ]);
        // Prisma's own orderBy guarantees ascending timestamps in practice; this
        // confirms the service doesn't additionally rely on array insertion order.
        expect(result[0].gridImportKwh).toBeCloseTo(10, 3); // 20->25->30
    });

    it('returns no buckets for an empty range', async () => {
        const result = await run([]);
        expect(result).toEqual([]);
    });

    it('ignores aggregated ({avg,min,max}) rows interleaved with raw readings instead of treating them as a 0 reading', async () => {
        // Regression test for a real bug: AggregationService writes a row every
        // 5s with no `metrics` object. Treating that as importKwh=0 created a
        // real-value -> 0 -> real-value sawtooth that got double-counted as
        // massive fake growth on every jump back up to the real value.
        const result = await run([
            row('2026-01-01T10:00:00Z', 100, 0),
            aggregatedRow('2026-01-01T10:00:05Z'),
            row('2026-01-01T10:00:10Z', 100, 0), // no real growth
            aggregatedRow('2026-01-01T10:00:15Z'),
            row('2026-01-01T10:00:20Z', 101, 0), // +1 real growth
        ]);
        expect(result[0].gridImportKwh).toBeCloseTo(1, 3);
    });
});
