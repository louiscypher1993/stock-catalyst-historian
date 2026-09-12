/**
 * PREREG_2026-08-21_riskscore_refit.md — PART C2.
 *
 * THE PRE-REGISTERED QUESTION: do the refitted cutoffs' actionable tier (STRONG_BUY+BUY)
 * beat the ALL-scored unselective baseline, on mean day-clustered net return, over >=10
 * run_dates, at a realistic £1,250 position?
 *
 * PRE-COMMITTED RESPONSE IF NOT: report that tier selection has no demonstrable live
 * edge, and do NOT re-tune. A third round of threshold tuning on the same window is
 * fishing.
 *
 * CUTOFFS. Deployed D5 2W: BUY >= 0.024743, STRONG_BUY >= 0.031582. Refitted (C1,
 * 2026-08-24, live percentiles): BUY >= 0.031300, STRONG_BUY >= 0.035100. Per AMENDMENT 1
 * only the UPPER tiers are adopted — SELL stays sign-anchored — and SELL does not enter
 * the actionable set anyway.
 *
 * METHOD. Paired by run_date: for each day, mean net of the tier minus mean net of that
 * same day's baseline, then a t-test on the daily differences. Pairing removes the day
 * effect, which is the whole reason this project abandoned pooled statistics.
 * net = actual_return - roundTripCost(symbol, £1,250) + dividend_credit.
 *
 * Quarantined rows never enter outcome_results (outcomeTracker skips unreliable_reason
 * rows by design), so the population is already clean.
 *
 * READ-ONLY.
 */
import 'dotenv/config';
import { roundTripCost } from '../costModel';

const POSITION = 1250, PARITY = '2026-08-09', MIN_DAYS = 10;
const DEPLOYED = { buy: 0.024743, strongBuy: 0.031582 };
const REFITTED = { buy: 0.031300, strongBuy: 0.035100 };

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
function tStat(d: number[]) {
  if (d.length < 2) return NaN;
  const m = mean(d);
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length - 1));
  return sd > 0 ? m / (sd / Math.sqrt(d.length)) : NaN;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('outcome_results')
      .select('symbol, run_date, predicted_return, actual_return, dividend_credit')
      .eq('horizon', '2W').gte('run_date', PARITY).range(f, f + 999);
    if (error) throw error;
    rows.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const use = rows.filter(r => r.predicted_return != null && r.actual_return != null);
  const net = (r: any) => 100 * (Number(r.actual_return)
    - roundTripCost(r.symbol, POSITION).totalGBP / POSITION
    + Number(r.dividend_credit ?? 0));

  const byDay = new Map<string, any[]>();
  for (const r of use) {
    const d = String(r.run_date).slice(0, 10);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(r);
  }
  const days = [...byDay.keys()].sort();
  console.log(`post-parity 2W matured rows: ${use.length} over ${days.length} run_dates  ${days[0]} .. ${days[days.length-1]}`);
  console.log(`C2 gate needs >=${MIN_DAYS} run_dates: ${days.length >= MIN_DAYS ? 'MET' : 'NOT MET'}`);
  console.log(`position £${POSITION}  (cost mean ${(mean(use.map(r => 10000*roundTripCost(r.symbol,POSITION).totalGBP/POSITION))).toFixed(0)}bps)\n`);

  const arms: Array<{ name: string; sel: (r: any) => boolean }> = [
    { name: 'ALL scored (baseline)',       sel: () => true },
    { name: 'DEPLOYED actionable (SB+BUY)', sel: r => Number(r.predicted_return) >= DEPLOYED.buy },
    { name: 'DEPLOYED STRONG_BUY only',     sel: r => Number(r.predicted_return) >= DEPLOYED.strongBuy },
    { name: 'REFITTED actionable (SB+BUY)', sel: r => Number(r.predicted_return) >= REFITTED.buy },
    { name: 'REFITTED STRONG_BUY only',     sel: r => Number(r.predicted_return) >= REFITTED.strongBuy },
  ];

  const dailyBaseline = new Map<string, number>();
  for (const d of days) dailyBaseline.set(d, mean(byDay.get(d)!.map(net)));

  console.log('arm                              n    days   mean net%/trade   vs baseline (paired)   t');
  console.log('-'.repeat(92));
  const results: Record<string, { diffs: number[]; dailies: number[] }> = {};
  for (const a of arms) {
    const dailies: number[] = [], diffs: number[] = [];
    let n = 0;
    for (const d of days) {
      const sel = byDay.get(d)!.filter(a.sel);
      if (!sel.length) continue;
      n += sel.length;
      const m = mean(sel.map(net));
      dailies.push(m);
      diffs.push(m - dailyBaseline.get(d)!);
    }
    results[a.name] = { diffs, dailies };
    const isBase = a.name.startsWith('ALL');
    console.log(`${a.name.padEnd(32)}${String(n).padStart(5)}${String(dailies.length).padStart(7)}` +
      `${mean(dailies).toFixed(3).padStart(16)}%` +
      (isBase ? '              —              —'
              : `${mean(diffs).toFixed(3).padStart(21)}pp${tStat(diffs).toFixed(2).padStart(8)}`));
  }

  console.log('\n' + '='.repeat(92));
  const key = 'REFITTED actionable (SB+BUY)';
  const r = results[key];
  const pass = days.length >= MIN_DAYS && mean(r.diffs) > 0;
  console.log(`PRE-REGISTERED C2 VERDICT`);
  console.log(`  refitted actionable beats the unselective baseline? ` +
    `${mean(r.diffs) > 0 ? 'YES' : 'NO'}  (${mean(r.diffs).toFixed(3)}pp, t=${tStat(r.diffs).toFixed(2)}, ${r.diffs.length} days)`);
  console.log(`  >=${MIN_DAYS} run_dates? ${days.length >= MIN_DAYS ? 'YES' : 'NO'}`);
  console.log(`\n  => ${pass
    ? 'ACCEPT the refitted upper-tier cutoffs.'
    : 'REJECT. Pre-committed response: report that tier selection has no demonstrable\n     live edge, and do NOT re-tune.'}`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
