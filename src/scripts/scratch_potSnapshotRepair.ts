/**
 * Repair pot_snapshots after the position-level FX fix. DRY RUN unless --apply.
 *
 * WHY IT MATTERS BEYOND THE DASHBOARD. PotService.ts:1263-1273 loads the LATEST snapshot's
 * realised_pnl_cumulative and carries it forward, so the inflation never self-heals. And
 * portfolioValue drives positionGBP = portfolioValue / focus (PotService.ts:850), so the
 * affected pots keep sizing every new position off a balance that includes phantom profit.
 *
 * METHOD. Rather than patch a delta, recompute realised_pnl_cumulative from the (now
 * correct) positions: for each snapshot, cumulative = sum of realised_pnl over that pot's
 * positions closed on or before that snapshot's date. portfolio_value cannot be rebuilt
 * historically -- per-position marks are not retained -- so it is shifted by the SAME
 * correction applied to cumulative, which is exactly the error that entered it.
 */
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');

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
    .select('pot_id, exit_date, realised_pnl, status').eq('status', 'closed').range(f, t));
  const snaps = await page<any>((f, t) => supabase.from('pot_snapshots')
    .select('id, pot_id, run_date, portfolio_value, realised_pnl_cumulative')
    .order('run_date', { ascending: true }).range(f, t));
  console.log(`closed positions ${pos.length} | snapshots ${snaps.length}`);

  const fixes: any[] = [];
  for (const s of snaps) {
    const day = String(s.run_date).slice(0, 10);
    const truth = pos
      .filter(p => p.pot_id === s.pot_id && p.exit_date && p.exit_date <= day)
      .reduce((a, b) => a + (b.realised_pnl ?? 0), 0);
    const diff = truth - (s.realised_pnl_cumulative ?? 0);
    if (Math.abs(diff) > 0.01) {
      fixes.push({ ...s, truth, diff, newPv: (s.portfolio_value ?? 0) + diff });
    }
  }

  console.log(`\nsnapshots needing correction: ${fixes.length}`);
  const byPot = new Map<number, any[]>();
  for (const f of fixes) {
    if (!byPot.has(f.pot_id)) byPot.set(f.pot_id, []);
    byPot.get(f.pot_id)!.push(f);
  }
  console.log(APPLY ? '\n*** APPLY MODE — WILL WRITE ***\n' : '\n--- DRY RUN — no writes ---\n');
  for (const [potId, rows] of [...byPot.entries()].sort((a, b) => a[0] - b[0])) {
    rows.sort((a, b) => String(a.run_date).localeCompare(String(b.run_date)));
    const first = rows[0], last = rows[rows.length - 1];
    console.log(`pot ${potId}: ${rows.length} snapshots  ${String(first.run_date).slice(0, 10)} .. ${String(last.run_date).slice(0, 10)}`);
    console.log(`   first: cumulative £${first.realised_pnl_cumulative?.toFixed(2)} -> £${first.truth.toFixed(2)}   ` +
      `portfolio £${first.portfolio_value?.toFixed(2)} -> £${first.newPv.toFixed(2)}`);
    console.log(`   last : cumulative £${last.realised_pnl_cumulative?.toFixed(2)} -> £${last.truth.toFixed(2)}   ` +
      `portfolio £${last.portfolio_value?.toFixed(2)} -> £${last.newPv.toFixed(2)}  (this row is what the next run carries forward)`);
  }

  if (APPLY) {
    let n = 0;
    for (const f of fixes) {
      const { error } = await supabase.from('pot_snapshots')
        .update({
          realised_pnl_cumulative: parseFloat(f.truth.toFixed(2)),
          portfolio_value: parseFloat(f.newPv.toFixed(2)),
        })
        .eq('id', f.id);
      if (error) throw error;
      if (++n % 25 === 0) console.log(`  ...${n}/${fixes.length}`);
    }
    console.log(`\nWROTE ${n} snapshot rows.`);
  } else if (fixes.length) {
    console.log('\nRe-run with --apply to write.');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
