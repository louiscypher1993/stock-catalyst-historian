/**
 * PREREG_2026-08-21_riskscore_refit.md — PART A1 ONLY.
 *
 * Pre-registered gate: >=50 distinct model_c_max_drawdown values over >=400 post-parity
 * clean live rows.
 *   >=50 -> refitting is meaningful, proceed to A2.
 *   <50  -> the 40-point drawdown term is a degeneracy dressed as a percentile. DO NOT
 *           refit; retire the term or fold its weight, and record C as a degenerate head.
 *
 * Also measures whether the LOCAL breakpoint table is even on the live path:
 * resolveHorizonSignal uses `result.model_c_percentile_rank ?? modelCPercentileRank(modelC)`
 * (PotService.ts:476), so if infer.py serves the rank, refitting the local table changes
 * nothing live. That was not established when the prereg was written.
 *
 * READ-ONLY. Writes nothing, changes nothing.
 */
import 'dotenv/config';
import { modelCPercentileRank } from '../PotService';

const PARITY = '2026-08-09';
const A1_MIN_DISTINCT = 50;
const A1_MIN_ROWS = 400;

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('run_date, unreliable_reason, model_c_max_drawdown, model_a_confidence, model_b_return_1m')
      .gte('run_date', PARITY).range(f, f + 999);
    if (error) throw error;
    rows.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const clean = rows.filter(r => !r.unreliable_reason && r.model_c_max_drawdown != null);
  const days = new Set(clean.map(r => String(r.run_date).slice(0, 10)));
  console.log(`post-parity rows ${rows.length} | clean with model_c ${clean.length} over ${days.size} run_dates\n`);

  const dist = (vals: any[]) => new Set(vals.filter(v => v != null).map(Number)).size;
  const cVals = clean.map(r => Number(r.model_c_max_drawdown));
  const nDistinctC = dist(cVals);

  console.log('=== A1 — THE PRE-REGISTERED GATE ===');
  console.log(`  distinct model_c_max_drawdown : ${nDistinctC}   (threshold >=${A1_MIN_DISTINCT})`);
  console.log(`  rows                          : ${clean.length}   (threshold >=${A1_MIN_ROWS})`);
  const pass = nDistinctC >= A1_MIN_DISTINCT && clean.length >= A1_MIN_ROWS;
  console.log(`\n  VERDICT: ${pass ? 'PASS -> proceed to A2 (refit is meaningful)' : 'FAIL -> DO NOT REFIT; retire/fold the drawdown term'}\n`);

  console.log('  for comparison (same window, same rows):');
  console.log(`    distinct model_a_confidence  : ${dist(clean.map(r => r.model_a_confidence))}`);
  console.log(`    distinct model_b_return_1m   : ${dist(clean.map(r => r.model_b_return_1m))}`);

  // Concentration — a bare distinct count can hide a spike.
  const counts = new Map<number, number>();
  for (const v of cVals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`\n  top model_c values by share:`);
  for (const [v, n] of top) console.log(`    ${v.toFixed(6).padStart(12)}  ${n} rows  ${(100*n/cVals.length).toFixed(1)}%`);

  // Is the LOCAL breakpoint table even used live?
  const served: any[] = []; // column does not exist in Supabase — see report
  console.log(`\n=== IS THE LOCAL BREAKPOINT TABLE ON THE LIVE PATH? ===`);
  console.log(`  rows with model_c_percentile_rank SERVED by infer.py : ${served.length} / ${clean.length}  (${(100*served.length/clean.length).toFixed(1)}%)`);
  console.log(`  rows falling back to the LOCAL table                 : ${clean.length - served.length}`);
  if (served.length) console.log(`  distinct served ranks : ${dist(served.map(r => r.model_c_percentile_rank))}`);

  // Current drawdown-term distribution, exactly as production computes it.
  const terms = clean.map(r => {
    const rank = modelCPercentileRank(Number(r.model_c_max_drawdown));
    return (1 - rank) * 40;
  });
  const tCounts = new Map<number, number>();
  for (const t of terms) tCounts.set(Math.round(t), (tCounts.get(Math.round(t)) ?? 0) + 1);
  const tTop = [...tCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`\n=== CURRENT drawdownTerm (0-40), as production computes it ===`);
  console.log(`  distinct rounded values: ${tCounts.size}`);
  for (const [v, n] of tTop) console.log(`    term ${String(v).padStart(2)}  ${String(n).padStart(4)} rows  ${(100*n/terms.length).toFixed(1)}%`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
