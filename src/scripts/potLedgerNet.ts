/**
 * The pot ledger, read NET of trading costs.
 *
 * READ-ONLY: no writes to any store, no schema change, no change to PotService
 * behaviour. See src/potLedgerCosts.ts for why the net figure is reported here rather
 * than deducted inside PotService.ts:701.
 *
 * Emits every headline on BOTH bases, because the 2026-06-14/15 genesis cohort has
 * honest-but-tiny sizes and there is no single correct way to fold it in:
 *
 *   admissible — sizing-reliable rows only. One population, internally consistent.
 *   imputed    — every row, but costed at the size the rule INTENDED. Keeps the 14
 *                cohort rows' (valid) price outcomes instead of discarding them.
 *
 * The spread between the two nets is the honest uncertainty the cohort injects. Quote
 * one, say which.
 *
 * Usage: npx tsx src/scripts/potLedgerNet.ts
 */
import 'dotenv/config';
import {
  costPositions, costPositionsWithSlippage, summarise,
  SIZING_MIN_FRACTION, LedgerPosition, LedgerSummary,
} from '../potLedgerCosts';
import { KNOWN_TAX_SUFFIXES } from '../costModel';

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

const f = (v: number, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '  —  ');

function printSummary(label: string, s: LedgerSummary, note = '') {
  console.log(`\n--- ${label}  (n=${s.n}) ${note}`);
  console.log(`  turnover                  GBP ${s.turnoverGBP.toFixed(0)}`);
  console.log(`  round-trip cost           GBP ${s.costGBP.toFixed(2)}`);
  console.log(`  cost %  turnover-weighted ${f(s.costPctWeighted)}%   <- robust (ratio of sums)`);
  console.log(`  cost %  mean-of-ratios    ${f(s.costPctMean)}%   median ${f(s.costPctMedian)}%`);
  console.log(`  GROSS   mean ${f(s.grossPctMean)}%   median ${f(s.grossPctMedian)}%   win ${(100 * s.winRate).toFixed(0)}%`);
  console.log(`  NET     mean ${f(s.netPctMean)}%/trade`);
  console.log(`  P&L     gross GBP ${s.grossPnlGBP.toFixed(2)}  ->  net GBP ${s.netPnlGBP.toFixed(2)}`);
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');

  const positions = await page<any>((f_, t) => supabase.from('pot_positions')
    .select('id, pot_id, symbol, status, entry_date, position_size_gbp, realised_return_pct, realised_pnl')
    .eq('status', 'closed').range(f_, t));
  const pots = await page<any>((f_, t) => supabase.from('pots')
    .select('pot_id, name, focus, starting_balance').range(f_, t));
  const snaps = await page<any>((f_, t) => supabase.from('pot_snapshots')
    .select('pot_id, run_date, portfolio_value')
    .order('run_date', { ascending: true }).range(f_, t));

  const potById = new Map<number, any>(pots.map(p => [p.pot_id, p]));
  const snapsByPot = new Map<number, any[]>();
  for (const s of snaps) {
    if (!snapsByPot.has(s.pot_id)) snapsByPot.set(s.pot_id, []);
    snapsByPot.get(s.pot_id)!.push(s);
  }

  /** portfolioValue at entry / focus — what PotService.ts:876 would have allocated. */
  const intendedSizeFor = (p: LedgerPosition): number | null => {
    const pot = potById.get(p.pot_id);
    if (!pot?.focus) return null;
    const list = snapsByPot.get(p.pot_id) ?? [];
    let snap: any = null;
    for (const s of list) if (String(s.run_date).slice(0, 10) <= String(p.entry_date)) snap = s;
    // Genesis entries can predate the first snapshot; starting_balance is the right
    // fallback there (portfolio value has not moved yet by definition).
    const pv = Number(snap?.portfolio_value ?? pot.starting_balance);
    return pv > 0 ? pv / Number(pot.focus) : null;
  };

  const rows = (positions as LedgerPosition[])
    .filter(p => p.realised_return_pct != null && p.position_size_gbp);
  const costed = costPositions(rows, intendedSizeFor);

  const reliable = costed.filter(c => c.sizingReliable);
  const flagged  = costed.filter(c => !c.sizingReliable);

  console.log(`closed positions with a realised return : ${rows.length}`);
  console.log(`sizing-reliable                         : ${reliable.length}`);
  console.log(`sizing-FLAGGED (< ${(100 * SIZING_MIN_FRACTION).toFixed(0)}% of intended) : ${flagged.length}`);

  // ── Threshold audit: is SIZING_MIN_FRACTION separating two clean populations, or
  //    is it clipping legitimate rows? Printed so the constant stays challengeable.
  const ratios = costed.map(c => c.sizeRatio).filter((r): r is number => r != null).sort((a, b) => a - b);
  const relRatios = reliable.map(c => c.sizeRatio).filter((r): r is number => r != null).sort((a, b) => a - b);
  const flgRatios = flagged.map(c => c.sizeRatio).filter((r): r is number => r != null).sort((a, b) => a - b);
  console.log('\n=== THRESHOLD AUDIT  (size / intended size) ===');
  console.log(`  all rows      min ${f(ratios[0], 4)}  p10 ${f(ratios[Math.floor(ratios.length * 0.1)], 4)}  median ${f(ratios[ratios.length >> 1], 4)}  max ${f(ratios[ratios.length - 1], 4)}`);
  if (flgRatios.length) console.log(`  FLAGGED       max ${f(flgRatios[flgRatios.length - 1], 4)}   <- highest bad row`);
  if (relRatios.length) console.log(`  reliable      min ${f(relRatios[0], 4)}   <- lowest good row`);
  console.log(`  threshold     ${f(SIZING_MIN_FRACTION, 4)}` +
    (flgRatios.length && relRatios.length
      ? `   separation ${f(relRatios[0] / flgRatios[flgRatios.length - 1], 1)}x — ${relRatios[0] > SIZING_MIN_FRACTION && flgRatios[flgRatios.length - 1] < SIZING_MIN_FRACTION ? 'CLEAN SPLIT' : 'AMBIGUOUS — REVIEW'}`
      : ''));

  // ── The two bases ──────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(72));
  console.log('HEADLINE — both bases. Quote one, say which.');
  console.log('='.repeat(72));
  const admissible = summarise(reliable, false);
  const imputed    = summarise(costed, true);
  printSummary('ADMISSIBLE  (sizing-reliable rows, costed as traded)', admissible);
  printSummary('IMPUTED     (all rows, costed at intended size)', imputed);
  console.log(`\n  spread between bases: ${f(Math.abs(admissible.netPctMean - imputed.netPctMean) * 100, 1)}bp` +
    `  <- uncertainty the genesis cohort injects`);

  // ── Diagnostics ────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(72));
  console.log('DIAGNOSTICS');
  console.log('='.repeat(72));
  printSummary('ALL rows costed as traded (the naive read — cohort artefact intact)', summarise(costed, false));
  if (flagged.length) {
    printSummary('THE FLAGGED COHORT ALONE, as traded', summarise(flagged, false));
    printSummary('THE FLAGGED COHORT ALONE, at intended size', summarise(flagged, true));
  }

  // Pessimistic bound: latency slippage opted in (default config assumes 0).
  const slip = costPositionsWithSlippage(rows, intendedSizeFor);
  const slipAdmissible = summarise(slip.filter(c => c.sizingReliable), false);
  console.log(`\n--- pessimistic bound (admissible basis + suggestedLatencySlippageBps) ---`);
  console.log(`  cost ${f(slipAdmissible.costPctWeighted)}%  ->  NET ${f(slipAdmissible.netPctMean)}%/trade`);
  console.log('  (headline uses slippageBpsPerLeg=0: no measured latency data yet.)');
  console.log('  NOT included in any figure above: the measured close-to-next-open signal');
  console.log('  decay (D5 ~11.6-24.9bps) — it is not in costModel.');

  // ── The flagged rows, itemised ─────────────────────────────────────────────
  if (flagged.length) {
    console.log('\n=== FLAGGED ROWS (reported, never silently dropped) ===');
    console.log('id     pot sym          entry_date   size_gbp   intended  ratio    gross%   cost%@actual  cost%@intended');
    for (const c of flagged.sort((a, b) => (a.sizeRatio ?? 0) - (b.sizeRatio ?? 0))) {
      const p = c.pos;
      console.log(
        `${String(p.id).padStart(5)}  ${String(p.pot_id).padStart(3)} ${String(p.symbol).padEnd(12)} ` +
        `${String(p.entry_date).padEnd(11)} ${f(Number(p.position_size_gbp), 2).padStart(9)} ` +
        `${f(c.intendedSizeGBP ?? NaN, 2).padStart(9)} ${f(c.sizeRatio ?? NaN, 4).padStart(7)} ` +
        `${f(c.grossPct, 2).padStart(8)} ${f(c.costPctActual, 2).padStart(13)} ${f(c.costPctIntended, 3).padStart(15)}`);
    }
  }

  // ── Symbols costModel has no tax rate for ──────────────────────────────────
  // Coverage is derived from costModel's own table (KNOWN_TAX_SUFFIXES), not from a
  // hand-maintained copy here — a duplicated list drifts silently the moment a rate is
  // added, which is exactly the failure this check exists to catch. Single trailing
  // letters are skipped: those are US share classes (BRK.B), not venues.
  const unpriced = [...new Set(rows.map(r => {
    const d = r.symbol.lastIndexOf('.');
    return d === -1 ? null : r.symbol.slice(d).toUpperCase();
  }).filter(Boolean) as string[])]
    .filter(sfx => !KNOWN_TAX_SUFFIXES.has(sfx) && !/^\.[A-Z]$/.test(sfx));
  if (unpriced.length) {
    console.log(`\n⚠ suffixes with NO tax rate in costModel (taxed at 0 — understates cost): ${unpriced.join(', ')}`);
    const affected = rows.filter(r => unpriced.some(s => r.symbol.toUpperCase().endsWith(s)));
    console.log(`  affects ${affected.length} closed positions: ${[...new Set(affected.map(a => a.symbol))].join(', ')}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
