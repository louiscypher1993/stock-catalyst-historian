/**
 * URGENT RECON (read-only): reconstruct the ACTUAL live feature vector for a
 * set of symbols observed sharing near-identical inference_results outputs,
 * to determine whether the collapse is real, structural, and traceable.
 *
 * Calls the exact exported live-path functions used by runLiveInference
 * (fetchYahooDailyHistory, buildSpyReturnMap, detectAnomaly,
 * buildFeatureVectorForAnomaly) -- NOT runLiveInference itself, and does
 * NOT write anywhere. For enrichment, reproduces exactly what getSymbolSnapshot
 * returns on a FRESH GitHub Actions checkout (where local SQLite is empty,
 * confirmed by reading getSymbolSnapshot's own header comment + fallback
 * logic) rather than this repo's populated local db, since that's the
 * environment the real live scans actually run in.
 */
import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
} from '../LiveInferenceService';

// SymbolEnrichment isn't exported from LiveInferenceService.ts -- inline
// shape matches it structurally (same fields getSymbolSnapshot returns).
interface SymbolEnrichment {
  snap: Record<string, any> | null;
  primaryCategory: string | null;
  companyName: string | null;
  sector: string | null;
  exchange: string | null;
}

const NULL_ENRICHMENT: SymbolEnrichment = {
  snap: null, primaryCategory: null, companyName: null, sector: null, exchange: null,
};

async function reconstructFor(symbol: string, enrichment: SymbolEnrichment) {
  const bars = await fetchYahooDailyHistory(symbol, '1y');
  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  const anomaly = detectAnomaly(symbol, symbol, bars, spyReturnByDate, /* bypassZGate */ true);
  if (!anomaly) {
    console.log(`${symbol}: detectAnomaly returned NULL (bars.length=${bars.length}) -- cannot build vector`);
    return null;
  }
  const vector = buildFeatureVectorForAnomaly(bars, anomaly, enrichment, null);
  return { symbol, barsLength: bars.length, anomaly, vector };
}

async function main() {
  const results: Record<string, any> = {};

  // Group A: confirmed ZERO Supabase symbol_snapshots coverage -- fresh-CI
  // fallback is the fully-null default.
  for (const sym of ['PKO.WA', 'GFC.PA', 'XBI', 'BBAR', 'SNP.RO', 'MOH.AT']) {
    const r = await reconstructFor(sym, NULL_ENRICHMENT);
    if (r) results[sym] = r;
    await new Promise(res => setTimeout(res, 150));
  }

  console.log('\n=== Group A (confirmed snap=null) feature vector comparison ===');
  const groupASymbols = Object.keys(results);
  if (groupASymbols.length >= 2) {
    const vectors = groupASymbols.map(s => results[s].vector);
    const allKeys = Array.from(new Set(vectors.flatMap(v => Object.keys(v)))).sort();
    let identicalCount = 0, differingCount = 0;
    const differingKeys: string[] = [];
    for (const key of allKeys) {
      const vals = vectors.map(v => v[key]);
      const allSame = vals.every(v => v === vals[0]);
      if (allSame) identicalCount++;
      else { differingCount++; differingKeys.push(key); }
    }
    console.log(`Total feature keys: ${allKeys.length}`);
    console.log(`IDENTICAL across all ${groupASymbols.length} symbols: ${identicalCount}`);
    console.log(`DIFFERING across symbols: ${differingCount}`);
    console.log(`Differing keys: ${differingKeys.join(', ')}`);
    console.log('\nPer-symbol values for the differing keys:');
    for (const sym of groupASymbols) {
      const row = differingKeys.map(k => `${k}=${results[sym].vector[k]}`).join('  ');
      console.log(`  ${sym}: ${row}`);
    }
  }

  // Group B: confirmed REAL Supabase symbol_snapshots coverage -- reproduce
  // exactly what the real live run's getSymbolSnapshot() fallback (Supabase
  // symbol_snapshots table) returns, per lines 461-469 of LiveInferenceService.ts.
  const { supabase } = await import('../db/supabaseClient');
  const groupBSyms = ['AKRBP.OL', 'EVN.AX', 'WPP.L', 'ITSA4.SA'];
  const { data: snapRows } = await supabase.from('symbol_snapshots').select('*').in('symbol', groupBSyms);
  console.log(`\nFetched ${snapRows?.length ?? 0} real symbol_snapshots rows for Group B`);

  for (const sym of groupBSyms) {
    const row = (snapRows || []).find((r: any) => r.symbol === sym);
    const enrichment: SymbolEnrichment = row
      ? { snap: row.latest_signal_snapshot ?? null, primaryCategory: null, companyName: row.company_name ?? null, sector: row.sector ?? null, exchange: row.exchange ?? null }
      : NULL_ENRICHMENT;
    const r = await reconstructFor(sym, enrichment);
    if (r) results[sym] = r;
    await new Promise(res => setTimeout(res, 150));
  }

  console.log('\n=== Group B (real symbol_snapshots) feature vector comparison ===');
  const gbVectors = groupBSyms.filter(s => results[s]).map(s => results[s].vector);
  if (gbVectors.length >= 2) {
    const allKeys = Array.from(new Set(gbVectors.flatMap(v => Object.keys(v)))).sort();
    let identicalCount = 0;
    const differingKeys: string[] = [];
    for (const key of allKeys) {
      const vals = gbVectors.map(v => v[key]);
      const allSame = vals.every(v => v === vals[0]);
      if (allSame) identicalCount++; else differingKeys.push(key);
    }
    console.log(`Total feature keys: ${allKeys.length}, IDENTICAL: ${identicalCount}, DIFFERING: ${differingKeys.length}`);
  }

  // dump full vectors to disk for python cross-check (raw model scoring)
  const fs = await import('fs');
  const dump: Record<string, any> = {};
  for (const [sym, r] of Object.entries(results)) dump[sym] = (r as any).vector;
  fs.writeFileSync(
    'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/193bf814-3002-4d0c-aa2e-09544ef1043c/scratchpad/reconstructed_vectors.json',
    JSON.stringify(dump, null, 2)
  );
  console.log('\nWrote reconstructed_vectors.json for raw model scoring cross-check');

  // sanity: print zero-count per symbol (how "collapsed" is each vector)
  console.log('\n=== Zero-value count per symbol (of numeric feature keys) ===');
  for (const [sym, r] of Object.entries(results)) {
    const v = (r as any).vector;
    const numericKeys = Object.keys(v).filter(k => typeof v[k] === 'number');
    const zeroCount = numericKeys.filter(k => v[k] === 0).length;
    console.log(`  ${sym}: ${zeroCount}/${numericKeys.length} numeric features are exactly 0  (z_score=${v.z_score?.toFixed?.(4)}, excess_return=${v.excess_return?.toFixed?.(4)})`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
