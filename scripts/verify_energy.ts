import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyEnergy(deviceId: string, dateStr: string) {
  const startOfDay = new Date(dateStr);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(dateStr);
  endOfDay.setHours(23, 59, 59, 999);

  console.log(`Verifying energy for ${deviceId} on ${dateStr}...`);

  const telemetries = await prisma.telemetry.findMany({
    where: {
      deviceId,
      timestamp: {
        gte: startOfDay,
        lte: endOfDay,
      },
      impkwh: { gt: 0 } // Ignore 0 readings which might be errors
    },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true, impkwh: true }
  });

  if (telemetries.length < 2) {
    console.log('Not enough data to calculate consumption.');
    return;
  }

  let totalConsumption = 0;
  let jumps = 0;

  for (let i = 1; i < telemetries.length; i++) {
    const prev = telemetries[i - 1].impkwh ?? 0;
    const curr = telemetries[i].impkwh ?? 0;

    if (curr >= prev) {
      totalConsumption += (curr - prev);
    } else {
      // Detected a reset or jump backwards
      console.log(`[JUMP] detected at ${telemetries[i].timestamp.toISOString()}: ${prev} -> ${curr}`);
      jumps++;
    }
  }

  const firstVal = telemetries[0].impkwh ?? 0;
  const lastVal = telemetries[telemetries.length - 1].impkwh ?? 0;
  const rawDelta = lastVal - firstVal;

  console.log('--- Results ---');
  console.log(`Records fetched: ${telemetries.length}`);
  console.log(`First Reading: ${firstVal} kWh`);
  console.log(`Last Reading: ${lastVal} kWh`);
  console.log(`Raw Delta (Last - First): ${rawDelta.toFixed(4)} kWh`);
  console.log(`Cumulative Delta (Sum of positive differences): ${totalConsumption.toFixed(4)} kWh`);
  console.log(`Resets/Jumps detected: ${jumps}`);
}

const deviceId = process.argv[2] || 'NEWDEV_01';
const date = process.argv[3] || '2026-04-10';

verifyEnergy(deviceId, date)
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
