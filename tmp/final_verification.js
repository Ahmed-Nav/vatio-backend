const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function test() {
    try {
        const deviceId = "SIM-001";
        // This query mimics EXACTLY what the backend standard now is: 
        // 1. Groups by day in UTC
        // 2. Starts from the beginning of the first day in the range (date_trunc('day'))
        const sql = `
            SELECT 
                date_trunc('day', "timestamp" AT TIME ZONE 'UTC') as ts,
                MAX(impkwh) - MIN(impkwh) as consumption
            FROM "Telemetry"
            WHERE "deviceId" = $1 
              AND "timestamp" >= date_trunc('day', CAST('2026-03-31 16:20:00' as timestamp) - INTERVAL '30 days')
            GROUP BY 1
            ORDER BY 1 ASC
            LIMIT 5
        `;
        const results = await prisma.$queryRawUnsafe(sql, deviceId);
        console.log("Verified Daily consumption (UTC Aligned):");
        results.forEach(r => {
            console.log(`${new Date(r.ts).toISOString().split('T')[0]}: ${Number(r.consumption).toFixed(3)} KWh`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
