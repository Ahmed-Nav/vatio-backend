#!/usr/bin/env node
/**
 * device-simulator.js
 * ─────────────────────────────────────────────────────────────────────────
 * Shared physics model for a simulated 3-phase meter, used by both:
 *   - scripts/telemetry-simulator.js (live, publishes over MQTT in real time)
 *   - scripts/seed-historical-telemetry.js (batch, replays this same model
 *     across a year of historical timestamps and writes straight to Postgres)
 *
 * Kept in one place so both produce data with the exact same shape and the
 * exact same realism (voltage/current drift, day/night solar curve, occasional
 * sag/swell events, monotonic cumulative counters) — see telemetry-simulator.js
 * for the full contract/field-naming rationale.
 */

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const round = (v, d = 2) => Number(v.toFixed(d));

/** Random walk: drifts `value` by a small random step, reverting gently toward `center`. */
function drift(value, center, step, min, max) {
    const pull = (center - value) * 0.04; // gentle mean-reversion so it doesn't wander off
    const noise = (Math.random() - 0.5) * step;
    return clamp(value + pull + noise, min, max);
}

/** Solar irradiance curve: 0 at night, peaks at local solar noon. 0..1 multiplier. */
function solarIrradiance(date) {
    const hour = date.getHours() + date.getMinutes() / 60;
    const x = (hour - 6) / 12; // 0 at 06:00, 1 at 18:00
    if (x <= 0 || x >= 1) return 0;
    return Math.sin(x * Math.PI) * (0.85 + Math.random() * 0.15); // slight cloud-cover noise
}

class DeviceSimulator {
    constructor(deviceId, savedState) {
        this.deviceId = deviceId;
        // Intentionally NOT Date.now() — a caller ticking at a historical
        // timestamp far from "now" (the seed script, starting a year back)
        // would otherwise see a huge bogus dtHours gap on its very first
        // tick, producing one catastrophic energy delta right at the start
        // of the series. null means "uninitialized"; tick() sets this to
        // its own first `now` and treats that first step as zero elapsed
        // time instead of guessing.
        this.lastTick = null;

        // Baselines — a real 3-phase industrial/solar meter's typical range.
        this.v1 = 230; this.v2 = 229; this.v3 = 231;
        this.i1 = 8; this.i2 = 7.5; this.i3 = 7.8;
        this.freq = 50.0;
        this.pf1 = 0.95; this.pf2 = 0.94; this.pf3 = 0.96;
        this.vthd1 = 2.2; this.vthd2 = 2.0; this.vthd3 = 2.4;
        this.ithd1 = 3.4; this.ithd2 = 3.1; this.ithd3 = 3.6;

        // Cumulative counters — real meters never go backwards, and never
        // reset on a restart either. Resume from saved state when present;
        // only a brand-new device (never seen before) gets a fresh baseline.
        if (savedState) {
            this.energyKwh = savedState.energyKwh;
            this.importKwh = savedState.importKwh;
            this.exportKwh = savedState.exportKwh;
            this.totalKVAh = savedState.totalKVAh ?? this.energyKwh * 1.02;
            this.importKVArh = savedState.importKVArh ?? 0;
            this.exportKVArh = savedState.exportKVArh ?? 0;
            this.leadKVArh = savedState.leadKVArh ?? 0;
            this.lagKVArh = savedState.lagKVArh ?? 0;
            this.sysKVArh = savedState.sysKVArh ?? 0;
        } else {
            this.energyKwh = round(800 + Math.random() * 400, 3);
            // Grid import/export, mirroring the real meter's bidirectional registers
            // (Import_kWh / Export_kWh). Solar generation isn't directly measured by
            // this meter — only the net flow crossing the grid boundary is — so
            // "solar" is derived as export surplus, not simulated independently.
            this.importKwh = round(400 + Math.random() * 200, 3);
            this.exportKwh = round(Math.random() * 30, 3);
            // Apparent/reactive energy counters — derived from the same P/Q/S
            // relationship computed each tick below, not independent randoms.
            this.totalKVAh = round(this.energyKwh * 1.02, 3);
            this.importKVArh = round(this.energyKwh * 0.2, 3);
            this.exportKVArh = 0;
            this.leadKVArh = 0; // inductive loads (our model) are lagging, not leading
            this.lagKVArh = round(this.energyKwh * 0.2, 3);
            this.sysKVArh = this.lagKVArh;
        }

        // Occasional "event" (brief sag/swell/imbalance) to look less uniform.
        this.eventUntil = 0;
        this.eventFactor = 1;
    }

    maybeTriggerEvent(now) {
        if (now > this.eventUntil && Math.random() < 0.01) {
            this.eventUntil = now + (3000 + Math.random() * 7000);
            this.eventFactor = Math.random() < 0.5 ? 0.92 : 1.06; // sag or swell
        }
        if (now > this.eventUntil) this.eventFactor = 1;
    }

