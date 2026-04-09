import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const DEVICE_ID = 'SIM-001';
const FILE_PATH = path.join(process.cwd(), 'March_Telemetry_SIM-001_FULL.csv');

async function exportFullCSV() {
  console.log(`📤 Exporting FULL PARAMETER LIST for ${DEVICE_ID} to CSV...`);
  
  const stream = fs.createWriteStream(FILE_PATH);
  
  // Entire Schema Headers (Full MQTT Fields)
  const headers = [
    'Timestamp', 'DeviceId', 'Voltage_L1', 'Voltage_L2', 'Voltage_L3', 'VAvg_LN',
    'VL12', 'VL23', 'VL31', 'VAvg_LL', 'Current_L1', 'Current_L2', 'Current_L3', 'IAvg',
    'Power_W', 'Power_L1', 'Power_L2', 'Power_L3', 'KVA', 'KVA1', 'KVA2', 'KVA3',
    'KVAR', 'KVAR1', 'KVAR2', 'KVAR3', 'PF1', 'PF2', 'PF3', 'PFAvg',
    'Energy_Export', 'ImpKWh', 'LocalTime', 'EnergyNet', 'EnergyTotal', 'EnergyKVAh',
    'EnergyImpKVArh', 'EnergyExpKVArh', 'Frequency', 'VTHD_L1', 'VTHD_L2', 'VTHD_L3',
    'ITHD_L1', 'ITHD_L2', 'ITHD_L3', 'Temp', 'Status'
  ];
  
  stream.write(headers.join(',') + '\n');

  let skip = 0;
  const take = 10000; // Efficient batching for full schema
  let totalSaved = 0;

  while (true) {
    const batch = await prisma.telemetry.findMany({
      where: { deviceId: DEVICE_ID },
      orderBy: { timestamp: 'asc' },
      skip,
      take,
    });

    if (batch.length === 0) break;

    batch.forEach(row => {
      const line = [
        row.timestamp.toISOString(),
        row.deviceId,
        row.voltage, row.voltage2, row.voltage3, row.vAvgLN,
        row.vL12, row.vL23, row.vL31, row.vAvgLL,
        row.current, row.current2, row.current3, row.iAvg,
        row.power, row.power1, row.power2, row.power3,
        row.kva, row.kva1, row.kva2, row.kva3,
        row.kvar, row.kvar1, row.kvar2, row.kvar3,
        row.pf1, row.pf2, row.pf3, row.pfAvg,
        row.energyExport, row.impkwh, row.localTime,
        row.energyNet, row.energyTotal, row.energyKVAh,
        row.energyImpKVArh, row.energyExpKVArh,
        row.frequency, row.vthdL1, row.vthdL2, row.vthdL3,
        row.ithdL1, row.ithdL2, row.ithdL3,
        row.temp, row.status
      ].map(v => v === null ? '' : v).join(','); // Handle nulls as empty cells
      
      stream.write(line + '\n');
    });

    totalSaved += batch.length;
    console.log(`✅ Exported ${totalSaved} rows with full parameters...`);
    skip += take;
  }

  stream.end();
  console.log(`🚀 FULL EXPORT COMPLETE! File saved to: ${FILE_PATH}`);
}

exportFullCSV()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
