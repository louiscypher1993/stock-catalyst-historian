/**
 * dsrPboAudit.ts — Deflated Sharpe Ratio + Probability of Backtest Overfitting.
 *
 * Post-hoc honesty checks on the D5 (2W, recommendation-basis) live track
 * record. Both address the same risk: a system with 5 heads, ~100+ features,
 * and a history of threshold/config sweeps is a false-discovery machine —
 * these bound how much of the reported edge could be explained by how much
 * was tried, rather than a real effect.
 *
 * DSR (Bailey & Lopez de Prado, 2014, "The Deflated Sharpe Ratio"): corrects
 * the observed Sharpe ratio for the number of trials N, plus the return
 * series' own skew/kurtosis (fat tails inflate the chance of a lucky Sharpe).
 * Reported as a SENSITIVITY TABLE across N rather than one committed number —
 * deliberately, because picking a single "true" N is itself a judgment call
 * this tool should not make silently (see the printed history note instead).
 *
 * PBO (combinatorially symmetric cross-validation, same paper's companion
 * method): tests whether the specific SELECTION RULE actually used (which
 * tier cut / how many picks per day) was chosen because it truly ranks best,
 * or because it happened to look best on the particular history available.
 * Built from 5 trial variants over the SAME run_dates (STRONG_BUY-only,
 * STRONG_BUY+BUY ["actionable", the metric already used elsewhere],
 * top-3/day, top-10/day, and an unselective baseline) — this is buildable
 * from data that exists today, unlike a classic multi-strategy CSCV which
 * would need separately-tracked historical equity curves for v9.1..v9.4 that
 * were never captured as live track records.
 *
 * HONEST LIMITATIONS (read before trusting either number):
 *   - Only 14 distinct run_dates have resolved 2W outcomes -> short history,
 *     small effective N for both methods. Treat both as PILOT estimates.
 *   - 2W predictions overlap in time (each day's window covers 14 days, so
 *     adjacent daily observations are NOT independent) -- inflates apparent
 *     T for both Sharpe estimation and CSCV block count. Not corrected here
 *     (would need a Newey-West-style adjustment); documented, not hidden.
 *   - CSCV partitions the series into at most 14 blocks. While T<=14 that means
 *     one run_date per block (maximum resolution); as data accumulates the
 *     blocks grow instead of the split count exploding, which keeps the run
 *     bounded (C(14,7)=3432 splits) no matter how long the history gets.
 *   - All current data is PRE-v9.4 (post-v9.4 2W has n=0 until ~2026-08-05).
 *     Re-run after that date for a checkpoint-era-consistent read.
 *
 * Usage:
 *   npx tsx src/scripts/dsrPboAudit.ts                  # 2W, supabase, £50 position
 *   npx tsx src/scripts/dsrPboAudit.ts --horizon 2D --source local --position 500
 */
import 'dotenv/config';
import { loadRows, type Row } from './outcomeScoreboard';
import { roundTripCost } from '../costModel';

// ── normal-distribution helpers (Abramowitz-Stegun erf; Acklam probit) ──────
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normalCdf(x: number): number { return 0.5 * (1 + erf(x / Math.SQRT2)); }
// Acklam's rational approximation to the inverse standard normal CDF (probit).
function probit(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ── moment helpers ───────────────────────────────────────────────────────────
function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; }
function std(a: number[]): number { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); }
function skewness(a: number[]): number { const m = mean(a), s = std(a); return s === 0 ? 0 : mean(a.map(x => ((x - m) / s) ** 3)); }
function kurtosis(a: number[]): number { const m = mean(a), s = std(a); return s === 0 ? 3 : mean(a.map(x => ((x - m) / s) ** 4)); } // regular (normal=3), not excess

