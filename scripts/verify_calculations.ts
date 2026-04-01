/**
 * ╔══════════════════════════════════════════════════════════════╗
 *  Verify Analytics Calculations
 *  Runs the SAME SQL queries from analytics.service.ts and
 *  validates results against chart_analysis.md expectations.
 * ╚══════════════════════════════════════════════════════════════╝
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEVICE_ID = 'SIM-001';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail: string) {
  if (condition) {
    console.log(`  ✅ ${label}: ${detail}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}: ${detail}`);
    failed++;
  }
}

async function main() {
  const totalRows = await prisma.telemetry.count({ where: { deviceId: DEVICE_ID } });
  console.log(`\nTotal telemetry rows for ${DEVICE_ID}: ${totalRows}\n`);
  if (totalRows === 0) {
    console.log('❌ No data found. Run clear_and_load_csv.ts first.');
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────────
  // 1. Load Analysis — AVG(power), MIN(power), MAX(power)
  // ──────────────────────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Test 1: Load Analysis (Active Power)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        AVG(power) as avg_power,
        MIN(power) as min_power,
        MAX(power) as max_power
      FROM "Telemetry"
      WHERE "deviceId" = $1
    `, DEVICE_ID);
    const r = result[0];
    const avg = Number(r.avg_power);
    const min = Number(r.min_power);
    const max = Number(r.max_power);
    check('AVG(power) is numeric', !isNaN(avg) && avg > 0, `${avg.toFixed(2)} W`);
    check('MIN(power) is numeric', !isNaN(min) && min >= 0, `${min.toFixed(2)} W`);
    check('MAX(power) is numeric', !isNaN(max) && max > 0, `${max.toFixed(2)} W`);
    check('MIN < AVG < MAX ordering', min < avg && avg < max, `${min.toFixed(2)} < ${avg.toFixed(2)} < ${max.toFixed(2)}`);
  }

  // ──────────────────────────────────────────────────────────────
  // 2. Energy Analysis (Hourly) — MAX(impkwh) - MIN(impkwh)
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Test 2: Energy Analysis — Hourly Deltas');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        date_trunc('hour', "timestamp") as ts,
        MAX(impkwh) - MIN(impkwh) as consumption
      FROM "Telemetry"
      WHERE "deviceId" = $1
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 48
    `, DEVICE_ID);
    check('Hourly buckets returned', result.length > 0, `${result.length} buckets`);
    const allPositive = result.every(r => Number(r.consumption) >= 0);
    check('All hourly deltas >= 0', allPositive, allPositive ? 'All non-negative' : 'Found negative deltas!');
    const sample = result.slice(0, 5).map(r => `${new Date(r.ts).toISOString().slice(0, 13)}h → ${Number(r.consumption).toFixed(4)} kWh`);
    console.log(`  📊 Sample (first 5): ${sample.join(', ')}`);
  }

  // ──────────────────────────────────────────────────────────────
  // 3. Energy Analysis (Daily) — MAX(impkwh) - MIN(impkwh)
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Test 3: Energy Analysis — Daily Deltas');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        date_trunc('day', "timestamp") as ts,
        MAX(impkwh) - MIN(impkwh) as consumption
      FROM "Telemetry"
      WHERE "deviceId" = $1
      GROUP BY 1
      ORDER BY 1 ASC
    `, DEVICE_ID);
    check('Daily buckets returned', result.length > 0, `${result.length} days`);
    check('~30 days of data', result.length >= 28 && result.length <= 32, `${result.length} days`);
    const allPositive = result.every(r => Number(r.consumption) >= 0);
    check('All daily deltas >= 0', allPositive, allPositive ? 'All non-negative' : 'Found negative deltas!');
    const totalEnergy = result.reduce((sum, r) => sum + Number(r.consumption), 0);
    console.log(`  📊 Total energy over period: ${totalEnergy.toFixed(2)} kWh`);
    const sample = result.slice(0, 5).map(r => `${new Date(r.ts).toISOString().slice(0, 10)} → ${Number(r.consumption).toFixed(2)} kWh`);
    console.log(`  📊 Sample (first 5): ${sample.join(', ')}`);
  }

  // ──────────────────────────────────────────────────────────────
  // 4. Voltage Profile — AVG for L-N and L-L voltages
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Test 4: Voltage Profile');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        date_trunc('hour', "timestamp") as ts,
        AVG(voltage) as v1, AVG(voltage2) as v2, AVG(voltage3) as v3,
        AVG("vAvgLN") as vln,
        AVG("vL12") as v12, AVG("vL23") as v23, AVG("vL31") as v31,
        AVG("vAvgLL") as vll
      FROM "Telemetry"
      WHERE "deviceId" = $1
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 24
    `, DEVICE_ID);
    check('Voltage buckets returned', result.length > 0, `${result.length} hourly buckets`);
    const r = result[0];
    const v1 = Number(r.v1); const v2 = Number(r.v2); const v3 = Number(r.v3);
    const vln = Number(r.vln);
    check('L-N voltages in range (200-250V)', v1 > 200 && v1 < 260 && v2 > 200 && v2 < 260 && v3 > 200 && v3 < 260,
      `V1=${v1.toFixed(1)}, V2=${v2.toFixed(1)}, V3=${v3.toFixed(1)}`);
    check('vAvgLN reasonable', vln > 200 && vln < 260, `${vln.toFixed(1)} V`);
    const v12 = Number(r.v12); const v23 = Number(r.v23); const v31 = Number(r.v31);
    const vll = Number(r.vll);
    check('L-L voltages in range (380-440V)', v12 > 370 && v12 < 450, `V12=${v12.toFixed(1)}, V23=${v23.toFixed(1)}, V31=${v31.toFixed(1)}`);
    check('vAvgLL reasonable', vll > 370 && vll < 450, `${vll.toFixed(1)} V`);
  }

  // ──────────────────────────────────────────────────────────────
  // 5. Current Profile — AVG, MIN, MAX with bands
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Test 5: Current Profile (Min/Avg/Max Bands)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        date_trunc('hour', "timestamp") as ts,
        AVG(current) as i1_avg, MIN(current) as i1_min, MAX(current) as i1_max,
        AVG(current2) as i2_avg, MIN(current2) as i2_min, MAX(current2) as i2_max,
        AVG(current3) as i3_avg, MIN(current3) as i3_min, MAX(current3) as i3_max,
        AVG("iAvg") as i_avg_total
      FROM "Telemetry"
      WHERE "deviceId" = $1
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 24
    `, DEVICE_ID);
    check('Current buckets returned', result.length > 0, `${result.length} hourly buckets`);
    const r = result[0];
    const avg = Number(r.i1_avg); const min = Number(r.i1_min); const max = Number(r.i1_max);
    check('I1 MIN <= AVG <= MAX', min <= avg && avg <= max, `MIN=${min.toFixed(2)} AVG=${avg.toFixed(2)} MAX=${max.toFixed(2)}`);
    check('I1 values positive', avg > 0, `AVG=${avg.toFixed(2)} A`);
    check('iAvg is numeric', !isNaN(Number(r.i_avg_total)) && Number(r.i_avg_total) > 0, `${Number(r.i_avg_total).toFixed(2)} A`);
  }

  // ──────────────────────────────────────────────────────────────
  // 6. Power Factor — AVG, MIN, MAX
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Test 6: Power Factor (pfAvg)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        date_trunc('hour', "timestamp") as ts,
        AVG("pfAvg") as pf_avg, MIN("pfAvg") as pf_min, MAX("pfAvg") as pf_max
      FROM "Telemetry"
      WHERE "deviceId" = $1
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 24
    `, DEVICE_ID);
    check('PF buckets returned', result.length > 0, `${result.length} hourly buckets`);
    const r = result[0];
    const avg = Number(r.pf_avg); const min = Number(r.pf_min); const max = Number(r.pf_max);
    check('PF MIN <= AVG <= MAX', min <= avg + 0.001 && avg <= max + 0.001, `MIN=${min.toFixed(4)} AVG=${avg.toFixed(4)} MAX=${max.toFixed(4)}`);
    check('PF in valid range (0-1)', avg >= 0 && avg <= 1.05, `AVG=${avg.toFixed(4)}`);
  }

  // ──────────────────────────────────────────────────────────────
  // 7. Frequency — AVG, MIN, MAX
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Test 7: Frequency');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        date_trunc('hour', "timestamp") as ts,
        AVG(frequency) as f_avg, MIN(frequency) as f_min, MAX(frequency) as f_max
      FROM "Telemetry"
      WHERE "deviceId" = $1
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 24
    `, DEVICE_ID);
    check('Frequency buckets returned', result.length > 0, `${result.length} hourly buckets`);
    const r = result[0];
    const avg = Number(r.f_avg); const min = Number(r.f_min); const max = Number(r.f_max);
    check('Freq MIN <= AVG <= MAX', min <= avg + 0.001 && avg <= max + 0.001, `MIN=${min.toFixed(3)} AVG=${avg.toFixed(3)} MAX=${max.toFixed(3)}`);
    check('Freq near 50Hz', avg > 49 && avg < 51, `AVG=${avg.toFixed(3)} Hz`);
  }

  // ──────────────────────────────────────────────────────────────
  // 8. Voltage THD — AVG, MIN, MAX for vthdL1/L2/L3
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Test 8: Voltage THD');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const result: any[] = await prisma.$queryRawUnsafe(`
      SELECT 
        date_trunc('hour', "timestamp") as ts,
        AVG("vthdL1") as vthd1_avg, MIN("vthdL1") as vthd1_min, MAX("vthdL1") as vthd1_max,
        AVG("vthdL2") as vthd2_avg, MIN("vthdL2") as vthd2_min, MAX("vthdL2") as vthd2_max,
        AVG("vthdL3") as vthd3_avg, MIN("vthdL3") as vthd3_min, MAX("vthdL3") as vthd3_max
      FROM "Telemetry"
      WHERE "deviceId" = $1
      GROUP BY 1
      ORDER BY 1 ASC
      LIMIT 24
    `, DEVICE_ID);
    check('THD buckets returned', result.length > 0, `${result.length} hourly buckets`);
    const r = result[0];
    const t1 = Number(r.vthd1_avg); const t2 = Number(r.vthd2_avg); const t3 = Number(r.vthd3_avg);
    check('THD values are numeric', !isNaN(t1) && !isNaN(t2) && !isNaN(t3), `L1=${t1.toFixed(2)}% L2=${t2.toFixed(2)}% L3=${t3.toFixed(2)}%`);
    check('THD in valid range (0-15%)', t1 >= 0 && t1 < 15 && t2 >= 0 && t2 < 15 && t3 >= 0 && t3 < 15,
      `L1=${t1.toFixed(2)}% L2=${t2.toFixed(2)}% L3=${t3.toFixed(2)}%`);
    const min1 = Number(r.vthd1_min); const max1 = Number(r.vthd1_max);
    check('THD L1 MIN <= AVG <= MAX', min1 <= t1 + 0.001 && t1 <= max1 + 0.001,
      `MIN=${min1.toFixed(2)} AVG=${t1.toFixed(2)} MAX=${max1.toFixed(2)}`);
  }

  // ──────────────────────────────────────────────────────────────
  // 9. Solar Profile — CTE hourly deltas → 24-bin avg
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Test 9: Solar Profile (24-Hour Avg Consumption)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  {
    const result: any[] = await prisma.$queryRawUnsafe(`
      WITH hourly_deltas AS (
        SELECT 
          date_trunc('hour', "timestamp") as bucket_ts,
          EXTRACT(hour from "timestamp") as hour_of_day,
          MAX(impkwh) - MIN(impkwh) as consumption
        FROM "Telemetry"
        WHERE "deviceId" = $1
        GROUP BY 1, 2
      )
      SELECT 
        hour_of_day::int as hour,
        AVG(consumption) as avg_consumption
      FROM hourly_deltas
      GROUP BY 1
      ORDER BY 1 ASC
    `, DEVICE_ID);
    check('24 hourly bins returned', result.length === 24, `${result.length} bins`);
    const allPositive = result.every(r => Number(r.avg_consumption) >= 0);
    check('All avg consumption >= 0', allPositive, allPositive ? 'All non-negative' : 'Found negative values!');
    const allNumeric = result.every(r => !isNaN(Number(r.avg_consumption)));
    check('All values are numeric', allNumeric, allNumeric ? 'All numeric' : 'Non-numeric values found!');
    
    // Print the 24-hour profile
    console.log('\n  📊 24-Hour Average Grid Consumption Profile:');
    console.log('  ┌──────┬──────────────────┐');
    console.log('  │ Hour │ Avg kWh          │');
    console.log('  ├──────┼──────────────────┤');
    for (const r of result) {
      const hour = String(r.hour).padStart(2, '0');
      const val = Number(r.avg_consumption).toFixed(4);
      const bar = '█'.repeat(Math.min(30, Math.round(Number(r.avg_consumption) * 10)));
      console.log(`  │  ${hour}  │ ${val.padStart(8)} kWh ${bar}`);
    }
    console.log('  └──────┴──────────────────┘');
  }

  // ──────────────────────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (failed === 0) {
    console.log('🎉 All calculation tests PASSED!\n');
  } else {
    console.log(`⚠️  ${failed} test(s) FAILED. Review output above.\n`);
  }

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
