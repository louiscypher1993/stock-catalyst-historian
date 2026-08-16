/** READ-ONLY — lists the live pot roster to reconcile against TODO.md's "existing 20". */
import 'dotenv/config';
async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data: pots } = await supabase.from('pots')
    .select('pot_id, name, boldness, ambition, patience, conviction, focus, reactivity, starting_balance')
    .order('pot_id', { ascending: true });
  const { data: pos } = await supabase.from('pot_positions').select('pot_id, status');
  const open = new Map<number, number>(), closed = new Map<number, number>();
  for (const p of pos ?? []) {
    const m = p.status === 'open' ? open : closed;
    m.set(p.pot_id, (m.get(p.pot_id) ?? 0) + 1);
  }
  console.log('id   name                      bold  amb  pat  conv  focus  react  ratio  open  closed');
  for (const p of pots ?? []) {
    const ratio = p.reactivity ? p.ambition / p.reactivity : NaN;
    console.log(
      `${String(p.pot_id).padStart(3)}  ${String(p.name).padEnd(24)} ` +
      `${String(p.boldness).padStart(5)} ${String(p.ambition).padStart(4)} ${String(p.patience).padStart(4)} ` +
      `${String(p.conviction).padStart(5)} ${String(p.focus).padStart(6)} ${String(p.reactivity).padStart(6)} ` +
      `${ratio.toFixed(2).padStart(6)} ${String(open.get(p.pot_id) ?? 0).padStart(5)} ${String(closed.get(p.pot_id) ?? 0).padStart(7)}`);
  }
  console.log(`\ntotal pots: ${pots?.length}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
