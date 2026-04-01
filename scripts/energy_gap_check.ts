import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const data = await prisma.telemetry.findMany({
    where: { deviceId: 'SIM-001' },
    select: { impkwh: true, timestamp: true },
    orderBy: { timestamp: 'asc' }
  });

  if (data.length === 0) return;

  const lastImp = data[data.length - 1]!.impkwh ?? 0;
  const firstImp = data[0]!.impkwh ?? 0;
  const absoluteDelta = lastImp - firstImp;

  const daily: Record<string, { min: number; max: number }> = {};
  data.forEach(d => {
    const day = d.timestamp.toISOString().split('T')[0];
    const val = d.impkwh ?? 0;
    if (!daily[day]) {
      daily[day] = { min: val, max: val };
    }
    daily[day].min = Math.min(daily[day].min, val);
    daily[day].max = Math.max(daily[day].max, val);
  });

  let sumOfDailyDeltas = 0;
  Object.values(daily).forEach(d => {
    sumOfDailyDeltas += (d.max - d.min);
  });

  console.log('--- Energy Analysis ---');
  console.log('Absolute Max - Min Delta:', absoluteDelta.toFixed(3), 'kWh');
  console.log('Sum of 30 Daily Max-Min Deltas:', sumOfDailyDeltas.toFixed(3), 'kWh');
  console.log('Difference (Lost Energy due to daily gaps):', (absoluteDelta - sumOfDailyDeltas).toFixed(3), 'kWh');

  await prisma.$disconnect();
}

main();
