
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function verify() {
    console.log('🔍 VERIFYING ENERGY DATA FOR SIM-001...');
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const data = await prisma.telemetry.findMany({
        where: {
            deviceId: 'SIM-001',
            timestamp: { gte: oneHourAgo }
        },
        orderBy: { timestamp: 'asc' }
    });

    if (data.length === 0) {
        console.log('❌ NO DATA FOUND FOR SIM-001 IN THE LAST HOUR.');
        return;
    }

    const first = data[0];
    const last = data[data.length - 1];
    const delta = (Number(last.impkwh) || 0) - (Number(first.impkwh) || 0);

    console.log(`✅ DATA FOUND: ${data.length} records`);
    console.log(`⏱️  WINDOW: ${first.timestamp.toISOString()} to ${last.timestamp.toISOString()}`);
    console.log(`📊 START ENERGY: ${first.impkwh} KWh`);
    console.log(`📊 END ENERGY: ${last.impkwh} KWh`);
    console.log(`📈 CALCULATED DELTA (MAX-MIN): ${delta.toFixed(3)} KWh`);

    const totalInDb = await prisma.telemetry.count();
    console.log(`📦 TOTAL SYSTEM RECORDS: ${totalInDb}`);
}

verify().finally(() => prisma.$disconnect());
