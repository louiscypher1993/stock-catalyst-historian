/**
 * Did the latest run write a snapshot for EVERY pot, or only for pots that acted?
 * 20 of the 24 new pots show "no snapshot yet". That is either (a) normal — snapshots are
 * only written when a pot does something — or (b) the new pots are being skipped, which
 * would silently void the whole comparison. Decide it from the run itself.
 */
import 'dotenv/config';

async function page<T>(q: (f: number, t: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw error;
    const b = (data ?? []) as T[]; out.push(...b); if (b.length < 1000) break;
  }
  return out;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const pots = await page<any>((f, t) => supabase.from('pots').select('pot_id, name, ambition, reactivity, boldness, focus, patience').order('pot_id').range(f, t));
  const snaps = await page<any>((f, t) => supabase.from('pot_snapshots')
    .select('pot_id, run_date').gte('run_date', '2026-08-12T16:00:00Z').range(f, t));
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('pot_id, symbol, entry_date, status').gte('entry_date', '2026-08-12').range(f, t));

  const runs = [...new Set(snaps.map(s => String(s.run_date)))].sort();
  console.log(`snapshot timestamps since 16:00Z: ${runs.length}`);
  for (const r of runs) {
    const ids = new Set(snaps.filter(s => String(s.run_date) === r).map(s => s.pot_id));
    console.log(`  ${r}: ${ids.size} pots  (max pot_id ${Math.max(...ids)})`);
  }

  const wrote = new Set(snaps.map(s => s.pot_id));
  const missing = pots.filter(p => !wrote.has(p.pot_id));
  console.log(`\npots with NO snapshot in this window: ${missing.length} of ${pots.length}`);
  console.log('pot  name                  ratio  bold  focus  patience  openedToday');
  for (const p of missing) {
    const n = pos.filter(x => x.pot_id === p.pot_id).length;
    console.log(`${String(p.pot_id).padStart(3)}  ${String(p.name).padEnd(21)}${(p.ambition / p.reactivity).toFixed(2).padStart(6)}` +
      `${String(p.boldness).padStart(6)}${String(p.focus).padStart(7)}${String(p.patience).padStart(10)}${String(n).padStart(13)}`);
  }
  console.log('\npositions opened today, by pot:');
  const byPot = new Map<number, number>();
  for (const p of pos) byPot.set(p.pot_id, (byPot.get(p.pot_id) ?? 0) + 1);
  for (const [k, v] of [...byPot.entries()].sort((a, b) => a[0] - b[0])) {
    const p = pots.find(x => x.pot_id === k);
    console.log(`  pot ${String(k).padStart(2)} ${String(p?.name).padEnd(21)} ${v} position(s)  ratio ${(p.ambition / p.reactivity).toFixed(2)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
