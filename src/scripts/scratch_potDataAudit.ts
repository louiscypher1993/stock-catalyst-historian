/**
 * Before ranking pots, check the ledger is trustworthy. Two suspicions from the raw table:
 *   (a) realised_return_pct looks inconsistently scaled -- some rows ~-0.03, others ~122.9;
 *   (b) 19 of 96 closed positions carry exit_reason='manual_correction', which are not
 *       trading outcomes and should not score a pot.
 * Cross-check realised_return_pct against an independent return computed from the ledger's
 * own numbers (realised_pnl / position_size_gbp) -- if the two disagree, the column is not
 * a safe ranking key.
 */
import 'dotenv/config';

async function page<T>(q: (f: number, t: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw error;
    const b = (data ?? []) as T[];
    out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('pot_id, symbol, direction, status, entry_date, exit_date, entry_price, exit_price, shares, position_size_gbp, realised_pnl, realised_return_pct, exit_reason, patience_horizon')
    .eq('status', 'closed').range(f, t));
  console.log(`closed positions: ${pos.length}`);

  const withBoth = pos.filter(p => p.realised_return_pct != null && p.realised_pnl != null && p.position_size_gbp);
  console.log(`\n--- (a) does realised_return_pct agree with realised_pnl / position_size_gbp? ---`);
  let agreePct = 0, agreeFrac = 0;
  const bad: any[] = [];
  for (const p of withBoth) {
    const derived = p.realised_pnl / p.position_size_gbp;      // a FRACTION
    const asPct = Math.abs(p.realised_return_pct - derived * 100) < 0.5;
    const asFrac = Math.abs(p.realised_return_pct - derived) < 0.005;
    if (asPct) agreePct++;
    if (asFrac) agreeFrac++;
    if (!asPct && !asFrac) bad.push({ ...p, derived });
  }
  console.log(`  matches if column is PERCENT  : ${agreePct}/${withBoth.length}`);
  console.log(`  matches if column is FRACTION : ${agreeFrac}/${withBoth.length}`);
  console.log(`  matches NEITHER               : ${bad.length}/${withBoth.length}`);
  for (const b of bad.slice(0, 10)) {
    console.log(`    pot ${String(b.pot_id).padStart(2)} ${String(b.symbol).padEnd(10)} ${b.direction.padEnd(5)} ` +
      `entry ${b.entry_price} exit ${b.exit_price} shares ${b.shares} size £${b.position_size_gbp} | ` +
      `pnl £${b.realised_pnl} col=${b.realised_return_pct} derived=${(b.derived * 100).toFixed(2)}% [${b.exit_reason}]`);
  }

  console.log(`\n--- (b) exit_reason breakdown ---`);
  const byR: Record<string, { n: number; pnl: number }> = {};
  for (const p of pos) {
    const k = p.exit_reason ?? 'null';
    byR[k] ??= { n: 0, pnl: 0 };
    byR[k].n++; byR[k].pnl += p.realised_pnl ?? 0;
  }
  for (const [k, v] of Object.entries(byR).sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${k.padEnd(20)} n=${String(v.n).padStart(3)}  total pnl £${v.pnl.toFixed(0)}`);

  console.log(`\n--- (c) magnitude distribution of derived returns (excl. manual_correction) ---`);
  const real = withBoth.filter(p => p.exit_reason !== 'manual_correction');
  const d = real.map(p => (p.realised_pnl / p.position_size_gbp) * 100).sort((a, b) => a - b);
  const q = (x: number) => d[Math.floor(x * (d.length - 1))];
  console.log(`  n=${d.length}  min ${q(0).toFixed(2)}%  p25 ${q(.25).toFixed(2)}%  p50 ${q(.5).toFixed(2)}%  ` +
    `p75 ${q(.75).toFixed(2)}%  max ${q(1).toFixed(2)}%`);
  const extreme = real.filter(p => Math.abs(p.realised_pnl / p.position_size_gbp) > 1);
  console.log(`  |return| > 100%: ${extreme.length}`);
  for (const e of extreme.slice(0, 8))
    console.log(`    pot ${e.pot_id} ${e.symbol} ${e.direction} entry ${e.entry_price} exit ${e.exit_price} ` +
      `size £${e.position_size_gbp} pnl £${e.realised_pnl} = ${(100 * e.realised_pnl / e.position_size_gbp).toFixed(0)}% [${e.exit_reason}]`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
