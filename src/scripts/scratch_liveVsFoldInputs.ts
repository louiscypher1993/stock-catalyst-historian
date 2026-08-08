/**
 * Compare the two MODEL INPUTS that live actually stores against the training fold.
 *
 * The output gap (498784f) must originate upstream in the inputs. inference_results keeps
 * only two of the 72 feature columns -- z_score and excess_return -- but they are the two
 * that matter most here: excess_return is a direct model input AND the quantity the
 * z-score is computed from, and it is precisely what the SPY-vs-native benchmark mismatch
 * would corrupt (live hedges every symbol against SPY; training used 11 local benchmarks
 * for 39.1% of rows).
 *
 * Units matter and are checked explicitly. HistoricalEngine stores excess_return divided
 * by 100 (a fraction), per reextractDailyEvents.ts:345 "engine stores /100
 * (EventFeatureVector)". If the live write puts a percentage in the same column, that is a
 * 100x train/serve skew on a primary input and would explain the whole thing on its own.
 *
 * Prints percentiles rather than just medians, because a shifted centre and a shifted
 * SCALE have different causes.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

function pct(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

function describe(name: string, vals: number[]): void {
  const s = vals.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  console.log(`${name.padEnd(22)}${String(s.length).padStart(7)}` +
    [0.01, 0.10, 0.50, 0.90, 0.99].map(q => pct(s, q).toFixed(4).padStart(11)).join('') +
    mean.toFixed(4).padStart(11));
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  const live: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from('inference_results')
      .select('z_score, excess_return, day_change_pct, run_date')
      .gte('run_date', '2026-07-01').range(f, f + 999);
    if (error) throw error;
    live.push(...(data as any[]));
    if (!data || data.length < 1000) break;
  }
  console.log(`live rows since 2026-07-01: ${live.length}\n`);

  // fold side: features.csv, real events at live's own detection floor
  const csv = fs.readFileSync(path.join(process.cwd(), 'src', 'ml', 'features.csv'), 'utf8');
  const lines = csv.split('\n');
  const head = lines[0].split(',');
  const iZ = head.indexOf('z_score');
  const iX = head.indexOf('excess_return');
  const iN = head.indexOf('is_null_sample');
  const iD = head.indexOf('date');
  const foldZ: number[] = [], foldX: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < head.length) continue;
    if (c[iD] < '2025-02-13') continue;            // the held-out fold window
    if (Number(c[iN]) !== 0) continue;             // real events only
    const z = Number(c[iZ]), x = Number(c[iX]);
    if (!Number.isFinite(z) || Math.abs(z) < 2.15) continue;
    foldZ.push(z); foldX.push(x);
  }

  console.log(`${'series'.padEnd(22)}${'n'.padStart(7)}${'p01'.padStart(11)}${'p10'.padStart(11)}` +
              `${'p50'.padStart(11)}${'p90'.padStart(11)}${'p99'.padStart(11)}${'mean'.padStart(11)}`);
  console.log('-'.repeat(84));
  describe('z_score  FOLD', foldZ);
  describe('z_score  LIVE', live.map(r => Number(r.z_score)));
  console.log();
  describe('excess_return FOLD', foldX);
  describe('excess_return LIVE', live.map(r => Number(r.excess_return)));
  console.log();
  describe('day_change_pct LIVE', live.map(r => Number(r.day_change_pct)));

  const fx = foldX.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b);
  const lx = live.map(r => Math.abs(Number(r.excess_return))).filter(Number.isFinite).sort((a, b) => a - b);
  const ratio = pct(lx, 0.5) / pct(fx, 0.5);
  console.log(`\nmedian |excess_return| live / fold = ${ratio.toFixed(2)}x`);
  console.log(ratio > 20
    ? '  >20x — consistent with a PERCENT-vs-FRACTION unit mismatch on a primary input.'
    : '  not a unit-scale mismatch; the difference is distributional.');
}
main();
