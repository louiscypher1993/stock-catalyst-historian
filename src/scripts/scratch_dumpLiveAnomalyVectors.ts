/**
 * Live feature vectors for symbols that were GENUINELY anomalous, z-matched to training.
 *
 * scratch_dumpLiveVectors.ts forced emission on whatever today looked like, giving a
 * sampled |z| median of 0.31 against a 2.15 training floor. Every magnitude-scaled feature
 * then looked "out of distribution" for the trivial reason that nothing had happened that
 * day -- which produced two false leads (dd6b4e6).
 *
 * This fixes the sampling. It takes symbol/date pairs that the LIVE scanner itself flagged
 * at |z| >= 2.15, then reconstructs each vector AS OF that date by truncating the bar
 * series to end there -- detectAnomaly reads bars[bars.length-1] as the event bar
 * (LiveInferenceService.ts:361), so a truncated series reproduces that day's computation.
 *
 * Caveat kept in view: enrichment.snap is today's snapshot, not the as-of-date one, so the
 * enrichment-sourced fields are current-state. That is exactly what the live path itself
 * does, so it is faithful to production -- but it means this cannot separate
 * "live computes X differently" from "X was different on the day".
 *
 * Usage: npx tsx src/scripts/scratch_dumpLiveAnomalyVectors.ts [limit]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  fetchYahooDailyHistory, buildSpyReturnMap, detectAnomaly, buildFeatureVectorForAnomaly,
} from '../LiveInferenceService';

const LIMIT = Number(process.argv[2] ?? 30);
const OUT = path.join(process.cwd(), 'src', 'ml', 'scratch', 'live_anomaly_vectors.json');

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('inference_results')
    .select('symbol, run_date, z_score, sector, model_c_max_drawdown, model_d3_return_2d, model_b_return_1m')
    .gte('run_date', '2026-07-15').order('run_date', { ascending: false }).limit(4000);
  if (error) throw error;

  // Genuine anomalies only, ONE PER SYMBOL, and spread ACROSS RUN DATES by round-robin.
  // Taking the most recent N gave 30 vectors all from 2026-08-07 and skewed to the day's
  // biggest movers (live atr_shock_score median came out 2x the fold's), which is the same
  // sampling mistake as the quiet-day pass, just in the other direction.
  const anomalies = (data as any[]).filter(r => Math.abs(Number(r.z_score)) >= 2.15);
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
  console.log(`spread across ${dates.length} run_date(s): ${dates[0]}..${dates[dates.length - 1]}`);
  console.log(`live anomalies available: ${(data as any[]).filter(r => Math.abs(Number(r.z_score)) >= 2.15).length}`);
  console.log(`reconstructing ${picks.length} distinct symbols\n`);

  const snapSyms = picks.map(p => p.symbol);
  const { data: snapRows } = await supabase.from('symbol_snapshots').select('*').in('symbol', snapSyms);
  const snapBySymbol = new Map((snapRows || []).map((r: any) => [r.symbol, r]));

  const spyBars = await fetchYahooDailyHistory('SPY', '2y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);

  const vectors: Record<string, any> = {};
  const context: Record<string, any> = {};
  for (const p of picks) {
    try {
      const all = await fetchYahooDailyHistory(p.symbol, '2y');
      // run_date is the SCAN date, but the 07:00 UTC scan runs BEFORE the US close, so
      // live's event bar was frequently the previous session. Truncating at run_date then
      // scores a bar live never saw -- which dropped the rebuilt |z| median to 0.92
      // against a 2.15 floor. Try each candidate cutoff and keep the one that REPRODUCES
      // the stored z_score; a reconstruction that cannot reproduce the number live
      // recorded is not the vector live used, so it is discarded rather than trusted.
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
      if (!anomaly) { console.log(`${p.symbol}: detectAnomaly null`); continue; }
      if (best > 0.05) {
        console.log(`${p.symbol}@${p.run_date}: DISCARD — best rebuild z=${anomaly.zScore.toFixed(2)} ` +
                    `vs stored ${Number(p.z_score).toFixed(2)} (err ${best.toFixed(2)})`);
        continue;
      }
      const row: any = snapBySymbol.get(p.symbol);
      const key = `${p.symbol}@${p.run_date}`;
      // MIRROR LiveInferenceService.ts:1373-1378 EXACTLY. feature_extractor's accessors
      // read `s?.z_score ?? f.z_score` -- snapshot first -- so the live scan deletes these
      // four keys before building the vector to make the FRESH values win. A
      // reconstruction that skips this step feeds the models a stale z from whenever the
      // snapshot was written: on a first pass that produced sign flips on 74% of vectors
      // (MSI fresh +4.60 vs fed -6.27) which looked like a severe production bug and was
      // purely an artefact of not copying these six lines.
      const freshSnap = row?.latest_signal_snapshot ? { ...row.latest_signal_snapshot } : null;
      if (freshSnap) {
        delete freshSnap.z_score;
        delete freshSnap.excess_return;
        delete freshSnap.atr_shock_score;
        delete freshSnap.volume_ratio;
      }
      vectors[key] = buildFeatureVectorForAnomaly(bars, anomaly, {
        snap: freshSnap, primaryCategory: null,
        companyName: row?.company_name ?? null, sector: row?.sector ?? p.sector ?? null,
        exchange: row?.exchange ?? null,
      } as any, null);
      context[key] = {
        stored_z: Number(p.z_score), rebuilt_z: anomaly.zScore, date: anomaly.date,
        stored_c: Number(p.model_c_max_drawdown), stored_d3: Number(p.model_d3_return_2d),
      };
      console.log(`${key}: rebuilt z=${anomaly.zScore.toFixed(2)} (stored ${Number(p.z_score).toFixed(2)})`);
    } catch (e: any) {
      console.log(`${p.symbol}: ERROR ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ vectors, context }, null, 2));
  const zs = Object.values(context).map((c: any) => Math.abs(c.rebuilt_z)).sort((a, b) => a - b);
  console.log(`\nwrote ${OUT} (${Object.keys(vectors).length} vectors)`);
  console.log(`rebuilt |z| median ${zs.length ? zs[Math.floor(zs.length / 2)].toFixed(2) : 'n/a'} ` +
              `— training floor is 2.15, so the populations are now comparable`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
