import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const DEVICE_ID = 'SIM-001';
const FILE_PATH = path.join(process.cwd(), 'March_Telemetry_SIM-001.csv');

async function exportCSV() {
  console.log(`📤 Exporting ${DEVICE_ID} data to CSV...`);
  
  const stream = fs.createWriteStream(FILE_PATH);
  
  // Headers
  stream.write('Timestamp,Voltage_V1,Voltage_V2,Voltage_V3,Current_L1,Power_Total_W,Power_L1,Power_L2,Power_L3,PF_Avg,Freq,Energy_Import_kWh,Energy_Export_kWh\n');

  let skip = 0;
  const take = 50000; // Batch size for export speed
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
        row.voltage || 0,
        row.voltage2 || 0,
        row.voltage3 || 0,
        row.current || 0,
        row.power || 0,
        row.power1 || 0,
        row.power2 || 0,
        row.power3 || 0,
        row.pfAvg || 0,
        row.frequency || 0,
        row.impkwh || 0,
        row.energyExport || 0
      ].join(',');
      stream.write(line + '\n');
    });

    totalSaved += batch.length;
    console.log(`✅ Exported ${totalSaved} rows...`);
    skip += take;
  }

  stream.end();
  console.log(`🚀 Export complete! File saved to: ${FILE_PATH}`);
}

exportCSV()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
