/**
 * ╔══════════════════════════════════════════════════════════════╗
 *  Multi-Device 3-Phase Energy Meter Simulator (Realistic)
 *  Simulates SIM-001, SIM-002, and SIM-003 with unique loads.
 * ╚══════════════════════════════════════════════════════════════╝
 */

"use strict";
require("dotenv").config();
const mqtt = require("mqtt");

// ─── Runtime config ───────────────────────────────────────────────────────────
const CFG = {
  broker: process.env.MQTT_URL || process.env.MQTT_BROKER || "mqtt://localhost:1883",
  devices: ["SIM-001"],
  intervalMs: parseInt(process.env.PUBLISH_INTERVAL_MS || "5000", 10),
};

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

// ─── Math helpers ─────────────────────────────────────────────────────────────
function gauss(std) {
  const u1 = Math.random(), u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-12)) * Math.cos(2 * Math.PI * u2) * std;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const drift = (base, std, lo, hi) => clamp(base + gauss(std), lo, hi);
const randInt = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const randF = (lo, hi) => Math.random() * (hi - lo) + lo;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const r3 = (v) => parseFloat(v.toFixed(3));
const r2 = (v) => parseFloat(v.toFixed(2));

function loadMultiplier() {
  const h = new Date().getHours();
  const m = Math.exp(-0.5 * Math.pow((h - 9) / 1.8, 2));
  const e = Math.exp(-0.5 * Math.pow((h - 19) / 2.0, 2));
  const nv = Math.exp(-0.5 * Math.pow((h - 2) / 1.5, 2));
  return clamp(0.25 + 0.45 * m + 0.65 * e - 0.10 * nv, 0.20, 1.00);
}

// ─── Device Simulation Class ───────────────────────────────────────────────────
class DeviceSimulator {
  constructor(deviceId, baseSeed) {
    this.deviceId = deviceId;
    this.tick = 0;

    // Unique baseline load for this device
    const initialEnergy = 5000 + (baseSeed * 1000) + Math.random() * 500;
    this.base = {
      V_L1N: 214.46 + baseSeed * 2,
      V_L2N: 218.51 - baseSeed,
      V_L3N: 210.38 + baseSeed,
      I_L1: 2.227 + baseSeed * 0.5,
      I_L2: 1.466 + baseSeed * 0.3,
      I_L3: 4.073 - baseSeed * 0.2,
      dpfL1: 0.92,
      dpfL2: 0.88,
      dpfL3: 0.95,
      Import_kWh: initialEnergy,
      Export_kWh: 45629.189,
      Total_kVAh: initialEnergy * 1.12,
      Import_kVArh: initialEnergy * 0.15,
      Export_kVArh: 20987.800,
    };

    this.state = {
      Import_kWh: this.base.Import_kWh,
      Export_kWh: this.base.Export_kWh,
      Total_kVAh: this.base.Total_kVAh,
      Import_kVArh: this.base.Import_kVArh,
      Export_kVArh: this.base.Export_kVArh,
      ac: { active: false, phase: null, runCurrentA: 0, inrushCurrentA: 0, inrushTicksLeft: 0, holdTicksLeft: 0, isInrush: false },
    };
  }