    /**
     * Advances the simulation by one step and returns this step's metrics.
     * @param {number} [atTimestamp] epoch ms to simulate at — defaults to
     *   Date.now() for live use; the historical seed script passes an explicit
     *   replayed timestamp instead.
     */
    tick(atTimestamp) {
        const now = atTimestamp ?? Date.now();
        const nowDate = new Date(now);
        // First-ever tick has no prior reading to diff against — zero
        // elapsed time, not a bogus gap against the construction time.
        const dtHours = this.lastTick === null ? 0 : (now - this.lastTick) / 3_600_000;
        this.lastTick = now;
        this.maybeTriggerEvent(now);

        // Voltages (line-neutral), drifting around their baseline.
        this.v1 = drift(this.v1, 230 * this.eventFactor, 1.2, 205, 250);
        this.v2 = drift(this.v2, 229 * this.eventFactor, 1.2, 205, 250);
        this.v3 = drift(this.v3, 231 * this.eventFactor, 1.2, 205, 250);

        // Currents, loosely correlated with time-of-day load (higher daytime).
        const loadMult = 0.6 + solarIrradiance(nowDate) * 0.3 + Math.random() * 0.1;
        this.i1 = drift(this.i1, 6 + 8 * loadMult, 0.8, 1, 25);
        this.i2 = drift(this.i2, 6 + 7.5 * loadMult, 0.8, 1, 25);
        this.i3 = drift(this.i3, 6 + 7.8 * loadMult, 0.8, 1, 25);

        this.freq = drift(this.freq, 50.0, 0.04, 49.5, 50.5);
        this.pf1 = drift(this.pf1, 0.95, 0.01, 0.82, 0.995);
        this.pf2 = drift(this.pf2, 0.94, 0.01, 0.82, 0.995);
        this.pf3 = drift(this.pf3, 0.96, 0.01, 0.82, 0.995);
        this.vthd1 = drift(this.vthd1, 2.2, 0.3, 0.5, 6.5);
        this.vthd2 = drift(this.vthd2, 2.0, 0.3, 0.5, 6.5);
        this.vthd3 = drift(this.vthd3, 2.4, 0.3, 0.5, 6.5);
        this.ithd1 = drift(this.ithd1, 3.4, 0.4, 0.8, 8.0);
        this.ithd2 = drift(this.ithd2, 3.1, 0.4, 0.8, 8.0);
        this.ithd3 = drift(this.ithd3, 3.6, 0.4, 0.8, 8.0);

        // Instantaneous power per phase (W) = V * I * PF.
        const p1 = this.v1 * this.i1 * this.pf1;
        const p2 = this.v2 * this.i2 * this.pf2;
        const p3 = this.v3 * this.i3 * this.pf3;
        const totalPowerW = p1 + p2 + p3;

        // Apparent (S = V*I) and reactive (Q = sqrt(S^2 - P^2)) power per
        // phase, kept physically consistent with P and PF rather than
        // independently randomized — our modeled loads are inductive
        // (lagging PF), so reactive power is always "lag", never "lead".
        const s1 = this.v1 * this.i1, s2 = this.v2 * this.i2, s3 = this.v3 * this.i3;
        const q1 = Math.sqrt(Math.max(0, s1 * s1 - p1 * p1));
        const q2 = Math.sqrt(Math.max(0, s2 * s2 - p2 * p2));
        const q3 = Math.sqrt(Math.max(0, s3 * s3 - p3 * p3));
        const totalApparentVA = s1 + s2 + s3;
        const totalReactiveVAr = q1 + q2 + q3;
        const systemPF = totalApparentVA > 0 ? totalPowerW / totalApparentVA : 0;

        // Solar generation (W) follows the irradiance curve for this moment.
        // Not published directly — only its effect on net grid flow is "measured",
        // same as the real bidirectional meter. The drift()'d load's actual
        // steady-state equilibrium (not its below-equilibrium constructor
        // default) sits at ~8-9kW at peak loadMult — a 9000W array barely
        // matched that, leaving ~0 real headroom for export. Sized to 15000W
        // instead so a properly oversized rooftop array produces clearly
        // visible export around solar noon, same as a real net-metered site.
        const solarPowerW = solarIrradiance(nowDate) * 15000;
        const netPowerW = totalPowerW - solarPowerW; // >0 = drawing from grid, <0 = exporting surplus

        // Cumulative energy/apparent/reactive counters only ever go up.
        this.energyKwh = round(this.energyKwh + (totalPowerW / 1000) * dtHours, 3);
        this.totalKVAh = round(this.totalKVAh + (totalApparentVA / 1000) * dtHours, 3);
        this.lagKVArh = round(this.lagKVArh + (totalReactiveVAr / 1000) * dtHours, 3);
        this.sysKVArh = this.lagKVArh; // leadKVArh stays 0 — lagging loads only, see above
        if (netPowerW > 0) {
            this.importKwh = round(this.importKwh + (netPowerW / 1000) * dtHours, 3);
            this.importKVArh = round(this.importKVArh + (totalReactiveVAr / 1000) * dtHours, 3);
        } else {
            this.exportKwh = round(this.exportKwh + (-netPowerW / 1000) * dtHours, 3);
            this.exportKVArh = round(this.exportKVArh + (totalReactiveVAr / 1000) * dtHours, 3);
        }

        const v12 = round((this.v1 + this.v2) * 1.732 / 2 + (Math.random() - 0.5) * 2, 1);
        const v23 = round((this.v2 + this.v3) * 1.732 / 2 + (Math.random() - 0.5) * 2, 1);
        const v31 = round((this.v3 + this.v1) * 1.732 / 2 + (Math.random() - 0.5) * 2, 1);
        const avgVLN = round((this.v1 + this.v2 + this.v3) / 3, 1);
        const avgVLL = round((v12 + v23 + v31) / 3, 1);
        const avgCurrent = round((this.i1 + this.i2 + this.i3) / 3, 2);
        // Neutral/imbalance current — near zero for a well-balanced load, a
        // small fraction of the phase spread otherwise, never negative.
        const neutralCurrent = round(Math.abs(this.i1 - this.i2) * 0.3 + Math.abs(this.i2 - this.i3) * 0.3 + Math.random() * 0.2, 2);
        const powerFactor = round((this.pf1 + this.pf2 + this.pf3) / 3, 3);
        // V-I phase angle per line = acos(PF), in degrees.
        const toDeg = (rad) => rad * (180 / Math.PI);
        const viAngle1 = round(toDeg(Math.acos(clamp(this.pf1, -1, 1))), 2);
        const viAngle2 = round(toDeg(Math.acos(clamp(this.pf2, -1, 1))), 2);
        const viAngle3 = round(toDeg(Math.acos(clamp(this.pf3, -1, 1))), 2);
        // 3rd-harmonic magnitude — the dominant contributor to THD on this
        // kind of load, modeled as a fixed fraction of the matching THD%.
        const h3VL1 = round(this.vthd1 * 0.65, 2);
        const h3VL12 = round(((this.vthd1 + this.vthd2) / 2) * 0.65, 2);
        const h3VL3 = round(this.vthd3 * 0.65, 2);
        const h3IL1 = round(this.ithd1 * 0.7, 2);
        const h3IL2 = round(this.ithd2 * 0.7, 2);
        const h3IL3 = round(this.ithd3 * 0.7, 2);

        return {
            // Phase-split voltage/current/power (what DeviceAnalysisPage charts bind to)
            phase1Voltage: round(this.v1, 1), phase2Voltage: round(this.v2, 1), phase3Voltage: round(this.v3, 1),
            v12, v23, v31, avgVLN, avgVLL,
            totalVoltage: avgVLN, // kept as an alias — existing call sites read this name
            phase1Current: round(this.i1, 2), phase2Current: round(this.i2, 2), phase3Current: round(this.i3, 2),
            avgCurrent, neutralCurrent,
            phase1Power: round(p1, 1), phase2Power: round(p2, 1), phase3Power: round(p3, 1),
            power: round(totalPowerW, 1),
            frequency: round(this.freq, 3),
            phase1PF: round(this.pf1, 3), phase2PF: round(this.pf2, 3), phase3PF: round(this.pf3, 3),
            powerFactor, systemPF: round(systemPF, 3),
            viAngle1, viAngle2, viAngle3,
            phase1KVA: round(s1 / 1000, 3), phase2KVA: round(s2 / 1000, 3), phase3KVA: round(s3 / 1000, 3),
            totalKVA: round(totalApparentVA / 1000, 3),
            phase1KVAr: round(q1 / 1000, 3), phase2KVAr: round(q2 / 1000, 3), phase3KVAr: round(q3 / 1000, 3),
            totalKVAr: round(totalReactiveVAr / 1000, 3),
            vthd1: round(this.vthd1, 2), vthd2: round(this.vthd2, 2), vthd3: round(this.vthd3, 2),
            ithd1: round(this.ithd1, 2), ithd2: round(this.ithd2, 2), ithd3: round(this.ithd3, 2),
            h3VL1, h3VL12, h3VL3, h3IL1, h3IL2, h3IL3,
            energyKwh: this.energyKwh,
            importKwh: this.importKwh,
            exportKwh: this.exportKwh,
            netKwh: round(this.importKwh - this.exportKwh, 3),
            totalKVAh: this.totalKVAh,
            importKVArh: this.importKVArh,
            exportKVArh: this.exportKVArh,
            leadKVArh: this.leadKVArh,
            lagKVArh: this.lagKVArh,
            sysKVArh: this.sysKVArh,
            // Kept for existing call sites that still read a single "solar" figure —
            // equal to cumulative export (the only solar-related figure this meter
            // can actually measure), not an independent random value anymore.
            solarKwh: this.exportKwh,

            // Generic aliases (what AnalyticsPage/ReportsPage read as single flat fields)
            voltage: round(this.v1, 1),
            current: round(this.i1, 2),
            thd: round(this.vthd1, 2),
        };
    }
}

module.exports = { DeviceSimulator, drift, solarIrradiance, clamp, round };
