import * as fs from 'fs';
import * as path from 'path';

/**
 * 30-Day Simulation Data CSV Generator
 * Generates realistic 3-phase telemetry data for testing.
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const DEVICE_ID = 'SIM-001';
const INTERVAL_SEC = 5;
const DAYS = 30;
const OUTPUT_FILE = path.join(__dirname, 'simulation_data_30d.csv');

const AC_CFG = {
  startProb: 0.04,
  minHoldTicks: 24,
  maxHoldTicks: 120,
  runCurrentA: { min: 8, max: 20 },
  inrushMultiplier: { min: 3, max: 5 },
  inrushTicks: { min: 1, max: 2 },
  pfRun: 0.88,
  pfInrush: 0.70,
  vDipV: 1.8,
};

// ─── Math Helpers ────────────────────────────────────────────────────────────
function gauss(std: number) {
  const u1 = Math.random(), u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2) * std;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const drift = (base: number, std: number, lo: number, hi: number) => clamp(base + gauss(std), lo, hi);
const randInt = (lo: number, hi: number) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const randF = (lo: number, hi: number) => Math.random() * (hi - lo) + lo;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const r3 = (v: number) => parseFloat(v.toFixed(3));
const r2 = (v: number) => parseFloat(v.toFixed(2));

function loadMultiplier(date: Date) {
  const h = date.getHours();
  // Simplified time-of-day model: peaks at 9 AM and 7 PM, dip at 2 AM
  const m = Math.exp(-0.5 * Math.pow((h - 9) / 1.8, 2));
  const e = Math.exp(-0.5 * Math.pow((h - 19) / 2.0, 2));
  const nv = Math.exp(-0.5 * Math.pow((h - 2) / 1.5, 2));
  return clamp(0.25 + 0.45 * m + 0.65 * e - 0.10 * nv, 0.20, 1.00);
}

// ─── Simulation State ────────────────────────────────────────────────────────
class SimState {
  tick = 0;
  base = {
    V_L1N: 214.46,
    V_L2N: 218.51,
    V_L3N: 210.38,
    I_L1: 2.227,
    I_L2: 1.466,
    I_L3: 4.073,
    dpfL1: 0.92,
    dpfL2: 0.88,
    dpfL3: 0.95,
  };

  energy = {
    import_kWh: 5000,
    export_kWh: 45629.189,
    total_kVAh: 5000 * 1.12,
    import_kVArh: 5000 * 0.15,
    export_kVArh: 20987.800,
  };

  ac = {
    active: false,
    phase: null as string | null,
    runCurrentA: 0,
    inrushCurrentA: 0,
    inrushTicksLeft: 0,
    holdTicksLeft: 0,
    isInrush: false,
  };

  stepAcEvent() {
    const ac = this.ac;
    if (ac.active) {
      if (ac.isInrush) {
        ac.inrushTicksLeft--;
        if (ac.inrushTicksLeft <= 0) ac.isInrush = false;
      } else {
        ac.holdTicksLeft--;
        if (ac.holdTicksLeft <= 0) {
          ac.active = false;
          ac.phase = null;
        }
      }
    } else if (Math.random() < AC_CFG.startProb) {
      ac.active = true;
      ac.phase = pick(['L1', 'L2', 'L3']);
      ac.runCurrentA = randF(AC_CFG.runCurrentA.min, AC_CFG.runCurrentA.max);
      ac.inrushCurrentA = ac.runCurrentA * randF(AC_CFG.inrushMultiplier.min, AC_CFG.inrushMultiplier.max);
      ac.inrushTicksLeft = randInt(AC_CFG.inrushTicks.min, AC_CFG.inrushTicks.max);
      ac.holdTicksLeft = randInt(AC_CFG.minHoldTicks, AC_CFG.maxHoldTicks);
      ac.isInrush = true;
    }
  }

  generateRecord(timestamp: Date) {
    this.tick++;
    this.stepAcEvent();

    const lm = loadMultiplier(timestamp);
    const dtH = INTERVAL_SEC / 3600;
    const ac = this.ac;

    const V_L1N = drift(this.base.V_L1N - (ac.phase === 'L1' ? AC_CFG.vDipV : 0), 0.30, 200, 242);
    const V_L2N = drift(this.base.V_L2N - (ac.phase === 'L2' ? AC_CFG.vDipV : 0), 0.30, 200, 242);
    const V_L3N = drift(this.base.V_L3N - (ac.phase === 'L3' ? AC_CFG.vDipV : 0), 0.30, 200, 242);

    const extraI = (ph: string) => (ac.active && ac.phase === ph) ? (ac.isInrush ? ac.inrushCurrentA : ac.runCurrentA) : 0;
    const pfO = (ph: string) => (ac.active && ac.phase === ph) ? (ac.isInrush ? AC_CFG.pfInrush : AC_CFG.pfRun) : null;

    const I_L1 = clamp(this.base.I_L1 * lm + extraI('L1') + gauss(0.08), 0.05, 50);
    const I_L2 = clamp(this.base.I_L2 * lm + extraI('L2') + gauss(0.06), 0.05, 50);
    const I_L3 = clamp(this.base.I_L3 * lm + extraI('L3') + gauss(0.12), 0.05, 50);

    const kVA_L1 = (V_L1N * I_L1) / 1000;
    const kVA_L2 = (V_L2N * I_L2) / 1000;
    const kVA_L3 = (V_L3N * I_L3) / 1000;
    const Total_kVA = kVA_L1 + kVA_L2 + kVA_L3;

    const dpf1 = pfO('L1') || drift(this.base.dpfL1, 0.008, 0.82, 1.00);
    const dpf2 = pfO('L2') || drift(this.base.dpfL2, 0.008, 0.78, 1.00);
    const dpf3 = pfO('L3') || drift(this.base.dpfL3, 0.008, 0.85, 1.00);

    const kW_L1 = kVA_L1 * dpf1;
    const kW_L2 = kVA_L2 * dpf2;
    const kW_L3 = kVA_L3 * dpf3;
    const Total_kW = kW_L1 + kW_L2 + kW_L3;

    this.energy.import_kWh += Total_kW * dtH;
    this.energy.total_kVAh += Total_kVA * dtH;
    const Total_kVAr = Math.sqrt(Math.max(0, Math.pow(Total_kVA, 2) - Math.pow(Total_kW, 2)));
    this.energy.import_kVArh += Total_kVAr * dtH;

    return {
      deviceId: DEVICE_ID,
      timestamp: timestamp.toISOString(),
      voltage: r2(V_L1N),
      voltage2: r2(V_L2N),
      voltage3: r2(V_L3N),
      vAvgLN: r2((V_L1N + V_L2N + V_L3N) / 3),
      vL12: r2(V_L1N * 1.732),
      vL23: r2(V_L2N * 1.732),
      vL31: r2(V_L3N * 1.732),
      vAvgLL: r2(((V_L1N + V_L2N + V_L3N) / 3) * 1.732),
      current: r3(I_L1),
      current2: r3(I_L2),
      current3: r3(I_L3),
      iAvg: r3((I_L1 + I_L2 + I_L3) / 3),
      power: r3(Total_kW),
      power1: r3(kW_L1),
      power2: r3(kW_L2),
      power3: r3(kW_L3),
      kva: r3(Total_kVA),
      kva1: r3(kVA_L1),
      kva2: r3(kVA_L2),
      kva3: r3(kVA_L3),
      kvar: r3(Total_kVAr),
      kvar1: r3(Math.sqrt(Math.max(0, kVA_L1 ** 2 - kW_L1 ** 2))),
      kvar2: r3(Math.sqrt(Math.max(0, kVA_L2 ** 2 - kW_L2 ** 2))),
      kvar3: r3(Math.sqrt(Math.max(0, kVA_L3 ** 2 - kW_L3 ** 2))),
      pf1: r3(dpf1),
      pf2: r3(dpf2),
      pf3: r3(dpf3),
      pfAvg: r3(Total_kVA > 0 ? Total_kW / Total_kVA : 1.0),
      energyExport: r3(this.energy.export_kWh),
      impkwh: r3(this.energy.import_kWh),
      energyNet: r3(this.energy.import_kWh - this.energy.export_kWh),
      energyTotal: r3(this.energy.import_kWh + this.energy.export_kWh),
      energyKVAh: r3(this.energy.total_kVAh),
      energyImpKVArh: r3(this.energy.import_kVArh),
      energyExpKVArh: r3(this.energy.export_kVArh),
      frequency: r3(drift(50.00, 0.015, 49.85, 50.15)),
      vthdL1: r2(drift(1.0, 0.05, 0.5, 3.0)),
      vthdL2: r2(drift(2.5, 0.1, 1.0, 5.0)),
      vthdL3: r2(drift(2.4, 0.1, 1.0, 5.0)),
      ithdL1: r2(drift(2.4, 0.2, 1.0, 10.0)),
      ithdL2: r2(drift(21.7, 0.5, 15.0, 30.0)),
      ithdL3: r2(drift(3.5, 0.2, 1.0, 10.0)),
      temp: r2(drift(35, 0.5, 30, 45)),
      status: 1
    };
  }
}

// ─── Main Logic ─────────────────────────────────────────────────────────────
async function main() {
  const sim = new SimState();
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - DAYS);
  
  const endTime = new Date();
  const totalSteps = (endTime.getTime() - startTime.getTime()) / (INTERVAL_SEC * 1000);

  console.log(`Generating simulation data...`);
  console.log(`Start: ${startTime.toISOString()}`);
  console.log(`End  : ${endTime.toISOString()}`);
  console.log(`Steps: ${Math.floor(totalSteps)}`);

  const writeStream = fs.createWriteStream(OUTPUT_FILE);
  
  // Get headers from first record
  const dummyRecord = sim.generateRecord(startTime);
  const headers = Object.keys(dummyRecord).join(',');
  writeStream.write(headers + '\n');

  let currentStep = 0;
  let currentTime = startTime.getTime();

  while (currentTime <= endTime.getTime()) {
    const record = sim.generateRecord(new Date(currentTime));
    const line = Object.values(record).join(',');
    writeStream.write(line + '\n');

    currentTime += INTERVAL_SEC * 1000;
    currentStep++;

    if (currentStep % 10000 === 0) {
      const progress = ((currentStep / totalSteps) * 100).toFixed(2);
      process.stdout.write(`\rProgress: ${progress}% (${currentStep}/${Math.floor(totalSteps)})`);
    }
  }

  writeStream.end();
  console.log(`\n\nSimulation CSV generated successfully: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Error generating simulation CSV:', err);
  process.exit(1);
});