// ── DSR (Bailey & Lopez de Prado 2014) ──────────────────────────────────────
const EULER_MASCHERONI = 0.5772156649015329;
interface DsrResult { n: number; sr: number; varSr: number; skew: number; kurt: number; T: number }
function dsrStats(returns: number[]): DsrResult {
  const T = returns.length;
  const sr = mean(returns) / std(returns);
  const g3 = skewness(returns), g4 = kurtosis(returns);
  const varSr = (1 - g3 * sr + ((g4 - 1) / 4) * sr * sr) / (T - 1);
  return { n: T, sr, varSr: Math.max(varSr, 1e-12), skew: g3, kurt: g4, T };
}
// expected max Sharpe under N independent trials with SD sqrt(varSr); N=1 has
// no selection bias, so E[maxSR] = 0 and DSR(1) reduces to the plain PSR.
function expectedMaxSharpe(varSr: number, N: number): number {
  if (N <= 1) return 0;
  const sigma = Math.sqrt(varSr);
  return sigma * ((1 - EULER_MASCHERONI) * probit(1 - 1 / N) + EULER_MASCHERONI * probit(1 - 1 / (N * Math.E)));
}
function deflatedSharpe(d: DsrResult, N: number): number {
  const emax = expectedMaxSharpe(d.varSr, N);
  return normalCdf((d.sr - emax) / Math.sqrt(d.varSr));
}

// ── formatting ──────────────────────────────────────────────────────────────
function pct(v: number, dp = 3): string { return Number.isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(dp) + '%' : 'n/a'; }
function fixed(v: number, dp = 3): string { return Number.isFinite(v) ? v.toFixed(dp) : 'n/a'; }
function verdictFor(dsr: number): string {
  if (!Number.isFinite(dsr)) return 'n/a';
  if (dsr >= 0.95) return 'still significant (DSR>=0.95)';
  if (dsr >= 0.5) return 'weak / marginal';
  return 'NOT distinguishable from luck at this N';
}

// ── trial-variant construction (for PBO) ────────────────────────────────────
// gross = actual_return + dividend_credit (the SKILL question: did the model
// rank things right, cost-independent — mirrors this codebase's own "IC is
// cost-independent" framing). net = gross - cost @ the given position (the
// SIZE-VIABILITY question, already answered elsewhere: no, not at £50). DSR
// uses gross (a real edge shouldn't be judged against a known-unviable cost
// assumption); PBO uses net (it's a RELATIVE ranking test across variants, so
// a shared cost model doesn't distort it the way it distorts an absolute Sharpe).
interface DayRow { symbol: string; predicted_return: number; predicted_tier: string; gross: number; net: number }
type Variant = { name: string; select: (rows: DayRow[]) => DayRow[] };
const VARIANTS: Variant[] = [
  { name: 'STRONG_BUY only', select: rows => rows.filter(r => r.predicted_tier === 'STRONG_BUY') },
  { name: 'STRONG_BUY+BUY (actionable)', select: rows => rows.filter(r => r.predicted_tier === 'STRONG_BUY' || r.predicted_tier === 'BUY') },
  { name: 'top-3/day', select: rows => [...rows].sort((a, b) => b.predicted_return - a.predicted_return).slice(0, 3) },
  { name: 'top-10/day', select: rows => [...rows].sort((a, b) => b.predicted_return - a.predicted_return).slice(0, 10) },
  { name: 'ALL scored (baseline)', select: rows => rows },
];

// day with no rows selected by a variant => flat/no-trade => 0 return that period.
function variantSeries(byDate: Map<string, DayRow[]>, dates: string[], v: Variant, field: 'gross' | 'net'): number[] {
  return dates.map(d => { const picked = v.select(byDate.get(d) ?? []); return picked.length ? mean(picked.map(r => r[field])) : 0; });
}

