#!/usr/bin/env node
/**
 * wait-for-real-telemetry.js
 * ─────────────────────────────────────────────────────────────────────────
 * Standalone MQTT subscriber, independent of the backend's own ingestion
 * pipeline — connects directly to the real broker and waits for the first
 * message published by actual hardware. Confirms "is real telemetry
 * actually arriving on the wire" without any dependency on whether the
 * backend's parsing/Redis/DB path is working, so a problem in one doesn't
 * get mistaken for a problem in the other.
 *
 * Subscribes to vatio/# (every device, every sub-topic) rather than just
 * vatio/NEWDEV_01/rs485, so it also catches a device publishing under an
 * unexpected ID or to vatio/+/status, which would otherwise look like
 * silence.
 *
 * Usage:
 *   node scripts/wait-for-real-telemetry.js
 *   MQTT_URL=mqtt://test.enarxi.com:1883 node scripts/wait-for-real-telemetry.js
 */

require('dotenv').config();
const mqtt = require('mqtt');

const MQTT_URL = process.env.MQTT_URL || 'mqtt://test.enarxi.com:1883';
const TOPIC = 'vatio/#';

console.log(`[wait] connecting to ${MQTT_URL} ...`);
const client = mqtt.connect(MQTT_URL, { clientId: `vatio-telemetry-watch-${Date.now()}` });

let received = 0;

client.on('connect', () => {
    console.log(`[wait] connected. Subscribing to "${TOPIC}" and waiting for real telemetry...`);
    client.subscribe(TOPIC, (err) => {
        if (err) {
            console.error('[wait] subscribe failed:', err.message);
            process.exit(1);
        }
    });
});

client.on('message', (topic, payload) => {
    received += 1;
    const text = payload.toString();
    console.log(`\n[wait] ===== MESSAGE #${received} RECEIVED =====`);
    console.log(`[wait] topic: ${topic}`);
    console.log(`[wait] time:  ${new Date().toISOString()}`);
    console.log(`[wait] bytes: ${payload.length}`);
    console.log(`[wait] raw:   ${text.slice(0, 2000)}`);

    try {
        const parsed = JSON.parse(text);
        console.log(`[wait] valid JSON: yes`);
        console.log(`[wait] deviceId: ${parsed.deviceId ?? '(missing)'}`);
        if (parsed.metrics && typeof parsed.metrics === 'object') {
            const keys = Object.keys(parsed.metrics);
            console.log(`[wait] metrics field count: ${keys.length}`);
            console.log(`[wait] first few metrics: ${keys.slice(0, 8).map(k => `${k}=${parsed.metrics[k]}`).join(', ')}`);
        } else {
            console.log(`[wait] WARNING: no "metrics" object in payload — backend's TelemetryDto expects one`);
        }
    } catch (e) {
        console.log(`[wait] valid JSON: NO (${e.message}) — backend will fail to parse this message`);
    }

    // Exit on the first real, device-tagged message — that's confirmation
    // enough that hardware is live on the wire. Keep listening a few extra
    // seconds in case more arrive back-to-back, for a slightly fuller
    // picture, then stop.
    if (received === 1) {
        console.log('\n[wait] first message captured — listening 10 more seconds for any follow-ups, then exiting...');
        setTimeout(() => {
            console.log(`[wait] done. Total messages seen: ${received}`);
            client.end(() => process.exit(0));
        }, 10_000);
    }
});

client.on('error', (err) => {
    console.error('[wait] MQTT error:', err.message);
});

client.on('reconnect', () => {
    console.log('[wait] reconnecting...');
});
