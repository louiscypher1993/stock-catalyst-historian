/**
 * READ-ONLY — writes nothing.
 *
 * Re-runs the cost readout of scratch_potCostVerify.ts, but reports it THREE ways
 * so the effect of the 2026-06-14/15 genesis mis-sizing cohort is explicit rather
 * than baked in:
 *
 *   ALL      — every closed position (what scratch_potCostVerify.ts reported)
 *   EXCLUDED — dropping the 14 genesis rows whose sizing budget was wrong by 127x
 *   COHORT   — those 14 rows on their own
 *
 * Also reports mean-of-ratios vs turnover-weighted cost side by side, because the
 * two diverge by an order of magnitude and only the second is robust here.
 */
import 'dotenv/config';
import { roundTripCost } from '../costModel';

const GENESIS_ENTRY_DATES = ['2026-06-14', '2026-06-15'];
const UNDERSIZED_GBP = 100;

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

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function report(label: string, rows: any[]) {
  if (!rows.length) { console.log(`\n--- ${label}: no rows ---`); return; }
  let costGbp = 0, sizeGbp = 0, pnlGbp = 0;
  const costPcts: number[] = [], retPcts: number[] = [];
  for (const p of rows) {
    const size = Number(p.position_size_gbp);
    const c = roundTripCost(p.symbol, size);
    costGbp += c.totalGBP; sizeGbp += size; pnlGbp += Number(p.realised_pnl ?? 0);
    costPcts.push(100 * c.totalGBP / size);
    retPcts.push(100 * Number(p.realised_return_pct));
  }
  const grossMean = mean(retPcts), grossMed = median(retPcts);
  const costMean = mean(costPcts), costMed = median(costPcts);
  const costTurnover = 100 * costGbp / sizeGbp;
  const wins = retPcts.filter(r => r > 0).length;

  console.log(`\n--- ${label}  (n=${rows.length}) ---`);
  console.log(`  turnover                     GBP ${sizeGbp.toFixed(0)}`);
  console.log(`  round-trip cost              GBP ${costGbp.toFixed(2)}`);
  console.log(`  cost %  turnover-weighted    ${costTurnover.toFixed(3)}%   <- robust (ratio of sums)`);
  console.log(`  cost %  mean-of-ratios       ${costMean.toFixed(3)}%   median ${costMed.toFixed(3)}%`);
  console.log(`  GROSS return   mean ${grossMean.toFixed(3)}%   median ${grossMed.toFixed(3)}%   win ${(100 * wins / rows.length).toFixed(0)}%`);
  console.log(`  NET (mean gross - turnover-wtd cost) ${(grossMean - costTurnover).toFixed(3)}%/trade`);
  console.log(`  NET (mean gross - mean-of-ratios)    ${(grossMean - costMean).toFixed(3)}%/trade`);
  console.log(`  P&L  gross GBP ${pnlGbp.toFixed(2)}  ->  net GBP ${(pnlGbp - costGbp).toFixed(2)}`);
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('id, pot_id, symbol, status, entry_date, position_size_gbp, realised_return_pct, realised_pnl')
    .eq('status', 'closed').range(f, t));

  const rows = pos.filter(p => p.realised_return_pct != null && p.position_size_gbp);
  const isCohort = (p: any) =>
    GENESIS_ENTRY_DATES.includes(String(p.entry_date)) &&
    Number(p.position_size_gbp) < UNDERSIZED_GBP;

  const cohort = rows.filter(isCohort);
  const clean = rows.filter(p => !isCohort(p));

  console.log(`closed positions with a realised return: ${rows.length}`);
  console.log(`genesis mis-sized cohort: ${cohort.length}   admissible: ${clean.length}`);

  report('ALL closed positions', rows);
  report('EXCLUDING the genesis cohort', clean);
  report('THE GENESIS COHORT ALONE', cohort);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
