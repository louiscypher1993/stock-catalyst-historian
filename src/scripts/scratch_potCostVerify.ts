/**
 * VERIFICATION ONLY — read-only, writes nothing.
 * Claim under test: the pot ledger is GROSS of trading costs, so -0.448%/trade
 * understates the loss by roughly the round-trip cost.
 */
import 'dotenv/config';
import { roundTripCost, needsFx, taxRate, spreadBpsFor } from '../costModel';

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
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('symbol, status, position_size_gbp, realised_return_pct, realised_pnl')
    .eq('status', 'closed').range(f, t));

  const rows = pos.filter(p => p.realised_return_pct != null && p.position_size_gbp);
  console.log(`closed positions with a realised return: ${rows.length}\n`);

  let costGbp = 0, sizeGbp = 0, pnlGbp = 0;
  const bySfx = new Map<string, { n: number; cost: number; size: number }>();
  const costPcts: number[] = [];

  for (const p of rows) {
    const size = Number(p.position_size_gbp);
    const c = roundTripCost(p.symbol, size);
    costGbp += c.totalGBP; sizeGbp += size; pnlGbp += Number(p.realised_pnl ?? 0);
    costPcts.push(100 * c.totalGBP / size);
    const s = String(p.symbol).includes('.') ? '.' + String(p.symbol).split('.').pop() : 'US';
    if (!bySfx.has(s)) bySfx.set(s, { n: 0, cost: 0, size: 0 });
    const e = bySfx.get(s)!; e.n++; e.cost += c.totalGBP; e.size += size;
  }

  const grossMean = rows.reduce((a, p) => a + 100 * Number(p.realised_return_pct), 0) / rows.length;
  const meanCostPct = costPcts.reduce((a, b) => a + b, 0) / costPcts.length;
  const sorted = [...costPcts].sort((a, b) => a - b);

  console.log('traded composition (by suffix):');
  for (const [s, e] of [...bySfx.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${s.padEnd(6)} n=${String(e.n).padStart(3)}  avg cost ${(100 * e.cost / e.size).toFixed(3)}%  ` +
      `fx=${needsFx(s === 'US' ? 'AAPL' : 'X' + s)}  stampBuy=${(100 * taxRate(s === 'US' ? 'AAPL' : 'X' + s).buy).toFixed(2)}%`);

  console.log(`\ntotal position value traded : GBP ${sizeGbp.toFixed(0)}`);
  console.log(`total round-trip cost       : GBP ${costGbp.toFixed(2)}`);
  console.log(`cost as % of turnover       : ${(100 * costGbp / sizeGbp).toFixed(3)}%`);
  console.log(`mean per-trade cost         : ${meanCostPct.toFixed(3)}%   median ${sorted[Math.floor(sorted.length/2)].toFixed(3)}%`);
  console.log(`\nGROSS mean realised return  : ${grossMean.toFixed(3)}%/trade  (what the ledger records)`);
  console.log(`NET  mean realised return   : ${(grossMean - meanCostPct).toFixed(3)}%/trade  (after costModel)`);
  console.log(`\ngross P&L GBP ${pnlGbp.toFixed(2)}  ->  net GBP ${(pnlGbp - costGbp).toFixed(2)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
