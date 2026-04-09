import * as fs from 'fs';
import * as path from 'path';

const DEVICE_ID = 'SIM-001';
const START_DATE = new Date('2026-03-01T00:00:00Z');
const TEST_END_DATE = new Date('2026-03-02T00:00:00Z'); // 24-hour audit window
const STEP_SECONDS = 5; 
const FILE_PATH = path.join(process.cwd(), 'March_Full_Spectrum_Audit.csv');

async function generateAuditCSV() {
  console.log(`🧪 Generating 24-Hour Full-Spectrum Audit CSV...`);
  
  const stream = fs.createWriteStream(FILE_PATH);
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

  let currentTs = new Date(START_DATE);
  let impKwh = 12500.50;
  let expKwh = 2400.20;

  while (currentTs < TEST_END_DATE) {
    const hour = currentTs.getUTCHours();
    const isDay = hour >= 6 && hour <= 18;
    
    // Core (Voltage/Current)
    const v1 = 230 + (Math.random() * 4 - 2);
    const v2 = v1 - 1.5;
    const v3 = v1 + 1.2;
    const vAvgLN = (v1 + v2 + v3) / 3;
    const vLL = vAvgLN * 1.732; // Line-to-Line approx

    const pW = ((isDay ? 5.5 : 1.2) + Math.random() * 0.5) * 1000;
    const pfAvg = 0.94 + (Math.random() * 0.05);
    const sVA = pW / pfAvg; // Apparent Power
    const qVAR = Math.sqrt(Math.pow(sVA, 2) - Math.pow(pW, 2)); // Reactive Power
    
    const iTot = sVA / (vAvgLN * 3); // Approx Total Current
    const i1 = iTot * (0.98 + Math.random() * 0.04);
    const i2 = iTot * (0.98 + Math.random() * 0.04);
    const i3 = iTot * (0.98 + Math.random() * 0.04);

    impKwh += (pW * (STEP_SECONDS / 3600)) / 1000;
    if (isDay && Math.random() > 0.8) expKwh += (Math.random() * 0.05 * (STEP_SECONDS / 3600)) / 1000;

    const row = [
        currentTs.toISOString(), DEVICE_ID, v1.toFixed(2), v2.toFixed(2), v3.toFixed(2), vAvgLN.toFixed(2),
        vLL.toFixed(2), vLL.toFixed(2), vLL.toFixed(2), vLL.toFixed(2), 
        i1.toFixed(3), i2.toFixed(3), i3.toFixed(3), ((i1+i2+i3)/3).toFixed(3),
        pW.toFixed(2), (pW/3).toFixed(2), (pW/3).toFixed(2), (pW/3).toFixed(2),
        sVA.toFixed(2), (sVA/3).toFixed(2), (sVA/3).toFixed(2), (sVA/3).toFixed(2),
        qVAR.toFixed(2), (qVAR/3).toFixed(2), (qVAR/3).toFixed(2), (qVAR/3).toFixed(2),
        pfAvg.toFixed(3), pfAvg.toFixed(3), pfAvg.toFixed(3), pfAvg.toFixed(3),
        expKwh.toFixed(4), impKwh.toFixed(4), currentTs.toLocaleTimeString(),
        (impKwh - expKwh).toFixed(4), (impKwh + expKwh).toFixed(4), (impKwh * 1.05).toFixed(4),
        (qVAR / 1000).toFixed(4), (qVAR / 2000).toFixed(4),
        (49.9 + Math.random() * 0.2).toFixed(2),
        (2.1 + Math.random() * 1.2).toFixed(1), (2.1 + Math.random() * 1.2).toFixed(1), (2.1 + Math.random() * 1.2).toFixed(1),
        (3.5 + Math.random() * 1.5).toFixed(1), (3.5 + Math.random() * 1.5).toFixed(1), (3.5 + Math.random() * 1.5).toFixed(1),
        (38 + Math.random() * 5).toFixed(1), 1
    ];

    stream.write(row.join(',') + '\n');
    currentTs = new Date(currentTs.getTime() + STEP_SECONDS * 1000);
  }

  stream.end();
  console.log(`🚀 Audit CSV generated! Open this file to verify the values: ${FILE_PATH}`);
}

generateAuditCSV()
  .catch(console.error);
