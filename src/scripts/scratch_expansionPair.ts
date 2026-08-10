/**
 * Universe expansion pre-measurement: what changes in the feature vector, and in the
 * model scores, when the SAME anomaly is scored WITHOUT any enrichment?
 *
 * A symbol added to GLOBAL_MARKETS that never went through the historical batch scan has:
 *   - no symbol_snapshots row  -> snap = null (every snapshot-sourced feature nulls out)
 *   - no event_features row    -> primaryCategory = null -> defaults to 'market_structure'
 *   - no profile/sector        -> sector one-hots all 0 AND competitor_event_density = 0
 *     (competitorDensityFrom returns 0 on null sector even under LIVE_FEATURE_PARITY=ced)
 *
 * This script reuses the verified reconstruction approach from
 * scratch_dumpLiveAnomalyVectors.ts (z-score self-verification, snapshot-key deletion,
 * round-robin date sampling) and emits BOTH arms per anomaly so the Python side can
 * measure paired per-head deltas and derive the exact changed-column set.
 *
 * Usage: LIVE_FEATURE_PARITY=all npx tsx src/scripts/scratch_expansionPair.ts [limit]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  fetchYahooDailyHistory, buildSpyReturnMap, detectAnomaly, buildFeatureVectorForAnomaly,
  buildCompetitorDensityMap, competitorDensityFrom, LIVE_FEATURE_PARITY_CED,
} from '../LiveInferenceService';

const LIMIT = Number(process.argv[2] ?? 40);
const OUT = path.join(process.cwd(), 'src', 'ml', 'scratch', 'expansion_pairs.json');

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('inference_results')
    .select('symbol, run_date, z_score, sector, unreliable_reason')
    .gte('run_date', '2026-07-15').order('run_date', { ascending: false }).limit(4000);
  if (error) throw error;

  // Genuine anomalies with CLEAN enrichment only -- the pairing needs a real `with` arm.
  const anomalies = (data as any[]).filter(r =>
    Math.abs(Number(r.z_score)) >= 2.15 && !r.unreliable_reason);
  const byDate = new Map<string, any[]>();
  for (const r of anomalies) {
    const d = String(r.run_date).slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(r);
  }
  const dates = [...byDate.keys()].sort();
  const seen = new Set<string>();
  const picks: any[] = [];
  for (let i = 0; picks.length < LIMIT && i < 500; i++) {
    let progressed = false;
    for (const d of dates) {
      const bucket = byDate.get(d)!;
      if (i >= bucket.length) continue;
      progressed = true;
      const r = bucket[i];
      if (seen.has(r.symbol)) continue;
      seen.add(r.symbol); picks.push(r);
      if (picks.length >= LIMIT) break;
    }
    if (!progressed) break;
  }
  console.log(`spread across ${dates.length} run_date(s); reconstructing ${picks.length} symbols`);

  const { data: snapRows } = await supabase.from('symbol_snapshots')
    .select('*').in('symbol', picks.map(p => p.symbol));
  const snapBySymbol = new Map((snapRows || []).map((r: any) => [r.symbol, r]));

  const spyBars = await fetchYahooDailyHistory('SPY', '2y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  const densityMap = LIVE_FEATURE_PARITY_CED
    ? await buildCompetitorDensityMap(picks[0]?.run_date ?? new Date().toISOString().slice(0, 10))
    : new Map<string, Array<{ symbol: string; date: string }>>();

  const pairs: Record<string, { with: Record<string, number>; without: Record<string, number> }> = {};
  const changed = new Set<string>();
  for (const p of picks) {
    try {
      const all = await fetchYahooDailyHistory(p.symbol, '2y');
      let anomaly: any = null, bars: any[] = [];
      let best = Infinity;
      const upTo = all.filter(b => b.date <= p.run_date);
      for (const drop of [0, 1, 2]) {
        const cand = upTo.slice(0, upTo.length - drop);
        if (cand.length < 120) continue;
        const a = detectAnomaly(p.symbol, p.symbol, cand, spyReturnByDate, true);
        if (!a) continue;
        const err = Math.abs(a.zScore - Number(p.z_score));
        if (err < best) { best = err; anomaly = a; bars = cand; }
      }
      if (!anomaly || best > 0.05) {
        console.log(`${p.symbol}@${p.run_date}: DISCARD (rebuild err ${best === Infinity ? 'n/a' : best.toFixed(2)})`);
        continue;
      }
      const row: any = snapBySymbol.get(p.symbol);
      if (!row?.latest_signal_snapshot) { console.log(`${p.symbol}: no snapshot, skip`); continue; }
      // Mirror LiveInferenceService.ts fresh-wins deletions exactly (see
      // scratch_dumpLiveAnomalyVectors.ts for the failure mode this prevents).
      const freshSnap = { ...row.latest_signal_snapshot };
      delete freshSnap.z_score;
      delete freshSnap.excess_return;
      delete freshSnap.atr_shock_score;
      delete freshSnap.volume_ratio;
      const sector = row?.sector ?? p.sector ?? null;
      const dWith = LIVE_FEATURE_PARITY_CED
        ? competitorDensityFrom(densityMap, p.symbol, sector, anomaly.date) : null;

      const key = `${p.symbol}@${p.run_date}`;
      const withVec = buildFeatureVectorForAnomaly(bars, anomaly, {
        snap: freshSnap, primaryCategory: null,
        companyName: row?.company_name ?? null, sector,
        exchange: row?.exchange ?? null,
      } as any, null, dWith);
      // The `without` arm is EXACTLY what getSymbolSnapshot returns for an unknown
      // symbol: every field null. Density goes through the same call the scan loop
      // makes, with the null sector an unknown symbol would have -> 0.
      const dWithout = LIVE_FEATURE_PARITY_CED
        ? competitorDensityFrom(densityMap, p.symbol, null, anomaly.date) : null;
      const withoutVec = buildFeatureVectorForAnomaly(bars, anomaly, {
        snap: null, primaryCategory: null, companyName: null, sector: null, exchange: null,
      } as any, null, dWithout);

      pairs[key] = { with: withVec, without: withoutVec };
      for (const c of Object.keys(withVec)) {
        if ((withVec[c] ?? 0) !== (withoutVec[c] ?? 0)) changed.add(c);
      }
      console.log(`${key}: z=${anomaly.zScore.toFixed(2)} ok`);
    } catch (e: any) {
      console.log(`${p.symbol}: ERROR ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ pairs, changedColumns: [...changed].sort() }, null, 2));
  console.log(`\nwrote ${OUT}: ${Object.keys(pairs).length} pairs, ${changed.size} columns differ`);
  console.log([...changed].sort().join(', '));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
