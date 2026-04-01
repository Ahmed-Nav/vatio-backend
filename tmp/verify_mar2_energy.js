const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function test() {
    try {
        const deviceId = "SIM-001";
        // March 2nd full day
        const dayStart = "2026-03-02T00:00:00Z";
        const dayEnd = "2026-03-02T23:59:59Z";
        
        const sql = `
            SELECT 
                MIN(impkwh) as min_val,
                MAX(impkwh) as max_val,
                MAX(impkwh) - MIN(impkwh) as delta
            FROM "Telemetry"
            WHERE "deviceId" = $1
              AND "timestamp" BETWEEN $2::timestamp AND $3::timestamp
        `;
        const result = await prisma.$queryRawUnsafe(sql, deviceId, dayStart, dayEnd);
        console.log("Full Day Mar 2nd:", JSON.stringify(result, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
