const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function test() {
    try {
        const deviceId = "SIM-001";
        // Find first and last records of March 2nd
        const sql = `
            SELECT "timestamp", impkwh 
            FROM "Telemetry" 
            WHERE "deviceId" = $1 
              AND "timestamp" BETWEEN '2026-03-02 00:00:00' AND '2026-03-02 23:59:59'
            ORDER BY "timestamp" ASC 
            LIMIT 1
        `;
        const first = await prisma.$queryRawUnsafe(sql, deviceId);
        
        const sql2 = `
            SELECT "timestamp", impkwh 
            FROM "Telemetry" 
            WHERE "deviceId" = $1 
              AND "timestamp" BETWEEN '2026-03-02 00:00:00' AND '2026-03-02 23:59:59'
            ORDER BY "timestamp" DESC 
            LIMIT 1
        `;
        const last = await prisma.$queryRawUnsafe(sql2, deviceId);

        console.log("First record Mar 2nd:", JSON.stringify(first, null, 2));
        console.log("Last record Mar 2nd:", JSON.stringify(last, null, 2));

        if (first.length && last.length) {
            console.log("Difference:", Number(last[0].impkwh) - Number(first[0].impkwh));
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
