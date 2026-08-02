import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { db, getCachedCompanyProfile, getCompetitorEventDensity } from '../db';
import { GLOBAL_MARKETS } from './marketsData';
import { buildLiveFeatureVector, LiveFeatureContext } from './ml/feature_extractor';
import {
  calculatePriceZScore,
  calculateVolumeRatio,
  calculateATRMoveNormalization,
} from './utils/physics';
import { getRecentFilings as getEdgarFilings } from '../EdgarService';
import { fetchFREDSeries, convertToGBPIfHighNominal } from '../FREDService';
import type { EdgarFiling } from './types';
import { isFmpPremium } from '../FMPService';
import { getAlphaVantageNewsSentiment } from '../AlphaVantageService';
import {
  evaluateRun, type PotInferenceResult,
  HORIZON_TIER_CONFIG, resolveTierFromConfig, modelCPercentileRank, RISK_REWARD_FLOOR,
} from './PotService';

// Local copy — cannot import from HistoricalEngine (circular dependency).
// NOTE: HistoricalEngine.ts's own copy of this list has the identical gap
// documented below -- this fix has not been ported there (out of scope here).
//
// Suffixes below are every distinct exchange suffix in marketsData.ts's
// symbol list, cross-checked against Yahoo's real chart API (not guessed):
// each one returns real price data unmodified but 404s when dash-converted,
// same failure mode originally found on PKO.WA. Two suffixes present in
// marketsData.ts are deliberately NOT in this list because dot->dash
// preservation didn't fix them either:
//   .B  -- correctly handled by the existing dash-fallback below (e.g.
//          BRK.B -> BRK-B is genuinely Yahoo's real format for US
//          multi-class shares, not an international suffix).
//   .AB -- Abu Dhabi Securities Exchange tickers 404 under every format
//          tried (raw, dashed, and a .AD hypothesis) -- looks like a Yahoo
//          data-coverage gap, not a suffix-mapping bug.
//   .PS -- intended as Philippine Stock Exchange, but resolves (200 OK) to
//          an unrelated US synthetic/mutual-fund placeholder under Yahoo's
//          internal "YHD" pseudo-exchange, not real PSE data, under every
//          format tried. Not a dot/dash issue; needs real investigation
//          before touching, not a guess.
const _YAHOO_INTL_SUFFIXES = new Set([
  '.AE', '.AS', '.AT', '.AX', '.BA', '.BD', '.BK', '.BO', '.BR',
  '.CA', '.CL', '.CO', '.DE', '.F', '.HE', '.HK', '.IR', '.IS',
  '.JK', '.JO', '.KA', '.KL', '.KQ', '.KS', '.KW', '.L', '.LM',
  '.LS', '.MC', '.ME', '.MI', '.MX', '.NS', '.NZ', '.OL', '.PA',
  '.PR', '.QA', '.RO', '.SA', '.SI', '.SN', '.SR', '.SS', '.ST',
  '.SW', '.SZ', '.T', '.TO', '.TW', '.VN', '.WA',
]);
function normaliseForYahoo(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx === -1) return upper;
  const suffix = upper.slice(dotIdx);
  if (_YAHOO_INTL_SUFFIXES.has(suffix)) return upper;
  return upper.replace(/\./g, '-');
}

function isUsListed(exchange: string | null): boolean {
  if (!exchange) return false;
  const ex = exchange.toLowerCase();
  return ex.includes('nyse') || ex.includes('nasdaq') || ex.includes('otc');
}

