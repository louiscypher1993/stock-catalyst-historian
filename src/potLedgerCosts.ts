/**
 * Net-of-cost read layer for the pot ledger.
 *
 * WHY THIS EXISTS. `PotService.ts` never imports `costModel.ts`:
 * `realisedPnl = returnSoFar * pos.position_size_gbp` (PotService.ts:701) is a pure
 * price return with no cost term, so every figure the ledger reports is GROSS.
 * `costModel` is wired into outcomeScoreboard, dsrPboAudit, readoutHarness,
 * topBuysReport and dumpPotCosts — the pot ledger was the one consumer missing it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. This is a READ layer. It writes nothing, adds
 * no column, and does not touch PotService.ts:701. Deducting cost inside `realisedPnl`
 * would propagate through totalRealisedPnl (:845) -> portfolioValue (:822) ->
 * positionGBP = portfolioValue / F (:876), i.e. it would change how every future
 * position is SIZED. That is a behavioural change to a live paper-trading system and
 * would split the record into non-comparable halves — the same trap the 2026-07-07
 * accumulator rebase already created. It belongs to a deliberate decision at the
 * checkpoint, not to a reporting fix.
 *
 * SIZING RELIABILITY — reported, never silently filtered.
 * 14 positions entered 2026-06-14/15 on `.NS`/`.BO` carry sizes of GBP 4-16 against a
 * rule that gives GBP 1,000-5,000. The cause is NOT a corrupt `position_size_gbp`:
 * the invariant `position_size_gbp === shares * entry_price` (PotService.ts:887-888)
 * holds on all 185 rows, and the prices are right (LT.NS 31.8447 vs 500510.BO 31.8518
 * — same issuer, two exchanges, 0.02% apart). The wrong input was the BUDGET: every
 * one of the 14 implies a portfolioValue of ~GBP 78.63 where the snapshot records
 * 10,000, a uniform 127.2x. Same-day control inside pot 13: KBANK.BK and PKO.WA sized
 * at GBP 1,250.00 (= 10,000/8) while 500510.BO sized at GBP 9.83 (= 78.63/8).
 *
 * These are therefore HONEST records of genuinely tiny trades, not corrupt fields.
 * Rewriting them would break the invariant that currently holds and would require
 * inventing `shares` and `realised_pnl` to match — fabricating trades that never
 * happened. So they are FLAGGED, not dropped, and every summary is emitted on both
 * bases so a caller must state which one it is quoting. A hardcoded filter that
 * silently removed 14 rows would be the same shape as this project's recurring
 * failure mode (the empty ClinicalTrials roster, the query truncated at 1,000 rows,
 * CI failures swallowed into warnings): invisible at the point of reading.
 *
 * KNOWN GAPS, stated rather than hidden:
 *  - `.BO` is absent from costModel's TAX table, so BSE lines are taxed at 0 and fall
 *    through the "unlisted exchange — REVIEW" branch. BSE carries the same ~0.1% STT
 *    as `.NS`. Understates cost on those rows.
 *  - `slippageBpsPerLeg` defaults to 0 (no measured latency data). `withSlippage`
 *    gives the pessimistic bound rather than baking a guess into the headline, the
 *    same convention dumpPotCosts.ts uses.
 *  - The measured close-to-next-open signal decay (D5 ~11.6-24.9bps) is NOT in
 *    costModel and so is not in any figure here.
 */
import { roundTripCost, suggestedLatencySlippageBps, IBKR_DEFAULT, CostConfig } from './costModel';

/**
 * A position's size is treated as reliable when it reaches this fraction of what the
 * sizing rule would have allocated. The floor for a LEGITIMATE row is ~0.5: shares are
 * `Math.floor(positionGBP / entryPrice)` (PotService.ts:882), so a stock priced just
 * over half the allocation yields one share and ~50% deployment (above the allocation
 * the entry is skipped outright at :883). 0.20 sits well clear of that floor while the
 * known-bad cohort sits at ~0.008. The observed margin is printed by the script so the
 * threshold stays auditable rather than assumed.
 */
export const SIZING_MIN_FRACTION = 0.20;

export interface LedgerPosition {
  id:                  number;
  pot_id:              number;
  symbol:              string;
  status:              string;
  entry_date:          string;
  position_size_gbp:   number;
  realised_return_pct: number | null;
  realised_pnl:        number | null;
}

