/** READ-ONLY: did supabase_model_c_rank_migration.sql land, and is the rank populating? */
import 'dotenv/config';
async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const probe = await supabase.from('inference_results')
    .select('run_date, model_c_percentile_rank, model_c_version').limit(1);
  if (probe.error) {
    console.log(`MIGRATION NOT APPLIED — ${probe.error.message}`);
    console.log('  -> run src/db/supabase_model_c_rank_migration.sql in the Supabase SQL editor.');
    console.log('  -> writes are fail-soft, so nothing is broken; the rank is simply not stored.');
    process.exit(0);
  }
  console.log('MIGRATION APPLIED — columns exist.\n');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('run_date, model_c_percentile_rank, model_c_version')
      .gte('run_date', '2026-08-20').range(f, f + 999);
    if (error) throw error;
    rows.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const byDay = new Map<string, { n: number; filled: number; vers: Set<string> }>();
  for (const r of rows) {
    const d = String(r.run_date).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, { n: 0, filled: 0, vers: new Set() });
    const e = byDay.get(d)!; e.n++;
    if (r.model_c_percentile_rank != null) e.filled++;
    if (r.model_c_version) e.vers.add(r.model_c_version);
  }
  console.log('run_date     rows   rank populated   model_c_version');
  for (const d of [...byDay.keys()].sort()) {
    const e = byDay.get(d)!;
    console.log(`${d}   ${String(e.n).padStart(4)}   ${String(e.filled).padStart(4)} (${(100*e.filled/e.n).toFixed(0)}%)      ${[...e.vers].join(',') || '—'}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
