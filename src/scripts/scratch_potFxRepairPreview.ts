/**
 * DRY RUN. Shows exactly what a repair of the 4 scale-broken pot positions would change.
 * Writes NOTHING. Pass --apply only after the preview has been reviewed.
 *
 * These are pre-F8 entries that closed 2026-07-15/16 with a native-currency exit price
 * against a GBP-converted entry price. The F8 backfill repaired open positions and the 10
 * that closed on 07-14, but missed these. Code is correct today (potResults are converted
 * at LiveInferenceService.ts:1612); this is stale data only.
 *
 * Downstream: pot_snapshots.realised_pnl_cumulative and portfolio_value are carried forward
 * run to run, so they do NOT self-heal -- the per-pot delta each would need is shown too.
 */
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { convertToGBPIfHighNominal } = await import('../../FREDService');

  const { data, error } = await supabase.from('pot_positions')
    .select('id, pot_id, symbol, direction, entry_date, exit_date, entry_price, exit_price, shares, position_size_gbp, realised_pnl, realised_return_pct, exit_reason, status')
    .eq('status', 'closed');
  if (error) throw error;

  const broken = (data ?? []).filter((p: any) =>
    p.position_size_gbp && p.direction === 'long' &&
    Math.abs(p.realised_pnl / p.position_size_gbp) > 1);

  console.log(`scale-broken closed positions: ${broken.length}`);
  console.log(APPLY ? '\n*** APPLY MODE — WILL WRITE ***\n' : '\n--- DRY RUN — no writes ---\n');

  const deltas = new Map<number, number>();
  for (const p of broken as any[]) {
    const fixedExit = await convertToGBPIfHighNominal(p.symbol, p.exit_price, p.exit_date);
    const sign = 1; // all four are long
    const newPnl = sign * p.shares * (fixedExit - p.entry_price);
    const newRet = newPnl / p.position_size_gbp;
    const delta = newPnl - p.realised_pnl;
    deltas.set(p.pot_id, (deltas.get(p.pot_id) ?? 0) + delta);

    console.log(`position id=${p.id} pot=${p.pot_id} ${p.symbol}  (${p.entry_date} -> ${p.exit_date})`);
    console.log(`  entry_price          ${p.entry_price}  (already GBP-converted)`);
    console.log(`  exit_price           ${p.exit_price}  ->  ${fixedExit.toFixed(4)}`);
    console.log(`  realised_pnl      £${p.realised_pnl.toFixed(2)}  ->  £${newPnl.toFixed(2)}   (delta £${delta.toFixed(2)})`);
    console.log(`  realised_return_pct  ${p.realised_return_pct}  ->  ${newRet.toFixed(6)}  (${(100 * newRet).toFixed(2)}%)\n`);

    if (APPLY) {
      const { error: e } = await supabase.from('pot_positions')
        .update({
          exit_price: parseFloat(fixedExit.toFixed(4)),
          realised_pnl: parseFloat(newPnl.toFixed(2)),
          realised_return_pct: parseFloat(newRet.toFixed(6)),
        })
        .eq('id', p.id);
      if (e) throw e;
      console.log(`  WROTE position ${p.id}\n`);
    }
  }

  console.log('=== downstream pot_snapshots impact (carried forward, will NOT self-heal) ===');
  for (const [potId, d] of deltas) {
    const { data: snaps } = await supabase.from('pot_snapshots')
      .select('id, run_date, portfolio_value, realised_pnl_cumulative')
      .eq('pot_id', potId).order('run_date', { ascending: false }).limit(1);
    const s = snaps?.[0];
    console.log(`  pot ${potId}: realised P&L delta £${d.toFixed(2)}  | latest snapshot ` +
      `portfolio_value £${s?.portfolio_value?.toFixed(2)} cumulative £${s?.realised_pnl_cumulative?.toFixed(2)}` +
      `  -> would become £${((s?.portfolio_value ?? 0) + d).toFixed(2)} / £${((s?.realised_pnl_cumulative ?? 0) + d).toFixed(2)}`);
  }
  console.log(`\ntotal phantom P&L removed: £${[...deltas.values()].reduce((a, b) => a + b, 0).toFixed(2)}`);
  if (!APPLY) console.log('\nRe-run with --apply to write. Snapshot rows are NOT touched by this script.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
