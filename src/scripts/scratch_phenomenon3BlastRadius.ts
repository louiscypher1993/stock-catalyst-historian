/**
 * Phenomenon 3 blast-radius recon (read-only): for the top-severity
 * candidates (ranked by |z_score| + 10*|excess_return| in their stale,
 * 2026-06-13-dated symbol_snapshots row), reconstruct the REAL fresh
 * feature vector (today's real bars/anomaly) vs the STALE-OVERRIDDEN
 * vector (what the live pipeline actually feeds the model right now,
 * given the confirmed s?.field ?? f.field accessor bug), run both through
 * the real deployed infer.py, and report the divergence. Same method as
 * the DVN corrected-replay. No writes, no decidePot/applyPotActions calls.
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

const CANDIDATES = process.argv.slice(2);

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data: snapRows } = await supabase.from('symbol_snapshots').select('*').in('symbol', CANDIDATES);
  const snapBySymbol = new Map((snapRows || []).map((r: any) => [r.symbol, r]));

  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);

  const freshVectors: Record<string, any> = {};
  const staleVectors: Record<string, any> = {};
  const context: Record<string, any> = {};

  for (const symbol of CANDIDATES) {
    try {
      const row: any = snapBySymbol.get(symbol);
      if (!row) { console.log(`${symbol}: no snapshot row found, skipping`); continue; }
      const bars = await fetchYahooDailyHistory(symbol, '1y');
      const anomaly = detectAnomaly(symbol, symbol, bars, spyReturnByDate, true);
      if (!anomaly) { console.log(`${symbol}: detectAnomaly null (bars=${bars.length}), skipping`); continue; }

      const staleSnap = row.latest_signal_snapshot ?? {};
      const enrichmentStale: SymbolEnrichment = {
        snap: staleSnap, primaryCategory: null,
        companyName: row.company_name ?? null, sector: row.sector ?? null, exchange: row.exchange ?? null,
      };
      const correctedSnap = { ...staleSnap };
      delete correctedSnap.z_score; delete correctedSnap.excess_return;
      delete correctedSnap.atr_shock_score; delete correctedSnap.volume_ratio;
      const enrichmentFresh: SymbolEnrichment = { ...enrichmentStale, snap: correctedSnap };

      staleVectors[symbol] = buildFeatureVectorForAnomaly(bars, anomaly, enrichmentStale, null);
      freshVectors[symbol] = buildFeatureVectorForAnomaly(bars, anomaly, enrichmentFresh, null);
      context[symbol] = {
        fresh_z: anomaly.zScore, fresh_excess_return: anomaly.excessReturn,
        stale_z: staleSnap.z_score, stale_excess_return: staleSnap.excess_return,
      };
      console.log(`${symbol}: OK (fresh z=${anomaly.zScore.toFixed(3)} vs stale z=${staleSnap.z_score})`);
    } catch (e: any) {
      console.log(`${symbol}: ERROR ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 120));
  }

  const fs = await import('fs');
  const out = 'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/193bf814-3002-4d0c-aa2e-09544ef1043c/scratchpad/blast_radius_vectors.json';
  fs.writeFileSync(out, JSON.stringify({ fresh: freshVectors, stale: staleVectors, context }, null, 2));
  console.log(`\nWrote ${out}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
