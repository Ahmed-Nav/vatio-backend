import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const telemetryCount = await prisma.telemetry.count();
    const hourlyCount = await prisma.hourlyDeviceStats.count();
    const dailyCount = await prisma.dailyDeviceStats.count();

    console.log('--- Database Stats ---');
    console.log(`Telemetry Records: ${telemetryCount}`);
    console.log(`Hourly Summary Records: ${hourlyCount}`);
    console.log(`Daily Summary Records: ${dailyCount}`);

    if (hourlyCount > 0) {
      const latestHourly = await prisma.hourlyDeviceStats.findFirst({
        orderBy: { timestamp: 'desc' }
      });
      console.log('Latest Hourly Stat:', latestHourly);
    }

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