// ── CSCV / PBO (Bailey, Borwein, Lopez de Prado, Zhu 2015-ish companion method) ──
// CSCV is defined over S BLOCKS, not over T individual observations. Enumerating
// splits of individual periods (block size 1) is a degenerate case that only
// works while T is tiny, and it fails badly as data accumulates:
//   T=24 -> 2.7M masks (slow)   T=28 -> 40M (OOM)
//   T>=31 -> `1 << T` OVERFLOWS 32-bit signed, the loop never executes, and PBO
//            comes back NaN -- a silently WRONG answer, not an error.
// Since 2W run_dates accumulate daily post-checkpoint, that would have broken
// exactly when this tool became useful. Blocking bounds the split count
// regardless of T (C(14,7)=3432) and matches the method as published.
const S_MAX_BLOCKS = 14;

/** Largest EVEN block count <= min(S_MAX_BLOCKS, T), for a symmetric IS/OOS split. */
function blockCountFor(T: number): number {
  const s = Math.min(S_MAX_BLOCKS, T);
  return s % 2 === 0 ? s : s - 1;
}

/** Partition [0..T) into S contiguous, near-equal blocks of period indices. */
function partitionIntoBlocks(T: number, S: number): number[][] {
  const blocks: number[][] = [];
  for (let b = 0; b < S; b++) {
    const start = Math.floor((b * T) / S);
    const end = Math.floor(((b + 1) * T) / S);
    const idx: number[] = [];
    for (let t = start; t < end; t++) idx.push(t);
    blocks.push(idx);
  }
  return blocks;
}

/** All bitmasks over S blocks with exactly k bits set. S <= 14, so this is bounded. */
function combinationsBitmasks(S: number, k: number): number[] {
  const out: number[] = [];
  for (let mask = 0; mask < (1 << S); mask++) {
    let bits = 0, m = mask;
    while (m) { bits += m & 1; m >>= 1; }
    if (bits === k) out.push(mask);
  }
  return out;
}
function sharpeOf(vals: number[]): number { const s = std(vals); return s === 0 || !Number.isFinite(s) ? 0 : mean(vals) / s; }

