/**
 * costModel.ts — itemized round-trip trading cost (Tier 1).
 *
 * Single source of truth for "what does it actually cost to round-trip a
 * position in this symbol", consumed by outcomeScoreboard (net-return) and
 * topBuysReport (min-move filter) so neither reimplements a flat constant.
 *
 * Three components:
 *   1. Transaction tax / stamp duty — accurate public rates by exchange suffix
 *      (side-aware: UK stamp is buy-only, HK/Swiss are both sides). SETTLED DATA.
 *   2. Commission — rate + per-order MINIMUM. The minimum is what bites at small
 *      position sizes. Broker-specific -> IBKR defaults below, CONFIRM.
 *   3. FX round-trip — for non-base-currency symbols from a GBP account.
 *      Broker-specific -> IBKR defaults, CONFIRM.
 *
 * Also exposes minViablePosition(): the smallest position where fixed costs
 * (per-order commission min + FX min) fall below a target bps — the most
 * decision-relevant output, since below it you're paying to trade, not to invest.
 *
 * NOTE (dividends): forward-return labels + the outcome tracker use Yahoo
 * quote.close (split-adjusted, DIVIDEND-EXCLUDED). Total return is understated by
 * the horizon dividend yield. That is a RETURN credit, not a cost — modeled
 * separately (dividendCredit) so net = price_return - cost + dividendCredit.
 */

// ── Config: commission + FX. IBKR defaults — CONFIRM against the real account. ──
export interface CostConfig {
  label: string;
  commissionRate: number;        // fraction of trade value (per leg)
  commissionMinPerOrderGBP: number; // per-order floor (per leg) — the biting number
  commissionMaxPctOfValue: number;  // cap as fraction of value (IBKR caps at 1%)
  fxBpsPerLeg: number;           // FX spread, fraction, per conversion
  fxMinPerLegGBP: number;        // FX per-conversion floor
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

  const totalGBP = taxGBP + commissionGBP + fxGBP;
  const fixedGBP = (cfg.commissionMinPerOrderGBP * 2) + (fx ? cfg.fxMinPerLegGBP * 2 : 0);
  return {
    symbol, positionValueGBP, taxGBP, commissionGBP, fxGBP, totalGBP,
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
  const variableBps = ((t.buy + t.sell) + cfg.commissionRate * 2 + (needsFx(symbol) ? cfg.fxBpsPerLeg * 2 : 0)) * 10000;
  const budgetForFixed = maxCostBps - variableBps;
  if (budgetForFixed <= 0) return null; // even ignoring fixed costs, variable already exceeds budget
  const fixedGBP = (cfg.commissionMinPerOrderGBP * 2) + (needsFx(symbol) ? cfg.fxMinPerLegGBP * 2 : 0);
  return fixedGBP / (budgetForFixed / 10000);
}
