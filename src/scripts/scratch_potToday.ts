import 'dotenv/config';
async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();

  const { data: trades } = await supabase.from('pot_trades')
    .select('pot_id, symbol, action, price, position_size_gbp, reason, run_date')
    .gte('run_date', since).order('run_date', { ascending: false });
  console.log(`pot trades in the last 36h: ${trades?.length ?? 0}`);
  for (const t of (trades ?? []).slice(0, 25))
    console.log(`  ${t.run_date.slice(5, 16)} pot ${String(t.pot_id).padStart(2)} ${t.action.padEnd(5)} ` +
      `${String(t.symbol).padEnd(12)} £${Number(t.position_size_gbp).toFixed(0).padStart(5)}  ${t.reason ?? ''}`);

  const { data: pos } = await supabase.from('pot_positions')
    .select('pot_id, symbol, status, entry_date, exit_date, patience_horizon, exit_deadline')
    .eq('status', 'open');
  const open = pos ?? [];
  console.log(`\nopen positions: ${open.length}`);
  const byH: Record<string, number> = {};
  for (const p of open) byH[p.patience_horizon] = (byH[p.patience_horizon] ?? 0) + 1;
  console.log('by horizon:', byH);
  const deadlines = open.map(p => p.exit_deadline).filter(Boolean).sort();
  console.log(`next exit deadline: ${deadlines[0]}   last: ${deadlines[deadlines.length - 1]}`);
  const soon = open.filter(p => p.exit_deadline <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  console.log(`positions due to close within 7 days: ${soon.length}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
