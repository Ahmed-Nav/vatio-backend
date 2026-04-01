/**
 * ╔══════════════════════════════════════════════════════════════╗
 *  Clear DB + Load 30-Day Simulation CSV into PostgreSQL
 *  1. Deletes ALL existing Telemetry rows
 *  2. Streams CSV and batch-inserts in chunks of 5000
 *  3. Converts power fields from kW → Watts (×1000)
 * ╚══════════════════════════════════════════════════════════════╝
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});
const CSV_PATH = path.join(__dirname, 'simulation_data_30d.csv');
const BATCH_SIZE = 5000;

// Fields that the live pipeline stores in Watts (kW × 1000)
const POWER_FIELDS = [
  'power', 'power1', 'power2', 'power3',
  'kva', 'kva1', 'kva2', 'kva3',
  'kvar', 'kvar1', 'kvar2', 'kvar3',
];

// Fields that are strings, not numbers
const STRING_FIELDS = ['deviceId', 'timestamp', 'localTime'];

function parseRow(headers: string[], values: string[]): Record<string, any> {
  const row: Record<string, any> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i];
    const raw = values[i];

    if (key === 'deviceId') {
      row.deviceId = raw;
    } else if (key === 'timestamp') {
      row.timestamp = new Date(raw);
    } else if (key === 'localTime') {
      row.localTime = raw || null;
    } else {
      let num = parseFloat(raw);
      if (isNaN(num)) {
        row[key] = null;
      } else {
        // Convert power fields from kW to Watts
        if (POWER_FIELDS.includes(key)) {
          num = num * 1000;
        }
        row[key] = num;
      }
    }
  }
  // Ensure status is integer
  if (row.status !== null && row.status !== undefined) {
    row.status = Math.round(row.status);
  }
  return row;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Phase 1: CLEAR DATABASE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Count existing rows
  const existingCount = await prisma.telemetry.count();
  console.log(`Existing telemetry rows: ${existingCount}`);

  // Delete all telemetry
  const deleteResult = await prisma.telemetry.deleteMany({});
  console.log(`✅ Deleted ${deleteResult.count} telemetry rows`);

  // Reset device lastSeen
  await prisma.device.updateMany({
    data: { lastSeen: null, status: 'offline' },
  });
  console.log('✅ Reset all device lastSeen & status\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Phase 2: LOAD CSV');
  console.log(`  File: ${CSV_PATH}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV file not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(CSV_PATH, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let headers: string[] = [];
  let batch: Record<string, any>[] = [];
  let totalInserted = 0;
  let lineNum = 0;
  let batchNum = 0;
  const startTime = Date.now();

  for await (const line of rl) {
    lineNum++;

    // First line is the header
    if (lineNum === 1) {
      headers = line.split(',').map(h => h.trim());
      console.log(`CSV Headers (${headers.length}): ${headers.join(', ')}`);
      continue;
    }

    // Skip empty lines
    if (!line.trim()) continue;

    const values = line.split(',');
    const row = parseRow(headers, values);
    batch.push(row);

    // Flush batch
    if (batch.length >= BATCH_SIZE) {
      batchNum++;
      try {
        await prisma.telemetry.createMany({ data: batch as any });
        totalInserted += batch.length;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (totalInserted / parseFloat(elapsed)).toFixed(0);
        process.stdout.write(
          `\r  Batch ${batchNum}: ${totalInserted} rows inserted (${elapsed}s, ~${rate} rows/s)    `
        );
      } catch (err: any) {
        console.error(`\n❌ Batch ${batchNum} failed: ${err.message}`);
        console.error(`  Sample row: ${JSON.stringify(batch[0])}`);
      }
      batch = [];
    }
  }

  // Flush remaining rows
  if (batch.length > 0) {
    batchNum++;
    try {
      await prisma.telemetry.createMany({ data: batch as any });
      totalInserted += batch.length;
    } catch (err: any) {
      console.error(`\n❌ Final batch failed: ${err.message}`);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ CSV Load Complete!`);
  console.log(`  Total rows inserted: ${totalInserted}`);
  console.log(`  Total time: ${totalElapsed}s`);

  // Update device lastSeen to latest timestamp
  await prisma.device.updateMany({
    where: { id: 'SIM-001' },
    data: { lastSeen: new Date(), status: 'online' },
  });
  console.log('✅ Updated SIM-001 device status to online\n');

  // Final verification
  const finalCount = await prisma.telemetry.count();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(` VERIFICATION: ${finalCount} rows in Telemetry table`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
