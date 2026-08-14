/**
 * What can we learn from this morning's run (2026-08-10 07:00 UTC trigger, actually
 * ran 08:21-08:31 UTC)? This run is POST-parity-fix but PRE-expansion (checkout
 * happened before the 10:29 UTC expansion commit) -- a clean data point for parity
 * health, independent of the expansion, extending the n=4 Monday check.
 */
import 'dotenv/config';

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('inference_results')
    .select('symbol, run_date, created_at, unreliable_reason, z_score, sector, ' +
      'model_b_return_1m, model_c_max_drawdown, model_d3_return_2d, model_d5_return_2w, risk_score')
    .gte('created_at', '2026-08-10T08:20:00Z').lt('created_at', '2026-08-10T08:32:00Z')
    .order('created_at', { ascending: true });
  if (error) throw error;
  // Cast is required, not cosmetic: the select list is built by string concatenation, so
  // supabase-js cannot infer the row shape and widens `data` to its error union --
  // which made every field access below a type error and left `npm run lint` red.
  const rows = (data ?? []) as any[];
  console.log(`rows: ${rows.length}`);

  const clean = rows.filter(r => !r.unreliable_reason);
  const unrel = rows.filter(r => r.unreliable_reason);
  console.log(`clean: ${clean.length}  |  unreliable: ${unrel.length}`);

  console.log('\n--- clean rows (post-parity, pre-expansion universe) ---');
  for (const r of clean) {
    console.log(`${r.symbol.padEnd(10)} z=${Number(r.z_score).toFixed(2).padStart(6)}  ` +
      `B=${Number(r.model_b_return_1m).toFixed(4)}  C=${Number(r.model_c_max_drawdown).toFixed(4)}  ` +
      `D3=${Number(r.model_d3_return_2d).toFixed(4)}  D5=${Number(r.model_d5_return_2w).toFixed(4)}  ` +
      `risk=${r.risk_score}`);
  }

  console.log('\n--- unreliable rows: checking for Phenomenon-1 clone symptom (identical D5/D2-style outputs) ---');
  const byD5 = new Map<string, string[]>();
  for (const r of unrel) {
    const k = Number(r.model_d5_return_2w).toFixed(4);
    if (!byD5.has(k)) byD5.set(k, []);
    byD5.get(k)!.push(r.symbol);
  }
  const clones = [...byD5.entries()].filter(([, syms]) => syms.length >= 3);
  if (clones.length) {
    for (const [v, syms] of clones) console.log(`  D5=${v} shared by ${syms.length}: ${syms.join(', ')}`);
  } else {
    console.log('  none -- no D5 value shared by 3+ symbols in this run');
  }

  const riskVals = rows.map(r => r.risk_score).filter((v): v is number => v != null).sort((a, b) => a - b);
  if (riskVals.length) {
    console.log(`\nrisk_score this run: min=${riskVals[0]} p50=${riskVals[Math.floor(riskVals.length / 2)]} max=${riskVals[riskVals.length - 1]}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
