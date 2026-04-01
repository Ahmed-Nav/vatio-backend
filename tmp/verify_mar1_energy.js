const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function test() {
    try {
        const deviceId = "SIM-001";
        // March 1st full day
        const dayStart = "2026-03-01T00:00:00Z";
        const dayEnd = "2026-03-01T23:59:59Z";
        
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
        console.log("Full Day Mar 1st:", JSON.stringify(result, null, 2));

        // Window starting at 3:59 PM (as in screenshot)
        const winStart = "2026-03-01T15:59:19Z";
        const resultWin = await prisma.$queryRawUnsafe(sql, deviceId, winStart, dayEnd);
        console.log("Partial Window Mar 1st (from 3:59 PM):", JSON.stringify(resultWin, null, 2));

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
