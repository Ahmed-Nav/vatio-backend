import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function checkNewDevStats() {
  const prisma = new PrismaClient();

  try {
    const newDevStats = await prisma.hourlyDeviceStats.findMany({
      where: { deviceId: 'NEWDEV_01' },
      orderBy: { timestamp: 'desc' },
      take: 5
    });

    console.log('NEWDEV_01 Hourly Stats (latest 5):');
    console.log(JSON.stringify(newDevStats, null, 2));

    const newDevTelemetry = await prisma.telemetry.findMany({
      where: { deviceId: 'NEWDEV_01' },
      orderBy: { timestamp: 'desc' },
      take: 5,
      select: {
        id: true,
        deviceId: true,
        timestamp: true,
        voltage: true,
        current: true,
        power: true,
        impkwh: true
      }
    });

    const count = await prisma.hourlyDeviceStats.count({
      where: { deviceId: 'NEWDEV_01' }
    });

    console.log(`\nNEWDEV_01 Hourly Stats Count: ${count}`);

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkNewDevStats();