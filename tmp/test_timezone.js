const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function test() {
    try {
        const deviceId = "SIM-001";
        // User is in +05:30
        // March 2nd local day starts at March 1st 18:30 UTC
        const start = "2026-03-01T18:30:00Z";
        const end = "2026-03-02T18:30:00Z";
        
        const sql = `
            SELECT 
                MAX(impkwh) - MIN(impkwh) as delta
            FROM "Telemetry"
            WHERE "deviceId" = $1
              AND "timestamp" BETWEEN $2::timestamp AND $3::timestamp
        `;
        const result = await prisma.$queryRawUnsafe(sql, deviceId, start, end);
        console.log("March 2nd (+05:30 Alignment) Delta:", JSON.stringify(result, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
