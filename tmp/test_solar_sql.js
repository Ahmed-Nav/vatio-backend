const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function test() {
    try {
        const deviceId = "SIM-001";
        const sql = `
            WITH hourly_deltas AS (
                SELECT 
                    date_trunc('hour', "timestamp") as bucket_ts,
                    EXTRACT(hour from "timestamp") as hour_of_day,
                    MAX(impkwh) - MIN(impkwh) as consumption,
                    MAX("energyExport") - MIN("energyExport") as solar
                FROM "Telemetry"
                WHERE "deviceId" = $1 
                  AND "timestamp" >= NOW() - INTERVAL '30 days'
                GROUP BY 1, 2
            )
            SELECT 
                hour_of_day::int as hour,
                AVG(consumption) as avg_consumption,
                AVG(solar) as avg_solar
            FROM hourly_deltas
            GROUP BY 1
            ORDER BY 1 ASC
        `;
        const results = await prisma.$queryRawUnsafe(sql, deviceId);
        console.log("SQL Results (first 5):", JSON.stringify(results.slice(0, 5), null, 2));
        
        // Test mapping like the service
        const mapped = results.slice(0,2).map(r => ({
            hour: r.hour,
            consumption: Number(r.avg_consumption) || 0,
            solar: Number(r.avg_solar) || 0
        }));
        console.log("Mapped Results (first 2):", JSON.stringify(mapped, null, 2));
        
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
