/**
 * v17 found that models trained under the production protocol produce D5 predictions
 * whose distribution puts 86.6% of rows below the SELL cutoff -- against a design target
 * of ~10%. But those were models I trained. This asks the only question that matters:
 * what does the DEPLOYED model actually emit live, scored against the same cutoffs?
 *
 * There is precedent for the failure mode: before the v9.3 recalibration, 98.3% of D5 and
 * 87.0% of D3 fold predictions resolved SELL (97/100 live on 2026-07-12). The
 * recalibration fixed it. This checks whether it has drifted back.
 */
import 'dotenv/config';
import { HORIZON_TIER_CONFIG, resolveTierFromConfig } from '../PotService';

async function page<T>(q: (f: number, t: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw error;
    const b = (data ?? []) as T[]; out.push(...b); if (b.length < 1000) break;
  }
  return out;
}

const HEADS: Array<[string, string]> = [
  ['D5', 'model_d5_return_2w'], ['D3', 'model_d3_return_2d'],
  ['D1', 'model_d1_return_3m'], ['D2', 'model_d2_return_6m'],
];

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows = await page<any>((f, t) => supabase.from('inference_results')
    .select('symbol, run_date, recommendation, unreliable_reason, ' + HEADS.map(h => h[1]).join(', '))
    .gte('created_at', '2026-08-09T12:07:00Z')   // post-parity only
    .order('created_at', { ascending: true }).range(f, t));
  const clean = rows.filter(r => !r.unreliable_reason);
  console.log(`post-parity live rows: ${rows.length}  (clean ${clean.length})\n`);

  for (const [head, field] of HEADS) {
    const cfg = (HORIZON_TIER_CONFIG as any)[field];
    const v = clean.map(r => r[field]).filter((x: any) => x != null).map(Number).sort((a, b) => a - b);
    if (!v.length) { console.log(`${head}: no values\n`); continue; }
    const pct = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    const counts: Record<string, number> = {};
    for (const x of v) { const t = resolveTierFromConfig(x, cfg); counts[t] = (counts[t] ?? 0) + 1; }
    console.log(`=== ${head} (${field})  n=${v.length} ===`);
    console.log(`  p10=${pct(0.10).toFixed(4)}  p25=${pct(0.25).toFixed(4)}  median=${pct(0.50).toFixed(4)}` +
                `  p75=${pct(0.75).toFixed(4)}  p90=${pct(0.90).toFixed(4)}`);
    const parts = Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${(100 * n / v.length).toFixed(1)}%`);
    console.log(`  tiers: ${parts.join('   ')}    (design target ~10/10/10/70)\n`);
  }

  const rc: Record<string, number> = {};
  for (const r of clean) if (r.recommendation) rc[r.recommendation] = (rc[r.recommendation] ?? 0) + 1;
  const tot = Object.values(rc).reduce((a, b) => a + b, 0);
  console.log('canonical `recommendation` as actually stored (post-downgrade):');
  for (const [k, n] of Object.entries(rc).sort((a, b) => b[1] - a[1]))
    console.log(`  ${k.padEnd(12)} ${n} (${(100 * n / tot).toFixed(1)}%)`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
