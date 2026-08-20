/** READ-ONLY readiness check for PREREG_2026-08-21_riskscore_refit.md. Counts only. */
import 'dotenv/config';
async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const out: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('run_date, unreliable_reason, model_c_max_drawdown')
      .gte('run_date', '2026-08-09').range(f, f + 999);
    if (error) throw error;
    out.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const clean = out.filter(r => !r.unreliable_reason);
  const days = new Set(clean.map(r => String(r.run_date).slice(0, 10)));
  const cVals = clean.map(r => r.model_c_max_drawdown).filter(v => v != null);
  console.log(`post-parity rows        : ${out.length}`);
  console.log(`  clean (unquarantined) : ${clean.length}   over ${days.size} run_dates`);
  console.log(`  with model_c non-null : ${cVals.length}`);
  console.log(`\nPREREG A1 gate needs >=400 clean rows : ${clean.length >= 400 ? 'MET' : 'NOT MET'}`);
  console.log(`(distinct-value count is A1 itself and is NOT run here.)`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
