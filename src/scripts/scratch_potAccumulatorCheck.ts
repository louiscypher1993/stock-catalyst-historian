/**
 * Is realised_pnl_cumulative CORRUPT, or does it just measure a different window?
 *
 * It is a running accumulator (PotService.ts:819) seeded from the previous snapshot, so it
 * only ever counts exits PROCESSED BY A RUN. Positions that closed before a pot's first
 * snapshot -- or that were written out-of-band by a repair script -- would never enter it.
 * If the first-snapshot discrepancy equals the P&L of positions closed before that date,
 * the field is fine and my recompute would have REDEFINED it, not repaired it.
 */
import 'dotenv/config';

async function page<T>(q: (f: number, t: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw error;
    const b = (data ?? []) as T[];
    out.push(...b); if (b.length < 1000) break;
  }
  return out;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('pot_id, exit_date, realised_pnl, exit_reason, status').eq('status', 'closed').range(f, t));
  const snaps = await page<any>((f, t) => supabase.from('pot_snapshots')
    .select('pot_id, run_date, realised_pnl_cumulative').order('run_date', { ascending: true }).range(f, t));

  const firstSnap = new Map<number, any>();
  for (const s of snaps) if (!firstSnap.has(s.pot_id)) firstSnap.set(s.pot_id, s);

  console.log('pot  firstSnap    cum@first  preSnapPnL  explained?   corrections  postFirstDiff');
  console.log('-'.repeat(88));
  for (const [potId, s] of [...firstSnap.entries()].sort((a, b) => a[0] - b[0])) {
    const day = String(s.run_date).slice(0, 10);
    const mine = pos.filter(p => p.pot_id === potId);
    const pre = mine.filter(p => p.exit_date && p.exit_date < day);
    const preSum = pre.reduce((a, b) => a + (b.realised_pnl ?? 0), 0);
    const cum = s.realised_pnl_cumulative ?? 0;
    const corr = mine.filter(p => p.exit_reason === 'manual_correction')
      .reduce((a, b) => a + (b.realised_pnl ?? 0), 0);
    // if the accumulator simply missed pre-snapshot closes, cum should be ~0 and preSum
    // should equal the gap between cum and the all-time sum at that date
    const allAtFirst = mine.filter(p => p.exit_date && p.exit_date <= day)
      .reduce((a, b) => a + (b.realised_pnl ?? 0), 0);
    const gap = allAtFirst - cum;
    const explained = Math.abs(gap - preSum) < 1 ? 'YES' : 'no';
    console.log(`${String(potId).padStart(3)}  ${day}  ${cum.toFixed(2).padStart(9)}  ` +
      `${preSum.toFixed(2).padStart(10)}  ${explained.padStart(9)}   ${corr.toFixed(2).padStart(10)}  ${(gap - preSum).toFixed(2).padStart(13)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
