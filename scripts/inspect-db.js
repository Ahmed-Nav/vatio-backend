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
    const count = await prisma.telemetry.count();
    console.log('Total Telemetry Rows:', count);

    const devices = await prisma.device.findMany({ select: { id: true, name: true } });
    console.log('Registered Devices:', devices);

    const rows = await prisma.telemetry.findMany({
      take: 5,
      orderBy: { timestamp: 'desc' },
    });

    console.log('\n--- LATEST 5 ROWS ---');
    for (const r of rows) {
      console.log(`[${r.id}] Dev: ${r.deviceId} | Time: ${r.timestamp.toISOString()}`);
      if (r.data && r.data.metrics) {
        console.log('  metrics keys:', Object.keys(r.data.metrics));
        console.log('  importKwh:', r.data.metrics.importKwh, 'Import_kWh:', r.data.metrics.Import_kWh);
        console.log('  exportKwh:', r.data.metrics.exportKwh, 'Export_kWh:', r.data.metrics.Export_kWh);
        console.log('  solarKwh:', r.data.metrics.solarKwh, 'Solar_kWh:', r.data.metrics.Solar_kWh);
      } else {
        console.log('  data shape (no metrics object):', Object.keys(r.data || {}));
      }
    }

    console.log('\n--- CHECKING AGGREGATES ACROSS ALL ROWS ---');
    const minMax = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*) as total_rows,
        COUNT(CASE WHEN "data" ? 'metrics' THEN 1 END) as rows_with_metrics,
        MAX(COALESCE(("data"->'metrics'->>'exportKwh')::double precision, ("data"->'metrics'->>'Export_kWh')::double precision, 0)) as max_export,
        MIN(COALESCE(("data"->'metrics'->>'exportKwh')::double precision, ("data"->'metrics'->>'Export_kWh')::double precision, 0)) as min_export,
        MAX(COALESCE(("data"->'metrics'->>'solarKwh')::double precision, 0)) as max_solar_kwh,
        MAX(COALESCE(("data"->'metrics'->>'importKwh')::double precision, ("data"->'metrics'->>'Import_kWh')::double precision, 0)) as max_import,
        MIN(COALESCE(("data"->'metrics'->>'importKwh')::double precision, ("data"->'metrics'->>'Import_kWh')::double precision, 0)) as min_import
      FROM "Telemetry"
    `);
    console.log(minMax);

    console.log('\n--- SAMPLE RAW METRICS KEYS ---');
    const sample = await prisma.$queryRawUnsafe(`
      SELECT jsonb_object_keys("data"->'metrics') as metric_key, count(*) as freq
      FROM "Telemetry"
      WHERE "data" ? 'metrics'
      GROUP BY metric_key
      ORDER BY freq DESC
      LIMIT 30;
    `);
    console.log(sample);

    console.log('\n--- NON-ZERO EXPORT ROWS (IF ANY) ---');
    const nonZeroExport = await prisma.$queryRawUnsafe(`
      SELECT "id", "deviceId", "timestamp",
        "data"->'metrics'->>'exportKwh' as export_kwh,
        "data"->'metrics'->>'Export_kWh' as export_kwh_upper,
        "data"->'metrics'->>'solarKwh' as solar_kwh,
        "data"->'metrics'->>'importKwh' as import_kwh,
        "data"->'metrics'->>'Import_kWh' as import_kwh_upper
      FROM "Telemetry"
      WHERE "data" ? 'metrics'
        AND (
          COALESCE(("data"->'metrics'->>'exportKwh')::double precision, 0) > 0
          OR COALESCE(("data"->'metrics'->>'Export_kWh')::double precision, 0) > 0
          OR COALESCE(("data"->'metrics'->>'solarKwh')::double precision, 0) > 0
        )
      LIMIT 5;
    `);
    console.log('Non-zero export count/samples:', nonZeroExport);

  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

run();
