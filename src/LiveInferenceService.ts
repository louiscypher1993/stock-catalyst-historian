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

const Z_SCORE_THRESHOLD = 2.15;
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

interface AnomalySignal {
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
}

interface ModelScores {
  model_a_confidence: number;
  model_b_return_1m: number;
  model_c_max_drawdown: number;
  model_d1_return_3m: number;
  model_d2_return_6m: number;
  model_e_outperform_12m_prob: number;
}

interface Recommendation {
  recommendation: string;
  riskScore: number;
  riskReward: number;
  positionSizePct: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchYahooDailyHistory(symbol: string, range: string = '1y'): Promise<YahooBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
function detectAnomaly(symbol: string, companyName: string, bars: YahooBar[], spyReturn: number): AnomalySignal | null {
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
  if (Math.abs(zScore) <= Z_SCORE_THRESHOLD) return null;

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
  };
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
async function getSymbolSnapshot(symbol: string): Promise<SymbolEnrichment> {
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

function buildFeatureVectorForAnomaly(anomaly: AnomalySignal, enrichment: SymbolEnrichment): Record<string, number> {
  const { snap, primaryCategory } = enrichment;
  const temporal = getTemporalFeatures(anomaly.date);

  const features: Record<string, any> = {
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

  return buildLiveFeatureVector(features, snap, context);
}

function runInference(featureVector: Record<string, number>): ModelScores {
  const inferScript = path.join(ML_DIR, 'infer.py');
  const vectorJson = JSON.stringify(featureVector).replace(/"/g, '\\"');
  const output = execSync(`python "${inferScript}" "${vectorJson}"`, { encoding: 'utf-8' });
  return JSON.parse(output.trim()) as ModelScores;
}

function getRecommendation(modelA: number, modelB: number, modelC: number): Recommendation {
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

  let recommendation: string;
  if (modelA >= 0.80 && modelB >= 0.05 && riskScore <= 40) recommendation = 'STRONG_BUY';
  else if (modelA >= 0.70 && modelB >= 0.03 && riskScore <= 55) recommendation = 'BUY';
  else if (modelA >= 0.65 && modelB >= 0.01) recommendation = 'ADD';
  else if (modelB < -0.05 && riskScore >= 60) recommendation = 'SELL';
  else if (modelB < -0.02) recommendation = 'REDUCE';
  else recommendation = 'HOLD';

  return { recommendation, riskScore, riskReward, positionSizePct };
}

async function generateNarrative(
  aiClient: GoogleGenAI,
  anomaly: AnomalySignal,
  scores: ModelScores,
  rec: Recommendation
): Promise<string> {
  const fallback = `${anomaly.symbol}: ${rec.recommendation} signal with ${(scores.model_a_confidence * 100).toFixed(1)}% model confidence, expected 1M return ${(scores.model_b_return_1m * 100).toFixed(2)}% and max drawdown ${(scores.model_c_max_drawdown * 100).toFixed(2)}%.`;

  if (!process.env.GEMINI_API_KEY) return fallback;

  try {
    const prompt = `You are a senior institutional equity analyst. Summarize the investment case for ${anomaly.symbol} (${anomaly.companyName}) in 2-3 sentences.

Today's price: $${anomaly.close.toFixed(2)}
Z-score (idiosyncratic move): ${anomaly.zScore.toFixed(2)}
Excess return vs market: ${(anomaly.excessReturn * 100).toFixed(2)}%
Volume ratio: ${anomaly.volumeRatio.toFixed(2)}x

Model outputs:
- Event confidence: ${(scores.model_a_confidence * 100).toFixed(1)}%
- Expected 1-month return: ${(scores.model_b_return_1m * 100).toFixed(2)}%
- Max adverse excursion (1-month): ${(scores.model_c_max_drawdown * 100).toFixed(2)}%
- Expected 3-month return: ${(scores.model_d1_return_3m * 100).toFixed(2)}%
- Expected 6-month return: ${(scores.model_d2_return_6m * 100).toFixed(2)}%
- Probability of >10% return over 12 months: ${(scores.model_e_outperform_12m_prob * 100).toFixed(1)}%
- Recommendation: ${rec.recommendation}
- Risk score: ${rec.riskScore}/100
- Risk/reward ratio: ${rec.riskReward}

Note: a risk/reward ratio below 1.0 is UNFAVOURABLE — it means the expected downside exceeds the expected upside. A ratio above 1.0 is favourable. Always reflect this correctly in the narrative.

Write a concise, professional narrative covering near-term (1-month) positioning as well as the medium-term (3/6-month) and long-term (12-month) outlook implied by the model outputs above. No emojis. No investment disclaimers.`;

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

async function sendNtfyNotification(symbol: string, rec: string, modelB: number, riskScore: number, narrative: string): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      'Title': `${rec}: ${symbol}`,
      'Priority': rec === 'STRONG_BUY' ? 'high' : 'default',
      'Tags': rec === 'STRONG_BUY' ? 'rocket,chart_increasing' : 'chart_increasing',
      'Content-Type': 'text/plain',
    },
    body: `Expected return: ${(modelB * 100).toFixed(1)}% | Risk score: ${riskScore}/100\n\n${narrative.slice(0, 280)}`,
  });
}

function computeSignalCompleteness(vector: Record<string, number>): number {
  const indicatorKeys = Object.keys(vector).filter(k => k.endsWith('_is_null'));
  if (indicatorKeys.length === 0) return 1;
  const nullCount = indicatorKeys.reduce((sum, k) => sum + vector[k], 0);
  return Math.round((1 - nullCount / indicatorKeys.length) * 1000) / 1000;
}

async function writeResultToSupabase(
  runDate: string,
  anomaly: AnomalySignal,
  sector: string | null,
  exchange: string | null,
  scores: ModelScores,
  rec: Recommendation,
  narrative: string,
  signalCompletenessScore: number
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
      model_a_confidence: scores.model_a_confidence,
      model_b_return_1m: scores.model_b_return_1m,
      model_c_max_drawdown: scores.model_c_max_drawdown,
      model_d1_return_3m: scores.model_d1_return_3m,
      model_d2_return_6m: scores.model_d2_return_6m,
      model_e_outperform_12m_prob: scores.model_e_outperform_12m_prob,
      recommendation: rec.recommendation,
      risk_score: rec.riskScore,
      risk_reward_ratio: rec.riskReward,
      position_size_pct: rec.positionSizePct,
      narrative,
      signal_completeness_score: signalCompletenessScore,
    }, { onConflict: 'run_date,symbol' });

