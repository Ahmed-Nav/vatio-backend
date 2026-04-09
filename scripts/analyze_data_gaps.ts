import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeDataGaps() {
  const DEVICE_ID = 'SIM-001'; // Change this to analyze different devices

  console.log(`\n🔍 Analyzing data gaps for device: ${DEVICE_ID}\n`);

  // Get all telemetry records ordered by timestamp
  const records = await prisma.telemetry.findMany({
    where: { deviceId: DEVICE_ID },
    select: {
      timestamp: true,
      deviceId: true
    },
    orderBy: { timestamp: 'asc' }
  });

  if (records.length === 0) {
    console.log('❌ No telemetry records found for this device');
    return;
  }

  console.log(`📊 Total records: ${records.length}`);
  console.log(`📅 Time range: ${records[0].timestamp.toISOString()} to ${records[records.length - 1].timestamp.toISOString()}\n`);

  // Calculate time differences between consecutive records
  const gaps: { timestamp: Date; gapMs: number; gapMinutes: number; gapHours: number }[] = [];

  for (let i = 1; i < records.length; i++) {
    const current = records[i];
    const previous = records[i - 1];

    const gapMs = current.timestamp.getTime() - previous.timestamp.getTime();
    const gapMinutes = gapMs / (1000 * 60);
    const gapHours = gapMs / (1000 * 60 * 60);

    if (gapMs > 0) { // Only record positive gaps (should always be true for ordered data)
      gaps.push({
        timestamp: current.timestamp,
        gapMs,
        gapMinutes,
        gapHours
      });
    }
  }

  // Sort gaps by size (largest first)
  gaps.sort((a, b) => b.gapMs - a.gapMs);

  console.log('⏱️  Top 20 largest time gaps:\n');

  gaps.slice(0, 20).forEach((gap, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${gap.timestamp.toISOString()}`);
    console.log(`    Gap: ${gap.gapHours.toFixed(2)} hours (${gap.gapMinutes.toFixed(1)} minutes, ${gap.gapMs} ms)`);
    console.log('');
  });

  // Statistics
  const totalGaps = gaps.length;
  const avgGapMs = gaps.reduce((sum, gap) => sum + gap.gapMs, 0) / totalGaps;
  const medianGapMs = gaps[Math.floor(totalGaps / 2)].gapMs;

  console.log('📈 Gap Statistics:');
  console.log(`   Average gap: ${(avgGapMs / (1000 * 60)).toFixed(2)} minutes`);
  console.log(`   Median gap:  ${(medianGapMs / (1000 * 60)).toFixed(2)} minutes`);
  console.log(`   Largest gap: ${(gaps[0].gapMs / (1000 * 60 * 60)).toFixed(2)} hours`);

  // Expected interval analysis (assuming 5-second intervals based on seed script name)
  const expectedIntervalMs = 5 * 1000; // 5 seconds
  const gapsLargerThanExpected = gaps.filter(gap => gap.gapMs > expectedIntervalMs * 2);

  console.log(`\n⚠️  Gaps larger than 10 seconds (${gapsLargerThanExpected.length} total):`);
  gapsLargerThanExpected.slice(0, 10).forEach((gap, index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${gap.timestamp.toISOString()} - ${(gap.gapMs / 1000).toFixed(1)}s gap`);
  });

  await prisma.$disconnect();
}

analyzeDataGaps().catch(console.error);