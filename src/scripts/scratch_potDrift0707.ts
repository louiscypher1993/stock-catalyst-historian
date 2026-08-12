/**
 * Was the "2026-07-07 phantom increment" real, or an artefact of my own day-walk?
 * The drift script compared each day against the PREVIOUS DAY PRESENT in that pot's
 * snapshot list. If a pot has no snapshot on some day, the increment silently spans
 * several days while the expected figure only counted one day's exits.
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
  const POTS = [2, 3, 4, 19];
  const snaps = await page<any>((f, t) => supabase.from('pot_snapshots')
    .select('pot_id, run_date, realised_pnl_cumulative').in('pot_id', POTS)
    .gte('run_date', '2026-07-01').lte('run_date', '2026-07-12T23:59:59Z')
    .order('run_date', { ascending: true }).range(f, t));
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('pot_id, symbol, exit_date, realised_pnl, exit_reason').eq('status', 'closed')
    .in('pot_id', POTS).range(f, t));

  for (const potId of POTS) {
    console.log(`\n=== pot ${potId} ===`);
    const daily = new Map<string, number>();
    for (const s of snaps.filter(x => x.pot_id === potId))
      daily.set(String(s.run_date).slice(0, 10), s.realised_pnl_cumulative ?? 0);
    const days = [...daily.keys()].sort();
    console.log('  day         cumulative   closes that day');
    for (const d of days) {
      const cl = pos.filter(p => p.pot_id === potId && p.exit_date === d);
      const sum = cl.reduce((a, b) => a + (b.realised_pnl ?? 0), 0);
      console.log(`  ${d}  ${daily.get(d)!.toFixed(2).padStart(10)}   ` +
        (cl.length ? `${cl.length} close(s) £${sum.toFixed(2)}  ${cl.map(c => `${c.symbol}[${c.exit_reason}]`).join(' ')}` : '-'));
    }
    const gaps: string[] = [];
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(days[i - 1]), cur = new Date(days[i]);
      const dd = (cur.getTime() - prev.getTime()) / 864e5;
      if (dd > 1) gaps.push(`${days[i - 1]} -> ${days[i]} (${dd}d)`);
    }
    console.log(`  snapshot-day gaps: ${gaps.length ? gaps.join(', ') : 'none'}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