  stepAcEvent() {
    const ac = this.state.ac;
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
      ac.phase = pick(["L1", "L2", "L3"]);
      ac.runCurrentA = randF(AC_CFG.runCurrentA.min, AC_CFG.runCurrentA.max);
      ac.inrushCurrentA = ac.runCurrentA * randF(AC_CFG.inrushMultiplier.min, AC_CFG.inrushMultiplier.max);
      ac.inrushTicksLeft = randInt(AC_CFG.inrushTicks.min, AC_CFG.inrushTicks.max);
      ac.holdTicksLeft = randInt(AC_CFG.minHoldTicks, AC_CFG.maxHoldTicks);
      ac.isInrush = true;
    }
  }

  buildPayload() {
    this.tick++;
    this.stepAcEvent();

    const lm = loadMultiplier();
    const dtH = CFG.intervalMs / 1000 / 3600;
    const ac = this.state.ac;

    const V_L1N = drift(this.base.V_L1N - (ac.phase === "L1" ? AC_CFG.vDipV : 0), 0.30, 200, 242);
    const V_L2N = drift(this.base.V_L2N - (ac.phase === "L2" ? AC_CFG.vDipV : 0), 0.30, 200, 242);
    const V_L3N = drift(this.base.V_L3N - (ac.phase === "L3" ? AC_CFG.vDipV : 0), 0.30, 200, 242);

    const extraI = ph => (ac.active && ac.phase === ph) ? (ac.isInrush ? ac.inrushCurrentA : ac.runCurrentA) : 0;
    const pfO = ph => (ac.active && ac.phase === ph) ? (ac.isInrush ? AC_CFG.pfInrush : AC_CFG.pfRun) : null;

    const I_L1 = clamp(this.base.I_L1 * lm + extraI("L1") + gauss(0.08), 0.05, 50);
    const I_L2 = clamp(this.base.I_L2 * lm + extraI("L2") + gauss(0.06), 0.05, 50);
    const I_L3 = clamp(this.base.I_L3 * lm + extraI("L3") + gauss(0.12), 0.05, 50);

    const kVA_L1 = (V_L1N * I_L1) / 1000;
    const kVA_L2 = (V_L2N * I_L2) / 1000;
    const kVA_L3 = (V_L3N * I_L3) / 1000;
    const Total_kVA = kVA_L1 + kVA_L2 + kVA_L3;

    const dpf1 = pfO("L1") || drift(this.base.dpfL1, 0.008, 0.82, 1.00);
    const dpf2 = pfO("L2") || drift(this.base.dpfL2, 0.008, 0.78, 1.00);
    const dpf3 = pfO("L3") || drift(this.base.dpfL3, 0.008, 0.85, 1.00);

    const kW_L1 = kVA_L1 * dpf1;
    const kW_L2 = kVA_L2 * dpf2;
    const kW_L3 = kVA_L3 * dpf3;
    const Total_kW = kW_L1 + kW_L2 + kW_L3;

    this.state.Import_kWh += Total_kW * dtH;
    this.state.Total_kVAh += Total_kVA * dtH;
    const Total_kVAr = Math.sqrt(Math.max(0, Total_kVA ** 2 - Total_kW ** 2));
    this.state.Import_kVArh += Total_kVAr * dtH;

    return {
      deviceId: this.deviceId,
      timestamp: new Date().toISOString(),
      Import_kWh: r3(this.state.Import_kWh),
      Export_kWh: r3(this.state.Export_kWh),
      Net_kWh: r3(this.state.Import_kWh - this.state.Export_kWh),
      Total_kWh: r3(this.state.Import_kWh + this.state.Export_kWh),
      Total_kVAh: r3(this.state.Total_kVAh),
      Import_kVArh: r3(this.state.Import_kVArh),
      Export_kVArh: r3(this.state.Export_kVArh),
      V_L1N: r2(V_L1N),
      V_L2N: r2(V_L2N),
      V_L3N: r2(V_L3N),
      V_Avg_LN: r2((V_L1N + V_L2N + V_L3N) / 3),
      V_L12: r2(V_L1N * 1.732),
      V_L23: r2(V_L2N * 1.732),
      V_L31: r2(V_L3N * 1.732),
      V_Avg_LL: r2((V_L1N + V_L2N + V_L3N) / 3 * 1.732),
      I_L1: r3(I_L1),
      I_L2: r3(I_L2),
      I_L3: r3(I_L3),
      I_Avg: r3((I_L1 + I_L2 + I_L3) / 3),
      PF_L1: r3(dpf1),
      PF_L2: r3(dpf2),
      PF_L3: r3(dpf3),
      PF_Avg: r3(Total_kVA > 0 ? Total_kW / Total_kVA : 1.0),
      Frequency: r3(drift(50.00, 0.015, 49.85, 50.15)),
      kW_L1: r3(kW_L1),
      kW_L2: r3(kW_L2),
      kW_L3: r3(kW_L3),
      Total_kW: r3(Total_kW),
      kVA_L1: r3(kVA_L1),
      kVA_L2: r3(kVA_L2),
      kVA_L3: r3(kVA_L3),
      Total_kVA: r3(Total_kVA),
      kVAr_L1: r3(Math.sqrt(Math.max(0, kVA_L1 ** 2 - kW_L1 ** 2))),
      kVAr_L2: r3(Math.sqrt(Math.max(0, kVA_L2 ** 2 - kW_L2 ** 2))),
      kVAr_L3: r3(Math.sqrt(Math.max(0, kVA_L3 ** 2 - kW_L3 ** 2))),
      Total_kVAr: r3(Total_kVAr),
      VTHD_L1: r2(drift(1.0, 0.05, 0.5, 3.0)),
      VTHD_L2: r2(drift(2.5, 0.1, 1.0, 5.0)),
      VTHD_L3: r2(drift(2.4, 0.1, 1.0, 5.0)),
      ITHD_L1: r2(drift(2.4, 0.2, 1.0, 10.0)),
      ITHD_L2: r2(drift(21.7, 0.5, 15.0, 30.0)),
      ITHD_L3: r2(drift(3.5, 0.2, 1.0, 10.0)),
      _sim: {
        tick: this.tick,
        ac_active: ac.active,
        ac_phase: ac.phase,
        ac_mode: ac.active ? (ac.isInrush ? "inrush" : "run") : "off",
        load_factor: r2(lm),
      },
    };
  }
}

// ─── MQTT connect & publish loop ──────────────────────────────────────────────
const client = mqtt.connect(CFG.broker, {
  clientId: `energy_multi_sim_${Date.now()}`,
  clean: true,
  reconnectPeriod: 3000,
});

const sims = CFG.devices.map((id, index) => new DeviceSimulator(id, index));

client.on("connect", () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(` Multi-Device Simulator Started`);
  console.log(` Devices: ${CFG.devices.join(", ")}`);
  console.log(` Broker : ${CFG.broker}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const publishAll = () => {
    sims.forEach(sim => {
      const p = sim.buildPayload();
      const topic = `vatio/${sim.deviceId}/rs485`;
      client.publish(topic, JSON.stringify(p), { qos: 1 });
      console.log(`[${sim.deviceId}] kW=${p.Total_kW.toFixed(3)} | PF=${p.PF_Avg.toFixed(3)} | AC=${p._sim.ac_mode}`);
    });
    console.log("──────────────────────────────────────────────");
  };

  setInterval(publishAll, CFG.intervalMs);
  publishAll();
});

client.on("error", (e) => console.error("[ERR] MQTT:", e.message));
