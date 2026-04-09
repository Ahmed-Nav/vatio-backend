import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEVICE_ID = 'SIM-001';
const START_DATE = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); 
const END_DATE = new Date();
const CHUNK_SIZE_MIN = 15; // Smaller chunks for Neon performance

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function seedYearlyData() {
  console.log(`🚀 Resuming Industrial Seeder for ${DEVICE_ID}...`);
  
  // 1. Find where we left off
  const lastRecord = await prisma.telemetry.findFirst({
      where: { deviceId: DEVICE_ID },
      orderBy: { timestamp: 'desc' }
  });

  let currentTs = lastRecord ? new Date(lastRecord.timestamp.getTime() + 1000) : new Date(START_DATE);
  console.log(`📅 Starting from: ${currentTs.toISOString()}`);
  console.log(`🏁 Target: ${END_DATE.toISOString()}`);

  let totalRawInserted = 0;
  let currentDayStart = new Date(currentTs);
  currentDayStart.setHours(0,0,0,0);

  // Track cumulative energy (approximate based on start date)
  let cumulativeImportKwh = 12500.50 + ((currentTs.getTime() - START_DATE.getTime()) / 3600000) * 1.5; 
  let cumulativeExportKwh = 2400.20 + ((currentTs.getTime() - START_DATE.getTime()) / 3600000) * 0.2;

  while (currentTs < END_DATE) {
    const chunkEndTime = new Date(currentTs.getTime() + CHUNK_SIZE_MIN * 60 * 1000);
    const batch: any[] = [];
    
    let sumV = 0, sumI = 0, sumP = 0, sumPF = 0, sumFreq = 0;
    let sumV1 = 0, sumV2 = 0, sumV3 = 0, sumI1 = 0, sumI2 = 0, sumI3 = 0;
    let sumP1 = 0, sumP2 = 0, sumP3 = 0;
    let minV = 1000, maxV = 0, minI = 1000, maxI = 0, minP = 100000, maxP = 0;
    let startKwh = cumulativeImportKwh, startExp = cumulativeExportKwh;

    // Generate Chunks (900 records)
    for (let i = 0; i < CHUNK_SIZE_MIN * 60; i++) {
        const recordTs = new Date(currentTs.getTime() + i * 1000);
        if (recordTs >= END_DATE) break;

        const hour = recordTs.getHours();
        const baseV = 230 + (Math.random() * 4 - 2); 
        const isDay = hour >= 6 && hour <= 18;
        const pW = ( (isDay ? 5.5 : 1.2) + Math.random() * 0.5) * 1000;
        const amp = pW / (baseV * 0.98); 
        const pf = 0.95 + (Math.random() * 0.04);
        const f = 49.9 + (Math.random() * 0.2);

        cumulativeImportKwh += (pW / 3600) / 1000;
        if (isDay && Math.random() > 0.5) cumulativeExportKwh += (Math.random() * 0.1) / 3600;

        batch.push({
            deviceId: DEVICE_ID, timestamp: recordTs, voltage: baseV, voltage2: baseV-1.5, voltage3: baseV+1.2, vAvgLN: baseV,
            current: amp, current2: amp*0.95, current3: amp*1.05, iAvg: amp, power: pW, power1: pW/3, power2: pW/3.1, power3: pW/2.9,
            pfAvg: pf, frequency: f, impkwh: cumulativeImportKwh, energyExport: cumulativeExportKwh,
        });

        sumV += baseV; sumI += amp; sumP += pW; sumPF += pf; sumFreq += f;
        sumV1 += baseV; sumV2 += (baseV-1.5); sumV3 += (baseV+1.2);
        sumI1 += amp; sumI2 += (amp*0.95); sumI3 += (amp*1.05);
        sumP1 += pW/3; sumP2 += pW/3.1; sumP3 += pW/2.9;
        minV = Math.min(minV, baseV); maxV = Math.max(maxV, baseV);
        minI = Math.min(minI, amp); maxI = Math.max(maxI, amp);
        minP = Math.min(minP, pW); maxP = Math.max(maxP, pW);
    }

    if (batch.length > 0) {
        let retries = 5;
        while (retries > 0) {
            try {
                await (prisma.telemetry as any).createMany({ data: batch });
                break;
            } catch (err) {
                console.warn(`⚠️ Batch failed, retrying... (${retries} left): ${err.message}`);
                retries--;
                await delay(2000);
                if (retries === 0) throw err;
            }
        }
        totalRawInserted += batch.length;
    }

    // Every 1 hour, update Hourly Summaries
    if (chunkEndTime.getMinutes() === 0 || chunkEndTime >= END_DATE) {
        const hourTs = new Date(currentTs);
        hourTs.setMinutes(0,0,0);
        await (prisma.hourlyDeviceStats as any).upsert({
            where: { deviceId_timestamp: { deviceId: DEVICE_ID, timestamp: hourTs } },
            update: {},
            create: {
                deviceId: DEVICE_ID, timestamp: hourTs, count: 3600,
                avgVoltage: sumV / 3600 || 230, avgCurrent: sumI / 3600 || 5, avgPower: sumP / 3600 || 1200,
                avgPF: sumPF / 3600 || 0.98, avgFreq: sumFreq / 3600 || 50,
                avgV1: sumV1/3600, avgV2: sumV2/3600, avgV3: sumV3/3600,
                avgI1: sumI1/3600, avgI2: sumI2/3600, avgI3: sumI3/3600,
                avgP1: sumP1/3600, avgP2: sumP2/3600, avgP3: sumP3/3600,
                minVoltage: minV, maxVoltage: maxV, minCurrent: minI, maxCurrent: maxI, minPower: minP, maxPower: maxP,
                energyImport: cumulativeImportKwh - startKwh, energyExport: cumulativeExportKwh - startExp
            }
        });
        console.log(`🕒 Hour aggregated: ${hourTs.toISOString()}`);
        await delay(100);
    }

    // Every 24 hours, update Daily Summaries
    if (chunkEndTime.getUTCHours() === 0 && chunkEndTime.getUTCMinutes() === 0) {
        const dayTs = new Date(currentTs);
        dayTs.setUTCHours(0,0,0,0);
        const stats: any = await (prisma.hourlyDeviceStats as any).aggregate({
            where: { deviceId: DEVICE_ID, timestamp: { gte: dayTs, lt: new Date(dayTs.getTime() + 24*3600*1000) } },
            _avg: { avgVoltage: true, avgCurrent: true, avgPower: true },
            _sum: { energyImport: true, energyExport: true }
        });
        await (prisma.dailyDeviceStats as any).upsert({
            where: { deviceId_timestamp: { deviceId: DEVICE_ID, timestamp: dayTs } },
            update: {},
            create: {
                deviceId: DEVICE_ID, timestamp: dayTs, avgVoltage: stats._avg.avgVoltage,
                avgCurrent: stats._avg.avgCurrent, avgPower: stats._avg.avgPower,
                energyImport: stats._sum.energyImport, energyExport: stats._sum.energyExport, count: 1
            }
        });
        console.log(`📅 Day aggregated: ${dayTs.toISOString()} | Total Rows: ${totalRawInserted}`);
        await delay(1000); // 1s rest every day
    }

    currentTs = chunkEndTime;
  }

  console.log(`✅ Seeding complete!`);
}

seedYearlyData()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
