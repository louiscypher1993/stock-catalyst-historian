/**
 * (1) TARGETED FX-ONLY snapshot fix. DRY RUN unless --apply.
 *
 * Fixes ONLY the known FX inflation in pots 3/10/13 and deliberately leaves the separate,
 * not-yet-understood accumulator drift alone. Scoped this way because a full recompute
 * would REDEFINE realised_pnl_cumulative (a running accumulator, PotService.ts:819) rather
 * than repair it, silently absorbing a defect nobody has explained yet.
 *
 * Why it is not cosmetic: portfolioValue = starting_balance + totalRealisedPnl
 * (PotService.ts:822) and positionGBP = portfolioValue / focus (:850), so until this is
 * corrected these three pots size every new position off phantom profit.
 *
 * Deltas are the exact position-level corrections already applied by
 * scratch_potFxRepairPreview.ts --apply (new realised_pnl minus old). They are hardcoded
 * because the source rows are now repaired and the delta can no longer be re-derived.
 */
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');

// pot_id, exit_date of the broken position, delta to apply from that date onward
const CORRECTIONS: Array<{ potId: number; fromDate: string; delta: number; posId: number }> = [
  { potId: 3,  fromDate: '2026-07-15', delta: -3676.95, posId: 3  },  // BAJFINANCE.NS 3679.71 -> 2.76
  { potId: 10, fromDate: '2026-07-15', delta: -4833.81, posId: 8  },  // 500510.BO    4832.57 -> -1.24
  { potId: 13, fromDate: '2026-07-15', delta: -1208.45, posId: 9  },  // 500510.BO    1208.14 -> -0.31
  { potId: 13, fromDate: '2026-07-16', delta: -1124.91, posId: 20 },  // HDFCLIFE.NS  1124.49 -> -0.42
];

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
  const potIds = [...new Set(CORRECTIONS.map(c => c.potId))];
  const snaps = await page<any>((f, t) => supabase.from('pot_snapshots')
    .select('id, pot_id, run_date, portfolio_value, realised_pnl_cumulative')
    .in('pot_id', potIds).order('run_date', { ascending: true }).range(f, t));
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('pot_id, exit_date, realised_pnl').eq('status', 'closed').in('pot_id', potIds).range(f, t));

  console.log(`snapshots for pots ${potIds.join('/')}: ${snaps.length}`);
  console.log(APPLY ? '\n*** APPLY MODE — WILL WRITE ***\n' : '\n--- DRY RUN — no writes ---\n');

  const updates = new Map<number, { row: any; delta: number }>();
  for (const s of snaps) {
    const day = String(s.run_date).slice(0, 10);
    const d = CORRECTIONS
      .filter(c => c.potId === s.pot_id && day >= c.fromDate)
      .reduce((a, b) => a + b.delta, 0);
    if (d !== 0) updates.set(s.id, { row: s, delta: d });
  }

  for (const potId of potIds) {
    const mine = [...updates.values()].filter(u => u.row.pot_id === potId)
      .sort((a, b) => String(a.row.run_date).localeCompare(String(b.row.run_date)));
    if (!mine.length) { console.log(`pot ${potId}: nothing to correct`); continue; }
    const last = mine[mine.length - 1];
    const truth = pos.filter(p => p.pot_id === potId).reduce((a, b) => a + (b.realised_pnl ?? 0), 0);
    const after = (last.row.realised_pnl_cumulative ?? 0) + last.delta;
    console.log(`pot ${potId}: ${mine.length} snapshots from ${String(mine[0].row.run_date).slice(0, 10)}  (delta £${last.delta.toFixed(2)})`);
    console.log(`   latest cumulative  £${last.row.realised_pnl_cumulative?.toFixed(2)} -> £${after.toFixed(2)}`);
    console.log(`   latest portfolio   £${last.row.portfolio_value?.toFixed(2)} -> £${((last.row.portfolio_value ?? 0) + last.delta).toFixed(2)}`);
    console.log(`   position-sum says  £${truth.toFixed(2)}  -> residual drift £${(truth - after).toFixed(2)} (left for step 2)`);
  }

  if (APPLY) {
    let n = 0;
    for (const { row, delta } of updates.values()) {
      const { error } = await supabase.from('pot_snapshots').update({
        realised_pnl_cumulative: parseFloat(((row.realised_pnl_cumulative ?? 0) + delta).toFixed(2)),
        portfolio_value: parseFloat(((row.portfolio_value ?? 0) + delta).toFixed(2)),
      }).eq('id', row.id);
      if (error) throw error;
      n++;
    }
    console.log(`\nWROTE ${n} snapshot rows across pots ${potIds.join('/')}.`);
  } else {
    console.log(`\n${updates.size} rows would change. Re-run with --apply.`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
