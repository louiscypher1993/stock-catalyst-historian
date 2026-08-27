/**
 * Backfill inference_results.model_c_percentile_rank + model_c_version.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * WHY THIS IS RECONSTRUCTION AND NOT INVENTION. The rank is a deterministic function of
 * model_c_max_drawdown (which IS stored) evaluated against the breakpoints of the Model C
 * version that produced the row — exactly what infer.py computes. Nothing is estimated.
 *
 * VERSION SPLIT. MODEL_C_VERSION=9.5 was enabled on both inference entry points at
 * e745e08, 2026-08-06 16:46:57 UTC. run_date is a DATE and the flip landed mid-day, so
 * the split uses created_at (TIMESTAMPTZ, set on first insert) instead. Rows created
 * before the flip are ranked against the v9.1 table in PotService.ts; rows after,
 * against model_c_breakpoints_v9.5.json. Pairing a model with the other version's
 * breakpoints shifts the drawdown term by ~22 points — recreating, in reverse, the bug
 * this backfill exists to close.
 *
 * SAFETY. Only rows where model_c_percentile_rank IS NULL are touched, so no existing
 * value can be overwritten and a re-run is a no-op. Writes only those two columns.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { modelCPercentileRank } from '../PotService';

const APPLY = process.argv.includes('--apply');
const FLIP_UTC = '2026-08-06T16:46:57Z';
const V95: Array<[number, number]> =
  JSON.parse(readFileSync('src/ml/model_c_breakpoints_v9.5.json', 'utf8')).breakpoints;

function rankV95(value: number): number {
  const bp = V95;
  if (value <= bp[0][1]) return bp[0][0];
  if (value >= bp[bp.length - 1][1]) return bp[bp.length - 1][0];
  for (let i = 1; i < bp.length; i++) {
    const [pHi, vHi] = bp[i], [pLo, vLo] = bp[i - 1];
    if (value <= vHi) return vHi === vLo ? pHi : pLo + ((value - vLo) / (vHi - vLo)) * (pHi - pLo);
  }
  return 1;
}
const stats = (a: number[]) => {
  if (!a.length) return 'n/a';
  const s = [...a].sort((x, y) => x - y), q = (p: number) => s[Math.floor(p * (s.length - 1))];
  return `min ${q(0).toFixed(1)} p25 ${q(.25).toFixed(1)} median ${q(.5).toFixed(1)} p75 ${q(.75).toFixed(1)} max ${q(1).toFixed(1)}`;
};

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('id, run_date, created_at, model_c_max_drawdown, model_c_percentile_rank, model_c_version')
      .is('model_c_percentile_rank', null).range(f, f + 999);
    if (error) throw error;
    rows.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const todo = rows.filter(r => r.model_c_max_drawdown != null);
  console.log(`rows with a NULL rank            : ${rows.length}`);
  console.log(`  ...of which have model_c       : ${todo.length}  (the backfillable set)`);
  console.log(`  ...no model_c, left untouched  : ${rows.length - todo.length}\n`);
  if (!todo.length) { console.log('nothing to do.'); process.exit(0); }

  const planned = todo.map(r => {
    const v = Number(r.model_c_max_drawdown);
    const isV95 = new Date(r.created_at).toISOString() >= new Date(FLIP_UTC).toISOString();
    return { id: r.id, run_date: String(r.run_date).slice(0, 10), created_at: r.created_at,
             version: isV95 ? '9.5' : '9.1',
             rank: isV95 ? rankV95(v) : modelCPercentileRank(v) };
  });
  const v95 = planned.filter(p => p.version === '9.5'), v91 = planned.filter(p => p.version === '9.1');
  console.log(`version split at the e745e08 flip (${FLIP_UTC}), by created_at:`);
  // MIN/MAX, not first/last: the query has no ORDER BY, so array order is arbitrary and
  // printing [0] and [n-1] as a range silently misreports it.
  const span = (a: typeof planned) => {
    if (!a.length) return '—';
    const d = a.map(x => x.run_date).sort();
    return `${d[0]} .. ${d[d.length - 1]}  (${new Set(d).size} run_dates)`;
  };
  console.log(`  v9.1 (pre-flip)  ${String(v91.length).padStart(5)}   ${span(v91)}`);
  console.log(`  v9.5 (post-flip) ${String(v95.length).padStart(5)}   ${span(v95)}`);
  const overlap = v91.filter(a => v95.some(b => b.run_date === a.run_date)).length;
  if (overlap) console.log(`  ⚠ ${overlap} v9.1 rows share a run_date with v9.5 rows — expected only on the flip date`);

  // Boundary exposure: created_at is insert time, a proxy for inference time.
  const near = planned.filter(p => Math.abs(new Date(p.created_at).getTime() - new Date(FLIP_UTC).getTime()) < 2*3600*1000);
  console.log(`  rows within +/-2h of the flip (boundary risk): ${near.length}`);

  console.log(`\nresulting drawdownTerm (1-rank)*40:`);
  console.log(`  v9.1 rows  ${stats(v91.map(p => (1 - p.rank) * 40))}`);
  console.log(`  v9.5 rows  ${stats(v95.map(p => (1 - p.rank) * 40))}`);

  const post = planned.filter(p => p.run_date >= '2026-08-09');
  console.log(`\npost-parity rows fixed by this (the window Part B and C2 read): ${post.length}`);

  if (!APPLY) { console.log('\n--- DRY RUN — no writes. Re-run with --apply to write. ---'); process.exit(0); }

  console.log('\n*** APPLY MODE — WRITING ***');
  let done = 0, failed = 0;
  for (let i = 0; i < planned.length; i += 50) {
    const chunk = planned.slice(i, i + 50);
    const res = await Promise.all(chunk.map(p => supabase.from('inference_results')
      .update({ model_c_percentile_rank: Number(p.rank.toFixed(6)), model_c_version: p.version })
      .eq('id', p.id)
      .is('model_c_percentile_rank', null)));   // never overwrite a value written since the read
    for (const r of res) { if (r.error) { failed++; if (failed <= 3) console.error('  ', r.error.message); } else done++; }
    process.stdout.write(`\r  ${done + failed}/${planned.length}`);
  }
  console.log(`\n  updated ${done}, failed ${failed}`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
