require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  try {
    const deviceId = 'DEV-001';
    const start = new Date('2026-10-05T00:00:00Z');
    const end = new Date('2026-10-13T23:59:59Z');
    const bucketInterval = '1 day';

    console.log(`Querying solar profile for ${deviceId} from ${start.toISOString()} to ${end.toISOString()} with ${bucketInterval}...`);

    // Let's test the exact query from EnergyCalculationService
    const results = await prisma.$queryRawUnsafe(`
      WITH readings AS (
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
      ORDER BY bucket ASC
    `, deviceId, start, end, bucketInterval);

    console.log('\n--- DAILY BUCKET RESULTS ---');
    console.table(results);

    // Also let's check what export_val changes happened day by day
    const daySnapshots = await prisma.$queryRawUnsafe(`
      SELECT 
        DATE("timestamp") as day,
        MIN((t."data"->'metrics'->>'importKwh')::double precision) as min_import,
        MAX((t."data"->'metrics'->>'importKwh')::double precision) as max_import,
        MIN((t."data"->'metrics'->>'exportKwh')::double precision) as min_export,
        MAX((t."data"->'metrics'->>'exportKwh')::double precision) as max_export,
        COUNT(*) as samples
      FROM "Telemetry" t
      WHERE t."deviceId" = $1
        AND t."timestamp" >= $2::timestamp
        AND t."timestamp" <= $3::timestamp
        AND t."data" ? 'metrics'
      GROUP BY DATE("timestamp")
      ORDER BY day ASC
    `, deviceId, start, end);

    console.log('\n--- DAY SNAPSHOTS (MIN/MAX COUNTERS) ---');
    console.table(daySnapshots);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

run();
