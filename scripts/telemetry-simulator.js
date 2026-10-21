#!/usr/bin/env node
/**
 * telemetry-simulator.js
 * ─────────────────────────────────────────────────────────────────────────
 * Publishes realistic, continuously-fluctuating 3-phase meter telemetry over
 * MQTT, matching the real backend contract:
 *
 *   Topic:   vatio/{deviceId}/rs485
 *   Payload: { deviceId, metrics: { <name>: <number>, ... } }   (TelemetryDto)
 *
 * This stands in for the real hardware firmware until it's updated to speak
 * this same contract (see the firmware/backend MQTT bridge fix tracked
 * separately). Metric key names are chosen to exactly match the field names
 * the frontend charts already read (DeviceAnalysisPage.jsx, AnalyticsPage.jsx,
 * TelemetryContext.jsx) so the whole pipeline — ingestion -> Redis stream ->
 * 5s aggregation (avg/min/max) -> WebSocket -> live charts — lights up with
 * no further frontend changes.
 *
 * The actual per-device physics model (drift, solar curve, cumulative
 * counters) lives in scripts/lib/device-simulator.js, shared with
 * scripts/seed-historical-telemetry.js so live and backfilled data match.
 *
 * PUBLISH CADENCE
 * ─────────────────────────────────────────────────────────────────
 * The real firmware (Vatio_WiFi_4G.ino) publishes once per FULL register
 * sweep, not continuously: its loop() reads one Modbus holding register per
 * iteration via node.readHoldingRegisters(), incrementing registerAddress by
 * 1 each time (by 2 at six specific addresses — 322/384/446/508/570/632 —
 * where a pair of registers is read together), until registerAddress reaches
 * 635, at which point it converts everything and calls sendDat()/publishMQTT()
 * once. That's 629 iterations per sweep (635 total address-steps, minus 6
 * saved by the six +2 jumps), each followed by a fixed delay(100) ⇒
 * 629 * 100ms ≈ 62.9s floor between publishes on real hardware.
 * Default below is set faster than that (200ms) for responsive dev/demo
 * iteration — override with SIM_INTERVAL_MS, e.g. SIM_INTERVAL_MS=62900 to
 * match the firmware's real-hardware cadence exactly.
 *
 * Usage:
 *   node scripts/telemetry-simulator.js
 *   DEVICE_IDS=DEV-001,DEV-002 MQTT_URL=mqtt://localhost:1883 node scripts/telemetry-simulator.js
 *   SIM_INTERVAL_MS=62900 node scripts/telemetry-simulator.js   # match real firmware cadence
 */

require('dotenv').config();
const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const { DeviceSimulator } = require('./lib/device-simulator');

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const DEVICE_IDS = (process.env.DEVICE_IDS || 'DEV-001,DEV-002').split(',').map((s) => s.trim()).filter(Boolean);
const TICK_MS = Number(process.env.SIM_INTERVAL_MS || 200);

// Cumulative counters (energyKwh/importKwh/exportKwh) must survive a restart —
// a real meter never resets on a power cycle. Without this, every dev restart
// re-rolls a fresh random starting value, which the backend's reset-safe delta
// logic (correctly) counts as a one-time reset spike — repeated restarts during
// testing pollute the historical data with dozens of fake several-hundred-kWh
// jumps. Persist state to disk and resume from it instead. The historical seed
// script writes this same file when it finishes, so live data picks up exactly
// where the seeded year leaves off.
const STATE_FILE = path.join(__dirname, '.simulator-state.json');

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveState(sims) {
    const state = {};
    for (const sim of sims) {
        state[sim.deviceId] = {
            energyKwh: sim.energyKwh, importKwh: sim.importKwh, exportKwh: sim.exportKwh,
            totalKVAh: sim.totalKVAh, importKVArh: sim.importKVArh, exportKVArh: sim.exportKVArh,
            leadKVArh: sim.leadKVArh, lagKVArh: sim.lagKVArh, sysKVArh: sim.sysKVArh,
        };
    }
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error('[simulator] failed to save state:', err.message);
    }
}

// ─── Main ────────────────────────────────────────────────────────────────

function main() {
    console.log(`[simulator] connecting to ${MQTT_URL} ...`);
    const client = mqtt.connect(MQTT_URL, { clientId: `vatio-simulator-${Date.now()}` });
    const savedState = loadState();
    const sims = DEVICE_IDS.map((id) => new DeviceSimulator(id, savedState[id]));
    for (const sim of sims) {
        const resumed = savedState[sim.deviceId];
        console.log(
            resumed
                ? `[simulator] ${sim.deviceId}: resumed counters (import=${sim.importKwh}, export=${sim.exportKwh})`
                : `[simulator] ${sim.deviceId}: no saved state, starting fresh baseline`,
        );
    }

    client.on('connect', () => {
        console.log(`[simulator] connected. Publishing for: ${DEVICE_IDS.join(', ')} every ${TICK_MS}ms`);
        setInterval(() => {
            for (const sim of sims) {
                const metrics = sim.tick();
                const topic = `vatio/${sim.deviceId}/rs485`;
                const payload = JSON.stringify({ deviceId: sim.deviceId, metrics });
                client.publish(topic, payload);
            }
        }, TICK_MS);

        // Autosave every 5s so even an unclean shutdown (kill -9) loses at
        // most a few seconds of counter progress, not the whole run.
        setInterval(() => saveState(sims), 5000);
    });

    client.on('error', (err) => {
        console.error('[simulator] MQTT error:', err.message);
    });

    process.on('SIGINT', () => {
        console.log('\n[simulator] shutting down, saving state...');
        saveState(sims);
        client.end(() => process.exit(0));
    });
}

main();
