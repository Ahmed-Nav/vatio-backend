const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function test() {
    try {
        const deviceId = "SIM-001";
        const sql = `
            SELECT 
                date_trunc('day', "timestamp") as ts,
                MAX(impkwh) - MIN(impkwh) as consumption
            FROM "Telemetry"
            WHERE "deviceId" = $1 
              AND "timestamp" >= date_trunc('day', CAST('2026-03-31T15:59:01Z' as timestamp) - INTERVAL '30 days')
            GROUP BY 1
            ORDER BY 1 ASC
        `;
        const results = await prisma.$queryRawUnsafe(sql, deviceId);
        console.log("Calendar Aligned Results (first day):", JSON.stringify(results[0], null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
