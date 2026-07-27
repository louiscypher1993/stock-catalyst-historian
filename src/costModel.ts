/**
 * costModel.ts — itemized round-trip trading cost (Tier 1).
 *
 * Single source of truth for "what does it actually cost to round-trip a
 * position in this symbol", consumed by outcomeScoreboard (net-return) and
 * topBuysReport (min-move filter) so neither reimplements a flat constant.
 *
 * roundTripCost() components:
 *   1. Transaction tax / stamp duty — accurate public rates by exchange suffix
 *      (side-aware: UK stamp is buy-only, HK/Swiss are both sides). SETTLED DATA.
 *   2. Commission — rate + per-order MINIMUM. The minimum is what bites at small
 *      position sizes. Broker-specific -> IBKR defaults below, CONFIRM.
 *   3. FX round-trip — for non-base-currency symbols from a GBP account.
 *      Broker-specific -> IBKR defaults, CONFIRM.
 *   4. Bid-ask spread (Tier-2) — static liquidity-tier table (see below).
 *   5. Latency slippage (Tier-3, OFF by default) — cfg.slippageBpsPerLeg; a guess
 *      would be false precision until the tracker measures next-open entry.
 *
 * Also exposes:
 *   - minViablePosition(): smallest position where fixed costs (per-order + FX
 *     mins) fall below a target bps — the most decision-relevant output, since
 *     below it you're paying to trade, not to invest.
 *   - lotFit()/minLotBudget() (Tier-2b): whole-share / board-lot constraints
 *     (non-binding for US fractional; a real floor for Japan .T = 100).
 *   - shortBorrowCostGBP() (Tier-3): borrow cost for SHORT holds (0 for the
 *     long-biased live book; exists for future short signals).
 *
 * NOTE (dividends): forward-return labels + the outcome tracker use Yahoo
 * quote.close (split-adjusted, DIVIDEND-EXCLUDED). Total return is understated by
 * the horizon dividend yield. That is a RETURN credit, not a cost — modeled
 * separately (dividendCredit) so net = price_return - cost + dividendCredit.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Spread: static liquidity-tier table (Tier-2, 2026-07-24). Per-symbol
// round-trip bid-ask spread in bps, precomputed by buildSpreadEstimates.cjs into
// a committed JSON (market_cache.db is local-only / not on CI). Chosen over the
// Abdi-Ranaldo OHLC estimator after it over-estimated badly on our daily bars. ──
let SPREAD_BPS: Record<string, number> = {};
try {
  const _dir = dirname(fileURLToPath(import.meta.url));
  SPREAD_BPS = JSON.parse(readFileSync(join(_dir, 'scripts', 'symbol_spread_bps.json'), 'utf8')).spreadBps ?? {};
} catch { /* table absent -> spreads fall back to DEFAULT_SPREAD_BPS */ }
const DEFAULT_SPREAD_BPS = 25; // conservative fallback for symbols not in the table
export function spreadBpsFor(symbol: string): number { return SPREAD_BPS[symbol] ?? DEFAULT_SPREAD_BPS; }

// ── Config: commission + FX. IBKR defaults — CONFIRM against the real account. ──
export interface CostConfig {
  label: string;
  commissionRate: number;        // fraction of trade value (per leg)
  commissionMinPerOrderGBP: number; // per-order floor (per leg) — the biting number
  commissionMaxPctOfValue: number;  // cap as fraction of value (IBKR caps at 1%)
  fxBpsPerLeg: number;           // FX spread, fraction, per conversion
  fxMinPerLegGBP: number;        // FX per-conversion floor
  slippageBpsPerLeg: number;     // Tier-3: assumed adverse move per leg from scan→
                                 // execution LATENCY. Default 0 — we have no measured
                                 // latency data yet (that's the deferred next-open
                                 // tracker work), so baking in a guess would be false
                                 // precision. suggestedLatencySlippageBps() offers a
                                 // heuristic to opt into; when 0 it changes nothing.
}

// IBKR (Lewis's account, confirmed 2026-07-24): commission 0.1% of value, min
// $1/order; FX 0.2bp, min $2/conversion. USD figures -> GBP at ~1.25 ($1≈£0.80,
// $2≈£1.60). The per-order + FX minimums are a HARD floor (no sub-min cap) —
// they dominate everything below ~£1.5k, which is the whole story at £10.
export const IBKR_DEFAULT: CostConfig = {
  label: 'IBKR (0.1% / $1 min / $2 FX)',
  commissionRate: 0.001,           // 0.1% of value
  commissionMinPerOrderGBP: 0.80,  // $1
  commissionMaxPctOfValue: Infinity, // no cap that overrides the min floor
  fxBpsPerLeg: 0.00002,            // 0.2bp
  fxMinPerLegGBP: 1.60,            // $2
  slippageBpsPerLeg: 0,            // off by default (no measured latency yet)
};

