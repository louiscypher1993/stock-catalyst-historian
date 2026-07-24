/**
 * scratch_p2_reconstruct.ts — Phenomenon 2 re-investigation (2026-07-23).
 *
 * Regenerates the LIVE feature vectors for the 7 Phenomenon-2 blue-chip cluster
 * symbols + DVN (known stale-corrupted reference), using each symbol's REAL
 * Supabase symbol_snapshots row for enrichment — the exact live-path input.
 * Dumps vectors to a controlled scratchpad path for the Python raw-scoring +
 * leaf/contribution step (the cross-check the original 07-13 recon never ran).
 * Read-only: no writes, no runLiveInference.
 */
import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
} from '../LiveInferenceService';
import * as fs from 'fs';

const OUT = 'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/p2_vectors.json';

// 7 Phenomenon-2 cluster symbols (per DEEP_DIVE_PROGRESS.md:192) + DVN reference
// + same-live-path CONTROLS: other large-caps (is it "these 7" or "any large-cap"?)
// and mid/smaller names (is it "large-caps" or "any calm symbol"?).
const P2 = ['AXP', 'CVX', 'O', 'PLD', 'TSLA', 'META', 'BCE'];
const CTRL_LARGE = ['AAPL', 'MSFT', 'JPM', 'JNJ', 'WMT', 'KO', 'PG', 'XOM', 'HD', 'PFE'];
const CTRL_OTHER = ['F', 'T', 'INTC', 'BAC', 'CSCO', 'PYPL', 'SNAP', 'RIVN', 'PLUG', 'ROKU'];
const SYMS = [...P2, 'DVN', ...CTRL_LARGE, ...CTRL_OTHER];
const GROUP: Record<string, string> = {};
for (const s of P2) GROUP[s] = 'P2';
GROUP['DVN'] = 'DVN';
for (const s of CTRL_LARGE) GROUP[s] = 'CTRL_LARGE';
for (const s of CTRL_OTHER) GROUP[s] = 'CTRL_OTHER';

interface SymbolEnrichment {
  snap: Record<string, any> | null; primaryCategory: string | null;
  companyName: string | null; sector: string | null; exchange: string | null;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data: snapRows } = await supabase.from('symbol_snapshots').select('*').in('symbol', SYMS);
  console.log(`Fetched ${snapRows?.length ?? 0}/${SYMS.length} real symbol_snapshots rows`);

  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);

  const dump: Record<string, any> = {};
  const meta: Record<string, any> = {};
  for (const sym of SYMS) {
    const row = (snapRows || []).find((r: any) => r.symbol === sym);
    if (!row) { console.log(`${sym}: NO snapshot row — skipping`); continue; }
    const snap = row.latest_signal_snapshot ?? null;
    const snapKeys = snap ? Object.keys(snap).length : 0;
    const nonNull = snap ? Object.values(snap).filter((v: any) => v !== null).length : 0;
    const snapAge = row.updated_at ?? row.date ?? 'unknown';

    const bars = await fetchYahooDailyHistory(sym, '1y');
    const anomaly = detectAnomaly(sym, sym, bars, spyReturnByDate, /* bypassZGate */ true);
    if (!anomaly) { console.log(`${sym}: detectAnomaly NULL (bars=${bars.length})`); continue; }

    const enrichment: SymbolEnrichment = {
      snap, primaryCategory: null, companyName: row.company_name ?? null,
      sector: row.sector ?? null, exchange: row.exchange ?? null,
    };
    const vector = buildFeatureVectorForAnomaly(bars, anomaly, enrichment, null);
    dump[sym] = vector;
    meta[sym] = {
      snap_keys: snapKeys, snap_nonnull: nonNull, snap_updated: snapAge,
      z_score: anomaly.zScore, excess_return: anomaly.excessReturn,
      group: GROUP[sym], is_p2: P2.includes(sym),
    };
    console.log(`${sym}: snap_keys=${snapKeys} nonnull=${nonNull} updated=${snapAge}  z=${anomaly.zScore.toFixed(3)} exret=${anomaly.excessReturn.toFixed(4)}`);
    await new Promise(r => setTimeout(r, 150));
  }

  fs.writeFileSync(OUT, JSON.stringify({ vectors: dump, meta }, null, 2));
  console.log(`\nWrote ${Object.keys(dump).length} vectors → ${OUT}`);
  process.exit(0);
}
main().catch(e => { console.error('RECON FAILED:', e); process.exit(1); });
