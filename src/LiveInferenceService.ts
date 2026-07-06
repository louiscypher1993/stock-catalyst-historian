import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { db, getCachedCompanyProfile } from '../db';
import { GLOBAL_MARKETS } from './marketsData';
import { buildLiveFeatureVector, LiveFeatureContext } from './ml/feature_extractor';
import {
  calculatePriceZScore,
  calculateVolumeRatio,
  calculateExcessReturn,
  calculateATRMoveNormalization,
} from './utils/physics';
import { getRecentFilings as getEdgarFilings } from '../EdgarService';
import { fetchFREDSeries } from '../FREDService';
import type { EdgarFiling } from './types';
import { isFmpPremium } from '../FMPService';
import { getAlphaVantageNewsSentiment } from '../AlphaVantageService';
import { evaluateRun, type PotInferenceResult } from './PotService';

// Local copy — cannot import from HistoricalEngine (circular dependency).
const _YAHOO_INTL_SUFFIXES = new Set([
  '.L', '.PA', '.AS', '.BR', '.DE', '.F', '.HK', '.SS', '.SZ',
  '.T', '.TO', '.AX', '.NS', '.BO', '.KS', '.TW', '.SW', '.ST',
  '.OL', '.CO', '.HE', '.ME', '.SA', '.BA', '.MX', '.IS', '.NZ',
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
const WATCHLIST_Z_SCORE_THRESHOLD = 1.25;
const ROLLING_WINDOW = 90;
const NARRATIVE_CONFIDENCE_THRESHOLD = 0.65;
const ML_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ml');
const YAHOO_REQUEST_DELAY_MS = 75;

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

// Mirrors HistoricalEngine.ts's idiosyncratic-return z-score: a 90-day rolling window of
// SPY-excess returns establishes the baseline mean/stddev, and an anomaly is any day whose
// excess return deviates from that baseline by more than Z_SCORE_THRESHOLD standard deviations.
export function detectAnomaly(symbol: string, companyName: string, bars: YahooBar[], spyReturn: number, forceSignal: boolean = false): AnomalySignal | null {
  if (bars.length < 12) return null;

  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];

  const dailyReturn = (last.close - prev.close) / prev.close;
  const excessReturn = calculateExcessReturn(dailyReturn, spyReturn);

  const windowStart = Math.max(1, bars.length - 1 - ROLLING_WINDOW);
  const windowReturns: number[] = [];
  for (let i = windowStart; i < bars.length - 1; i++) {
    const r = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;
    windowReturns.push(calculateExcessReturn(r, spyReturn));
  }
  if (windowReturns.length < 10) return null;

  const rollingMean = windowReturns.reduce((sum, r) => sum + r, 0) / windowReturns.length;
  const sumSquaredDiffs = windowReturns.reduce((sum, r) => sum + Math.pow(r - rollingMean, 2), 0);
  const rollingStd = Math.sqrt(sumSquaredDiffs / Math.max(1, windowReturns.length - 1));

  const zScore = calculatePriceZScore(excessReturn, rollingMean, rollingStd);
  if (Math.abs(zScore) <= (forceSignal ? WATCHLIST_Z_SCORE_THRESHOLD : Z_SCORE_THRESHOLD)) return null;

  const vol20Window = bars.slice(-21, -1);
  const vol20Avg = vol20Window.reduce((sum, b) => sum + b.volume, 0) / Math.max(1, vol20Window.length);
  const vol90Window = bars.slice(-(ROLLING_WINDOW + 1), -1);
  const vol90Avg = vol90Window.reduce((sum, b) => sum + b.volume, 0) / Math.max(1, vol90Window.length);

  const volumeRatio = calculateVolumeRatio(last.volume, vol20Avg);
  const relativeVolume30d = calculateVolumeRatio(last.volume, vol90Avg);

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
  const kineticEnergy = 0.5 * Math.pow(zScore, 2);

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

export function buildFeatureVectorForAnomaly(bars: YahooBar[], anomaly: AnomalySignal, enrichment: SymbolEnrichment): Record<string, number> {
  const { snap, primaryCategory } = enrichment;
  const temporal = getTemporalFeatures(anomaly.date);

  const features: Record<string, any> = {
    date: anomaly.date,
    z_score: anomaly.zScore,
    zScore: anomaly.zScore,
    excessReturn: anomaly.excessReturn,
    atrShockScore: anomaly.atrShockScore,
    volumeRatio: anomaly.volumeRatio,
    relative_volume_30d: anomaly.relativeVolume30d,
    body_to_range_ratio: anomaly.bodyToRangeRatio,
    overnight_gap_pct: anomaly.overnightGapPct,
    volume_price_clustering: anomaly.volumePriceClustering,
    kinetic_energy: anomaly.kineticEnergy,
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

export function getRecommendation(
  modelA: number,
  modelB: number,
  modelC: number,
  trendContext: TrendContext
): Recommendation {
  const riskScore = Math.round(Math.min(100, Math.max(0,
    (Math.abs(modelC) * 40) +
    ((1 - modelA) * 30) +
    (modelB < 0 ? 30 : 0)
  )));

  const riskReward = modelC !== 0
    ? Math.round((Math.abs(modelB) / Math.abs(modelC)) * 100) / 100
    : 0;

  const positionSizePct = Math.round(
    Math.min(10, Math.max(1, modelA * 10 * (1 - riskScore / 100))) * 10
  ) / 10;

  // Reduce position size when anomaly opposes the recent trend (potential dead cat / reversal)
  let trendAdjustedPositionSize = positionSizePct;
  if (trendContext.trendAlignment === 'OPPOSING') {
    const haircut = trendContext.trendStrength > 0.5 ? 0.50 : 0.75;
    trendAdjustedPositionSize = Math.round(positionSizePct * haircut * 10) / 10;
  }

  let recommendation: string;
  if (modelA >= 0.80 && modelB >= 0.05 && riskScore <= 40) recommendation = 'STRONG_BUY';
  else if (modelA >= 0.70 && modelB >= 0.03 && riskScore <= 55) recommendation = 'BUY';
  else if (modelA >= 0.65 && modelB >= 0.01) recommendation = 'ADD';
  else if (modelB < -0.05 && riskScore >= 60) recommendation = 'SELL';
  else if (modelB < -0.02) recommendation = 'REDUCE';
  else recommendation = 'HOLD';

  // Downgrade recommendation one level when strongly opposing the trend
  if (trendContext.trendAlignment === 'OPPOSING' && trendContext.trendStrength > 0.6) {
    if (recommendation === 'STRONG_BUY') recommendation = 'BUY';
    else if (recommendation === 'BUY') recommendation = 'ADD';
    else if (recommendation === 'ADD') recommendation = 'HOLD';
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
  const fallback = `${anomaly.symbol}: ${rec.recommendation} signal with ${(scores.model_a_confidence * 100).toFixed(1)}% model confidence. Pre-anomaly trend: ${trendContext.trendAlignment}. Expected 1M return ${(scores.model_b_return_1m * 100).toFixed(2)}% and max drawdown ${(scores.model_c_max_drawdown * 100).toFixed(2)}%.`;

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
- Recommendation: ${rec.recommendation}
- Risk score: ${rec.riskScore}/100
- Risk/reward ratio: ${rec.riskReward}

Note: a risk/reward ratio below 1.0 is UNFAVOURABLE — it means the expected downside exceeds the expected upside. A ratio above 1.0 is favourable. Always reflect this correctly in the narrative.
${edgarSection}
${managementSection}

Write a concise, professional narrative covering near-term (1-month) positioning as well as the medium-term (3/6-month) and long-term (12-month) outlook implied by the model outputs above. No emojis. No investment disclaimers. If the pre-anomaly trend is OPPOSING, explicitly note this as a risk factor and reflect it in your conviction level.`;

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


async function sendNtfyNotification(symbol: string, rec: string, modelB: number, riskScore: number, narrative: string): Promise<void> {
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
    body: sanitiseForHttp(`Expected return: ${(modelB * 100).toFixed(1)}% | Risk score: ${riskScore}/100\n\n${narrative.slice(0, 280)}`),
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
  alphavantageSentimentAvg: number | null
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

  let spyReturn = 0;
  try {
    const spyBars = await fetchYahooDailyHistory('SPY', '1mo');
    if (spyBars.length >= 2) {
      const last = spyBars[spyBars.length - 1];
      const prev = spyBars[spyBars.length - 2];
      spyReturn = (last.close - prev.close) / prev.close;
    }
  } catch (err: any) {
    console.warn('[LiveInference] Failed to fetch SPY benchmark:', err.message);
  }
  console.log(`[LiveInference] SPY benchmark return: ${(spyReturn * 100).toFixed(3)}%`);

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

  const aiClient = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

  let anomalyCount = 0;
  let narrativeCount = 0;
  let notificationCount = 0;
  const potResults: PotInferenceResult[] = [];

  for (const { symbol, companyName, exchange } of universe) {
    try {
      const bars = await fetchYahooDailyHistory(symbol, '1y');
      await sleep(YAHOO_REQUEST_DELAY_MS);

      const isWatchlisted = watchlistSymbols.has(symbol.toUpperCase());
      const anomaly = detectAnomaly(symbol, companyName, bars, spyReturn, isWatchlisted);
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
      if (avSentiment !== null) {
        if (enrichment.snap !== null) {
          enrichment.snap.av_news_sentiment = avSentiment;
        } else {
          enrichment.snap = { av_news_sentiment: avSentiment };
        }
      }
      const featureVector = buildFeatureVectorForAnomaly(bars, anomaly, enrichment);
      const digitalExhaust = computeDigitalExhaustVelocity(enrichment.snap);
      const scores = runInference(featureVector);
      const clampedReturn = Math.max(-0.30, Math.min(0.30, scores.model_b_return_1m));
      const clampedReturn3m = Math.max(-0.50, Math.min(0.50, scores.model_d1_return_3m));
      const clampedReturn6m = Math.max(-0.40, Math.min(0.40, scores.model_d2_return_6m));
      const clampedReturn2d = Math.max(-0.20, Math.min(0.20, scores.model_d3_return_2d));
      const clampedReturn3d = Math.max(-0.25, Math.min(0.25, scores.model_d4_return_3d));
      const clampedReturn2w = Math.max(-0.35, Math.min(0.35, scores.model_d5_return_2w));
      const rec = getRecommendation(scores.model_a_confidence, clampedReturn, scores.model_c_max_drawdown, trendContext);
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

      let narrative = '';
      if ((isActualAnomaly && scores.model_a_confidence >= NARRATIVE_CONFIDENCE_THRESHOLD) || rec.recommendation === 'SELL' || rec.recommendation === 'REDUCE') {
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

      await writeResultToSupabase(runDate, anomaly, enrichment.sector, exchange, clampedScores, rec, narrative, computeSignalCompleteness(featureVector), isWatchlisted, trendContext, edgarSummary, managementScore, digitalExhaust, avSentiment);

      potResults.push({
        symbol:                      anomaly.symbol,
        companyName:                 anomaly.companyName,
        current_price:               anomaly.close,
        recommendation:              rec.recommendation,
        risk_score:                  rec.riskScore,
        risk_reward_ratio:           rec.riskReward,
        model_a_confidence:          clampedScores.model_a_confidence,
        model_b_return_1m:           clampedScores.model_b_return_1m,
        model_c_max_drawdown:        clampedScores.model_c_max_drawdown,
        model_d1_return_3m:          clampedScores.model_d1_return_3m,
        model_d2_return_6m:          clampedScores.model_d2_return_6m,
        model_d3_return_2d:          clampedScores.model_d3_return_2d,
        model_d4_return_3d:          clampedScores.model_d4_return_3d,
        model_d5_return_2w:          clampedScores.model_d5_return_2w,
        model_e_outperform_12m_prob: clampedScores.model_e_outperform_12m_prob,
      });

      const shouldNotify = rec.recommendation === 'STRONG_BUY' || rec.recommendation === 'BUY';
      if (shouldNotify && (isActualAnomaly || isWatchlisted)) {
        const titlePrefix = isWatchlisted && !isActualAnomaly ? 'WATCHLIST' : rec.recommendation;
        await sendNtfyNotification(symbol, titlePrefix, clampedReturn, rec.riskScore, narrative);
        notificationCount++;
      }
    } catch (err: any) {
      console.error(`[LiveInference] Error processing ${symbol}:`, err.message);
    }
  }

  console.log(`[LiveInference] Done. Anomalies: ${anomalyCount}, Narratives: ${narrativeCount}, Notifications: ${notificationCount}`);

  if (potResults.length > 0) {
    console.log(`[LiveInference] Running PotService with ${potResults.length} signals (slot: ${determineRunSlot()})...`);
    try {
      await evaluateRun(potResults, new Date(), determineRunSlot());
    } catch (err: any) {
      console.error('[LiveInference] PotService evaluation failed:', err.message);
    }
  }

  const macro = await fetchMacroEnvironment(runDate);
  await writeMacroSnapshot(runDate, macro);
}

// Run directly when executed as a script (GitHub Actions)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cliSymbols = process.argv.slice(2);
  runLiveInference(cliSymbols.length > 0 ? cliSymbols : undefined).catch(console.error);
}
