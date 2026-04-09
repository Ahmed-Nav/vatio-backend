import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEVICE_ID = 'SIM-001';
const START_DATE = new Date('2026-03-01T00:00:00Z');
const END_DATE = new Date('2026-03-31T23:59:59Z');
const STEP_SEC = 5;

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function seedFullSpectrum() {
  console.log(`🚀 Resuming March Full-Spectrum Seeder for ${DEVICE_ID}...`);
  
  // 1. Find resume point
  const lastTele = await prisma.telemetry.findFirst({
      where: { deviceId: DEVICE_ID, timestamp: { gte: START_DATE, lte: END_DATE } },
      orderBy: { timestamp: 'desc' }
  });

  let currentTs = lastTele ? new Date(lastTele.timestamp.getTime() + STEP_SEC * 1000) : new Date(START_DATE);
  console.log(`📅 Starting from: ${currentTs.toISOString()}`);

  let totalRawInserted = 0;
  // Cumulative totals (approximate resume based on start date)
  const elapsedHours = (currentTs.getTime() - START_DATE.getTime()) / 3600000;
  let impKwh = 12500.50 + (elapsedHours * 1.5); 
  let expKwh = 2400.20 + (elapsedHours * 0.1);

  while (currentTs < END_DATE) {
    const chunkBatch: any[] = [];
    const hourStart = new Date(currentTs);
    
    // Industrial Aggregates for the hour
    let sV = 0, sI = 0, sP = 0, sPF = 0, sF = 0;
    let sV1=0, sV2=0, sV3=0, sI1=0, sI2=0, sI3=0, sP1=0, sP2=0, sP3=0;
    let minV = 1000, maxV = 0, minI = 1000, maxI = 0, minP = 1000000, maxP = 0;
    const startHourKwh = impKwh;
    const startHourExp = expKwh;

    // Generate 1 hour of 5s data (720 records)
    for (let i = 0; i < 720; i++) {
        if (currentTs > END_DATE) break;

        const hour = currentTs.getUTCHours();
        const isDay = hour >= 6 && hour <= 18;
        
        // Physics logic
        const v1 = 230 + (Math.random() * 4 - 2);
        const v2 = v1 - 1.5;
        const v3 = v1 + 1.2;
        const vAvg = (v1 + v2 + v3) / 3;
        const vLL = vAvg * 1.732;

        const pW = ((isDay ? 5.5 : 1.2) + Math.random() * 0.5) * 1000;
        const pf = 0.94 + (Math.random() * 0.05);
        const sVA = pW / pf;
        const qVAR = Math.sqrt(Math.max(0, Math.pow(sVA, 2) - Math.pow(pW, 2)));
        
        const iAvg = sVA / (vAvg * 3);
        const i1 = iAvg * (0.98 + Math.random() * 0.04);
        const i2 = iAvg * (0.98 + Math.random() * 0.04);
        const i3 = iAvg * (0.98 + Math.random() * 0.04);
        const f = 49.9 + (Math.random() * 0.2);

        impKwh += (pW * (STEP_SEC / 3600)) / 1000;
        if (isDay && Math.random() > 0.8) expKwh += (Math.random() * 0.05 * (STEP_SEC / 3600)) / 1000;

        chunkBatch.push({
            deviceId: DEVICE_ID, timestamp: new Date(currentTs),
            voltage: v1, voltage2: v2, voltage3: v3, vAvgLN: vAvg,
            vL12: vLL, vL23: vLL, vL31: vLL, vAvgLL: vLL,
            current: i1, current2: i2, current3: i3, iAvg: (i1+i2+i3)/3,
            power: pW, power1: pW/3, power2: pW/3, power3: pW/3,
            kva: sVA, kva1: sVA/3, kva2: sVA/3, kva3: sVA/3,
            kvar: qVAR, kvar1: qVAR/3, kvar2: qVAR/3, kvar3: qVAR/3,
            pf1: pf, pf2: pf, pf3: pf, pfAvg: pf,
            energyExport: expKwh, impkwh: impKwh,
            energyNet: impKwh - expKwh, energyTotal: impKwh + expKwh,
            localTime: currentTs.toLocaleTimeString(), frequency: f,
            vthdL1: 2.5 + Math.random(), vthdL2: 2.5 + Math.random(), vthdL3: 2.5 + Math.random(),
            ithdL1: 3.5 + Math.random(), ithdL2: 3.5 + Math.random(), ithdL3: 3.5 + Math.random(),
            temp: 38 + Math.random() * 5, status: 1
        });

        // Sum for aggregate
        sV += vAvg; sI += iAvg; sP += pW; sPF += pf; sF += f;
        sV1 += v1; sV2 += v2; sV3 += v3; sI1 += i1; sI2 += i2; sI3 += i3;
        sP1 += pW/3; sP2 += pW/3; sP3 += pW/3;
        minV = Math.min(minV, vAvg); maxV = Math.max(maxV, vAvg);
        minI = Math.min(minI, iAvg); maxI = Math.max(maxI, iAvg);
        minP = Math.min(minP, pW); maxP = Math.max(maxP, pW);

        currentTs = new Date(currentTs.getTime() + STEP_SEC * 1000);
    }

    if (chunkBatch.length > 0) {
        let retries = 5;
        while (retries > 0) {
            try {
                await (prisma.telemetry as any).createMany({ data: chunkBatch });
                
                const hTs = new Date(hourStart);
                hTs.setUTCMinutes(0,0,0);
                const cnt = chunkBatch.length;
                await (prisma.hourlyDeviceStats as any).upsert({
                    where: { deviceId_timestamp: { deviceId: DEVICE_ID, timestamp: hTs } },
                    update: {},
                    create: {
                        deviceId: DEVICE_ID, timestamp: hTs, count: cnt,
                        avgVoltage: sV/cnt, avgCurrent: sI/cnt, avgPower: sP/cnt, avgPF: sPF/cnt, avgFreq: sF/cnt,
                        avgV1: sV1/cnt, avgV2: sV2/cnt, avgV3: sV3/cnt,
                        avgI1: sI1/cnt, avgI2: sI2/cnt, avgI3: sI3/cnt,
                        avgP1: sP1/cnt, avgP2: sP2/cnt, avgP3: sP3/cnt,
                        minVoltage: minV, maxVoltage: maxV, minCurrent: minI, maxCurrent: maxI, minPower: minP, maxPower: maxP,
                        energyImport: impKwh - startHourKwh, energyExport: expKwh - startHourExp
                    }
                });
                break;
            } catch (err) {
                console.warn(`⚠️ Connection lost, retrying... (${retries} left): ${err.message}`);
                retries--;
                await delay(2000);
                if (retries === 0) throw err;
            }
        }
        totalRawInserted += chunkBatch.length;
    }

    // Daily closure
    if (hourStart.getUTCHours() === 23) {
        const dTs = new Date(hourStart); dTs.setUTCHours(0,0,0,0);
        const st: any = await (prisma.hourlyDeviceStats as any).aggregate({
            where: { deviceId: DEVICE_ID, timestamp: { gte: dTs, lt: new Date(dTs.getTime() + 24*3600*1000) } },
            _avg: { avgVoltage: true, avgCurrent: true, avgPower: true },
            _sum: { energyImport: true, energyExport: true }
        });
        await (prisma.dailyDeviceStats as any).upsert({
            where: { deviceId_timestamp: { deviceId: DEVICE_ID, timestamp: dTs } },
            update: {},
            create: {
                deviceId: DEVICE_ID, timestamp: dTs, avgVoltage: st._avg.avgVoltage, avgCurrent: st._avg.avgCurrent,
                avgPower: st._avg.avgPower, energyImport: st._sum.energyImport, energyExport: st._sum.energyExport, count: 1
            }
        });
        console.log(`📅 Day Pushed: ${dTs.toISOString().split('T')[0]} | Rows: ${totalRawInserted}`);
        await delay(500);
    }
  }

  console.log(`✅ MISSION SUCCESS! Full March Simulation Populated.`);
}

seedFullSpectrum()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
