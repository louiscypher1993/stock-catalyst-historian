/**
 * A1 follow-up: the drawdown term computed BOTH ways on the same live rows.
 *   v9.1 = PotService.ts's local table (the FALLBACK, used by anything reading Supabase)
 *   v9.5 = model_c_breakpoints_v9.5.json, what infer.py actually serves live
 * READ-ONLY.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { modelCPercentileRank } from '../PotService';

const V95: Array<[number, number]> =
  JSON.parse(readFileSync('src/ml/model_c_breakpoints_v9.5.json', 'utf8')).breakpoints;

function rank(bp: Array<[number, number]>, value: number): number {
  if (value <= bp[0][1]) return bp[0][0];
  if (value >= bp[bp.length - 1][1]) return bp[bp.length - 1][0];
  for (let i = 1; i < bp.length; i++) {
    const [pHi, vHi] = bp[i], [pLo, vLo] = bp[i - 1];
    if (value <= vHi) return vHi === vLo ? pHi : pLo + ((value - vLo) / (vHi - vLo)) * (pHi - pLo);
  }
  return 1;
}
const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => s[Math.floor(p * (s.length - 1))];
  return `min ${q(0).toFixed(1)}  p25 ${q(.25).toFixed(1)}  median ${q(.5).toFixed(1)}  p75 ${q(.75).toFixed(1)}  max ${q(1).toFixed(1)}`;
};
const spread = (a: number[]) => new Set(a.map(v => Math.round(v))).size;

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('unreliable_reason, model_c_max_drawdown').gte('run_date', '2026-08-09').range(f, f + 999);
    if (error) throw error;
    rows.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const c = rows.filter(r => !r.unreliable_reason && r.model_c_max_drawdown != null)
                .map(r => Number(r.model_c_max_drawdown));
  console.log(`live post-parity clean rows: ${c.length}\n`);

  const t91 = c.map(v => (1 - modelCPercentileRank(v)) * 40);
  const t95 = c.map(v => (1 - rank(V95, v)) * 40);

  console.log('drawdownTerm (0-40 points):');
  console.log(`  v9.1 local fallback  ${stats(t91)}   distinct(rounded) ${spread(t91)}`);
  console.log(`  v9.5 served live     ${stats(t95)}   distinct(rounded) ${spread(t95)}`);
  const meanDiff = t95.reduce((a, b, i) => a + (b - t91[i]), 0) / c.length;
  console.log(`\n  mean difference (v9.5 - v9.1): ${meanDiff.toFixed(1)} points`);
  const pinned91 = t91.filter(t => t >= 37).length, pinned95 = t95.filter(t => t >= 37).length;
  console.log(`  rows scoring >=37 of 40 : v9.1 ${pinned91} (${(100*pinned91/c.length).toFixed(1)}%)   v9.5 ${pinned95} (${(100*pinned95/c.length).toFixed(1)}%)`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