    if (error) {
      console.error(`[LiveInference] Supabase write failed for ${anomaly.symbol}:`, error.message);
    }
  } catch (err: any) {
    console.error(`[LiveInference] Supabase client unavailable, skipping write for ${anomaly.symbol}:`, err.message);
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

  const aiClient = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

  let anomalyCount = 0;
  let narrativeCount = 0;
  let notificationCount = 0;

  for (const { symbol, companyName, exchange } of universe) {
    try {
      const bars = await fetchYahooDailyHistory(symbol, '1y');
      await sleep(YAHOO_REQUEST_DELAY_MS);

      const anomaly = detectAnomaly(symbol, companyName, bars, spyReturn);
      if (!anomaly) continue;

      anomalyCount++;
      console.log(`[LiveInference] Anomaly detected: ${symbol} z=${anomaly.zScore.toFixed(2)}`);

      const enrichment = await getSymbolSnapshot(symbol);
      const featureVector = buildFeatureVectorForAnomaly(anomaly, enrichment);
      const scores = runInference(featureVector);
      const clampedReturn = Math.max(-0.30, Math.min(0.30, scores.model_b_return_1m));
      const clampedReturn3m = Math.max(-0.50, Math.min(0.50, scores.model_d1_return_3m));
      const clampedReturn6m = Math.max(-0.50, Math.min(0.50, scores.model_d2_return_6m));
      const rec = getRecommendation(scores.model_a_confidence, clampedReturn, scores.model_c_max_drawdown);
      console.log(`[LiveInference]   scores=${JSON.stringify(scores)} rec=${JSON.stringify(rec)}`);

      let narrative = '';
      if (scores.model_a_confidence >= NARRATIVE_CONFIDENCE_THRESHOLD || rec.recommendation === 'SELL' || rec.recommendation === 'REDUCE') {
        narrative = aiClient
          ? await generateNarrative(aiClient, anomaly, { ...scores, model_b_return_1m: clampedReturn, model_d1_return_3m: clampedReturn3m, model_d2_return_6m: clampedReturn6m }, rec)
          : `${symbol}: ${rec.recommendation} signal with ${(scores.model_a_confidence * 100).toFixed(1)}% model confidence.`;
        narrativeCount++;
      }

      await writeResultToSupabase(runDate, anomaly, enrichment.sector, exchange, { ...scores, model_b_return_1m: clampedReturn, model_d1_return_3m: clampedReturn3m, model_d2_return_6m: clampedReturn6m }, rec, narrative, computeSignalCompleteness(featureVector));

      if (rec.recommendation === 'STRONG_BUY' || rec.recommendation === 'BUY') {
        await sendNtfyNotification(symbol, rec.recommendation, scores.model_b_return_1m, rec.riskScore, narrative);
        notificationCount++;
      }
    } catch (err: any) {
      console.error(`[LiveInference] Error processing ${symbol}:`, err.message);
    }
  }

  console.log(`[LiveInference] Done. Anomalies: ${anomalyCount}, Narratives: ${narrativeCount}, Notifications: ${notificationCount}`);
}

// Run directly when executed as a script (GitHub Actions)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLiveInference().catch(console.error);
}
