/**
 * metric-aliases.ts
 * ─────────────────────────────────────────────────────────────────────────
 * The real meter (confirmed from live hardware on test.enarxi.com) publishes
 * metric keys like `V_L1N`, `I_L1`, `PF_Avg`, `Total_kW`, `VTHD_L1` — not the
 * camelCase names (`phase1Voltage`, `current`, `powerFactor`, `power`,
 * `vthd1`) every chart/query in this codebase was built against (originally
 * established to match the simulator's output, see
 * scripts/lib/device-simulator.js).
 *
 * Rather than touching every chart/query to read two possible key names,
 * normalize once at ingestion: add the canonical camelCase keys alongside
 * the real meter's own keys (which are kept, not overwritten, so the raw
 * payload stays inspectable). Both the simulator's live path and the real
 * meter's live path converge on the same canonical names from here on.
 *
 * `Import_kWh`/`Export_kWh` already had a narrower COALESCE fallback in
 * EnergyCalculationService — this supersedes that for anything ingested
 * after this change, but the COALESCE stays harmless for older rows.
 */

const ALIAS_MAP: Record<string, string> = {
    // Cumulative energy counters
    Import_kWh: 'importKwh',
    Export_kWh: 'exportKwh',
    Net_kWh: 'netKwh',
    Total_kVAh: 'totalKVAh',
    Import_kVArh: 'importKVArh',
    Export_kVArh: 'exportKVArh',

    // Per-phase voltage
    V_L1N: 'phase1Voltage',
    V_L2N: 'phase2Voltage',
    V_L3N: 'phase3Voltage',
    V_Avg_LN: 'avgVLN',
    V_L12: 'v12',
    V_L23: 'v23',
    V_L31: 'v31',
    V_Avg_LL: 'avgVLL',

    // Per-phase current
    I_L1: 'phase1Current',
    I_L2: 'phase2Current',
    I_L3: 'phase3Current',
    I_Avg: 'avgCurrent',

    // Power factor
    PF_L1: 'phase1PF',
    PF_L2: 'phase2PF',
    PF_L3: 'phase3PF',
    PF_Avg: 'powerFactor',

    Frequency: 'frequency',

    // Real power per phase/total
    kW_L1: 'phase1Power',
    kW_L2: 'phase2Power',
    kW_L3: 'phase3Power',
    Total_kW: 'power',

    // Apparent power
    kVA_L1: 'phase1KVA',
    kVA_L2: 'phase2KVA',
    kVA_L3: 'phase3KVA',
    Total_kVA: 'totalKVA',

    // Reactive power
    kVAr_L1: 'phase1KVAr',
    kVAr_L2: 'phase2KVAr',
    kVAr_L3: 'phase3KVAr',
    Total_kVAr: 'totalKVAr',

    // THD
    VTHD_L1: 'vthd1',
    VTHD_L2: 'vthd2',
    VTHD_L3: 'vthd3',
    ITHD_L1: 'ithd1',
    ITHD_L2: 'ithd2',
    ITHD_L3: 'ithd3',
};

/**
 * Returns a new metrics object: every real-meter key kept as-is, plus its
 * canonical camelCase alias added alongside (only when the canonical key
 * isn't already present — never overwrites a value that's already there,
 * e.g. from the simulator, which publishes canonical names directly).
 */
export function normalizeMetrics(metrics: Record<string, number> | undefined | null): Record<string, number> {
    if (!metrics || typeof metrics !== 'object') return {};
    const out: Record<string, number> = { ...metrics };

    for (const [rawKey, canonicalKey] of Object.entries(ALIAS_MAP)) {
        if (out[canonicalKey] === undefined && out[rawKey] !== undefined) {
            out[canonicalKey] = out[rawKey];
        }
    }

    // Generic single-value aliases a few older chart tabs read directly
    // (AnalyticsPage.jsx's load/voltage/thd/pf tabs) — same convention the
    // simulator already established (phase-1 reading as the flat alias).
    if (out.voltage === undefined && out.phase1Voltage !== undefined) out.voltage = out.phase1Voltage;
    if (out.current === undefined && out.avgCurrent !== undefined) out.current = out.avgCurrent;
    if (out.thd === undefined && out.vthd1 !== undefined) out.thd = out.vthd1;

    return out;
}