// ── Transaction tax by exchange suffix (fraction of value; side-aware). ──
// Public statutory rates. Buy/sell separated because several are one-sided.
interface TaxRate { buy: number; sell: number; note?: string }
const TAX: Record<string, TaxRate> = {
  '.L':  { buy: 0.005,  sell: 0,      note: 'UK SDRT 0.5% buy-only (AIM exempt — not distinguished here)' },
  '.IR': { buy: 0.01,   sell: 0,      note: 'Ireland stamp 1% buy' },
  '.PA': { buy: 0.003,  sell: 0,      note: 'France FTT 0.3% buy (>€1B caps only)' },
  '.MI': { buy: 0.001,  sell: 0,      note: 'Italy FTT 0.1% buy' },
  '.HK': { buy: 0.001,  sell: 0.001,  note: 'HK stamp 0.1% both sides (+ tiny trading fee)' },
  '.SW': { buy: 0.0015, sell: 0.0015, note: 'Swiss transfer tax 0.15% foreign both sides' },
  '.AX': { buy: 0,      sell: 0,      note: 'ASX no stamp' },
  '.TO': { buy: 0,      sell: 0 },
  '.T':  { buy: 0,      sell: 0 },
  '.DE': { buy: 0,      sell: 0 },
  '.F':  { buy: 0,      sell: 0 },
  '.SI': { buy: 0,      sell: 0 },
  '.KS': { buy: 0,      sell: 0.0018, note: 'Korea securities transaction tax ~0.18% sell' },
  '.KQ': { buy: 0,      sell: 0.0018 },
  '.NS': { buy: 0.0001, sell: 0.0001, note: 'India STT ~0.1% delivery both sides (approx)' },
  '.SA': { buy: 0,      sell: 0 },
  US:    { buy: 0,      sell: 0.0000278, note: 'US SEC fee ~0.00278% sell-only (as of 2024; tiny)' },
};

function suffixOf(symbol: string): string {
  const dot = symbol.lastIndexOf('.');
  if (dot === -1) return 'US'; // no suffix => US-listed
  return symbol.slice(dot).toUpperCase();
}

export function taxRate(symbol: string): TaxRate {
  const suf = suffixOf(symbol);
  return TAX[suf] ?? { buy: 0, sell: 0, note: `unlisted exchange ${suf} — assumed 0 (REVIEW)` };
}

// London-listed symbols are GBP-denominated (no FX from a GBP account); everything
// else needs a round-trip FX conversion. (Rough: some .L are USD lines, ignored.)
export function needsFx(symbol: string): boolean {
  return suffixOf(symbol) !== '.L';
}

export interface CostBreakdown {
  symbol: string;
  positionValueGBP: number;
  taxGBP: number;
  commissionGBP: number;   // round-trip (buy + sell)
  fxGBP: number;           // round-trip
  spreadGBP: number;       // round-trip bid-ask spread
  spreadBps: number;       // the tier spread applied
  slippageGBP: number;     // round-trip latency slippage (0 unless cfg opts in)
  totalGBP: number;
  totalBps: number;        // total round-trip cost as bps of position value
  fixedGBP: number;        // the size-independent part (commission mins + fx mins)
}

/** Full round-trip (buy then sell) cost for a position. */
export function roundTripCost(symbol: string, positionValueGBP: number, cfg: CostConfig = IBKR_DEFAULT): CostBreakdown {
  const t = taxRate(symbol);
  const taxGBP = positionValueGBP * (t.buy + t.sell);

  const cap = cfg.commissionMaxPctOfValue === Infinity ? Infinity : positionValueGBP * cfg.commissionMaxPctOfValue;
  const commLeg = (v: number) => Math.min(Math.max(v * cfg.commissionRate, cfg.commissionMinPerOrderGBP), cap);
  const commissionGBP = commLeg(positionValueGBP) * 2; // buy + sell

  const fx = needsFx(symbol);
  const fxLeg = fx ? Math.max(positionValueGBP * cfg.fxBpsPerLeg, cfg.fxMinPerLegGBP) : 0;
  const fxGBP = fxLeg * 2;

  const spreadBps = spreadBpsFor(symbol);
  const spreadGBP = positionValueGBP * (spreadBps / 10000); // round-trip (buy ask + sell bid)

  // Tier-3 latency slippage — both legs; 0 unless cfg.slippageBpsPerLeg is set.
  const slippageGBP = positionValueGBP * (cfg.slippageBpsPerLeg / 10000) * 2;

  const totalGBP = taxGBP + commissionGBP + fxGBP + spreadGBP + slippageGBP;
  const fixedGBP = (cfg.commissionMinPerOrderGBP * 2) + (fx ? cfg.fxMinPerLegGBP * 2 : 0);
  return {
    symbol, positionValueGBP, taxGBP, commissionGBP, fxGBP, spreadGBP, spreadBps, slippageGBP, totalGBP,
    totalBps: (totalGBP / positionValueGBP) * 10000, fixedGBP,
  };
}

/**
 * Smallest position (GBP) whose round-trip cost is <= maxCostBps. Below this,
 * fixed per-order/FX minimums dominate and you're paying to trade, not invest.
 * Solved directly: at large size the variable rate floor is tax+commRate+fxBps;
 * the fixed part must fit in the remaining budget.
 */
