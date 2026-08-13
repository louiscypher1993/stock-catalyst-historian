/**
 * Current balance per pot. portfolioValue drives positionGBP = portfolioValue / focus
 * (PotService.ts:850), so this is the number that decides how large every new position is
 * — worth a look after any ledger repair, and useful now the roster is 44 pots.
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
  const pots = await page<any>((f, t) => supabase.from('pots').select('*').order('pot_id').range(f, t));
  const snaps = await page<any>((f, t) => supabase.from('pot_snapshots')
    .select('pot_id, run_date, portfolio_value, realised_pnl_cumulative, open_positions_count')
    .order('run_date', { ascending: true }).range(f, t));

  const latest = new Map<number, any>();
  for (const s of snaps) latest.set(s.pot_id, s);

  console.log(`pots: ${pots.length}\n`);
  console.log('pot  name                   portfolio£  vs start   cumulative£  open  focus  slotSize£');
  console.log('-'.repeat(88));
  let flagged = 0;
  for (const p of pots) {
    const s = latest.get(p.pot_id);
    if (!s) { console.log(`${String(p.pot_id).padStart(3)}  ${String(p.name).padEnd(22)}  (no snapshot yet)`); continue; }
    const pv = s.portfolio_value ?? 0;
    const pct = (pv / p.starting_balance - 1) * 100;
    const slot = pv / p.focus;
    const odd = Math.abs(pct) > 25 ? '  <-- check' : '';
    if (odd) flagged++;
    console.log(`${String(p.pot_id).padStart(3)}  ${String(p.name).padEnd(22)}${pv.toFixed(0).padStart(11)}` +
      `${pct.toFixed(1).padStart(9)}%${(s.realised_pnl_cumulative ?? 0).toFixed(2).padStart(13)}` +
      `${String(s.open_positions_count ?? 0).padStart(6)}${String(p.focus).padStart(7)}${slot.toFixed(0).padStart(11)}${odd}`);
  }
  console.log(`\npots more than 25% from starting balance: ${flagged}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