function computeDigitalExhaustVelocity(snap: Record<string, any> | null): number | null {
  const wn = (key: string): number | null => {
    const v = snap?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const inputs = [
    { v: wn('stocktwits_virality_z'), w: 0.35 },
    { v: wn('google_trends_z'),       w: 0.30 },
    { v: wn('wikipedia_spike_z'),     w: 0.20 },
  ];
  const avail = inputs.filter(i => i.v !== null);
  if (avail.length < 2) return null;
  const totalW = avail.reduce((sum, i) => sum + i.w, 0);
  const raw    = avail.reduce((sum, i) => sum + i.v! * i.w, 0) / totalW;
  return Math.max(-3, Math.min(3, raw));
}

const Z_SCORE_THRESHOLD = 2.15;
const ROLLING_WINDOW = 90;
const NARRATIVE_CONFIDENCE_THRESHOLD = 0.65;
const ML_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ml');
const YAHOO_REQUEST_DELAY_MS = 75;

// When PULSE_MODE=1 (set by watchlist-pulse.yml's conditional trigger phase),
// this run skips PotService evaluation, Gemini narrative generation, and the
// macro snapshot -- notifications still fire with recommendation/return/risk
// numbers, just with an empty narrative. Rationale: pots are designed around
// 3 scheduled slots/day (pulse-triggered trading would silently change the
// experiment's semantics), Gemini quota is shared with the 3x/day main runs,
// and macro regime doesn't move at intraday granularity anyway. Absent the
// flag, behavior is byte-identical to today.
const PULSE_MODE = process.env.PULSE_MODE === '1';

// ---------------------------------------------------------------------------
// BENCHMARK SELECTION (LIVE_BENCHMARK_MODE)
//
// THE DEFECT. buildSpyReturnMap is built once per run and passed to detectAnomaly
// for EVERY symbol, so live hedges a Tokyo or London name against SPY. Training does
// not: HistoricalEngine.ts:1533-1543 picks a native index per suffix. excess_return is
// a model input AND the basis of the z-score that decides what counts as an anomaly at
// all, so for the 445 symbols in these 11 markets (39.1% of training rows) both the
// feature distribution and the detection criterion differ between train and serve.
// The comment on buildBetaHedgedExcessReturns claims it "ports HistoricalEngine.ts
// :1688-1723" — it ports the beta regression but not the benchmark selection.
//
// MEASURED BLAST RADIUS (scratch_v12_live_shadow.py, 2024-08-01 onward, 445 symbols):
// detection COUNT barely moves (10,206 -> 9,990, -2.1%) but COMPOSITION does — only
// 67% of detections persist; ~3,369 disappear and ~3,153 appear. Overlap tracks the
// mechanism: .TO 80% (closes with the US) down to .ST 55%. That is a behavioural
// change to a system issuing daily recommendations, which is why it is gated rather
// than simply applied.
//
//   'spy'     (default, and the value when the var is unset) — byte-identical to the
//             behaviour before this change. Nothing is fetched, nothing is computed.
//   'shadow'  — decisions still use SPY; the native-benchmark result is computed
//               alongside and divergences are logged. Zero behaviour change, but it
//               accumulates the live evidence needed to judge the 33% churn.
//   'native'  — the fix: hedge against the per-market index, and carry the last known
//               benchmark return forward instead of substituting 0 for a missing one.
const LIVE_BENCHMARK_MODE = (process.env.LIVE_BENCHMARK_MODE ?? 'spy').toLowerCase();

// Ported verbatim from HistoricalEngine.ts:1533-1543 so live and training agree.
const NATIVE_BENCHMARK: Record<string, string> = {
  '.AX': '^AXJO', '.SW': '^SSMI', '.ST': '^OMX', '.SI': '^STI', '.L': '^FTSE',
  '.DE': '^GDAXI', '.PA': '^FCHI', '.TO': '^GSPTSE', '.NS': '^BSESN',
  '.BO': '^BSESN', '.HK': '^HSI',
};

/** Benchmark ticker training would have used for this symbol; '^GSPC' otherwise. */
export function nativeBenchmarkTicker(symbol: string): string {
  const u = String(symbol).toUpperCase();
  for (const suffix of Object.keys(NATIVE_BENCHMARK)) {
    if (u.endsWith(suffix)) return NATIVE_BENCHMARK[suffix];
  }
  return '^GSPC';
}

/** Forward-fill a return series across calendar gaps.
 *  Used ONLY for the same-day hedge term. The beta window deliberately keeps using the
 *  sparse map and skipping absent dates: repeating a stale return inside the regression
 *  would bias the beta estimate, whereas substituting 0 for the same-day term (today's
 *  `?? 0`) silently converts excess_return into the raw return. Absence is not zero. */
function densifyForward(map: Map<string, number>): Map<string, number> {
  const dates = [...map.keys()].sort();
  if (!dates.length) return new Map();
  const out = new Map<string, number>();
  let last = map.get(dates[0])!;
  const cur = new Date(dates[0] + 'T00:00:00Z');
  const end = new Date(dates[dates.length - 1] + 'T00:00:00Z');
  while (cur <= end) {
    const key = cur.toISOString().slice(0, 10);
    if (map.has(key)) last = map.get(key)!;
    out.set(key, last);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

interface YahooBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AnomalySignal {
  symbol: string;
  companyName: string;
  date: string;
  close: number;
  zScore: number;
  excessReturn: number;
  volumeRatio: number;
  relativeVolume30d: number;
  atrShockScore: number;
  bodyToRangeRatio: number;
  overnightGapPct: number;
  volumePriceClustering: number;
  kineticEnergy: number;
  seismicMagnitudeMw: number;
  dayChangePct: number;
}

export interface ModelScores {
  model_a_confidence: number;
  model_b_return_1m: number;
  model_c_max_drawdown: number;
  model_d1_return_3m: number;
  model_d2_return_6m: number;
  model_d3_return_2d: number;
  model_d4_return_3d: number;
  model_d5_return_2w: number;
  model_e_outperform_12m_prob: number;
}

export interface Recommendation {
  recommendation: string;
  riskScore: number;
  riskReward: number;
  positionSizePct: number;
}

interface TrendContext {
  pre_return_5d: number;
  pre_return_10d: number;
  pre_return_21d: number;
  pre_volume_trend: number;  // positive = volume building, negative = declining
  trendAlignment: 'ALIGNED' | 'OPPOSING' | 'NEUTRAL';
  trendStrength: number;  // 0.0 to 1.0
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Determines which pipeline slot is running from env var (GitHub Actions)
 *  or falls back to the current UTC hour. */
function determineRunSlot(): 'morning' | 'afternoon' | 'evening' {
  const env = process.env.PIPELINE_RUN_SLOT;
  if (env === 'morning' || env === 'afternoon' || env === 'evening') return env;
  const hour = new Date().getUTCHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export async function fetchYahooDailyHistory(symbol: string, range: string = '1y'): Promise<YahooBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normaliseForYahoo(symbol))}?range=${range}&interval=1d`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    throw new Error(`Yahoo Finance request failed for ${symbol}: HTTP ${response.status}`);
  }
  const data: any = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) return [];

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const bars: YahooBar[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i];
    if ([open, high, low, close, volume].some((v: unknown) => v === null || v === undefined)) continue;
    bars.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      open, high, low, close, volume,
    });
  }

  return bars;
}

// Builds SPY's own daily return series keyed by date, once per scan run,
// shared across all symbols (F10) -- avoids re-deriving it per symbol.
// Exported so other detectAnomaly call sites (e.g. server.ts's single-symbol
// /api/scan-symbol endpoint) can build the same series consistently.
export function buildSpyReturnMap(spyBars: YahooBar[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i < spyBars.length; i++) {
    const prev = spyBars[i - 1];
    const curr = spyBars[i];
    if (prev.close > 0) map.set(curr.date, (curr.close - prev.close) / prev.close);
  }
  return map;
}

// F10: ports HistoricalEngine.ts:1688-1723's per-symbol, per-day rolling
// 60-day beta regression against SPY (Cov(stock,spy)/Var(spy), trailing
// window ending at each day i), replacing the old detectAnomaly construction
// that subtracted one constant SPY-return scalar from every day in the
// window -- that constant-scalar subtraction cancels out exactly in the
// z-score below (proven algebraically in the F10 recon report), making
// live's "market adjustment" a no-op. This makes it genuinely per-day and
// per-symbol, matching training. Regression inputs are scaled by 100 (percent),
// exactly matching training's convention, so the 0.0001 variance-floor
// threshold behaves identically -- the resulting beta value itself is
// scale-invariant (the x100 cancels in the covariance/variance ratio), so
// it's applied directly to the fractional (unscaled) daily/SPY returns
// below, consistent with live's existing fractional-return convention
// elsewhere in this function. Returns a parallel array of beta-hedged
// excess returns, one per index of `bars` (index 0 is always 0, matching
// training's i=0 boundary).
function buildBetaHedgedExcessReturns(
  bars: YahooBar[],
  spyReturnByDate: Map<string, number>,
  denseReturnByDate?: Map<string, number>,
): number[] {
  const excessReturns: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const dailyReturn = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;

    const betaStartIdx = Math.max(1, i - 59);
    const stockReturnsPct: number[] = [];
    const spyReturnsPct: number[] = [];
    for (let k = betaStartIdx; k <= i; k++) {
      const spyRet = spyReturnByDate.get(bars[k].date);
      if (spyRet !== undefined && bars[k - 1].close > 0) {
        stockReturnsPct.push(((bars[k].close - bars[k - 1].close) / bars[k - 1].close) * 100);
        spyReturnsPct.push(spyRet * 100);
      }
    }

    let beta = 1;
    if (spyReturnsPct.length >= 10) {
      const meanSpy = spyReturnsPct.reduce((a, b) => a + b, 0) / spyReturnsPct.length;
      const meanStock = stockReturnsPct.reduce((a, b) => a + b, 0) / stockReturnsPct.length;
      let covariance = 0;
      let varianceSpy = 0;
      for (let j = 0; j < spyReturnsPct.length; j++) {
        covariance += (spyReturnsPct[j] - meanSpy) * (stockReturnsPct[j] - meanStock);
        varianceSpy += Math.pow(spyReturnsPct[j] - meanSpy, 2);
      }
      if (varianceSpy > 0.0001) beta = covariance / varianceSpy;
    }

    // `?? 0` is the defect: on a date with no benchmark bar the hedge silently
    // vanishes and excess_return degenerates to the raw return (12-23% of bar-days
    // on .NZ/.AX/Gulf markets). When a forward-filled series is supplied we carry the
    // last known return instead; without one, behaviour is unchanged.
    const spyReturnToday = denseReturnByDate
      ? (spyReturnByDate.get(bars[i].date) ?? denseReturnByDate.get(bars[i].date) ?? 0)
      : (spyReturnByDate.get(bars[i].date) ?? 0);
    excessReturns[i] = dailyReturn - beta * spyReturnToday;
  }
  return excessReturns;
}

// F10: now genuinely mirrors HistoricalEngine.ts's idiosyncratic-return z-score
// -- a 90-day rolling window of per-day, beta-hedged SPY-excess returns
// establishes the baseline mean/stddev, and an anomaly is any day whose excess
// return deviates from that baseline by more than Z_SCORE_THRESHOLD standard
// deviations. (Previously this comment was aspirational, not actual -- the old
// constant-scalar SPY subtraction canceled out exactly in the z-score, making
// live's gate mathematically identical to using raw, non-market-adjusted
// returns; see the F10 recon report for the algebraic proof.)
export function detectAnomaly(symbol: string, companyName: string, bars: YahooBar[], spyReturnByDate: Map<string, number>, bypassZGate: boolean = false, denseReturnByDate?: Map<string, number>): AnomalySignal | null {
  if (bars.length < 12) return null;

  const excessReturns = buildBetaHedgedExcessReturns(bars, spyReturnByDate, denseReturnByDate);

  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];

  const dailyReturn = (last.close - prev.close) / prev.close;
  const excessReturn = excessReturns[bars.length - 1];

  const windowStart = Math.max(1, bars.length - 1 - ROLLING_WINDOW);
  const windowReturns: number[] = [];
  for (let i = windowStart; i < bars.length - 1; i++) {
    windowReturns.push(excessReturns[i]);
  }
  if (windowReturns.length < 10) return null;

  const rollingMean = windowReturns.reduce((sum, r) => sum + r, 0) / windowReturns.length;
  const sumSquaredDiffs = windowReturns.reduce((sum, r) => sum + Math.pow(r - rollingMean, 2), 0);
  const rollingStd = Math.sqrt(sumSquaredDiffs / Math.max(1, windowReturns.length - 1));

  const zScore = calculatePriceZScore(excessReturn, rollingMean, rollingStd);
  // Force-analyzed symbols (watchlist + open POTS positions) skip the z-gate
  // entirely so held/watched names get continuous B/D-head tracking regardless
  // of move size, not just when they anomaly-spike. Small |z| naturally yields
  // low model_a_confidence by construction (z is Model A's primary driver) --
  // expected, not a bug; the value here is the ongoing tracking + notifications
  // on held/watched names, not the anomaly signal itself.
  if (!bypassZGate && Math.abs(zScore) <= Z_SCORE_THRESHOLD) return null;

  const vol20Window = bars.slice(-21, -1);
  const vol20Avg = vol20Window.reduce((sum, b) => sum + b.volume, 0) / Math.max(1, vol20Window.length);
  // 30 bars INCLUDING today, matching training's exact convention
  // (HistoricalEngine.ts:1977-1985's vol30Slice = slice(i-29, i+1)) -- previously
  // used a 90-day/exclude-today window here despite the "30d" name, confirmed as a
  // real mismatch by the F1 window-bug measurement (median delta 0.27 vs training,
  // fully corrected 30d/include-today version matches training exactly at the
  // median). volumeRatio (20-day, above) is untouched -- out of scope, not flagged.
  const vol30Window = bars.slice(-30);
  const vol30Avg = vol30Window.reduce((sum, b) => sum + b.volume, 0) / Math.max(1, vol30Window.length);

  const volumeRatio = calculateVolumeRatio(last.volume, vol20Avg);
  const relativeVolume30d = calculateVolumeRatio(last.volume, vol30Avg);

  const trWindow = bars.slice(-15);
  const trList: number[] = [];
  for (let i = 1; i < trWindow.length; i++) {
    const cur = trWindow[i];
    const p = trWindow[i - 1];
    trList.push(Math.max(cur.high - cur.low, Math.abs(cur.high - p.close), Math.abs(cur.low - p.close)));
  }
  const atr14 = trList.length > 0 ? trList.reduce((sum, v) => sum + v, 0) / trList.length : 1.5;
  const atrShockScore = calculateATRMoveNormalization(last.high - last.low, atr14);

  const bodyToRangeRatio = Math.abs(last.close - last.open) / Math.max(0.0001, last.high - last.low);
  const overnightGapPct = ((last.open - prev.close) / prev.close) * 100;
  const volumePriceClustering = ((last.close - ((last.high + last.low) / 2)) / Math.max(0.0001, last.high - last.low)) * volumeRatio;

  // F1 KE/seismic reconciliation (final slice): ported exactly from
  // HistoricalEngine.ts:2039 -- 0.5 * relative_volume_30d * (rawReturn*100)^2.
  // `dailyReturn` above (unscaled fraction, e.g. 0.01 = 1%) matches training's
  // `rawReturn` convention exactly -- both multiply by 100 inline in this
  // formula, not pre-scaled, so no repeat of the x100 scaling bug caught in
  // market_reynolds_number's stdDev calc (that bug was in a DIFFERENT,
  // already-x100 convention -- calculatedReturns[i].dailyReturn -- which this
  // formula never used in training either). `relativeVolume30d` is the
  // already-corrected 30-day/include-today value from the window-mismatch fix,
  // confirmed independent of this change (Spearman 0.997 same-formula/
  // different-window). Previously live used an unrelated z-based formula
  // (0.5*z^2); seismic_magnitude_mw was never computed live at all.
  const kineticEnergy = 0.5 * relativeVolume30d * Math.pow(dailyReturn * 100, 2);
  const seismicMagnitudeMw = (2 / 3) * Math.log10(Math.max(1, kineticEnergy));

  return {
    symbol,
    companyName,
    date: last.date,
    close: last.close,
    zScore,
    excessReturn,
    volumeRatio,
    relativeVolume30d,
    atrShockScore,
    bodyToRangeRatio,
    overnightGapPct,
    volumePriceClustering,
    kineticEnergy,
    seismicMagnitudeMw,
    dayChangePct: dailyReturn,
  };
}

export function computeTrendContext(bars: YahooBar[], anomalyZScore: number): TrendContext {
  const n = bars.length;

  // Returns are computed up to the day BEFORE the anomaly (bars[-2])
  // so we don't contaminate the trend with the anomaly move itself.
  const dayBefore = bars[n - 2].close;
  const pre5d  = n >= 7  ? bars[n - 7].close  : null;
  const pre10d = n >= 12 ? bars[n - 12].close : null;
  const pre21d = n >= 23 ? bars[n - 23].close : null;

  const pre_return_5d  = pre5d  ? (dayBefore - pre5d)  / pre5d  : 0;
  const pre_return_10d = pre10d ? (dayBefore - pre10d) / pre10d : 0;
  const pre_return_21d = pre21d ? (dayBefore - pre21d) / pre21d : 0;

  // Volume trend: average of 5 bars immediately before anomaly vs 5 bars before that
  const recent5 = bars.slice(n - 6, n - 1);
  const prior5  = bars.slice(n - 11, n - 6);
  const recent5VolAvg = recent5.length > 0 ? recent5.reduce((s, b) => s + b.volume, 0) / recent5.length : 0;
  const prior5VolAvg  = prior5.length  > 0 ? prior5.reduce((s, b)  => s + b.volume, 0) / prior5.length  : 1;
  const pre_volume_trend = prior5VolAvg > 0 ? (recent5VolAvg - prior5VolAvg) / prior5VolAvg : 0;

  // Trend alignment: does the pre-anomaly direction match the anomaly direction?
  const TREND_THRESHOLD = 0.03; // 3% move to qualify as a trend
  let trendAlignment: 'ALIGNED' | 'OPPOSING' | 'NEUTRAL' = 'NEUTRAL';
  if (Math.abs(pre_return_10d) >= TREND_THRESHOLD) {
    const trendUp = pre_return_10d > 0;
    const anomalyUp = anomalyZScore > 0;
    trendAlignment = trendUp === anomalyUp ? 'ALIGNED' : 'OPPOSING';
  }

  const trendStrength = Math.min(1, Math.abs(pre_return_10d) / 0.10);

  return { pre_return_5d, pre_return_10d, pre_return_21d, pre_volume_trend, trendAlignment, trendStrength };
}

function getTemporalFeatures(dateStr: string): { day_sin: number; day_cos: number; month_sin: number; month_cos: number } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dayOfYear = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
  const month = d.getUTCMonth() + 1;
  return {
    day_sin: Math.sin((2 * Math.PI * dayOfYear) / 365),
    day_cos: Math.cos((2 * Math.PI * dayOfYear) / 365),
    month_sin: Math.sin((2 * Math.PI * month) / 12),
    month_cos: Math.cos((2 * Math.PI * month) / 12),
  };
}

interface SymbolEnrichment {
  snap: Record<string, any> | null;
  primaryCategory: string | null;
  companyName: string | null;
  sector: string | null;
  exchange: string | null;
}

// Slowly-changing enrichment signals (FMP fundamentals, GDELT tone, macro regime, etc.) are
// proxied from the most recent historical event_features/company_profiles rows for this
// symbol, the same way feature_extractor.ts reads them out of signal_snapshot_json. On a
// fresh checkout (e.g. GitHub Actions) the local SQLite DB is empty, so we fall back to the
// symbol_snapshots table mirrored to Supabase by migrate_snapshots.ts.
export async function getSymbolSnapshot(symbol: string): Promise<SymbolEnrichment> {
  const efRow = db.prepare(`
    SELECT signal_snapshot_json, primaryCategory
    FROM event_features
    WHERE symbol = ? AND signal_snapshot_json IS NOT NULL
    ORDER BY date DESC LIMIT 1
  `).get(symbol) as { signal_snapshot_json: string; primaryCategory: string | null } | undefined;

  const profile = getCachedCompanyProfile(symbol);

  if (efRow || profile) {
    let snap: Record<string, any> | null = null;
    if (efRow?.signal_snapshot_json) {
      try { snap = JSON.parse(efRow.signal_snapshot_json); } catch { snap = null; }
    }
    return {
      snap,
      primaryCategory: efRow?.primaryCategory ?? null,
      companyName: profile?.profile.name ?? null,
      sector: profile?.profile.sector ?? null,
      exchange: profile?.profile.exchange ?? null,
    };
  }

  try {
    const { supabase } = await import('./db/supabaseClient');
    const { data } = await supabase
      .from('symbol_snapshots')
      .select('*')
      .eq('symbol', symbol)
      .single();

    if (data) {
      return {
        snap: data.latest_signal_snapshot ?? null,
        primaryCategory: null,
        companyName: data.company_name ?? null,
        sector: data.sector ?? null,
        exchange: data.exchange ?? null,
      };
    }
  } catch (err: any) {
    console.error(`[LiveInference] Supabase snapshot fallback failed for ${symbol}:`, err.message);
  }

  return { snap: null, primaryCategory: null, companyName: null, sector: null, exchange: null };
}

/**
 * Wilder-smoothed RSI-14, ported verbatim from HistoricalEngine.ts's
 * calculateRSIArray (same recurrence: avgGain/avgLoss smoothed by (period-1)/period
 * each step) -- only the running value is kept instead of the full array, since
 * only the value at the last bar is needed here. Mathematically identical to
 * calculateRSIArray(points, 14)[points.length - 1].
 */
function calculateRSI14(points: { close: number }[]): number {
  const period = 14;
  if (points.length <= period) return 0;

  let sumGain = 0;
  let sumLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = points[i].close - points[i - 1].close;
    if (change > 0) sumGain += change;
    else sumLoss += Math.abs(change);
  }
  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;
  let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < points.length; i++) {
    const change = points[i].close - points[i - 1].close;
    let gain = 0;
    let loss = 0;
    if (change > 0) gain = change;
    else loss = Math.abs(change);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

export function buildFeatureVectorForAnomaly(bars: YahooBar[], anomaly: AnomalySignal, enrichment: SymbolEnrichment, epu: number | null = null): Record<string, number> {
  const { snap, primaryCategory } = enrichment;
  const temporal = getTemporalFeatures(anomaly.date);

  // Category-(a) technical features ported near-verbatim from HistoricalEngine.ts,
  // using the same `bars` array (1y history via fetchYahooDailyHistory, confirmed
  // sufficient depth in the F1 fix-scoping recon) that detectAnomaly already holds.
  // The target bar is bars[n-1], mirroring training's `p = sanitizedPoints[i]`.
  // kinetic_energy / seismic_magnitude_mw are computed in detectAnomaly (the
  // formula needs dailyReturn/relativeVolume30d from there) and read off
  // `anomaly` below -- this is the final F1 slice, all six ported features
  // now populate.
  const n0 = bars.length;
  const today = bars[n0 - 1];

  const rsi_14 = calculateRSI14(bars);

  const sma50StartIdx = Math.max(0, (n0 - 1) - 49);
  const sma50Slice = bars.slice(sma50StartIdx, n0);
  const sma50 = sma50Slice.length > 0 ? sma50Slice.reduce((sum, pt) => sum + pt.close, 0) / sma50Slice.length : 0;
  const dist_sma_50 = sma50Slice.length > 0 ? ((today.close - sma50) / Math.max(0.0001, sma50)) * 100 : 0;

  const sma200StartIdx = Math.max(0, (n0 - 1) - 199);
  const sma200Slice = bars.slice(sma200StartIdx, n0);
  const sma200 = sma200Slice.length > 0 ? sma200Slice.reduce((sum, pt) => sum + pt.close, 0) / sma200Slice.length : 0;
  const dist_sma_200 = sma200Slice.length > 0 ? ((today.close - sma200) / Math.max(0.0001, sma200)) * 100 : 0;

  let gap_fill_ratio = 0;
  if (n0 > 1) {
    const gap = today.open - bars[n0 - 2].close;
    const absGap = Math.abs(gap);
    if (absGap > 0) {
      const retracement = gap > 0 ? (today.open - today.low) : (today.high - today.open);
      gap_fill_ratio = Math.min((retracement / absGap) * 100, 100);
    }
  }

  // Redefined feature (F1 obv_delta_10d decision): the old formula normalized
  // a 10-day OBV delta by the ABSOLUTE LEVEL of a since-inception cumulative
  // running sum, which depends on how much history precedes the window -- not
  // reproducible from a shorter live window. Replaced with a fully
  // self-contained, symmetric definition: net volume-signed pressure over the
  // most recent 10 trading days, expressed as a percentage of total volume
  // traded in that SAME window. Naturally bounded to [-100, 100]. Same formula,
  // same result, regardless of what precedes the window -- this is a genuine
  // feature-DEFINITION change, ported identically into HistoricalEngine.ts
  // (training side). historical_inference_results/features.csv still reflect
  // the OLD formula until the next retrain regenerates them.
  const obv10StartIdx = Math.max(0, (n0 - 1) - 9);
  let obvSignedVolSum = 0;
  let obvTotalVolSum = 0;
  for (let idx = obv10StartIdx; idx < n0; idx++) {
    const cur = bars[idx];
    const prevBar = bars[idx - 1];
    obvTotalVolSum += cur.volume;
    if (idx > 0 && prevBar) {
      if (cur.close > prevBar.close) obvSignedVolSum += cur.volume;
      else if (cur.close < prevBar.close) obvSignedVolSum -= cur.volume;
    }
  }
  const obv_delta_10d = (obvSignedVolSum / Math.max(1, obvTotalVolSum)) * 100;

  const barycenterStartIdx = Math.max(0, (n0 - 1) - 19);
  const barycenterSlice = bars.slice(barycenterStartIdx, n0);
  let barycenter_stretch_20d = 0;
  if (barycenterSlice.length > 0) {
    let total_dollar_volume = 0;
    let total_raw_volume = 0;
    for (const pt of barycenterSlice) {
      total_dollar_volume += pt.close * pt.volume;
      total_raw_volume += pt.volume;
    }
    const barycenter_20d = total_dollar_volume / Math.max(0.0001, total_raw_volume);
    barycenter_stretch_20d = ((today.close - barycenter_20d) / Math.max(0.0001, barycenter_20d)) * 100;
  }

  let market_reynolds_number = 0;
  if (barycenterSlice.length > 0) {
    // Local, correctly-windowed 30-day-inclusive volume ratio, matching training's
    // own relative_volume_30d convention (HistoricalEngine.ts) exactly. Deliberately
    // NOT reusing anomaly.relativeVolume30d, which uses a different (90-day,
    // exclude-today) window -- that mismatch is tracked as its own separate,
    // not-yet-fixed issue (confirmed in the F1 window-bug measurement) and is out
    // of scope for this pass; reusing it here would break this formula's own
    // parity with training for no benefit.
    const relVol30StartIdx = Math.max(0, (n0 - 1) - 29);
    const relVol30Slice = bars.slice(relVol30StartIdx, n0);
    const avgVolume30dForReynolds = relVol30Slice.length > 0
      ? relVol30Slice.reduce((s, pt) => s + pt.volume, 0) / relVol30Slice.length : 0;
    const relativeVolume30dForReynolds = avgVolume30dForReynolds > 0 ? today.volume / avgVolume30dForReynolds : 1;

    const rawReturn = n0 > 1 ? (today.close - bars[n0 - 2].close) / bars[n0 - 2].close : 0;

    // NOTE: training's stdDev_20d is built from calculatedReturns[i].dailyReturn,
    // which HistoricalEngine.ts computes as ((close-prevClose)/prevClose) * 100 --
    // an ALREADY-x100 percentage, a different convention from the unscaled
    // `rawReturn` above (used only in the formula's numerator, where training
    // itself multiplies by 100 inline). Matching that x100 scale here is required
    // for parity -- using the unscaled fraction here (as rawReturn does) would
    // shrink stdDev_20d ~100x and inflate market_reynolds_number ~100x.
    const dailyReturnAt = (idx: number): number => {
      const prevClose = bars[idx - 1]?.close;
      return (idx > 0 && prevClose) ? ((bars[idx].close - prevClose) / prevClose) * 100 : 0;
    };
    let returnSum = 0;
    for (let idx = barycenterStartIdx; idx < n0; idx++) returnSum += dailyReturnAt(idx);
    const returnMean = returnSum / barycenterSlice.length;
    let varReturnSum = 0;
    for (let idx = barycenterStartIdx; idx < n0; idx++) varReturnSum += Math.pow(dailyReturnAt(idx) - returnMean, 2);
    let stdDev_20d = Math.sqrt(varReturnSum / barycenterSlice.length);
    if (stdDev_20d === 0) stdDev_20d = 0.0001;

    market_reynolds_number = (relativeVolume30dForReynolds * Math.abs(rawReturn * 100)) / stdDev_20d;
  }

  const features: Record<string, any> = {
    date: anomaly.date,
    z_score: anomaly.zScore,
    zScore: anomaly.zScore,
    excessReturn: anomaly.excessReturn,
    atrShockScore: anomaly.atrShockScore,
    volumeRatio: anomaly.volumeRatio,
    relative_volume_30d: anomaly.relativeVolume30d,
    // Already fetched once per run by fetchMacroEnvironment() (a single
    // market-wide FRED value, not a per-symbol quantity) -- previously only
    // reached macro_snapshots, never buildFeatureVectorForAnomaly. Threaded
    // through as a parameter rather than refetched here.
    economic_policy_uncertainty: epu,
    body_to_range_ratio: anomaly.bodyToRangeRatio,
    // Training stores div100(overnight_gap_pct) (HistoricalEngine.ts:541) --
    // anomaly.overnightGapPct is the raw, undivided percentage (used as-is
    // elsewhere, e.g. narrative text), so it must be scaled down specifically
    // at this feature-vector assignment, confirmed as its only consumer.
    overnight_gap_pct: anomaly.overnightGapPct / 100,
    volume_price_clustering: anomaly.volumePriceClustering,
    kinetic_energy: anomaly.kineticEnergy,
    seismic_magnitude_mw: anomaly.seismicMagnitudeMw,
    obv_delta_10d,
    rsi_14,
    dist_sma_50,
    dist_sma_200,
    gap_fill_ratio,
    barycenter_stretch_20d,
    market_reynolds_number,
    // Pure local SQLite query (db.ts), not a new integration -- counts same-
    // sector event_features rows in the trailing 14 days. Known, accepted
    // caveat (not fixed here): a full-universe daily run populates
    // event_features incrementally as it scans, so symbols processed early in
    // a run undercount competitors that get scanned later the same day. This
    // is a pre-existing characteristic of the feature (training has the same
    // kind of within-day ordering dependency during backfill), not a live-vs-
    // train defect this fix introduces.
    competitor_event_density: getCompetitorEventDensity(anomaly.symbol, anomaly.date),
    confidence_tier: 'high',
    ...temporal,
  };

  const context: LiveFeatureContext = {
    symbol: anomaly.symbol,
    primaryCategory: primaryCategory ?? null,
    confidence_tier: 'high',
  };

  // Pre-anomaly backward trajectory (ending T-1, excludes the anomaly day itself) -
  // mirrors the pre_return_*/pre_vol_ratio_* columns computed by backfillPreReturns.ts.
  const n = bars.length;
  const dayBefore = bars[n - 2]?.close ?? 0;
  const preRet = (offset: number): number => {
    const base = bars[n - 2 - offset]?.close;
    return dayBefore && base ? (dayBefore - base) / base : 0;
  };
  const vol30 = bars.slice(Math.max(0, n - 32), n - 1);
  const vol30Avg = vol30.length > 0 ? vol30.reduce((s, b) => s + b.volume, 0) / vol30.length : 1;
  const volRatio = (offset: number): number => {
    const w = bars.slice(Math.max(0, n - 1 - offset), n - 1);
    return vol30Avg > 0 && w.length > 0 ? (w.reduce((s, b) => s + b.volume, 0) / w.length) / vol30Avg : 0;
  };

  // is_us_listed: same derivation as EnrichBackfillService.ts and
  // train_all_models_v9.py so the live feature matches training (build_df in
  // infer.py defaults absent features to 0, which would mislabel every symbol
  // as non-US otherwise).
  const sym = anomaly.symbol;
  const isUsListed = !sym.includes('.') || sym.endsWith('.NYSE') || sym.endsWith('.NASDAQ');

  return {
    ...buildLiveFeatureVector(features, snap, context),
    pre_return_3d: preRet(3),
    pre_return_5d: preRet(5),
    pre_return_10d: preRet(10),
    pre_return_21d: preRet(21),
    pre_vol_ratio_5d: volRatio(5),
    pre_vol_ratio_10d: volRatio(10),
    is_us_listed: isUsListed ? 1 : 0,
  };
}

export function runInference(featureVector: Record<string, number>): ModelScores {
  const inferScript = path.join(ML_DIR, 'infer.py');
  const vectorJson = JSON.stringify(featureVector).replace(/"/g, '\\"');
  const output = execSync(`python "${inferScript}" "${vectorJson}"`, { encoding: 'utf-8' });
  const scores = JSON.parse(output.trim()) as ModelScores;
  return scores;
}

/**
 * Canonical basis: model_d5_return_2w (2-week horizon) -- the only head with
 * decile-confirmed, robust signal (recon this session: model_b_return_1m,
 * the 1-month head previously used here, was confirmed to have NO usable
 * signal in either tail). Tier/riskScore/riskReward reuse the SAME
 * already-verified formulas as PotService.ts's resolveHorizonSignal for
 * patience values that resolve to D5 -- imported directly (not duplicated)
 * so any future recalibration of HORIZON_TIER_CONFIG's D5 thresholds is
 * picked up here automatically.
 *
 * Two behavioural differences from the old modelB-basis logic, both
 * intentional consequences of reusing the verified D5 logic as-is rather
 * than re-deriving a new combined rule:
 *   1. Tier resolution is value-only (resolveTierFromConfig), with no
 *      separate riskScore gate -- the old logic additionally required
 *      riskScore <= 40/55 for STRONG_BUY/BUY; PotService.ts's decile
 *      diagnostic validated the D5 return-value thresholds alone, not a
 *      combined value+riskScore gate, so that extra gate is dropped here.
 *   2. Only 4 tiers now exist (STRONG_BUY/BUY/SELL/HOLD) instead of 6
 *      (no ADD/REDUCE) -- resolveTierFromConfig never returns those.
 */
export function getRecommendation(
  modelA: number,
  modelD5: number,
  modelC: number,
  trendContext: TrendContext
): Recommendation {
  const cfg = HORIZON_TIER_CONFIG.model_d5_return_2w!;
  const modelCRank = modelCPercentileRank(modelC);

  const confidenceTerm = (1 - modelA) * 30;
  const drawdownTerm   = (1 - modelCRank) * 40;
  const tailRiskTerm   = cfg.sell?.(modelD5) ? 30 : 0;

  const riskScore = Math.round(Math.min(100, Math.max(0,
    drawdownTerm + confidenceTerm + tailRiskTerm
  )));

  const riskReward = Math.round(
    (Math.abs(modelD5) / Math.max(1 - modelCRank, RISK_REWARD_FLOOR)) * 100
  ) / 100;

  const positionSizePct = Math.round(
    Math.min(10, Math.max(1, modelA * 10 * (1 - riskScore / 100))) * 10
  ) / 10;

  // Reduce position size when anomaly opposes the recent trend (potential dead cat / reversal)
  let trendAdjustedPositionSize = positionSizePct;
  if (trendContext.trendAlignment === 'OPPOSING') {
    const haircut = trendContext.trendStrength > 0.5 ? 0.50 : 0.75;
    trendAdjustedPositionSize = Math.round(positionSizePct * haircut * 10) / 10;
  }

  let recommendation = resolveTierFromConfig(modelD5, cfg);

  // Downgrade recommendation one level when strongly opposing the trend.
  // Condensed to the 4-tier set: STRONG_BUY -> BUY -> HOLD.
  if (trendContext.trendAlignment === 'OPPOSING' && trendContext.trendStrength > 0.6) {
    if (recommendation === 'STRONG_BUY') recommendation = 'BUY';
    else if (recommendation === 'BUY') recommendation = 'HOLD';
  }

  return { recommendation, riskScore, riskReward, positionSizePct: trendAdjustedPositionSize };
}

async function generateNarrative(
  aiClient: GoogleGenAI,
  anomaly: AnomalySignal,
  scores: ModelScores,
  rec: Recommendation,
  trendContext: TrendContext,
  edgarFilings: EdgarFiling[],
  managementScore: { confidence_score: number; primary_concern: string } | null
): Promise<string> {
  const fallback = `${anomaly.symbol}: ${rec.recommendation} signal with ${(scores.model_a_confidence * 100).toFixed(1)}% model confidence. Pre-anomaly trend: ${trendContext.trendAlignment}. Expected 2W return ${(scores.model_d5_return_2w * 100).toFixed(2)}% (recommendation basis) and max drawdown ${(scores.model_c_max_drawdown * 100).toFixed(2)}%.`;

  if (!process.env.GEMINI_API_KEY) return fallback;

  try {
    const trendLabel = trendContext.trendAlignment === 'ALIGNED'
      ? `${trendContext.trendAlignment} with anomaly (supports the move)`
      : trendContext.trendAlignment === 'OPPOSING'
      ? `${trendContext.trendAlignment} with anomaly (caution — potential dead cat / reversal)`
      : 'NEUTRAL (no clear pre-anomaly trend)';

    const trendSection = `
Pre-anomaly price trajectory:
- 5-day return (pre-anomaly): ${(trendContext.pre_return_5d * 100).toFixed(1)}%
- 10-day return (pre-anomaly): ${(trendContext.pre_return_10d * 100).toFixed(1)}%
- 21-day return (pre-anomaly): ${(trendContext.pre_return_21d * 100).toFixed(1)}%
- Volume trend (recent 5d vs prior 5d): ${trendContext.pre_volume_trend > 0 ? 'building' : 'declining'} (${(trendContext.pre_volume_trend * 100).toFixed(1)}%)
- Trend alignment: ${trendLabel}`;

    // Anonymize entity identifiers before LLM scoring to prevent
    // distraction/look-ahead bias (Glasserman & Lin, 2023)
    const ANON_TICKER = 'TICKER_X';
    const ANON_COMPANY = 'Company X';
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const anonymize = (text: string): string => {
      let result = text.replace(new RegExp(escapeRegex(anomaly.symbol), 'gi'), ANON_TICKER);
      if (anomaly.companyName && anomaly.companyName !== anomaly.symbol) {
        result = result.replace(new RegExp(escapeRegex(anomaly.companyName), 'gi'), ANON_COMPANY);
      }
      return result;
    };

    const edgarSection = edgarFilings.length > 0
      ? `\nRecent SEC 8-K filings (last 7 days):\n${edgarFilings
          .map(f => `- ${f.filedAt}: ${anonymize(f.description)}`)
          .join('\n')}`
      : '';

    const managementSection = managementScore
      ? `\nManagement confidence score (most recent earnings call): ${managementScore.confidence_score}/100\nPrimary concern: ${anonymize(managementScore.primary_concern)}`
      : '';

    const prompt = `You are a senior institutional equity analyst. Summarize the investment case for ${ANON_TICKER} (${ANON_COMPANY}) in 2-3 sentences.

Today's price: $${anomaly.close.toFixed(2)}
Z-score (idiosyncratic move): ${anomaly.zScore.toFixed(2)}
Excess return vs market: ${(anomaly.excessReturn * 100).toFixed(2)}%
Volume ratio: ${anomaly.volumeRatio.toFixed(2)}x
${trendSection}

Model outputs:
- Event confidence: ${(scores.model_a_confidence * 100).toFixed(1)}%
- Expected 2-day return: ${(scores.model_d3_return_2d * 100).toFixed(2)}%
- Expected 3-day return: ${(scores.model_d4_return_3d * 100).toFixed(2)}%
- Expected 2-week return: ${(scores.model_d5_return_2w * 100).toFixed(2)}%
- Expected 1-month return: ${(scores.model_b_return_1m * 100).toFixed(2)}%
- Max adverse excursion (1-month): ${(scores.model_c_max_drawdown * 100).toFixed(2)}%
- Expected 3-month return: ${(scores.model_d1_return_3m * 100).toFixed(2)}%
- Expected 6-month return: ${(scores.model_d2_return_6m * 100).toFixed(2)}%
- Probability of >10% return over 12 months: ${(scores.model_e_outperform_12m_prob * 100).toFixed(1)}%
- Recommendation: ${rec.recommendation} (based on the 2-week expected return and risk profile, not the 1-month figure above)
- Risk score: ${rec.riskScore}/100 (2-week horizon)
- Risk/reward ratio: ${rec.riskReward} (2-week horizon)

Note: a risk/reward ratio below 1.0 is UNFAVOURABLE — it means the expected downside exceeds the expected upside. A ratio above 1.0 is favourable. Always reflect this correctly in the narrative. The Recommendation/Risk score/Risk-reward ratio above are driven by the 2-week expected return specifically -- when writing the near-term positioning sentence, anchor it to the 2-week figure, not the 1-month one.
${edgarSection}
${managementSection}

Write a concise, professional narrative covering near-term (2-week) positioning as well as the medium-term (1/3/6-month) and long-term (12-month) outlook implied by the model outputs above. No emojis. No investment disclaimers. If the pre-anomaly trend is OPPOSING, explicitly note this as a risk factor and reflect it in your conviction level.`;

    const response = await aiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text?.trim() || fallback;
  } catch (err: any) {
    console.error(`[LiveInference] Narrative generation failed for ${anomaly.symbol}:`, err.message);
    return fallback;
  }
}

// function sanitiseForHttp(text: string): string {
//   // Remove characters outside the Basic Multilingual Plane (emoji, surrogates)
//   // which cause ByteString errors in fetch headers/body
//   return Array.from(text)
//     .filter((ch) => {
//       const code = ch.codePointAt(0)!;
//       return code <= 0xffff && (code < 0xd800 || code > 0xdfff);
//     })
//     .join('');
// }

function sanitiseForHttp(text: string): string {
  return text
    .replace(/[\uD800-\uDFFF]/g, '')  // remove lone/paired surrogates
    .replace(/[^\x00-\xFF]/g, '');     // enforce strict Latin1 / ByteString range
}


async function sendNtfyNotification(symbol: string, rec: string, modelD5: number, riskScore: number, narrative: string): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      'Title': sanitiseForHttp(`${rec}: ${symbol}`),
      'Priority': rec === 'STRONG_BUY' ? 'high' : 'default',
      'Tags': rec === 'STRONG_BUY' ? 'rocket,chart_increasing' : 'chart_increasing',
      'Content-Type': 'text/plain',
    },
    body: sanitiseForHttp(`Expected return (2W): ${(modelD5 * 100).toFixed(1)}% | Risk score: ${riskScore}/100\n\n${narrative.slice(0, 280)}`),
  });
}

export function computeSignalCompleteness(vector: Record<string, number>): number {
  const indicatorKeys = Object.keys(vector).filter(k => k.endsWith('_is_null'));
  if (indicatorKeys.length === 0) return 1;
  const nullCount = indicatorKeys.reduce((sum, k) => sum + vector[k], 0);
  return Math.round((1 - nullCount / indicatorKeys.length) * 1000) / 1000;
}

export async function writeResultToSupabase(
  runDate: string,
  anomaly: AnomalySignal,
  sector: string | null,
  exchange: string | null,
  scores: ModelScores,
  rec: Recommendation,
  narrative: string,
  signalCompletenessScore: number,
  isWatchlist: boolean,
  trendContext: TrendContext | null,
  edgarSummary: string | null,
  managementScore: { confidence_score: number; primary_concern: string } | null,
  digitalExhaustVelocity: number | null,
  alphavantageSentimentAvg: number | null,
  unreliableReason: string | null = null
): Promise<void> {
  try {
    const { supabase } = await import('./db/supabaseClient');
    const { error } = await supabase.from('inference_results').upsert({
      run_date: runDate,
      symbol: anomaly.symbol,
      company_name: anomaly.companyName,
      sector,
      exchange,
      z_score: anomaly.zScore,
      excess_return: anomaly.excessReturn,
      current_price: anomaly.close,
      day_change_pct: anomaly.dayChangePct,
      trend_alignment: trendContext?.trendAlignment ?? null,
      model_a_confidence: scores.model_a_confidence,
      model_b_return_1m: scores.model_b_return_1m,
      model_c_max_drawdown: scores.model_c_max_drawdown,
      model_d1_return_3m: scores.model_d1_return_3m,
      model_d2_return_6m: scores.model_d2_return_6m,
      model_d3_return_2d: scores.model_d3_return_2d,
      model_d4_return_3d: scores.model_d4_return_3d,
      model_d5_return_2w: scores.model_d5_return_2w,
      model_e_outperform_12m_prob: scores.model_e_outperform_12m_prob,
      recommendation: rec.recommendation,
      risk_score: rec.riskScore,
      risk_reward_ratio: rec.riskReward,
      position_size_pct: rec.positionSizePct,
      narrative,
      signal_completeness_score: signalCompletenessScore,
      is_watchlist: isWatchlist,
      edgar_8k_items: edgarSummary,
      management_confidence_score: managementScore?.confidence_score ?? null,
      earnings_primary_concern: managementScore?.primary_concern ?? null,
      digital_exhaust_velocity_14d: digitalExhaustVelocity,
      alphavantage_sentiment_avg: alphavantageSentimentAvg,
      unreliable_reason: unreliableReason,
    }, { onConflict: 'run_date,symbol' });

    if (error) {
      console.error(`[LiveInference] Supabase write failed for ${anomaly.symbol}:`, error.message);
    }
  } catch (err: any) {
    console.error(`[LiveInference] Supabase client unavailable, skipping write for ${anomaly.symbol}:`, err.message);
  }
}

async function fetchRecentEdgarFilings(
  symbol: string,
  exchange: string | null,
  runDate: string
): Promise<EdgarFiling[]> {
  if (!isUsListed(exchange)) return [];
  try {
    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];
    const filings = await getEdgarFilings(symbol, fromDate, runDate);
    return filings
      .filter(f => f.form === '8-K')
      .slice(0, 5);
  } catch (err: any) {
    console.warn(`[LiveInference] EDGAR fetch failed for ${symbol}:`, err.message);
    return [];
  }
}

async function fetchMacroEnvironment(runDate: string): Promise<{
  vix: number | null;
  yieldCurveSpread: number | null;
  highYieldOas: number | null;
  dollarIndex: number | null;
  fedFundsRate: number | null;
  epu: number | null;
}> {
  const fromDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  try {
    const [vixPts, dgs10Pts, dgs2Pts, oasPts, dollarPts, fedPts, epuPts] =
      await Promise.all([
        fetchFREDSeries('VIXCLS', fromDate, runDate),
        fetchFREDSeries('DGS10', fromDate, runDate),
        fetchFREDSeries('DGS2', fromDate, runDate),
        fetchFREDSeries('BAMLH0A0HYM2', fromDate, runDate),
        fetchFREDSeries('DTWEXBGS', fromDate, runDate),
        fetchFREDSeries('FEDFUNDS', fromDate, runDate),
        fetchFREDSeries('USEPUINDXD', fromDate, runDate),
      ]);

    const last = <T extends { date: string }>(pts: T[]): T | null =>
      pts.length ? pts[pts.length - 1] : null;

    const vix = last(vixPts)?.value ?? null;
    const dgs10 = last(dgs10Pts)?.value ?? null;
    const dgs2 = last(dgs2Pts)?.value ?? null;
    const yieldCurveSpread = dgs10 != null && dgs2 != null
      ? Math.round((dgs10 - dgs2) * 100) / 100 : null;

    return {
      vix: vix != null ? Math.round(vix * 100) / 100 : null,
      yieldCurveSpread,
      highYieldOas: last(oasPts)?.value ?? null,
      dollarIndex: last(dollarPts)?.value ?? null,
      fedFundsRate: last(fedPts)?.value ?? null,
      epu: last(epuPts)?.value ?? null,
    };
  } catch (err: any) {
    console.warn('[LiveInference] Macro environment fetch failed:', err.message);
    return { vix: null, yieldCurveSpread: null, highYieldOas: null,
             dollarIndex: null, fedFundsRate: null, epu: null };
  }
}

async function writeMacroSnapshot(runDate: string, macro: Awaited<ReturnType<typeof fetchMacroEnvironment>>): Promise<void> {
  try {
    const { supabase } = await import('./db/supabaseClient');

    const vixRegime = macro.vix == null ? null
      : macro.vix < 15 ? 'low'
      : macro.vix < 20 ? 'normal'
      : macro.vix < 30 ? 'elevated'
      : 'high';

    const creditRegime = macro.highYieldOas == null ? null
      : macro.highYieldOas < 3.5 ? 'loose'
      : macro.highYieldOas < 5.0 ? 'normal'
      : macro.highYieldOas < 7.0 ? 'tight'
      : 'stressed';

    const { error } = await supabase.from('macro_snapshots').upsert({
      run_date: runDate,
      vix: macro.vix,
      yield_curve_spread: macro.yieldCurveSpread,
      high_yield_oas: macro.highYieldOas,
      dollar_index: macro.dollarIndex,
      fed_funds_rate: macro.fedFundsRate,
      economic_policy_uncertainty: macro.epu,
      vix_regime: vixRegime,
      credit_regime: creditRegime,
    }, { onConflict: 'run_date' });

    if (error) console.error('[LiveInference] Macro snapshot write failed:', error.message);
    else console.log(`[LiveInference] Macro snapshot written — VIX: ${macro.vix}, OAS: ${macro.highYieldOas}, Curve: ${macro.yieldCurveSpread}`);
  } catch (err: any) {
    console.error('[LiveInference] Macro snapshot write error:', err.message);
  }
}

export async function runLiveInference(symbols?: string[]): Promise<void> {
  console.log('[LiveInference] Starting daily inference run...');
  const runDate = new Date().toISOString().split('T')[0];

  let universe: { symbol: string; companyName: string; exchange: string }[] = [];
  for (const market of GLOBAL_MARKETS) {
    for (const stock of market.stocks) {
      universe.push({ symbol: stock.symbol, companyName: stock.companyName, exchange: market.name });
    }
  }
  if (symbols && symbols.length > 0) {
    const wanted = new Set(symbols.map(s => s.toUpperCase()));
    universe = universe.filter(u => wanted.has(u.symbol.toUpperCase()));
  }
  console.log(`[LiveInference] Universe size: ${universe.length} symbols`);

  // F10: widened from '1mo' to '1y' -- the beta-hedged excess-return series
  // needs up to ~150 trading days of SPY history (90-day z-score window +
  // 60-day trailing beta lookback for the earliest day in that window), not
  // just the last 2 days. Fetched once per run, shared across all symbols
  // below (same call site, same frequency as before this fix -- no new API
  // calls, just a wider range on the existing one).
  let spyReturnByDate = new Map<string, number>();
  try {
    const spyBars = await fetchYahooDailyHistory('SPY', '1y');
    spyReturnByDate = buildSpyReturnMap(spyBars);
  } catch (err: any) {
    console.warn('[LiveInference] Failed to fetch SPY benchmark:', err.message);
  }
  console.log(`[LiveInference] SPY daily-return series: ${spyReturnByDate.size} days`);

  // Native per-market benchmarks. Only fetched when the mode asks for them, so the
  // default path makes exactly the same API calls it did before.
  const nativeReturnByTicker = new Map<string, Map<string, number>>();
  const nativeDenseByTicker = new Map<string, Map<string, number>>();
  if (LIVE_BENCHMARK_MODE === 'native' || LIVE_BENCHMARK_MODE === 'shadow') {
    const tickers = [...new Set(Object.values(NATIVE_BENCHMARK))];
    for (const t of tickers) {
      try {
        const b = await fetchYahooDailyHistory(t, '1y');
        const m = buildSpyReturnMap(b);
        nativeReturnByTicker.set(t, m);
        nativeDenseByTicker.set(t, densifyForward(m));
        await sleep(YAHOO_REQUEST_DELAY_MS);
      } catch (err: any) {
        console.warn(`[LiveInference] benchmark ${t} fetch failed: ${err.message} — ` +
                     `symbols in that market fall back to SPY this run`);
      }
    }
    console.log(`[LiveInference] mode=${LIVE_BENCHMARK_MODE}; native benchmark series: ` +
                [...nativeReturnByTicker].map(([t, m]) => `${t}:${m.size}d`).join(' '));
  }
  let shadowChecked = 0, shadowDiverged = 0;

  const watchlistSymbols = new Set<string>();
  try {
    const { supabase } = await import('./db/supabaseClient');
    const { data, error } = await supabase.from('watchlist').select('symbol');
    if (error) {
      console.warn('[LiveInference] Watchlist fetch error:', error.message);
    } else if (data) {
      data.forEach(r => watchlistSymbols.add(r.symbol.toUpperCase()));
    }
    console.log(`[LiveInference] Watchlist: ${watchlistSymbols.size} symbols`);
  } catch (err: any) {
    console.warn('[LiveInference] Could not fetch watchlist:', err.message);
  }

  // Force-analyze set: watchlist above, plus any symbol currently held in an
  // open POTS position -- continuous tracking of held names, not just
  // watchlist adds. These symbols skip detectAnomaly's z-gate entirely.
  const forceAnalyzeSymbols = new Set<string>(watchlistSymbols);
  try {
    const { supabase } = await import('./db/supabaseClient');
    const { data, error } = await supabase
      .from('pot_positions')
      .select('symbol')
      .eq('status', 'open');
    if (error) {
      console.warn('[LiveInference] Open positions fetch error:', error.message);
    } else if (data) {
      data.forEach(r => forceAnalyzeSymbols.add(r.symbol.toUpperCase()));
    }
    console.log(`[LiveInference] Force-analyze set (watchlist + open positions): ${forceAnalyzeSymbols.size} symbols`);
  } catch (err: any) {
    console.warn('[LiveInference] Could not fetch open positions:', err.message);
  }

  const aiClient = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

  // Fetched ONCE for the whole run (a single market-wide macro snapshot, not a
  // per-symbol quantity) -- previously fetched only after the per-symbol loop,
  // solely to write macro_snapshots, so economic_policy_uncertainty never
  // reached buildFeatureVectorForAnomaly. Same PULSE_MODE skip as before
  // (macro regime doesn't move at intraday granularity) -- reused below for
  // the macro_snapshots write instead of being refetched.
  const macro = PULSE_MODE ? null : await fetchMacroEnvironment(runDate);

  let anomalyCount = 0;
  let narrativeCount = 0;
  let notificationCount = 0;
  const potResults: PotInferenceResult[] = [];

  for (const { symbol, companyName, exchange } of universe) {
    try {
      const bars = await fetchYahooDailyHistory(symbol, '1y');
      await sleep(YAHOO_REQUEST_DELAY_MS);

      const isWatchlisted = watchlistSymbols.has(symbol.toUpperCase());
      const isForced = forceAnalyzeSymbols.has(symbol.toUpperCase());

      const benchTicker = nativeBenchmarkTicker(symbol);
      const nativeMap = nativeReturnByTicker.get(benchTicker);
      const nativeDense = nativeDenseByTicker.get(benchTicker);
      // 'native' acts on the per-market benchmark; every other mode acts on SPY, so
      // the default path is untouched. A failed benchmark fetch also falls back to SPY.
      const useNative = LIVE_BENCHMARK_MODE === 'native' && nativeMap !== undefined;
      const anomaly = useNative
        ? detectAnomaly(symbol, companyName, bars, nativeMap!, isForced, nativeDense)
        : detectAnomaly(symbol, companyName, bars, spyReturnByDate, isForced);

      // 'shadow': decide on SPY exactly as today, but compute the native-benchmark
      // verdict alongside and log where the two disagree. This is how the 33% churn
      // gets adjudicated on live outcomes instead of backtest.
      if (LIVE_BENCHMARK_MODE === 'shadow' && nativeMap && benchTicker !== '^GSPC') {
        try {
          const shadow = detectAnomaly(symbol, companyName, bars, nativeMap, isForced, nativeDense);
          shadowChecked++;
          const zCur = anomaly?.zScore ?? null;
          const zNat = shadow?.zScore ?? null;
          const detCur = !!anomaly && Math.abs(anomaly.zScore) > Z_SCORE_THRESHOLD;
          const detNat = !!shadow && Math.abs(shadow.zScore) > Z_SCORE_THRESHOLD;
          if (detCur !== detNat) {
            shadowDiverged++;
            console.log(`[ShadowBench] ${symbol} ${runDate} bench=${benchTicker} ` +
                        `z_spy=${zCur === null ? 'n/a' : zCur.toFixed(3)} ` +
                        `z_native=${zNat === null ? 'n/a' : zNat.toFixed(3)} ` +
                        `detected_spy=${detCur} detected_native=${detNat}`);
          }
        } catch (err: any) {
          console.warn(`[ShadowBench] ${symbol}: ${err.message}`);
        }
      }

      if (!anomaly) continue;

      const isActualAnomaly = Math.abs(anomaly.zScore) > Z_SCORE_THRESHOLD;

      // Single Alpha Vantage news-sentiment call per symbol (budget-checked and
      // SQLite-cached in AlphaVantageService). Only fired for real anomalies; the
      // result feeds both enrichment.snap and the Supabase write below.
      const avSentiment: number | null = isActualAnomaly
        ? (await getAlphaVantageNewsSentiment(symbol, runDate))?.sentiment_avg ?? null
        : null;

      const trendContext = computeTrendContext(bars, anomaly.zScore);

      anomalyCount++;
      console.log(`[LiveInference] ${isWatchlisted && !isActualAnomaly ? 'Watchlist' : 'Anomaly'} detected: ${symbol} z=${anomaly.zScore.toFixed(2)} trend=${trendContext.trendAlignment} (10d: ${(trendContext.pre_return_10d * 100).toFixed(1)}%)`);

      const enrichment = await getSymbolSnapshot(symbol);
      // Phenomenon 1 completeness check: captured BEFORE the av_news_sentiment
      // patch below, which can turn a null snap into a non-null (but still
      // essentially empty) object -- checking after that patch would silently
      // defeat this check for exactly the symbols it's meant to catch.
      const isNullEnrichment = enrichment.snap === null;
      if (avSentiment !== null) {
        if (enrichment.snap !== null) {
          enrichment.snap.av_news_sentiment = avSentiment;
        } else {
          enrichment.snap = { av_news_sentiment: avSentiment };
        }
      }
      // Phenomenon 3 fix: z_score/excess_return/atr_shock_score/volume_ratio are
      // always freshly computed above (anomaly.*, guaranteed non-null whenever we
      // reach this point) -- prefer them unconditionally over enrichment.snap's
      // cached copy, which can be arbitrarily stale (symbol_snapshots has gone
      // unrefreshed since 2026-06-13; see DEEP_DIVE_PROGRESS.md Session 4).
      // Stripped on a shallow copy so enrichment.snap itself (used below by
      // computeDigitalExhaustVelocity, which doesn't touch these 4 fields) keeps
      // every other cached field untouched. Shared NUMERIC_ACCESSORS map / training
      // path (extractFeatures()) are deliberately not touched by this fix.
      const freshSnap = enrichment.snap ? { ...enrichment.snap } : null;
      if (freshSnap) {
        delete freshSnap.z_score;
        delete freshSnap.excess_return;
        delete freshSnap.atr_shock_score;
        delete freshSnap.volume_ratio;
      }
      const featureVector = buildFeatureVectorForAnomaly(bars, anomaly, { ...enrichment, snap: freshSnap }, macro?.epu ?? null);
      const digitalExhaust = computeDigitalExhaustVelocity(enrichment.snap);
      const scores = runInference(featureVector);

      // Phenomenon 1 / Phenomenon 3 defense-in-depth: mechanism-agnostic sanity
      // gate on RAW (pre-clamp) predictions, scoped this session (see
      // DEEP_DIVE_PROGRESS.md). D3/D5 are the primary trigger because they're
      // the only two heads with a tight, real-bounded historical range (never
      // exceeding ~0.30/~0.31 across the 10,051-row test fold) -- any raw value
      // beyond these bounds is already outside everything ever observed, zero
      // false-positive risk. B/D1/D2/D4 have legitimately wide real tails
      // (D1/D2 exceed 1200% at the extreme), so none of them alone is a safe
      // trigger -- they only corroborate when >=2 fire together.
      const rawOutlierPrimary = Math.abs(scores.model_d3_return_2d) > 0.30 || Math.abs(scores.model_d5_return_2w) > 0.40;
      const rawOutlierSecondaryCount = [
        Math.abs(scores.model_b_return_1m) > 1.8,
        Math.abs(scores.model_d1_return_3m) > 2.5,
        Math.abs(scores.model_d2_return_6m) > 2.5,
        Math.abs(scores.model_d4_return_3d) > 1.0,
      ].filter(Boolean).length;
      const isRawPredictionOutlier = rawOutlierPrimary || rawOutlierSecondaryCount >= 2;

      // Precedence: null_enrichment is the more specific/diagnostic root cause
      // when both would fire (a fully-null snap can also produce an outlier
      // raw prediction) -- surfaces the actual cause rather than the symptom.
      const unreliableReason: string | null = isNullEnrichment
        ? 'null_enrichment'
        : (isRawPredictionOutlier ? 'raw_prediction_outlier' : null);

      const clampedReturn = Math.max(-0.30, Math.min(0.30, scores.model_b_return_1m));
      const clampedReturn3m = Math.max(-0.50, Math.min(0.50, scores.model_d1_return_3m));
      const clampedReturn6m = Math.max(-0.40, Math.min(0.40, scores.model_d2_return_6m));
      const clampedReturn2d = Math.max(-0.20, Math.min(0.20, scores.model_d3_return_2d));
      const clampedReturn3d = Math.max(-0.25, Math.min(0.25, scores.model_d4_return_3d));
      const clampedReturn2w = Math.max(-0.35, Math.min(0.35, scores.model_d5_return_2w));
      const rec = getRecommendation(scores.model_a_confidence, clampedReturn2w, scores.model_c_max_drawdown, trendContext);
      console.log(`[LiveInference]   scores=${JSON.stringify(scores)} rec=${JSON.stringify(rec)}`);

      const clampedScores = {
        ...scores,
        model_b_return_1m: clampedReturn,
        model_d1_return_3m: clampedReturn3m,
        model_d2_return_6m: clampedReturn6m,
        model_d3_return_2d: clampedReturn2d,
        model_d4_return_3d: clampedReturn3d,
        model_d5_return_2w: clampedReturn2w,
      };

      const edgarFilings = await fetchRecentEdgarFilings(symbol, exchange, runDate);
      if (edgarFilings.length > 0) {
        console.log(`[LiveInference] ${symbol}: ${edgarFilings.length} recent 8-K(s) — ${edgarFilings.map(f => f.description).join(' | ')}`);
      }

      // Management-confidence scoring from FMP earnings transcripts is disabled in
      // the live path: the FMP transcript endpoint 404s on our tier and isFmpPremium()
      // is false after premium expiry. managementScore stays null so the
      // writeResultToSupabase / generateNarrative signatures are unchanged. (The
      // backfill-side scoring in EnrichBackfillService is unaffected.)
      const managementScore: { confidence_score: number; primary_concern: string } | null = null;

      // PULSE_MODE skips Gemini narrative generation (shared quota with main
      // runs) -- notifications below still fire with an empty narrative.
      let narrative = '';
      if (!PULSE_MODE && ((isActualAnomaly && scores.model_a_confidence >= NARRATIVE_CONFIDENCE_THRESHOLD) || rec.recommendation === 'SELL' || rec.recommendation === 'REDUCE')) {
        narrative = aiClient
          ? await generateNarrative(aiClient, anomaly, clampedScores, rec, trendContext, edgarFilings, managementScore)
          : `${symbol}: ${rec.recommendation} signal with ${(scores.model_a_confidence * 100).toFixed(1)}% model confidence.`;
        narrativeCount++;
      }

      const edgarSummary = edgarFilings.length > 0
        ? JSON.stringify(edgarFilings.map(f => ({
            date: f.filedAt,
            description: f.description,
            url: f.filingUrl
          })))
        : null;

      await writeResultToSupabase(runDate, anomaly, enrichment.sector, exchange, clampedScores, rec, narrative, computeSignalCompleteness(featureVector), isWatchlisted, trendContext, edgarSummary, managementScore, digitalExhaust, avSentiment, unreliableReason);

      // F8: pot-ledger sizing/P&L math treats current_price as GBP -- convert
      // high-nominal-currency symbols here so PotService.ts (entryPrice,
      // shares, position_size_gbp) never sees a raw native price. Deliberately
      // NOT applied to writeResultToSupabase's inference_results write above
      // (a display/audit table, out of scope for this fix).
      const potCurrentPrice = await convertToGBPIfHighNominal(anomaly.symbol, anomaly.close, runDate);

      potResults.push({
        symbol:                      anomaly.symbol,
        companyName:                 anomaly.companyName,
        current_price:               potCurrentPrice,
        recommendation:              rec.recommendation,
        risk_score:                  rec.riskScore,
        risk_reward_ratio:           rec.riskReward,
        unreliable_reason:           unreliableReason,
        model_a_confidence:          clampedScores.model_a_confidence,
        model_b_return_1m:           clampedScores.model_b_return_1m,
        model_c_max_drawdown:        clampedScores.model_c_max_drawdown,
        model_d1_return_3m:          clampedScores.model_d1_return_3m,
        model_d2_return_6m:          clampedScores.model_d2_return_6m,
        model_d3_return_2d:          clampedScores.model_d3_return_2d,
        model_d4_return_3d:          clampedScores.model_d4_return_3d,
        model_d5_return_2w:          clampedScores.model_d5_return_2w,
        model_e_outperform_12m_prob: clampedScores.model_e_outperform_12m_prob,
        // F2 entry-gate rule inputs (PotService.ts) -- classifyEvent's own
        // move/volume quantities, not previously threaded through to PotService.
        day_change_pct:              anomaly.dayChangePct,
        volume_ratio:                anomaly.volumeRatio,
      });

      const shouldNotify = rec.recommendation === 'STRONG_BUY' || rec.recommendation === 'BUY';
      // isForced (watchlist + open positions) supersedes isWatchlisted here so
      // held-only positions also get notified, not just watchlist names.
      if (shouldNotify && (isActualAnomaly || isForced)) {
        const titlePrefix = isWatchlisted && !isActualAnomaly ? 'WATCHLIST' : rec.recommendation;
        await sendNtfyNotification(symbol, titlePrefix, clampedReturn2w, rec.riskScore, narrative);
        notificationCount++;
      }
    } catch (err: any) {
      console.error(`[LiveInference] Error processing ${symbol}:`, err.message);
    }
  }

  if (LIVE_BENCHMARK_MODE === 'shadow') {
    console.log(`[ShadowBench] SUMMARY ${runDate}: ${shadowChecked} symbols compared, ` +
                `${shadowDiverged} detection divergences ` +
                `(${shadowChecked ? (100 * shadowDiverged / shadowChecked).toFixed(1) : '0.0'}%). ` +
                `Decisions were made on SPY as usual — this run changed no behaviour.`);
  }
  console.log(`[LiveInference] Done. Anomalies: ${anomalyCount}, Narratives: ${narrativeCount}, Notifications: ${notificationCount}`);

  if (PULSE_MODE) {
    console.log('[LiveInference] PULSE_MODE=1 -- skipping PotService evaluation (pots run on 3 scheduled slots/day; pulse-triggered trading would change the experiment semantics).');
  } else if (potResults.length > 0) {
    console.log(`[LiveInference] Running PotService with ${potResults.length} signals (slot: ${determineRunSlot()})...`);
    try {
      await evaluateRun(potResults, new Date(), determineRunSlot());
    } catch (err: any) {
      console.error('[LiveInference] PotService evaluation failed:', err.message);
    }
  }

  if (PULSE_MODE) {
    console.log('[LiveInference] PULSE_MODE=1 -- skipping macro snapshot (macro regime does not move at intraday granularity).');
  } else if (macro) {
    await writeMacroSnapshot(runDate, macro);
  }
}

// Run directly when executed as a script (GitHub Actions)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cliSymbols = process.argv.slice(2);
  runLiveInference(cliSymbols.length > 0 ? cliSymbols : undefined).catch(console.error);
}
