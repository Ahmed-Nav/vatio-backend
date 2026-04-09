import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearDB() {
  console.log('🧹 Clearing Telemetry and Summary Tables...');
  try {
    const t = await prisma.telemetry.deleteMany();
    const h = await prisma.hourlyDeviceStats.deleteMany();
    const d = await prisma.dailyDeviceStats.deleteMany();

    console.log(`✅ Deleted ${t.count} Telemetry rows.`);
    console.log(`✅ Deleted ${h.count} Hourly Summary rows.`);
    console.log(`✅ Deleted ${d.count} Daily Summary rows.`);
  } catch (e) {
    console.error('❌ Failed to clear DB:', e);
  } finally {
    await prisma.$disconnect();
  }
}

clearDB();
