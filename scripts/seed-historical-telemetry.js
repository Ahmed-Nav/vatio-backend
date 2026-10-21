#!/usr/bin/env node
/**
 * seed-historical-telemetry.js
 * ─────────────────────────────────────────────────────────────────────────
 * Batch-generates a year of realistic historical telemetry and writes it
 * directly to the Telemetry table — NOT through MQTT/Redis (that would take
 * as long as the time span being simulated). Reuses the exact same physics
 * model as the live simulator (scripts/lib/device-simulator.js) so seeded
 * history and live-going-forward data are indistinguishable in shape.
 *
 * This script does ONLY the seed step. Reviewing and clearing the Telemetry
 * table first are deliberately separate, manual steps — see Part 11 of the
 * project plan. The script refuses to run if the table isn't already empty.
 *
 * Usage:
 *   node scripts/seed-historical-telemetry.js
 *   DAYS=90 node scripts/seed-historical-telemetry.js                  # shorter backfill
 *   DEVICE_IDS=DEV-001 node scripts/seed-historical-telemetry.js        # single device
 *   SIM_INTERVAL_MS=300000 node scripts/seed-historical-telemetry.js    # coarser/faster backfill
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const fs = require('fs');
const path = require('path');
const { DeviceSimulator } = require('./lib/device-simulator');

const DEVICE_IDS = (process.env.DEVICE_IDS || 'DEV-001,DEV-002').split(',').map((s) => s.trim()).filter(Boolean);
const DAYS = Number(process.env.DAYS || 365);
// Real firmware cadence by default (~62.9s) — see telemetry-simulator.js's
// header comment for how that number is derived — so the seeded year has the
// same data density production will actually have.
const STEP_MS = Number(process.env.SIM_INTERVAL_MS || 62_900);
const BATCH_SIZE = 2000;
const STATE_FILE = path.join(__dirname, '.simulator-state.json');

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function main() {
    const existing = await prisma.telemetry.count();
    if (existing > 0) {
        console.error(
            `[seed] Telemetry table is not empty (${existing} rows). Refusing to run — ` +
            `clear it first if you want a fresh year of history (this script only seeds, never clears).`,
        );
        process.exit(1);
    }

    for (const id of DEVICE_IDS) {
        const device = await prisma.device.findUnique({ where: { id } });
        if (!device) {
            console.error(`[seed] Device '${id}' doesn't exist yet — register it (e.g. via prisma/seed.ts) before backfilling its telemetry.`);
            process.exit(1);
        }
    }

    const end = Date.now();
    const start = end - DAYS * 86_400_000;
    const stepsPerDevice = Math.floor((end - start) / STEP_MS);
    const totalRows = stepsPerDevice * DEVICE_IDS.length;

    console.log(`[seed] Backfilling ${DAYS} days for ${DEVICE_IDS.join(', ')}`);
    console.log(`[seed] Cadence: ${STEP_MS}ms/step -> ~${stepsPerDevice.toLocaleString()} rows/device, ~${totalRows.toLocaleString()} rows total`);

    const sims = DEVICE_IDS.map((id) => new DeviceSimulator(id)); // no saved state — this is a fresh year from a clean table
    const startedAt = Date.now();
    let written = 0;
    let batch = [];

    const flush = async () => {
        if (batch.length === 0) return;
        await prisma.telemetry.createMany({ data: batch });
        written += batch.length;
        batch = [];
        const pct = ((written / totalRows) * 100).toFixed(1);
        process.stdout.write(`\r[seed] ${written.toLocaleString()}/${totalRows.toLocaleString()} rows (${pct}%) — ${fmtDuration(Date.now() - startedAt)} elapsed`);
    };

    for (let ts = start; ts < end; ts += STEP_MS) {
        for (const sim of sims) {
            const metrics = sim.tick(ts);
            batch.push({
                deviceId: sim.deviceId,
                timestamp: new Date(ts),
                data: { deviceId: sim.deviceId, metrics },
            });
            if (batch.length >= BATCH_SIZE) await flush();
        }
    }
    await flush();
    console.log(`\n[seed] Done — ${written.toLocaleString()} rows written in ${fmtDuration(Date.now() - startedAt)}`);

    // Hand off to the live simulator: write the ending counter values so a
    // subsequent `node scripts/telemetry-simulator.js` resumes right where
    // this seeded year leaves off, instead of rolling a fresh random baseline
    // and creating one more reset-spike at the seam.
    const state = {};
    for (const sim of sims) {
        state[sim.deviceId] = {
            energyKwh: sim.energyKwh, importKwh: sim.importKwh, exportKwh: sim.exportKwh,
            totalKVAh: sim.totalKVAh, importKVArh: sim.importKVArh, exportKVArh: sim.exportKVArh,
            leadKVArh: sim.leadKVArh, lagKVArh: sim.lagKVArh, sysKVArh: sim.sysKVArh,
        };
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`[seed] Wrote ending counters to ${STATE_FILE} — the live simulator will resume from here.`);
}

main()
    .catch((err) => {
        console.error('[seed] failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