export interface CostedPosition {
  pos:              LedgerPosition;
  intendedSizeGBP:  number | null;  // portfolioValue at entry / focus; null if unknown
  sizeRatio:        number | null;  // actual / intended
  sizingReliable:   boolean;
  grossPct:         number;         // realised_return_pct * 100
  /** Cost at the size actually traded. Meaningless where sizing is unreliable —
   *  fixed per-order and FX minimums do not scale down, so a GBP 4.57 position pays
   *  the same ~GBP 4.80 round trip as a GBP 1,250 one. */
  costGBPActual:    number;
  costPctActual:    number;
  /** Cost the same trade would have carried at its INTENDED size. This is the
   *  imputation used by the `imputed` basis; for reliable rows it is ~identical to
   *  the actual. */
  costGBPIntended:  number;
  costPctIntended:  number;
}

/**
 * @param intendedSizeFor  returns portfolioValue-at-entry / focus for a position, or
 *                         null when no snapshot covers it. Kept as a callback so this
 *                         module stays independent of the store.
 */
export function costPositions(
  positions: LedgerPosition[],
  intendedSizeFor: (p: LedgerPosition) => number | null,
  cfg: CostConfig = IBKR_DEFAULT,
): CostedPosition[] {
  return positions.map(pos => {
    const size = Number(pos.position_size_gbp);
    const intended = intendedSizeFor(pos);
    const ratio = intended && intended > 0 ? size / intended : null;
    const actual = roundTripCost(pos.symbol, size, cfg);
    // Fall back to the actual size when no snapshot covers the entry: that makes the
    // imputed basis degrade to the actual basis for that row rather than dropping it.
    const impSize = intended && intended > 0 ? intended : size;
    const imp = roundTripCost(pos.symbol, impSize, cfg);
    return {
      pos, intendedSizeGBP: intended, sizeRatio: ratio,
      sizingReliable: ratio == null ? true : ratio >= SIZING_MIN_FRACTION,
      grossPct:        100 * Number(pos.realised_return_pct),
      costGBPActual:   actual.totalGBP,
      costPctActual:   100 * actual.totalGBP / size,
      costGBPIntended: imp.totalGBP,
      costPctIntended: 100 * imp.totalGBP / impSize,
    };
  });
}

export interface LedgerSummary {
  n:              number;
  turnoverGBP:    number;
  costGBP:        number;
  /** Ratio of sums. The robust statistic — use this one. */
  costPctWeighted: number;
  /** Mean of per-trade ratios. Destroyed by any tiny denominator; reported so the
   *  divergence from the median stays visible as a diagnostic. */
  costPctMean:    number;
  costPctMedian:  number;
  grossPctMean:   number;
  grossPctMedian: number;
  netPctMean:     number;   // grossPctMean - costPctWeighted
  winRate:        number;
  grossPnlGBP:    number;
  netPnlGBP:      number;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * @param useIntendedCost  when true, each row is costed at its INTENDED size (the
 *                         imputed basis). Turnover is taken at the intended size too,
 *                         so the weighted rate stays a coherent ratio of sums.
 */
export function summarise(rows: CostedPosition[], useIntendedCost = false): LedgerSummary {
  const sizes = rows.map(r => useIntendedCost
    ? (r.intendedSizeGBP && r.intendedSizeGBP > 0 ? r.intendedSizeGBP : Number(r.pos.position_size_gbp))
    : Number(r.pos.position_size_gbp));
  const costs = rows.map(r => useIntendedCost ? r.costGBPIntended : r.costGBPActual);
  const costPcts = rows.map(r => useIntendedCost ? r.costPctIntended : r.costPctActual);
  const gross = rows.map(r => r.grossPct);

  const turnover = sizes.reduce((a, b) => a + b, 0);
  const costGBP = costs.reduce((a, b) => a + b, 0);
  const costPctWeighted = 100 * costGBP / turnover;
  const grossPctMean = mean(gross);
  // Gross P&L is taken as recorded, not recomputed from the imputed size: the realised
  // pounds are a fact about the trade that was made.
  const grossPnl = rows.reduce((a, r) => a + Number(r.pos.realised_pnl ?? 0), 0);

  return {
    n: rows.length, turnoverGBP: turnover, costGBP, costPctWeighted,
    costPctMean: mean(costPcts), costPctMedian: median(costPcts),
    grossPctMean, grossPctMedian: median(gross),
    netPctMean: grossPctMean - costPctWeighted,
    winRate: gross.filter(g => g > 0).length / (rows.length || 1),
    grossPnlGBP: grossPnl, netPnlGBP: grossPnl - costGBP,
  };
}

/** Same costing with the pessimistic latency-slippage bound opted in, per symbol. */
export function costPositionsWithSlippage(
  positions: LedgerPosition[],
  intendedSizeFor: (p: LedgerPosition) => number | null,
): CostedPosition[] {
  return positions.map(pos => costPositions([pos], intendedSizeFor,
    { ...IBKR_DEFAULT, slippageBpsPerLeg: suggestedLatencySlippageBps(pos.symbol) })[0]);
}
