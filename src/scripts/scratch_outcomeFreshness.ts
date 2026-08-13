/**
 * Did the Outcome Tracker actually WRITE anything, or just go green?
 * outcome_tracker.db is gitignored and lives on the runner, so the durable record is the
 * Supabase outcome_results mirror. A green run that mirrors nothing is the exact
 * silent-failure shape that hid the ClinicalTrials breakage for three weeks.
 */
import 'dotenv/config';

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('outcome_results')
    .select('symbol, run_date, horizon, actual_return, checked_at')
    .order('checked_at', { ascending: false }).limit(5);
  if (error) { console.error('outcome_results query failed:', error.message); process.exit(1); }
  const rows = data ?? [];
  console.log(`newest outcome_results rows: ${rows.length}`);
  for (const r of rows)
    console.log(`  ${r.checked_at?.slice(0, 16)}  ${String(r.symbol).padEnd(10)} ${String(r.horizon).padEnd(4)} ` +
      `actual ${r.actual_return == null ? 'null' : Number(r.actual_return).toFixed(4)}  (run ${String(r.run_date).slice(0, 10)})`);

  const { count } = await supabase.from('outcome_results')
    .select('*', { count: 'exact', head: true })
    .gte('checked_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString());
  console.log(`\nrows checked in the last 6h: ${count ?? 0}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
