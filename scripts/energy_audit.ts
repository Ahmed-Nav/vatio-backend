import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Overall energy range
  const overall: any[] = await prisma.$queryRawUnsafe(
    `SELECT MIN(impkwh) as min_e, MAX(impkwh) as max_e, MAX(impkwh) - MIN(impkwh) as total_delta FROM "Telemetry" WHERE "deviceId" = $1`,
    'SIM-001'
  );
  console.log('=== OVERALL ENERGY ===');
  console.log(`MIN(impkwh) = ${Number(overall[0].min_e).toFixed(3)} kWh`);
  console.log(`MAX(impkwh) = ${Number(overall[0].max_e).toFixed(3)} kWh`);
  console.log(`TOTAL DELTA = ${Number(overall[0].total_delta).toFixed(3)} kWh`);

  // 2. Daily deltas
  const daily: any[] = await prisma.$queryRawUnsafe(
    `SELECT date_trunc('day', "timestamp") as day, MAX(impkwh) - MIN(impkwh) as daily_kwh FROM "Telemetry" WHERE "deviceId" = $1 GROUP BY 1 ORDER BY 1`,
    'SIM-001'
  );
  console.log('\n=== DAILY DELTAS ===');
  let sum = 0;
  for (const row of daily) {
    const v = Number(row.daily_kwh);
    sum += v;
    console.log(`${new Date(row.day).toISOString().slice(0, 10)} -> ${v.toFixed(2)} kWh`);
  }
  console.log(`\nSum of daily deltas: ${sum.toFixed(2)} kWh`);
  console.log(`Number of days: ${daily.length}`);

  // 3. Theoretical check: avg power * time
  const avgPower: any[] = await prisma.$queryRawUnsafe(
    `SELECT AVG(power) as avg_w FROM "Telemetry" WHERE "deviceId" = $1`,
    'SIM-001'
  );
  const avgW = Number(avgPower[0].avg_w);
  const avgKW = avgW / 1000; // power stored in Watts
  const hours = 30 * 24;
  const theoretical = avgKW * hours;
  console.log(`\n=== THEORETICAL CHECK ===`);
  console.log(`AVG power in DB: ${avgW.toFixed(2)} W (${avgKW.toFixed(4)} kW)`);
  console.log(`30 days = ${hours} hours`);
  console.log(`Theoretical energy = ${avgKW.toFixed(4)} kW × ${hours} h = ${theoretical.toFixed(2)} kWh`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
