const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        const data = await prisma.telemetry.findFirst({
            where: { deviceId: 'SIM-001' },
            orderBy: { timestamp: 'desc' }
        });
        console.log('--- SIM-001 LATEST RECORD ---');
        console.log(JSON.stringify(data, (key, value) => {
            return typeof value === 'bigint' ? value.toString() : value;
        }, 2));
    } catch (err) {
        console.error('Database Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
