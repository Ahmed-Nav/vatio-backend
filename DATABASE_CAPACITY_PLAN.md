# ⚡ Vatio IoT — Database Storage & Capacity Sizing Plan

> **Authoritative Architecture Document**: Sizing, capacity forecasting, and lifecycle management for high-frequency telemetry ingestion across PostgreSQL and TimescaleDB with **Selective Metric Segregation (Fast vs. Slow Streams)**.

---

## 1. Executive Summary

In high-performance industrial IoT and solar telemetry, **not all data points populate or change at millisecond rates**. 

Attempting to broadcast and store all 25+ registers every 200ms is wasteful: cumulative energy counters (`energyKwh`), billing registers, temperatures, and device states change over minutes or hours, not milliseconds.

This document establishes the realistic sizing model based on **Metric Segregation**:
1. **Fast Stream (200ms – 1s)**: Only high-frequency fluctuating electrical signals (Voltage, Current, Instantaneous kW, Frequency). Payload is compact (~140 bytes).
2. **Medium Stream (5s – 30s)**: Power Factor, Voltage THD, phase-split powers.
3. **Slow / Cumulative Stream (1min – 15min / On-Change)**: Cumulative Energy counters (`Import_kWh`, `Solar_kWh`), TOD billing registers, inverter temperatures.
4. **Storage Impact**: Segregating metrics reduces millisecond payload size from **524 bytes down to ~140 bytes**, cutting raw database storage demand by **over 70%**.

---

## 2. Metric Segregation by Physical Frequency

| Metric Classification | Cadence / Interval | Metrics Included | Avg Payload Size | Update Justification |
| :--- | :--- | :--- | :--- | :--- |
| **Tier A: Fast Fluctuations** | **200 ms – 1s** | `V_L1N`, `V_L2N`, `V_L3N`, `I_L1`, `I_L2`, `I_L3`, `Total_kW`, `Frequency` | **~140 bytes** | Required for real-time waveform tracking, sudden sags/swells, and live UI needle gauges. |
| **Tier B: Power Quality** | **5s – 30s** | `PF` (Phase 1/2/3, Total), `vthd1`, `vthd2`, `vthd3`, Phase Powers | **~220 bytes** | Harmonics and power factor drift slowly under industrial motor loads; 5s window is optimal. |
| **Tier C: Cumulative Energy** | **1 min – 15 min** | `Import_kWh`, `Solar_kWh`, TOD Peak/Off-peak Registers | **~180 bytes** | Cumulative kWh counters advance fractions of a unit over minutes. Publishing every 200ms writes 99.9% identical data. |
| **Tier D: Diagnostics / Health** | **15 min / On-Change** | Internal Temp, Firmware, Signal Strength (RSSI), Modbus Error Count | **~120 bytes** | Hardware health is steady; should only publish on significant change or scheduled heartbeat. |
| **Tier E: Event / Alarms** | **Immediate (Async)** | Breaker trip, overvoltage alarm, connection loss | **~100 bytes** | Event-driven triggers pushed immediately via MQTT QoS 1. |

---

## 3. Telemetry Payload & Database Row Anatomy

### Comparison: Full Dump vs. Segregated Fast Payload

```
FULL DUMP ROW (Old Simulator):
{
  "phase1Voltage": 235.3, "phase2Voltage": 231.7, "phase3Voltage": 234.5,
  "v12": 405.3, "v23": 404.2, "v31": 406.6, "totalVoltage": 233.8,
  "phase1Current": 13.31, "phase2Current": 12.29, "phase3Current": 11.8,
  "phase1Power": 2934.6, "phase2Power": 2701.3, "phase3Power": 2689.3,
  "power": 8325.2, "frequency": 50.022, "phase1PF": 0.937, "phase2PF": 0.948,
  "phase3PF": 0.972, "powerFactor": 0.952, "vthd1": 2.07, "vthd2": 2.15,
  "vthd3": 2.94, "energyKwh": 1111.373, "solarKwh": 7.837, ...
}
──► Row Footprint in DB: ~524 bytes

SEGREGATED FAST ROW (Selective 200ms Stream):
{
  "v1": 235.3, "v2": 231.7, "v3": 234.5,
  "i1": 13.31, "i2": 12.29, "i3": 11.8,
  "kw": 8.32, "freq": 50.02
}
──► Row Footprint in DB: ~140 bytes (73% smaller!)
```

### Component Breakdown (Per Row)

| Component | Full Dump (All Metrics) | Segregated Fast Stream (Fluctuations Only) |
| :--- | :--- | :--- |
| **Row Header & Transaction IDs** | 28 bytes | 28 bytes |
| **`id` + `timestamp` + `deviceId`** | 32 bytes | 32 bytes |
| **`data` Column (JSONB)** | ~380 bytes | **~50 bytes** |
| **B-Tree Indexes** | ~84 bytes | ~30 bytes (lean index) |
| **Total Physical Disk Footprint** | **~524 bytes (~0.5 KB)** | **~140 bytes (~0.14 KB)** |
| **TimescaleDB Columnar Compressed** | **~35 to 45 bytes** | **~12 to 18 bytes** |