function computePBO(matrix: number[][], T: number): { pbo: number; splits: number; blocks: number; blockSize: string } {
  const M = matrix.length; // number of trial variants
  const S = blockCountFor(T);
  const blocks = partitionIntoBlocks(T, S);
  const masks = combinationsBitmasks(S, S / 2);
  const sizes = blocks.map(b => b.length);
  const blockSize = Math.min(...sizes) === Math.max(...sizes)
    ? `${sizes[0]}` : `${Math.min(...sizes)}-${Math.max(...sizes)}`;
  let overfitCount = 0;
  for (const mask of masks) {
    const isIdx: number[] = [], oosIdx: number[] = [];
    for (let b = 0; b < S; b++) ((mask >> b) & 1 ? isIdx : oosIdx).push(...blocks[b]);
    const isSharpes = matrix.map(series => sharpeOf(isIdx.map(i => series[i])));
    const oosSharpes = matrix.map(series => sharpeOf(oosIdx.map(i => series[i])));
    let bestIS = 0; for (let m = 1; m < M; m++) if (isSharpes[m] > isSharpes[bestIS]) bestIS = m;
    // OOS rank of the IS-winner: 1 = best OOS Sharpe among the M variants.
    const rank = 1 + oosSharpes.filter((s, m) => m !== bestIS && s > oosSharpes[bestIS]).length;
    const omega = rank / (M + 1);
    const logit = Math.log(omega / (1 - omega));
    if (logit > 0) overfitCount++; // IS-winner landed below the OOS median -> overfit signal
  }
  return { pbo: overfitCount / masks.length, splits: masks.length, blocks: S, blockSize };
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const source = arg('--source', 'supabase');
  const horizon = arg('--horizon', '2W');
  const positionGBP = Number(arg('--position', '50'));

  const all = await loadRows(source, null, null);
  const rows = all.filter(r => r.horizon === horizon);
  const dates = [...new Set(rows.map(r => r.run_date))].sort();
  const byDate = new Map<string, DayRow[]>();
  for (const r of rows) {
    const cost = roundTripCost(r.symbol, positionGBP).totalBps / 10000;
    const gross = r.actual_return + (r.dividend_credit ?? 0);
    const net = gross - cost;
    if (!byDate.has(r.run_date)) byDate.set(r.run_date, []);
    byDate.get(r.run_date)!.push({ symbol: r.symbol, predicted_return: r.predicted_return, predicted_tier: r.predicted_tier, gross, net });
  }

  const line = '='.repeat(80);
  console.log(`\n${line}`);
  console.log(` DSR + PBO AUDIT — ${horizon} track record`);
  console.log(` source: ${source}   ·   cost @ £${positionGBP}   ·   ${rows.length} rows across ${dates.length} run_dates (${dates[0] ?? '—'} → ${dates[dates.length - 1] ?? '—'})`);
  console.log(line);

  if (dates.length < 6) {
    console.log(`\n Only ${dates.length} distinct run_dates — too few for a meaningful DSR/PBO read (need >=6). Stopping.\n`);
    return;
  }

  // ── DSR on GROSS returns (the SKILL question — cost-independent, same logic
  // as this codebase's own "IC is cost-independent" framing). Net-of-£50-cost
  // would trivially fail DSR because £50 costs ~940bps, a KNOWN size-viability
  // problem already established elsewhere — that's a different question from
  // "is the ranking edge itself real", and conflating them would misreport a
  // cost artifact as an absence of skill. ──
  const actionableGross = variantSeries(byDate, dates, VARIANTS[1], 'gross');
  const baselineGross = variantSeries(byDate, dates, VARIANTS[4], 'gross');
  const actionableNet = variantSeries(byDate, dates, VARIANTS[1], 'net');
  const d = dsrStats(actionableGross);
  const dBase = dsrStats(baselineGross);

  console.log(`\n${'─'.repeat(80)}`);
  console.log(` DEFLATED SHARPE RATIO — "actionable" (STRONG_BUY+BUY) daily GROSS-return series`);
  console.log(`${'─'.repeat(80)}`);
  console.log(` (gross = actual_return + dividend_credit, NO trading cost — the skill question,`);
  console.log(`  independent of position size. For reference, net @ £${positionGBP}: mean ${pct(mean(actionableNet))} —`);
  console.log(`  that's the known £50-cost-drag effect, not evidence about the underlying signal.)`);
  console.log(` T=${d.T} periods   mean ${pct(mean(actionableGross))}   σ ${pct(std(actionableGross))}   Sharpe(per-period) ${fixed(d.sr)}`);
  console.log(` skew ${fixed(d.skew)}   kurtosis ${fixed(d.kurt)} (normal=3)`);
  console.log(` ⚠ T=${d.T} is short and these are OVERLAPPING ${horizon}-return windows sampled daily — treat as a pilot,`);
  console.log(`   not a final statistic. Re-run as post-v9.4 ${horizon} data accumulates (~2026-08-05+).`);

  console.log(`\n DSR sensitivity — is the Sharpe still "significant" after correcting for N trials?`);
  console.log(`   (DSR = P(true Sharpe > 0 | selection bias from N independent trials). Not one number`);
  console.log(`    on purpose — picking a single "true" N is a judgment call, shown here instead of asserted.)`);
  console.log(`\n   ${'N (trials)'.padStart(12)} ${'E[max SR|N]'.padStart(14)} ${'DSR'.padStart(8)}   verdict`);
  const N_SWEEP = [1, 2, 5, 10, 20, 50, 100, 500, 1000, 5000, 40000];
  for (const N of N_SWEEP) {
    const emax = expectedMaxSharpe(d.varSr, N);
    const dsr = deflatedSharpe(d, N);
    console.log(`   ${String(N).padStart(12)} ${fixed(emax).padStart(14)} ${fixed(dsr, 4).padStart(8)}   ${verdictFor(dsr)}`);
  }
  console.log(`\n   For contrast, the SAME sweep on the unselective baseline (all scored symbols, no`);
  console.log(`   tier filter) — expect this to fail sooner if the tier selection is adding real value:`);
  console.log(`   ${'N (trials)'.padStart(12)} ${'DSR'.padStart(8)}   verdict`);
  for (const N of [1, 10, 100]) console.log(`   ${String(N).padStart(12)} ${fixed(deflatedSharpe(dBase, N), 4).padStart(8)}   ${verdictFor(deflatedSharpe(dBase, N))}`);

  console.log(`\n   Documented history for calibrating N (not a recommendation, just what's on record):`);
  console.log(`     ~5   major model retrains/threshold recalibrations (v9 -> v9.1 -> v9.2 -> v9.3 -> v9.4)`);
  console.log(`     ~10-20 distinct analysis/ablation passes (v10 DROP, Stage 3/4 fixes, F5 threshold, etc.)`);
  console.log(`     ~40,000 configs in the Boldness/Patience pot-parameter sweep — a DIFFERENT trial pool`);
  console.log(`       (synthetic-pot training params, not this live D5 buy-tier metric directly) but the`);
  console.log(`       same selection-bias mechanism applies if any of its conclusions fed back into this metric.`);

  // ── PBO across 5 selection-rule variants ──
  console.log(`\n${'─'.repeat(80)}`);
  console.log(` PROBABILITY OF BACKTEST OVERFITTING — did the ACTUAL selection rule chosen`);
  console.log(` (which tier cut / how many picks per day) get picked for being truly best, or for`);
  console.log(` looking best on this specific history?`);
  console.log(`${'─'.repeat(80)}`);
  console.log(` (net-of-cost @ £${positionGBP} — PBO is a RELATIVE ranking test across variants under the`);
  console.log(`  SAME cost model, so the shared cost drag doesn't distort it the way it distorts an absolute Sharpe.)`);
  console.log(` Trial variants (all over the SAME ${dates.length} run_dates, £${positionGBP} netted):`);
  const seriesByVariant = VARIANTS.map(v => variantSeries(byDate, dates, v, 'net'));
  VARIANTS.forEach((v, i) => {
    const s = seriesByVariant[i];
    console.log(`   ${v.name.padEnd(28)} mean ${pct(mean(s)).padStart(9)}   Sharpe ${fixed(sharpeOf(s)).padStart(7)}   (full-sample, not CSCV)`);
  });

  // Blocking handles any T (odd included), so no periods are discarded.
  const T = dates.length;
  const matrix = seriesByVariant;
  const { pbo, splits, blocks, blockSize } = computePBO(matrix, T);

  console.log(`\n CSCV: T=${T} periods partitioned into ${blocks} blocks of ${blockSize} period(s),`);
  console.log(`   ${splits} symmetric IS/OOS block-splits evaluated.`);
  if (T <= S_MAX_BLOCKS) console.log(`   (T <= ${S_MAX_BLOCKS}, so block size is 1 — maximum resolution.)`);
  console.log(`\n   PBO = ${fixed(pbo, 3)}  (${(pbo * 100).toFixed(1)}% of splits: the in-sample-best variant ranked`);
  console.log(`   BELOW the out-of-sample median among all ${VARIANTS.length} variants)`);
  const pboVerdict = pbo > 0.5 ? 'MORE LIKELY THAN NOT overfit — the chosen selection rule\'s apparent edge over'
    + '\n     the other cuts may not survive out-of-sample. Treat the specific tier/top-N choice as unproven.'
    : pbo > 0.3 ? 'borderline — some overfitting risk in the selection-rule choice, not conclusive either way.'
    : 'the selection rule\'s edge looks robust to which half of history you check (low overfitting signal).';
  console.log(`   VERDICT: ${pboVerdict}`);

  console.log(`\n${line}`);
  console.log(` Both figures are PILOT estimates on ${dates.length} periods of overlapping-window data. Re-run`);
  console.log(` this exact command post-2026-08-05 once post-v9.4 2W data accumulates for a firmer read.`);
  console.log(`${line}\n`);
}

main().catch(e => { console.error('[DSR/PBO] FATAL:', e); process.exit(1); });