export function minViablePosition(symbol: string, maxCostBps = 50, cfg: CostConfig = IBKR_DEFAULT): number | null {
  const t = taxRate(symbol);
  const variableBps = ((t.buy + t.sell) + cfg.commissionRate * 2 + (needsFx(symbol) ? cfg.fxBpsPerLeg * 2 : 0)) * 10000
    + spreadBpsFor(symbol) + cfg.slippageBpsPerLeg * 2;
  const budgetForFixed = maxCostBps - variableBps;
  if (budgetForFixed <= 0) return null; // even ignoring fixed costs, variable already exceeds budget
  const fixedGBP = (cfg.commissionMinPerOrderGBP * 2) + (needsFx(symbol) ? cfg.fxMinPerLegGBP * 2 : 0);
  return fixedGBP / (budgetForFixed / 10000);
}

// ── Tier-2b: whole-share / lot-size constraints ────────────────────────────
// You buy an integer number of shares (or board lots), not an arbitrary £ amount.
// Two effects: (1) cash drag — the residual you can't deploy; (2) a hard floor —
// below one lot the position is infeasible. IBKR trades US names FRACTIONALLY, so
// the constraint is non-binding there (the bulk of the universe); board-lot markets
// force whole-lot orders. HONEST LIMITATION: HK board lots vary per-security
// (100–10,000) and are not modeled — assumed 1, which UNDERSTATES the HK floor.

const FRACTIONAL_SUFFIXES = new Set(['US']); // IBKR fractional-eligible (US-listed)
const LOT_SIZE: Record<string, number> = {
  '.T': 100, // Tokyo — standardized 100-share trading unit since 2018-10 (only
             // clearly-standardized board lot; others default to 1 below, .HK noted)
};

export function lotSize(symbol: string): number { return LOT_SIZE[suffixOf(symbol)] ?? 1; }
export function isFractional(symbol: string): boolean { return FRACTIONAL_SUFFIXES.has(suffixOf(symbol)); }

export interface LotFit {
  shares: number;        // whole shares/lots actually buyable (fractional for US)
  deployedGBP: number;   // shares * price (SAME currency as inputs)
  residualGBP: number;   // budget - deployed (uninvested cash drag)
  cashDragBps: number;   // residual as bps of budget
  feasible: boolean;     // can you afford >= 1 lot?
}

/**
 * Whole-share/lot fit of a budget. `budget` and `price` MUST be in the same
 * currency (this is currency-agnostic — pass GBP+GBP, or local+local, but not a
 * mix; FX belongs to roundTripCost, not here). US (fractional) => no rounding.
 */
export function lotFit(symbol: string, budget: number, price: number): LotFit {
  if (!(price > 0) || !(budget > 0)) {
    return { shares: 0, deployedGBP: 0, residualGBP: Math.max(budget, 0), cashDragBps: budget > 0 ? 10000 : 0, feasible: false };
  }
  if (isFractional(symbol)) {
    return { shares: budget / price, deployedGBP: budget, residualGBP: 0, cashDragBps: 0, feasible: true };
  }
  const lot = lotSize(symbol);
  const shares = Math.floor(budget / (price * lot)) * lot; // round down to whole lots
  const deployedGBP = shares * price;
  const residualGBP = budget - deployedGBP;
  return { shares, deployedGBP, residualGBP, cashDragBps: (residualGBP / budget) * 10000, feasible: shares >= lot };
}

/** Minimum budget (same currency as price) to afford one whole lot (0 = fractional). */
export function minLotBudget(symbol: string, price: number): number {
  return isFractional(symbol) ? 0 : lotSize(symbol) * price;
}

// ── Tier-3: latency slippage heuristic + short borrow ──────────────────────

/**
 * Suggested per-leg latency slippage (bps) to plug into CostConfig.slippageBpsPerLeg
 * IF you want to model scan→execution delay. Heuristic: you give up ~half the
 * bid-ask spread crossing on a delayed/market entry. This is an ASSUMPTION, not a
 * measurement — the measured version is the deferred next-open entry re-source in
 * the tracker. Kept separate from the default (0) so cost figures stay honest
 * unless you deliberately opt in.
 */
export function suggestedLatencySlippageBps(symbol: string): number {
  return 0.5 * spreadBpsFor(symbol);
}

/**
 * Borrow cost of holding a SHORT for `horizonDays`. Applies ONLY to short
 * positions (acting on a SELL by shorting) — the strategy is long-biased, so this
 * is 0 for the live book and exists for completeness / future short signals.
 * annualRate defaults to 0.005 (50bps, general-collateral / easy-to-borrow).
 * HONEST LIMITATION: hard-to-borrow / squeeze names run far higher (10–100%/yr)
 * and are NOT captured by a flat GC rate — pass a real per-name rate for those.
 */
export function shortBorrowCostGBP(positionValueGBP: number, horizonDays: number, annualRate = 0.005): number {
  return positionValueGBP * annualRate * (horizonDays / 365);
}