---

## 4. Realistic Sizing Matrix: Selective / Hybrid Model (1 Device)

Under the recommended **Selective Model**:
* **Fast Stream (200ms)** publishes only fluctuating V/I/kW/Freq.
* **Medium Stream (5s)** aggregates power quality & phase splits.
* **Slow Stream (1min)** captures cumulative energy & solar meters.

| Stream Type | Interval | Records / Day | Records / Month (30d) | Monthly Disk (Uncompressed) | Monthly Disk (TimescaleDB Compressed) | Annual Disk (Compressed) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Fast Stream (V, I, kW, Freq)** | **200 ms** | 432,000 | 12,960,000 | **1.81 GB** | **194 MB** | **2.33 GB** |
| **Medium Stream (PQ, THD, PF)** | **5 sec** | 17,280 | 518,400 | **114 MB** | **10.4 MB** | **125 MB** |
| **Slow Stream (Cumulative kWh, TOD)** | **1 min** | 1,440 | 43,200 | **7.8 MB** | **0.8 MB** | **9.6 MB** |
| **Total Combined per Device** | **Hybrid** | **450,720** | **13,521,600** | **~1.93 GB** | **~205 MB** | **~2.46 GB** |

---

## 5. Multi-Device Fleet Scaling (Selective Hybrid Model)

The table below demonstrates how the database scales across fleet sizes when adopting metric segregation:

| Fleet Size | Fast Ingestion Rate | Daily Records | Monthly Storage (Uncompressed) | Annual Storage (Uncompressed) | Annual Storage (Compressed) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1 Device** | 5 msgs/sec | 450k rows | 1.93 GB | 23.5 GB | **2.46 GB** |
| **10 Devices** | 50 msgs/sec | 4.51M rows | 19.3 GB | 235 GB | **24.6 GB** |
| **50 Devices** | 250 msgs/sec | 22.5M rows | 96.5 GB | 1.18 TB | **123 GB** |
| **100 Devices** | 500 msgs/sec | 45.1M rows | 193 GB | 2.35 TB | **246 GB** |
| **500 Devices** | 2,500 msgs/sec | 225M rows | 965 GB | 11.75 TB | **1.23 TB** |

---

## 6. Deadband & Change-of-Value (COV) Filtering

Further storage optimization can be unlocked using **Deadband / Change-of-Value (COV)** logic at the firmware or MQTT bridge layer:

### Deadband Threshold Rules:
1. **Solar Power (`solarKwh`, `solar_kW`)**:
   - At night (irradiance = 0), power does not change.
   - **Rule**: If solar generation remains $0\text{ W}$, suspend 200ms publishing and switch to a **5-minute heartbeat**. Saves **~50% of solar data generation**.
2. **Steady-State Grid Voltage**:
   - If line voltage fluctuates within $\pm 0.3\text{ V}$, it represents nominal noise.
   - **Rule**: Only emit high-frequency bursts when $\Delta V > 0.5\text{ V}$ or $\Delta I > 0.1\text{ A}$.
3. **Cumulative Energy Counters**:
   - Only publish when meter registers advance by at least $0.01\text{ kWh}$.

### Efficiency Gain:
Applying COV Deadbands reduces daily write volume by an additional **35% to 55%**, enabling 100 devices to run comfortably on a standard **250 GB SSD** for over an entire year!

---

## 7. Recommended Production Architecture Summary

```
                      ┌──────────────────────────────────────────────┐
                      │ IoT Hardware / Firmware / Simulator Bridge  │
                      └──────────────────────┬───────────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │                                           │
             [Fast Fluctuation Stream]                  [Slow Cumulative Stream]
             • Cadence: 200ms - 1s                      • Cadence: 1m - 15m
             • Metrics: V, I, kW, Freq                  • Metrics: Energy kWh, Solar kWh
             • Size: ~140 bytes                         • Size: ~180 bytes
                       │                                           │
                       ▼                                           ▼
             [Redis Stream Buffer]                      [PostgreSQL / TimescaleDB]
             (Hot RAM / WebSocket)                      (Cold Long-Term Table)
                       │
                       ▼ (5s Aggregator window)
             [TimescaleDB Operational Hypertable]
             • Compressed after 7 days (92% savings)
             • Rolled into 1-Hour continuous aggregates
```

### Action Items for Implementation:
1. **Simulator Configuration**:
   - In [telemetry-simulator.js](file:///c:/Users/Hameed/OneDrive%20-%20Enarxi%20Innovations%20Pvt%20Ltd/Enarxi/Vatio/Vatio-backend/scripts/telemetry-simulator.js), separate the high-frequency electrical tick (`200ms`) from the slower cumulative energy tick (`60s`).
2. **Database Compression**:
   - Ensure `timescaledb.compress_segmentby = '"deviceId"'` is active so segmented column data stores efficiently.
