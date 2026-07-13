/**
 * URGENT root-cause STEP 4 + safety-check follow-up: does DVN (drove a real
 * STRONG_BUY entry across 3 pots today, with model_d1_return_3m=0.5/
 * model_d2_return_6m=0.4/model_d3_return_2d=0.2 -- three DIFFERENT horizons
 * simultaneously pegged at their exact clamp ceilings, despite a mundane
 * anomaly signal z_score=0.39/excess_return=0.97%) and the previously-
 * flagged Phenomenon 2 blue-chip cluster (AXP/CVX/O/PLD/TSLA/META/BCE --
 * all confirmed to have RICH symbol_snapshots coverage, not null) show
 * implausible RAW (unclamped) predictions like Phenomenon 1's null-collapsed
 * population did, or genuinely sane raw predictions that just happen to be
 * similar to each other.
 *
 * Read-only: reconstructs real feature vectors via the exact live-path
 * functions (no runLiveInference, no writes), using each symbol's REAL
 * Supabase symbol_snapshots row (confirmed non-null) for enrichment.
 */
import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
} from '../LiveInferenceService';

interface SymbolEnrichment {
  snap: Record<string, any> | null;
  primaryCategory: string | null;
  companyName: string | null;
  sector: string | null;
  exchange: string | null;
}

async function reconstructFor(symbol: string, enrichment: SymbolEnrichment) {
  const bars = await fetchYahooDailyHistory(symbol, '1y');
  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  const anomaly = detectAnomaly(symbol, symbol, bars, spyReturnByDate, /* bypassZGate */ true);
  if (!anomaly) {
    console.log(`${symbol}: detectAnomaly returned NULL (bars.length=${bars.length})`);
    return null;
  }
  const vector = buildFeatureVectorForAnomaly(bars, anomaly, enrichment, null);
  return { symbol, anomaly, vector };
}

async function main() {
  const syms = ['DVN', 'AXP', 'CVX', 'O', 'PLD', 'TSLA', 'META', 'BCE'];
  const { supabase } = await import('../db/supabaseClient');
  const { data: snapRows } = await supabase.from('symbol_snapshots').select('*').in('symbol', syms);
  console.log(`Fetched ${snapRows?.length ?? 0}/${syms.length} real symbol_snapshots rows`);

  const results: Record<string, any> = {};
  for (const sym of syms) {
    const row = (snapRows || []).find((r: any) => r.symbol === sym);
    if (!row) {
      console.log(`${sym}: NO symbol_snapshots row found (unexpected -- was confirmed covered) -- skipping`);
      continue;
    }
    const snapKeys = row.latest_signal_snapshot ? Object.keys(row.latest_signal_snapshot).length : 0;
    const nonNull = row.latest_signal_snapshot
      ? Object.values(row.latest_signal_snapshot).filter((v: any) => v !== null).length : 0;
    console.log(`${sym}: snap_keys=${snapKeys} non_null=${nonNull}`);
    const enrichment: SymbolEnrichment = {
      snap: row.latest_signal_snapshot ?? null, primaryCategory: null,
      companyName: row.company_name ?? null, sector: row.sector ?? null, exchange: row.exchange ?? null,
    };
    const r = await reconstructFor(sym, enrichment);
    if (r) results[sym] = r;
    await new Promise(res => setTimeout(res, 150));
  }

  const fs = await import('fs');
  const dump: Record<string, any> = {};
  for (const [sym, r] of Object.entries(results)) dump[sym] = (r as any).vector;
  fs.writeFileSync(
    'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/193bf814-3002-4d0c-aa2e-09544ef1043c/scratchpad/phenomenon2_vectors.json',
    JSON.stringify(dump, null, 2)
  );

  console.log('\n=== Anomaly signal sanity (z_score / excess_return) per symbol ===');
  for (const [sym, r] of Object.entries(results)) {
    const a = (r as any).anomaly;
    console.log(`  ${sym}: z_score=${a.zScore.toFixed(4)}  excess_return=${a.excessReturn.toFixed(4)}  dayChangePct=${a.dayChangePct.toFixed(4)}`);
  }
  console.log('\nWrote phenomenon2_vectors.json for raw model scoring cross-check');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
