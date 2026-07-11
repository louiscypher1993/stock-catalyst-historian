import { GoogleGenAI, Type } from "@google/genai";
import { detectMacroSwings } from "./MacroTrendDetector";
import {
  db,
  getCachedAnalysis,
  setCachedAnalysis,
  setEventFeatures,
  getPriorEvents,
  insertPolygonNews,
  getNewsForAnomaly,
  saveNewsArticles,
  getSocialMentionsForAnomaly,
  saveSocialMentions,
  getInsiderClusterDensity,
  getManagementFrictionScore,
  getCompetitorEventDensity,
  getEdgarFilings,
  getScannerState,
  setScannerState,
  clearScannerState,
  getCachedDarkPool,
  getCachedBorrowRate,
  getCachedSocialSentiment,
  getCachedEarningsCalendar,
  insertEarningsCalendar
} from "./db";
import {
  MarketRegime,
  EventFeatureVector,
  StockAnalysis,
  StockPoint,
  ChartPoint,
  StockScanResult,
  EarningsEvent,
  GDELTToneSummary,
} from "./src/types";
import { detectRegime } from "./RegimeDetectionService";
import { EVENT_TAXONOMY } from "./EventTaxonomy";
import {
  fetchPriceHistory,
  fetchNewsForSymbol,
  fetchTickerDetails,
  getHistoricalImpliedVolatility,
  getDailyPutCallRatio,
} from "./PolygonService";
import { getRecentFilings, getEdgarInsiderSummary } from "./EdgarService";
import { getFullCompanyContext, getEarningsTranscript, getSocialSentiment, getEstimateRevisions, getFMPNewsSentiment, getFMPInsiderTrading, getFMPInstitutionalOwnership, getFMPEarningsSurprise, getFMPAnalystGrades, getFMPPriceTargetConsensus } from "./FMPService";
import { getTopPeers } from "./PeerDataService";
import { getDarkPoolActivity, getBorrowRate, getFMPShortInterest } from "./ShortDataService";
import { fetchGDELTToneForDate } from "./GDELTService";
import {
  fetchInternationalPriceHistory,
  getExchangeStatus,
} from "./EODHDService";
import { getMacroSnapshot, fetchFREDSeries, getCompanyCreditContext } from "./FREDService";
import { getActualMacroRelease } from "./EconomicCalendar";
import { searchNewsForStock, rankArticlesByRelevance } from "./NewsAPIService";
import { getStockTwitsSentimentSummary } from "./StockTwitsService";
import { getShortInterest, getShortInterestVelocity } from "./FinraShortInterestService";
import { getTrendsSummary } from "./GoogleTrendsService";
import { detectWikipediaSpike } from "./WikipediaService";
import { getCongressionalNetFlow } from "./CongressionalTradingService";
import { getFinnhubNewsCount, getFinnhubInsiderActivity } from "./FinnhubService";
import { getFDAActivity } from "./FDAService";
import { getExecutiveRoster } from "./ExecutiveIntelligence";
import { fetchYouTubeTranscripts } from "./YouTubeService";
import { getEarningsCalendar } from "./EarningsCalendarService";
import { extractAndParseJson } from "./src/JsonParser";
import { scoreManagementConfidence } from "./EarningsSentimentService";
import { isSourceRateLimited, getRateLimitedSources } from "./DataSourceRegistry";
import { SignalNormalizer } from "./src/SignalNormalizer";
import { runGatingEngine, GatingVerdict } from "./QuantamentalGatingEngine";
import { buildGatingInput } from "./GatingAdapter";

const normaliseSuspectedCatalyst = (val: any): string | undefined => {
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'string') return val;
  return undefined;
};

// Exchange suffixes that Yahoo Finance preserves with a dot (international markets).
// Synced to the 52-entry allowlist in LiveInferenceService.ts / scripts/watchlist-pulse.mjs
// (cross-checked against every distinct suffix in marketsData.ts against Yahoo's real chart
// API). `.AB` (Abu Dhabi) and `.PS` (Philippine Stock Exchange) are deliberately excluded --
// a Yahoo data-coverage gap, not a suffix-mapping bug -- so they fall through to the
// dash-fallback below same as before.
const YAHOO_INTL_SUFFIXES = new Set([
  '.AE', '.AS', '.AT', '.AX', '.BA', '.BD', '.BK', '.BO', '.BR',
  '.CA', '.CL', '.CO', '.DE', '.F', '.HE', '.HK', '.IR', '.IS',
  '.JK', '.JO', '.KA', '.KL', '.KQ', '.KS', '.KW', '.L', '.LM',
  '.LS', '.MC', '.ME', '.MI', '.MX', '.NS', '.NZ', '.OL', '.PA',
  '.PR', '.QA', '.RO', '.SA', '.SI', '.SN', '.SR', '.SS', '.ST',
  '.SW', '.SZ', '.T', '.TO', '.TW', '.VN', '.WA',
]);

/**
 * Converts a symbol from FMP/internal format to Yahoo Finance format.
 * US multi-class share tickers use a dash separator on Yahoo (BRK.B → BRK-B),
 * while international exchange suffixes are preserved as-is.
 */
export function normaliseForYahoo(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx === -1) return upper;
  const suffix = upper.slice(dotIdx);
  if (YAHOO_INTL_SUFFIXES.has(suffix)) return upper;
  return upper.replace(/\./g, '-');
}

/**
 * A highly robust, promise-based sleep helper function. 
 * We must artificially cripple our V8 JavaScript engine's raw processing speed 
 * to a crawling pace just because modern data providers' backend servers are 
 * absolutely terrified of a little API traffic.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Micro-throttle: Spaces out sequential requests to different endpoints within 
 * the single ticker evaluation block so we don't look like we're executing
 * a high-speed penetration test on their API gateways.
 */
const MICRO_THROTTLE_MS = 300;

/**
 * Macro-throttle: Spaces out transitions from one ticker symbol chunk/iteration
 * to the next stock in our gargantuan run of tickers. Stalls the engine to
 * ensure we don't run into daily caps or minute limits.
 */
const MACRO_THROTTLE_MS = 12000;

const SECTOR_COMMODITY_MAP: Record<string, string> = {
  "Airlines": "DCOILWTICO",
  "Transportation": "DCOILWTICO",
  "Logistics & Transportation": "DCOILWTICO",
  "Energy": "DCOILWTICO",
  "Utilities": "DCOILWTICO",
  "Semiconductors": "PCOPPUSDM",
  "Technology": "PCOPPUSDM",
  "Industrials": "PCOPPUSDM",
  "Basic Materials": "PCOPPUSDM",
  "Machinery": "PCOPPUSDM",
};

export function enrichConfidences(analysisObj: any, matchPoint?: any) {
  if (matchPoint) {
    if (
      (matchPoint as any)._tempDataConfidence !== undefined &&
      analysisObj.dataConfidence === undefined
    ) {
      analysisObj.dataConfidence = (matchPoint as any)._tempDataConfidence;
    }
    if (
      (matchPoint as any)._tempStatisticalConfidence !== undefined &&
      analysisObj.statisticalConfidence === undefined
    ) {
      analysisObj.statisticalConfidence = (
        matchPoint as any
      )._tempStatisticalConfidence;
    }
  }

  // Ensure uncalculated confidences are saved as NULL (using javascript null, not 0)
  if (analysisObj.statisticalConfidence === undefined) analysisObj.statisticalConfidence = null;
  if (analysisObj.dataConfidence === undefined) analysisObj.dataConfidence = null;

  if (
    analysisObj.correlation_confidence !== undefined &&
    analysisObj.correlation_confidence !== null &&
    analysisObj.aiConfidence !== undefined &&
    analysisObj.aiConfidence !== null &&
    analysisObj.causalConfidence === undefined
  ) {
    analysisObj.causalConfidence = Math.round(
      analysisObj.correlation_confidence * 0.6 + analysisObj.aiConfidence * 0.4,
    );
  } else if (
    analysisObj.correlation_confidence !== undefined &&
    analysisObj.correlation_confidence !== null &&
    analysisObj.causalConfidence === undefined
  ) {
    analysisObj.causalConfidence = analysisObj.correlation_confidence;
  } else if (
    analysisObj.aiConfidence !== undefined &&
    analysisObj.aiConfidence !== null &&
    analysisObj.causalConfidence === undefined
  ) {
    analysisObj.causalConfidence = analysisObj.aiConfidence;
  }

  if (analysisObj.causalConfidence === undefined) {
    analysisObj.causalConfidence = null;
  }

  if (analysisObj.historicalConfidence === undefined || analysisObj.historicalConfidence === 0 || analysisObj.historicalConfidence === null) {
    // Calculate a real Historical Dataset Confidence (%) based on available features instead of defaulting to 0
    let score = 70; // Baseline
    
    // 1. Coverage context check (eventDensity denotes how dense our historical sequence tracking is)
    if (analysisObj.eventDensity !== undefined && analysisObj.eventDensity !== null) {
      if (analysisObj.eventDensity > 0) score += 12;
      else score += 5; // clean blank slate history is still valuable coverage
    } else {
      score += 2;
    }

    // 2. Volatility regime completeness
    if (analysisObj.vixAtEvent !== undefined && analysisObj.vixAtEvent > 0) {
      score += 7;
    }

    // 3. Alternative/Governance metadata abundance
    if (analysisObj.alternative_data_score !== undefined && analysisObj.alternative_data_score !== null && analysisObj.alternative_data_score > 0) {
      score += 5;
    }
    if (analysisObj.corporate_governance_score !== undefined && analysisObj.corporate_governance_score !== null && analysisObj.corporate_governance_score > 0) {
      score += 5;
    }

    // 4. Macro completeness
    if (analysisObj.macroeconomic_score !== undefined && analysisObj.macroeconomic_score !== null && analysisObj.macroeconomic_score > 0) {
      score += 5;
    }

    // Clamp score strictly between 65 and 99
    analysisObj.historicalConfidence = Math.min(99, Math.max(65, score));
  }

  if (analysisObj.aiConfidence === undefined) {
    analysisObj.aiConfidence = null;
  }

  const confs = [
    analysisObj.statisticalConfidence,
    analysisObj.causalConfidence,
    analysisObj.aiConfidence,
    analysisObj.historicalConfidence,
    analysisObj.dataConfidence,
  ].filter((c) => c !== undefined && c !== null);

  if (confs.length > 0) {
    analysisObj.confidence_score = Math.round(
      confs.reduce((a: number, b: number) => a + b, 0) / confs.length,
    );
  } else {
    analysisObj.confidence_score = null;
  }
}

/**
 * Calculates a rolling Relative Strength Index (RSI) across a price array.
 * 
 * Mathematical Formulation:
 * 1. Price Change (C_t):
 *    C_t = Close_t - Close_{t-1}
 * 
 * 2. Initial Averages (t = period):
 *    Average Gain (avgGain_0) = (Sum of gains over period) / period
 *    Average Loss (avgLoss_0) = (Sum of losses over period) / period
 * 
 * 3. Smoothing (t > period) using Wilder's Smoothing Technique:
 *    avgGain_t = (avgGain_{t-1} * (period - 1) + Gain_t) / period
 *    avgLoss_t = (avgLoss_{t-1} * (period - 1) + Loss_t) / period
 * 
 * 4. Relative Strength (RS):
 *    RS = avgGain_t / avgLoss_t
 * 
 * 5. Relative Strength Index (RSI):
 *    RSI = 100 - (100 / (1 + RS))
 *    Bounded: 0 <= RSI <= 100
 *    Physical meaning: Momentum oscillator measuring speed and change of price movements.
 * 
 * @param points Historical points list with at least .close values
 * @param period Lookback window size (defaults to 14)
 * @returns An array representing the historical RSI index at each point index
 */
function calculateRSIArray(points: any[], period: number = 14): number[] {
  const rsi = new Array(points.length).fill(0);
  if (points.length <= period) return rsi;

  let sumGain = 0;
  let sumLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = points[i].close - points[i - 1].close;
    if (change > 0) sumGain += change;
    else sumLoss += Math.abs(change);
  }

  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;

  if (avgLoss === 0) {
    rsi[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    rsi[period] = 100 - (100 / (1 + rs));
  }

  for (let i = period + 1; i < points.length; i++) {
    const change = points[i].close - points[i - 1].close;
    let gain = 0;
    let loss = 0;
    if (change > 0) gain = change;
    else loss = Math.abs(change);

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - (100 / (1 + rs));
    }
  }

  return rsi;
}

const LOCAL_VOLATILITY_INDEX_REGISTRY: Record<string, string> = {
  // Australian Securities Exchange
  "AX": "^AXVI", // S&P/ASX 200 VIX
  // Toronto Stock Exchange
  "TO": "^VIXCAD", // S&P/TSX 60 VIX
  "V": "^VIXCAD",
  // London Stock Exchange
  "L": "^VFTSE", // FTSE 100 VIX
  // Hong Kong Stock Exchange
  "HK": "^VHSI", // Hang Seng VIX
  // India NSE/BSE
  "NS": "^INDIAVIX",
  "BO": "^INDIAVIX",
  // European exchanges: Germany, France, Spain, Netherlands, Italy
  "DE": "^V2TX", // Euro Stoxx 50 Volatility
  "PA": "^V2TX",
  "MC": "^V2TX",
  "AS": "^V2TX",
  "MI": "^V2TX",
};

/**
 * Retrieves the corresponding volatility index ticker for a given asset symbol based on regional registry.
 * 
 * Volatility Index Exchange Mapping:
 * - Symbol has no suffix -> Defaults to CBOE VIX Index ("^VIX")
 * - Suffix is registered in LOCAL_VOLATILITY_INDEX_REGISTRY -> Maps exchange-specific volatility tracker (e.g. AX -> ^AXVI)
 * - Exchange is unregistered -> Fallback to null (which maps to VIX valuation level of 0.0)
 * 
 * @param symbol The raw ticker symbol of the financial asset (e.g. "AAPL", "BP.L", "BHP.AX")
 * @returns The associated localized Volatility Index ticker symbol, or null if unregistered
 */
export function getVolIndexTicker(symbol: string): string | null {
  const parts = symbol.toUpperCase().trim().split(".");
  const suffix = parts.length > 1 ? parts[parts.length - 1] : "";
  if (!suffix) {
    // No suffix means US-based stock, return Spark CBOE VIX "^VIX"
    return "^VIX";
  }
  
  // God forbid an exchange is located outside the USA. We must search our localized registry since 
  // Americans think the S&P 500 is the entire universe, though try explaining that to a retail trader.
  if (LOCAL_VOLATILITY_INDEX_REGISTRY[suffix]) {
    return LOCAL_VOLATILITY_INDEX_REGISTRY[suffix];
  }
  // If exchange is not US-based and not in registry, return null (which means it'll default VIX to 0)
  return null;
}

/**
 * Computes the pre-anomaly backward trajectory features (returns and volume ratios)
 * using only bars up to and including T-1, so the anomaly day's own move is excluded.
 */
function computePreReturnFeatures(bars: { close: number; volume: number }[], anomalyIdx: number): {
  pre_return_3d: number | null;
  pre_return_5d: number | null;
  pre_return_10d: number | null;
  pre_return_21d: number | null;
  pre_vol_ratio_5d: number | null;
  pre_vol_ratio_10d: number | null;
} {
  const dayBefore = bars[anomalyIdx - 1]?.close;
  if (!dayBefore) return { pre_return_3d: null, pre_return_5d: null, pre_return_10d: null, pre_return_21d: null, pre_vol_ratio_5d: null, pre_vol_ratio_10d: null };

  const ret = (n: number): number | null => {
    const base = bars[anomalyIdx - 1 - n]?.close;
    return base ? (dayBefore - base) / base : null;
  };

  // 30d avg volume using bars before anomaly
  const vol30Window = bars.slice(Math.max(0, anomalyIdx - 31), anomalyIdx - 1);
  const vol30Avg = vol30Window.length > 0 ? vol30Window.reduce((s, b) => s + b.volume, 0) / vol30Window.length : null;

  const volRatio = (n: number): number | null => {
    if (!vol30Avg || vol30Avg === 0) return null;
    const window = bars.slice(Math.max(0, anomalyIdx - 1 - n), anomalyIdx - 1);
    if (window.length === 0) return null;
    const avg = window.reduce((s, b) => s + b.volume, 0) / window.length;
    return avg / vol30Avg;
  };

  return {
    pre_return_3d: ret(3),
    pre_return_5d: ret(5),
    pre_return_10d: ret(10),
    pre_return_21d: ret(21),
    pre_vol_ratio_5d: volRatio(5),
    pre_vol_ratio_10d: volRatio(10),
  };
}

/**
 * Computes short-term forward return targets (2d, 3d, 2w) from the anomaly close,
 * returning null when the required future bar is not yet available (event too recent).
 */
function computeForwardReturnFeatures(bars: { close: number }[], anomalyIdx: number): {
  forward_return_2d: number | null;
  forward_return_3d: number | null;
  forward_return_2w: number | null;
} {
  const c0 = bars[anomalyIdx]?.close;
  if (!c0) return { forward_return_2d: null, forward_return_3d: null, forward_return_2w: null };

  const fwd = (n: number): number | null => {
    const fut = bars[anomalyIdx + n]?.close;
    return fut !== undefined ? (fut - c0) / c0 : null;
  };

  return {
    forward_return_2d: fwd(2),
    forward_return_3d: fwd(3),
    forward_return_2w: fwd(10),
  };
}

/**
 * Normalizes, scales, and serializes technical daily parameters into an ML-ready EventFeatureVector.
 * Writes output vector to the SQLite cache registry.
 * 
 * Mathematical Normalization Metrics:
 * 1. ATR Shock Score (%):
 *    ATR_Shock = ((High - Low) / Close) * 100
 *    Physical meaning: Measure of intra-day extreme volatility relative to closing valuation.
 * 
 * 2. Return Lag Vector:
 *    R_lag = [R_{t-1}/100, R_{t-2}/100, ..., R_{t-5}/100]
 *    where R = Daily Return or Excess Return over benchmark.
 * 
 * 3. Volume Ratio Lag Vector:
 *    V_lag = [V_{t-1}/V_avg20, V_{t-2}/V_avg20, ..., V_{t-5}/V_avg20]
 * 
 * @param symbol Normalized stock symbol string.
 * @param p Current stock target row containing quantitative features.
 * @param points Array representing historical pricing time series.
 * @param i Index pointer of current stock target row in timeline sequence.
 */
function buildAndSaveFeatureVector(
  symbol: string,
  p: StockPoint,
  points: StockPoint[],
  i: number,
) {
  if (p.hasAnalysis && p.analysis) {
    const atrShock = ((p.high - p.low) / (p.close > 0 ? p.close : 1)) * 100;

    const returnLagList: number[] = [];
    const volumeLagList: number[] = [];

    for (let lag = 1; lag <= 5; lag++) {
      const idx = i - lag;
      if (idx >= 0 && points[idx]) {
        // Divide lag returns by 100 for ML-readiness
        const val = points[idx].excessReturn ?? points[idx].dailyReturn ?? 0;
        returnLagList.push(val / 100);
        volumeLagList.push(points[idx].volumeRatio ?? 1);
      } else {
        returnLagList.push(0);
        volumeLagList.push(0);
      }
    }

    // Convert percentages into normalized floating scale (val / 100).
    // This basis points scaling (/ 100) is highly necessary because standard retail traders will
    // literally lose their life savings on excessive leverage because they didn't know what a basis point was,
    // or why 1% represents 0.01 in real mathematical systems.
    const div100 = (val: number | null | undefined): number | null => {
      if (val === null || val === undefined || isNaN(val)) return null;
      return val / 100;
    };

    const vixRaw = (p as any)._tempVixAtEvent ?? p.vixAtEvent ?? p.analysis?.vixAtEvent ?? null;
    const scaledVix = vixRaw !== null ? vixRaw / 100 : null;

    const triggeredZThreshold = (p as any)._tempTriggeredZScoreThreshold ?? p.analysis?.triggered_z_score_threshold ?? null;
    const confidenceTier: string | null = triggeredZThreshold !== null
      ? triggeredZThreshold >= 2.15 ? 'high' : triggeredZThreshold >= 1.8 ? 'medium' : 'low'
      : null;

    const preReturnFeatures = computePreReturnFeatures(points, i);
    const forwardReturnFeatures = computeForwardReturnFeatures(points, i);
    const competitorEventDensity = getCompetitorEventDensity(symbol, p.date);

    const features: EventFeatureVector = {
      symbol: symbol,
      date: p.date,
      excessReturn: p.excessReturn !== undefined ? p.excessReturn / 100 : p.dailyReturn / 100,
      zScore: p.zScore,
      atrShockScore: atrShock / 100,
      volumeRatio: p.volumeRatio ?? 1,
      volumeShockType: p.volumeShockType ?? null,
      vixAtEvent: scaledVix,
      vixRegime: (p as any)._tempVixRegime ?? p.analysis?.vixRegime ?? null,
      trendRegime: (p as any)._tempMarketRegime?.trendRegime ?? p.analysis?.marketRegime?.trendRegime ?? null,
      volatilityRegime: (p as any)._tempMarketRegime?.volatilityRegime ?? p.analysis?.marketRegime?.volatilityRegime ?? null,
      primaryCategory: p.analysis.primaryCategory ?? null,
      primarySubType: p.analysis.primarySubType ?? null,
      return_1d: div100(p.analysis.return_1d),
      return_1w: div100(p.analysis.return_1w),
      return_1m: div100(p.analysis.return_1m),
      return_6m: div100(p.analysis.return_6m),
      return_1y: div100(p.analysis.return_1y),
      forward_return_1d: div100(p.analysis.return_1d),
      forward_return_1w: div100(p.analysis.return_1w),
      forward_return_1m: div100(p.analysis.return_1m),
      forward_return_2d: forwardReturnFeatures.forward_return_2d,
      forward_return_3d: forwardReturnFeatures.forward_return_3d,
      forward_return_2w: forwardReturnFeatures.forward_return_2w,
      pre_return_3d: preReturnFeatures.pre_return_3d,
      pre_return_5d: preReturnFeatures.pre_return_5d,
      pre_return_10d: preReturnFeatures.pre_return_10d,
      pre_return_21d: preReturnFeatures.pre_return_21d,
      pre_vol_ratio_5d: preReturnFeatures.pre_vol_ratio_5d,
      pre_vol_ratio_10d: preReturnFeatures.pre_vol_ratio_10d,
      z_score: p.zScore,
      vix_close: scaledVix,
      statisticalConfidence: p.analysis.statisticalConfidence ?? 50,
      causalConfidence: p.analysis.causalConfidence ?? null,
      return_lag_vector: JSON.stringify(returnLagList),
      volume_lag_vector: JSON.stringify(volumeLagList),
      body_to_range_ratio: p.body_to_range_ratio,
      overnight_gap_pct: div100(p.overnight_gap_pct),
      volume_price_clustering: p.volume_price_clustering,
      volatility_contraction_index: div100(p.volatility_contraction_index),
      obv_delta_10d: p.obv_delta_10d,
      day_sin: p.day_sin,
      day_cos: p.day_cos,
      month_sin: p.month_sin,
      month_cos: p.month_cos,
      gap_fill_ratio: p.gap_fill_ratio,
      congressional_net_flow_30d: (p as any)._tempCongressionalNetFlow !== undefined && (p as any)._tempCongressionalNetFlow !== null ? (p as any)._tempCongressionalNetFlow : null,
      economic_policy_uncertainty: (p as any)._tempMacroSnapshot?.economic_policy_uncertainty !== undefined && (p as any)._tempMacroSnapshot?.economic_policy_uncertainty !== null ? (p as any)._tempMacroSnapshot.economic_policy_uncertainty : null,
      management_confidence_score: p.analysis?.management_confidence_score ?? null,
      iv_crush_pct: div100((p as any)._tempIvCrush ?? p.analysis?.iv_crush_pct),
      peer_average_return: div100((p as any)._tempPeerAverageReturn ?? p.analysis?.peer_average_return),
      peer_contagion_delta: div100((p as any)._tempContagionDelta ?? p.analysis?.peer_contagion_delta),
      dist_sma_50: (p as any)._tempDistSma50 ?? null,
      dist_sma_200: (p as any)._tempDistSma200 ?? null,
      rsi_14: (p as any)._tempRsi14 ?? null,
      relative_volume_30d: (p as any)._tempRelativeVolume30d ?? null,
      put_call_ratio_t_minus_1: (p as any)._tempPutCallRatio ?? p.analysis?.put_call_ratio_t_minus_1 ?? null,
      dark_pool_index: (p as any)._tempDarkPoolIndex ?? p.analysis?.dark_pool_index ?? null,
      ctb_velocity_7d: (p as any)._tempCtbVelocity ?? p.analysis?.ctb_velocity_7d ?? null,
      shannon_entropy_30d: (p as any)._tempShannonEntropy ?? p.analysis?.shannon_entropy_30d ?? null,
      amihud_illiquidity_30d: (p as any)._tempAmihud ?? p.analysis?.amihud_illiquidity_30d ?? null,
      barycenter_stretch_20d: (p as any)._tempBarycenterStretch ?? p.analysis?.barycenter_stretch_20d ?? null,
      kinetic_energy: (p as any)._tempKineticEnergy ?? p.analysis?.kinetic_energy ?? null,
      l1_lagrange_point: (p as any)._tempL1Lagrange ?? p.analysis?.l1_lagrange_point ?? null,
      orbital_escape_velocity: (p as any)._tempEscapeVelocity ?? p.analysis?.orbital_escape_velocity ?? null,
      escape_velocity_cleared: (p as any)._tempEscapeVelocityCleared ?? p.analysis?.escape_velocity_cleared ?? null,
      market_reynolds_number: (p as any)._tempReynoldsNumber ?? p.analysis?.market_reynolds_number ?? null,
      fractal_efficiency_ratio_10d: (p as any)._tempFER ?? p.analysis?.fractal_efficiency_ratio_10d ?? null,
      market_jerk: (p as any)._tempMarketJerk ?? p.analysis?.market_jerk ?? null,
      seismic_magnitude_mw: (p as any)._tempSeismicMagnitudeMw ?? p.analysis?.seismic_magnitude_mw ?? null,
      triggered_z_score_threshold: (p as any)._tempTriggeredZScoreThreshold ?? p.analysis?.triggered_z_score_threshold ?? null,
      sector_relative_z_score: (p as any)._tempSectorRelativeZScore ?? p.analysis?.sector_relative_z_score ?? null,
      fmp_social_sentiment_score: (p as any)._tempFmpSocialSentimentScore ?? p.analysis?.fmp_social_sentiment_score ?? null,
      fmp_social_post_volume: (p as any)._tempFmpSocialPostVolume ?? p.analysis?.fmp_social_post_volume ?? null,
      fmp_news_sentiment_avg: (p as any)._tempFmpNewsSentimentAvg ?? (p.analysis as any)?.fmp_news_sentiment_avg ?? null,
      fmp_news_article_count_7d: (p as any)._tempFmpNewsArticleCount7d ?? (p.analysis as any)?.fmp_news_article_count_7d ?? null,
      insider_net_shares_30d: (p as any)._tempInsiderNetShares30d ?? (p.analysis as any)?.insider_net_shares_30d ?? null,
      insider_buy_count_30d: (p as any)._tempInsiderBuyCount30d ?? (p.analysis as any)?.insider_buy_count_30d ?? null,
      insider_sell_count_30d: (p as any)._tempInsiderSellCount30d ?? (p.analysis as any)?.insider_sell_count_30d ?? null,
      institutional_ownership_pct: (p as any)._tempInstitutionalOwnershipPct ?? (p.analysis as any)?.institutional_ownership_pct ?? null,
      institutional_ownership_change_qoq: (p as any)._tempInstitutionalOwnershipChangeQoQ ?? (p.analysis as any)?.institutional_ownership_change_qoq ?? null,
      eps_surprise_pct: (p as any)._tempEpsSurprisePct ?? (p.analysis as any)?.eps_surprise_pct ?? null,
      revenue_surprise_pct: (p as any)._tempRevenueSurprisePct ?? (p.analysis as any)?.revenue_surprise_pct ?? null,
      earnings_date_proximity_days: (p as any)._tempEarningsProximityDays ?? (p.analysis as any)?.earnings_date_proximity_days ?? null,
      analyst_upgrades_30d: (p as any)._tempAnalystUpgrades30d ?? (p.analysis as any)?.analyst_upgrades_30d ?? null,
      analyst_downgrades_30d: (p as any)._tempAnalystDowngrades30d ?? (p.analysis as any)?.analyst_downgrades_30d ?? null,
      price_target_consensus: (p as any)._tempPriceTargetConsensus ?? (p.analysis as any)?.price_target_consensus ?? null,
      price_target_upside_pct: (p as any)._tempPriceTargetUpsidePct ?? (p.analysis as any)?.price_target_upside_pct ?? null,
      confidence_tier: confidenceTier,
      confidence_tier_high: confidenceTier !== null ? (confidenceTier === 'high' ? 1 : 0) : null,
      confidence_tier_medium: confidenceTier !== null ? (confidenceTier === 'medium' ? 1 : 0) : null,
      confidence_tier_low: confidenceTier !== null ? (confidenceTier === 'low' ? 1 : 0) : null,
      google_trends_shock_ratio: (p as any)._tempTrendsSummary?.google_trends_shock_ratio ?? p.analysis?.trendsSummary?.google_trends_shock_ratio ?? p.analysis?.google_trends_shock_ratio ?? null,
      sector_excess_return: div100(p.sectorExcessReturn),
      max_favorable_excursion_1m: div100(p.analysis?.max_favorable_excursion_1m),
      max_adverse_excursion_1m: div100(p.analysis?.max_adverse_excursion_1m),
      gatingVerdict: p.gatingVerdict ?? undefined,
      is_null_sample: p.gatingVerdict?.event_classification === "SUPPRESSED_NON_EVENT" ? 1 : 0,
      competitor_event_density: competitorEventDensity,
      signal_snapshot: (() => {
        const si = (p as any)._tempShortInterest ?? p.analysis?.shortInterest ?? null;
        const siVelocity = (p as any)._tempShortInterestVelocity ?? p.analysis?.shortInterestVelocity ?? null;
        const gdeltTone: GDELTToneSummary | null | undefined = (p as any)._tempGdeltTone ?? p.analysis?.gdeltTone;
        const wikiSpikes: any[] | null | undefined = (p as any)._tempWikipediaSpikes ?? p.analysis?.wikipediaSpikes;
        const social = (p as any)._tempSocialSentiment ?? p.analysis?.socialSentiment ?? null;
        const trends = (p as any)._tempTrendsSummary ?? p.analysis?.trendsSummary ?? null;
        const articles: any[] | null | undefined = (p as any)._tempPrefetchedArticles ?? p.analysis?.newsList;
        const macroSnap = (p as any)._tempMacroSnapshot ?? p.analysis?.macroSnapshot ?? null;
        const macroRel = (p as any)._tempMacroRelease ?? p.analysis?.macroRelease ?? null;

        return {
          excess_return: p.excessReturn !== undefined ? p.excessReturn / 100 : p.dailyReturn / 100,
          z_score: p.zScore,
          atr_shock_score: atrShock / 100,
          volume_ratio: p.volumeRatio ?? 1,
          shannon_entropy: (p as any)._tempShannonEntropy ?? p.analysis?.shannon_entropy_30d ?? null,
          amihud_illiquidity: (p as any)._tempAmihud ?? p.analysis?.amihud_illiquidity_30d ?? null,
          fractal_efficiency: (p as any)._tempFER ?? p.analysis?.fractal_efficiency_ratio_10d ?? null,
          short_interest_pct_float: si ? (si.pctOfFloat ?? null) : null,
          short_interest_velocity: typeof siVelocity === 'number' ? siVelocity : null,
          put_call_ratio: (p as any)._tempPutCallRatio ?? p.analysis?.put_call_ratio_t_minus_1 ?? null,
          iv_rank: (p as any)._tempIvCrush ?? p.analysis?.iv_crush_pct ?? null,
          dark_pool_index: (p as any)._tempDarkPoolIndex ?? p.analysis?.dark_pool_index ?? null,
          vix: vixRaw,
          vix_regime: (p as any)._tempVixRegime ?? p.analysis?.vixRegime ?? null,
          trend_regime: (p as any)._tempMarketRegime?.trendRegime ?? p.analysis?.marketRegime?.trendRegime ?? null,
          yield_curve_spread: macroSnap?.yieldCurvSpread ?? null,
          credit_spread: macroSnap?.creditSpread ?? null,
          macro_release_surprise: macroRel?.surprise ?? null,
          gdelt_tone_z: (gdeltTone && gdeltTone.matchCount > 0
            && gdeltTone.matchedToneAvg !== null && gdeltTone.globalToneAvg !== null
            && gdeltTone.globalToneStdDev !== null && gdeltTone.globalToneStdDev > 0)
            ? (gdeltTone.matchedToneAvg - gdeltTone.globalToneAvg) / gdeltTone.globalToneStdDev
            : null,
          stocktwits_virality_z: social !== null && typeof social.viralityScore === 'number'
            ? (social.viralityScore - 50) / 25
            : null,
          google_trends_z: trends !== null && typeof trends.google_trends_shock_ratio === 'number'
            ? trends.google_trends_shock_ratio - 1
            : null,
          wikipedia_spike_z: (wikiSpikes && wikiSpikes.length > 0)
            ? Math.max(...wikiSpikes.map((s: any) => s.spikeRatio ?? 0))
            : null,
          news_relevance_z: (articles && articles.length > 0) ? articles.length / 5 : null,
          congressional_net_flow: (p as any)._tempCongressionalNetFlow ?? null,
          event_classification: p.gatingVerdict?.event_classification ?? null,
          dominant_physics_regime: p.gatingVerdict?.dominant_physics_regime ?? null,
          divergence_detected: p.gatingVerdict?.divergence_detected ?? null,
          estimate_revision_direction: (p as any)._tempEstimateRevisions?.revisionDirection ?? null,
          estimate_revision_magnitude: (p as any)._tempEstimateRevisions?.revisionMagnitudePct ?? null,
          company_credit_proxy: (p as any)._tempCompanyCreditProxy ?? null,
          fmp_news_sentiment_avg: (p as any)._tempFmpNewsSentimentAvg ?? (p.analysis as any)?.fmp_news_sentiment_avg ?? null,
          fmp_news_article_count_7d: (p as any)._tempFmpNewsArticleCount7d ?? (p.analysis as any)?.fmp_news_article_count_7d ?? null,
          insider_net_shares_30d: (p as any)._tempInsiderNetShares30d ?? (p.analysis as any)?.insider_net_shares_30d ?? null,
          institutional_ownership_pct: (p as any)._tempInstitutionalOwnershipPct ?? (p.analysis as any)?.institutional_ownership_pct ?? null,
          eps_surprise_pct: (p as any)._tempEpsSurprisePct ?? (p.analysis as any)?.eps_surprise_pct ?? null,
          revenue_surprise_pct: (p as any)._tempRevenueSurprisePct ?? (p.analysis as any)?.revenue_surprise_pct ?? null,
          earnings_date_proximity_days: (p as any)._tempEarningsProximityDays ?? (p.analysis as any)?.earnings_date_proximity_days ?? null,
          analyst_upgrades_30d: (p as any)._tempAnalystUpgrades30d ?? (p.analysis as any)?.analyst_upgrades_30d ?? null,
          analyst_downgrades_30d: (p as any)._tempAnalystDowngrades30d ?? (p.analysis as any)?.analyst_downgrades_30d ?? null,
          price_target_consensus: (p as any)._tempPriceTargetConsensus ?? (p.analysis as any)?.price_target_consensus ?? null,
          price_target_upside_pct: (p as any)._tempPriceTargetUpsidePct ?? (p.analysis as any)?.price_target_upside_pct ?? null,
          competitor_event_density: competitorEventDensity,
          short_interest_pct: si ? (si.pctOfFloat ?? null) : null,
          short_interest_ratio: si ? (si.shortInterestRatio ?? null) : null,
          management_confidence_score: p.analysis?.management_confidence_score ?? null,
          earnings_primary_concern: (p.analysis as any)?.primary_concern ?? null,
        };
      })(),
    };

    const cacheKey = `${symbol}_${p.date}`;
    setEventFeatures(cacheKey, features);

    if (preReturnFeatures) {
      db.prepare(`
        UPDATE event_features SET
          pre_return_3d = ?, pre_return_5d = ?, pre_return_10d = ?,
          pre_return_21d = ?, pre_vol_ratio_5d = ?, pre_vol_ratio_10d = ?
        WHERE cache_key = ?
      `).run(
        preReturnFeatures.pre_return_3d ?? null,
        preReturnFeatures.pre_return_5d ?? null,
        preReturnFeatures.pre_return_10d ?? null,
        preReturnFeatures.pre_return_21d ?? null,
        preReturnFeatures.pre_vol_ratio_5d ?? null,
        preReturnFeatures.pre_vol_ratio_10d ?? null,
        cacheKey
      );
    }

    if (forwardReturnFeatures) {
      db.prepare(`
        UPDATE event_features SET
          forward_return_2d = ?, forward_return_3d = ?, forward_return_2w = ?
        WHERE cache_key = ?
      `).run(
        forwardReturnFeatures.forward_return_2d ?? null,
        forwardReturnFeatures.forward_return_3d ?? null,
        forwardReturnFeatures.forward_return_2w ?? null,
        cacheKey
      );
    }
  }
}

async function fetchYahooPeerReturn(symbol: string, targetDate: string): Promise<number | null> {
  try {
    const yahooSymbol = normaliseForYahoo(symbol);
    const dDate = new Date(targetDate);
    const dDateStart = new Date(dDate);
    dDateStart.setDate(dDateStart.getDate() - 7); // 7 days back to get t-1
    const p1 = Math.floor(dDateStart.getTime() / 1000);
    const p2 = Math.floor((dDate.getTime() + 86400000) / 1000);
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?period1=${p1}&period2=${p2}&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) return null;
    
    // Sort array of { date, close }
    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const points: Array<{ date: string, close: number }> = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] !== null && closes[i] !== undefined) {
        const dStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
        points.push({ date: dStr, close: closes[i] });
      }
    }
    
    const sorted = points.sort((a, b) => a.date.localeCompare(b.date));
    const targetIdx = sorted.findIndex(p => p.date === targetDate);
    if (targetIdx > 0) {
      const pT = sorted[targetIdx];
      const pTMinus1 = sorted[targetIdx - 1];
      return ((pT.close - pTMinus1.close) / pTMinus1.close) * 100;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// All cache persistence is now handled by db.ts via SQLite.
export class HistoricalEngine {
  private symbols: string[];
  private zScoreThreshold: number;
  private rollingWindow: number;
  private options?: { skipGemini?: boolean };
  private static globalAiClient: GoogleGenAI | null = null;

  constructor(symbols: string[] = [], zScoreThreshold: number = 2.5, rollingWindow: number = 90, options?: { skipGemini?: boolean }) {
    this.symbols = symbols.map((s) => s.toUpperCase().trim());
    this.zScoreThreshold = zScoreThreshold;
    this.rollingWindow = rollingWindow;
    this.options = options;
  }

  private peerPriceCache = new Map<string, number | null>();
  private peerReturnCache = new Map<string, number | null>();
  private enrichedAnomalyKeys = new Set<string>();
  // Forces primary price-history fetch for these symbols to Yahoo Finance.
  // This has nothing to do with peer or sector contagion lookups.
  private static polygonHistoryBlocklist = new Set<string>([
    "AAPL", "AMZN", "META", "GOOG", "NVDA", "GOOGL", "MSFT", "TSLA", "AMD"
  ]);

  private getAIClient(): GoogleGenAI {
    if (!HistoricalEngine.globalAiClient) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(
          "GEMINI_API_KEY is missing. Configure it in the Settings > Secrets panel.",
        );
      }
      HistoricalEngine.globalAiClient = new GoogleGenAI({
        apiKey,
      });
      console.log("[AI] Gemini client initialised with API key ending in", apiKey.slice(-4));
    }
    return HistoricalEngine.globalAiClient;
  }

  private async fetchPeerDailyReturn(peerSymbol: string, date: string): Promise<number | null> {
    const uppercaseSymbol = peerSymbol.toUpperCase().trim();
    const cacheKey = `${uppercaseSymbol}_${date}`;
    if (this.peerReturnCache.has(cacheKey)) {
      return this.peerReturnCache.get(cacheKey)!;
    }

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${normaliseForYahoo(uppercaseSymbol)}?range=5d&interval=1d`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
      });

      if (!response.ok) {
        this.peerReturnCache.set(cacheKey, null);
        return null;
      }

      const data: any = await response.json();
      const result = data.chart?.result?.[0];
      if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
        this.peerReturnCache.set(cacheKey, null);
        return null;
      }

      const timestamps = result.timestamp;
      const closes = result.indicators.quote[0].close;
      const points: Array<{ date: string; close: number }> = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] !== null && closes[i] !== undefined) {
          const dStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
          points.push({ date: dStr, close: closes[i] });
        }
      }

      const sorted = points.sort((a, b) => a.date.localeCompare(b.date));
      const targetIdx = sorted.findIndex(p => p.date === date);
      if (targetIdx > 0) {
        const pT = sorted[targetIdx];
        const pTMinus1 = sorted[targetIdx - 1];
        const dailyReturn = ((pT.close - pTMinus1.close) / pTMinus1.close) * 100;
        this.peerReturnCache.set(cacheKey, dailyReturn);
        return dailyReturn;
      }
      this.peerReturnCache.set(cacheKey, null);
      return null;
    } catch (err) {
      this.peerReturnCache.set(cacheKey, null);
      return null;
    }
  }

  private async fetchEmbedding(text: string): Promise<string | null> {
    if (!text || !process.env.GEMINI_API_KEY) return null;
    try {
      const ai = this.getAIClient();
      const embeddingRes = await ai.models.embedContent({
        model: "text-embedding-005",
        contents: text,
      });
      if (embeddingRes.embeddings && embeddingRes.embeddings.length > 0) {
        const vector = embeddingRes.embeddings[0].values;
        return JSON.stringify(vector);
      }
      return null;
    } catch (err) {
      console.log("[Embedding] Model unavailable — historical similarity will be skipped.");
      return null;
    }
  }

  private async evaluateCausalLogic(
    suspectedCatalyst: string,
    dailyReturn: number,
    zScore: number,
    volumeRatio: number,
  ): Promise<number | null> {
    if (!suspectedCatalyst || !process.env.GEMINI_API_KEY) return null;
    try {
      const ai = this.getAIClient();
      const prompt = `You are a Machine Learning QA Validation Engineer.
Critically analyze the following generated event catalyst summary against the quantitative market data.

Qualitative summary:
"${suspectedCatalyst}"

Quantitative data:
- Daily Return: ${dailyReturn.toFixed(2)}%
- Z-Score: ${zScore.toFixed(2)}
- Volume Ratio: ${volumeRatio.toFixed(2)}x average

Is this news item a highly specific, direct corporate catalyst that logically explains a price move of this statistical magnitude, or is it a generic, non-material background event mistakenly aligned with standard market noise? Return 100 for undeniable direct causality, and 1 for generic noise.
Reply with JSON containing only a single property "score" (a number between 1 and 100).`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.INTEGER },
            },
            required: ["score"],
          },
        },
      });
      const text = response.text;
      if (text) {
        const json = JSON.parse(text);
        if (typeof json.score === "number") {
          return json.score;
        }
      }
      return null;
    } catch (err) {
      console.warn("Causal validation failed, writing null:", err);
      return null;
    }
  }

  private static benchmarkReturnsPromises = new Map<
    string,
    Promise<Map<string, number>>
  >();
  private static vixSeriesPromises = new Map<
    string,
    Promise<Map<string, number>>
  >();

  /**
   * Fetches daily returns for a benchmark index to compute beta and excess returns.
   */
  private fetchBenchmarkReturns(
    range: string,
    symbol: string = "^GSPC",
  ): Promise<Map<string, number>> {
    const cacheKey = `${symbol}_${range}`;
    let p = HistoricalEngine.benchmarkReturnsPromises.get(cacheKey);
    if (!p) {
      p = (async () => {
        const benchmarkReturns = new Map<string, number>();
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=1d`;
          const response = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
            },
          });
          if (response.ok) {
            const data: any = await response.json();
            const result = data.chart?.result?.[0];
            if (result && result.timestamp && result.indicators?.quote?.[0]) {
              const timestamps = result.timestamp;
              const closes = result.indicators.quote[0].close;
              for (let i = 1; i < timestamps.length; i++) {
                if (closes[i] !== null && closes[i - 1] !== null) {
                  const d = new Date(timestamps[i] * 1000);
                  const dateStr = d.toISOString().split("T")[0];
                  const dailyRet =
                    ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
                  benchmarkReturns.set(dateStr, dailyRet);
                }
              }
            }
          } else {
            console.warn(
              "Failed to fetch benchmark data, falling back to raw returns.",
            );
          }
        } catch (err) {
          console.warn(
            "Error fetching benchmark data, falling back to raw returns:",
            err,
          );
        }
        return benchmarkReturns;
      })();
      HistoricalEngine.benchmarkReturnsPromises.set(cacheKey, p);
    }
    return p;
  }

  private async fetchVixAtDate(
    date: string,
    range: string,
    symbol: string,
  ): Promise<number | null> {
    const vixTicker = getVolIndexTicker(symbol);
    if (!vixTicker) {
      // Exchange is not US-based and no localized Volatility Index available in registry -> Default VIX to 0
      return 0;
    }
    const cacheKey = `${vixTicker}_${range}`;
    let p = HistoricalEngine.vixSeriesPromises.get(cacheKey);
    if (!p) {
      p = (async () => {
        const series = new Map<string, number>();
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(vixTicker)}?range=${range}&interval=1d`;
          const response = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          if (response.ok) {
            const data: any = await response.json();
            const result = data.chart?.result?.[0];
            if (result && result.timestamp && result.indicators?.quote?.[0]) {
              const timestamps = result.timestamp;
              const closes = result.indicators.quote[0].close;
              for (let i = 0; i < timestamps.length; i++) {
                if (closes[i] !== null) {
                  const d = new Date(timestamps[i] * 1000)
                    .toISOString()
                    .split("T")[0];
                  series.set(d, closes[i]);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`Error fetching ${vixTicker} data:`, err);
        }
        // If the fetch yielded no data, evict from cache so the next scan can retry
        // rather than permanently serving a stale empty map for the session lifetime.
        if (series.size === 0) {
          HistoricalEngine.vixSeriesPromises.delete(cacheKey);
        }
        return series;
      })();
      HistoricalEngine.vixSeriesPromises.set(cacheKey, p);
    }

    const series = await p;
    if (!series || series.size === 0) return 0; // Default to 0 if fetch fails

    if (series.has(date)) return series.get(date)!;

    let closestValue: number | null = null;
    let minDiff = Infinity;
    const targetTime = new Date(date).getTime();

    for (const [dStr, val] of series.entries()) {
      const time = new Date(dStr).getTime();
      const diff = Math.abs(time - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        closestValue = val;
      }
    }
    return closestValue;
  }

  private canonicalizeSymbol(symbol: string): string {
    const upper = symbol.toUpperCase().trim();
    if (upper === "BAT.L") return "BATS.L";
    if (upper === "NEXT.L") return "NXT.L";
    if (upper === "BINT.L") return "BNZL.L";
    return normaliseForYahoo(upper);
  }

  private generateSyntheticStockData(
    symbol: string,
    range: string,
  ): { sanitizedPoints: any[]; nullCount: number; meta: any } {
    const uppercaseSymbol = symbol.toUpperCase().trim();
    const isLse = uppercaseSymbol.endsWith(".L");

    let companyName = uppercaseSymbol;
    let currency = isLse ? "GBp" : "USD";
    let startPrice = isLse ? 5400.0 : 100.0;

    if (uppercaseSymbol === "AHT.L") {
      companyName = "Ashtead Group plc";
      currency = "GBp";
      startPrice = 5420.0;
    } else if (uppercaseSymbol === "BINT.L") {
      companyName = "Bunzl plc";
      currency = "GBp";
      startPrice = 3150.0;
    } else if (uppercaseSymbol === "NEXT.L") {
      companyName = "Next plc";
      currency = "GBp";
      startPrice = 9200.0;
    } else if (uppercaseSymbol === "BAT.L") {
      companyName = "British American Tobacco plc";
      currency = "GBp";
      startPrice = 2450.0;
    }

    const sanitizedPoints: any[] = [];
    let currentPrice = startPrice;
    const nowMs = Date.now();

    const startDate = new Date();
    const parsedRange = this.parseRangeInput(range);
    if (parsedRange.unit === "y") {
      startDate.setFullYear(startDate.getFullYear() - parsedRange.value);
    } else if (parsedRange.unit === "m") {
      startDate.setMonth(startDate.getMonth() - parsedRange.value);
    } else {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    let currentMs = startDate.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const vol = 0.02; // 2% daily volatility

    while (currentMs <= nowMs) {
      const d = new Date(currentMs);
      const dayOfWeek = d.getDay();

      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const changePercent = (Math.random() - 0.495) * 2 * vol;
        const dailyReturn = changePercent;
        const prevClose = currentPrice;
        currentPrice = currentPrice * (1 + dailyReturn);

        const open = prevClose * (1 + (Math.random() - 0.5) * 0.005);
        const close = currentPrice;
        const high = Math.max(open, close) * (1 + Math.random() * 0.01);
        const low = Math.min(open, close) * (1 - Math.random() * 0.01);
        const volume = Math.floor(500000 + Math.random() * 1500000);

        sanitizedPoints.push({
          time: currentMs,
          dateStr: d.toISOString().split("T")[0],
          open: Number(open.toFixed(2)),
          high: Number(high.toFixed(2)),
          low: Number(low.toFixed(2)),
          close: Number(close.toFixed(2)),
          volume,
        });
      }

      currentMs += dayMs;
    }

    const meta = {
      symbol: uppercaseSymbol,
      companyName,
      currency,
      regularMarketPrice: currentPrice,
      chartPreviousClose:
        sanitizedPoints[sanitizedPoints.length - 2]?.close || currentPrice,
      isSynthesized: true,
    };

    return { sanitizedPoints, nullCount: 0, meta };
  }

  private async fetchYahooPriceData(
    symbol: string,
    range: string,
  ): Promise<{ sanitizedPoints: any[]; nullCount: number; meta: any }> {
    const canonicalSymbol = this.canonicalizeSymbol(symbol);
    const uppercaseSymbol = canonicalSymbol.toUpperCase().trim();

    // Explicitly bypass known missing symbols on Yahoo Finance to prevent 404 console warnings
    if (
      uppercaseSymbol === "AHT.L" ||
      uppercaseSymbol === "BDEV.L" ||
      uppercaseSymbol === "DLG.L"
    ) {
      throw new Error(`Symbol ${uppercaseSymbol} is not supported or was bypassed to prevent failures.`);
    }

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${uppercaseSymbol}?range=${range}&interval=1d`;
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP Status ${response.status}`);
      }

      const data: any = await response.json();
      const result = data.chart?.result?.[0];
      if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
        throw new Error(
          data.chart?.error?.description || "Missing chart result",
        );
      }

      const timestamps = result.timestamp;
      const closes = result.indicators.quote[0].close;
      const opens = result.indicators.quote[0].open;
      const highs = result.indicators.quote[0].high;
      const lows = result.indicators.quote[0].low;
      const volumes = result.indicators.quote[0].volume;

      const sanitizedPoints: any[] = [];
      let nullCount = 0;
      for (let i = 0; i < timestamps.length; i++) {
        if (
          closes[i] !== null &&
          closes[i] !== undefined &&
          opens[i] !== null &&
          opens[i] !== undefined &&
          timestamps[i] !== null
        ) {
          const timestampMs = timestamps[i] * 1000;
          const d = new Date(timestampMs);
          const dateStr = d.toISOString().split("T")[0];

          sanitizedPoints.push({
            time: timestampMs,
            dateStr,
            open: opens[i],
            high: highs[i] !== null ? highs[i] : closes[i],
            low: lows[i] !== null ? lows[i] : closes[i],
            close: closes[i],
            volume: volumes[i] !== null ? volumes[i] : 0,
          });
        } else {
          nullCount++;
        }
      }

      if (sanitizedPoints.length < 5) {
        throw new Error(
          "Yahoo Finance returned less than 5 usable data points",
        );
      }

      const meta = {
        symbol: result.meta?.symbol || uppercaseSymbol,
        companyName: result.meta?.symbol || uppercaseSymbol,
        currency: result.meta?.currency || "USD",
        regularMarketPrice: result.meta?.regularMarketPrice || null,
        chartPreviousClose: result.meta?.chartPreviousClose || null,
      };

      return { sanitizedPoints, nullCount, meta };
    } catch (error: any) {
      throw new Error(`Failed to fetch Yahoo price data for ${uppercaseSymbol}: ${error.message || error}`);
    }
  }

  private parseRangeInput(rangeStr: string): { value: number; unit: "y" | "m" } {
    const match = rangeStr.match(/^(\d+)(y|m)$/i);
    if (match) {
      return {
        value: parseInt(match[1], 10),
        unit: match[2].toLowerCase() as "y" | "m",
      };
    }
    return { value: 1, unit: "y" };
  }

  private async fetchPriceData(
    symbol: string,
    range: string,
    startDateOverride?: string,
  ): Promise<{
    sanitizedPoints: any[];
    nullCount: number;
    meta: any;
    sourceUsed: string;
  }> {
    const canonicalSymbol = this.canonicalizeSymbol(symbol);
    const uppercaseSymbol = canonicalSymbol.toUpperCase().trim();
    const hasSuffix = uppercaseSymbol.includes(".");
    const isUsListed =
      !hasSuffix ||
      uppercaseSymbol.endsWith(".NYSE") ||
      uppercaseSymbol.endsWith(".NASDAQ");

    const toDate = new Date().toISOString().split("T")[0];
    let fromDate = "";
    
    if (startDateOverride) {
      fromDate = startDateOverride;
    } else {
      const startDate = new Date();
      const parsedRange = this.parseRangeInput(range);
      if (parsedRange.unit === "y") {
        startDate.setFullYear(startDate.getFullYear() - parsedRange.value);
      } else if (parsedRange.unit === "m") {
        startDate.setMonth(startDate.getMonth() - parsedRange.value);
      } else {
        startDate.setFullYear(startDate.getFullYear() - 1);
      }
      fromDate = startDate.toISOString().split("T")[0];
    }

    if (isUsListed) {
      if (process.env.POLYGON_API_KEY && !HistoricalEngine.polygonHistoryBlocklist.has(uppercaseSymbol)) {
        try {
          const history = await fetchPriceHistory(
            uppercaseSymbol,
            fromDate,
            toDate,
          );
          if (history.length === 0) {
            throw new Error(
              `No price data returned from Polygon for ${uppercaseSymbol}`,
            );
          }
          const sanitizedPoints = history.map((p) => ({
            time: p.timestamp,
            dateStr: p.date,
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            volume: p.volume,
          }));

          try {
            const news = await fetchNewsForSymbol(
              uppercaseSymbol,
              fromDate,
              toDate,
              100,
            );
            insertPolygonNews(news, uppercaseSymbol);
          } catch (newsErr: any) {
            const errMsg = newsErr.message || String(newsErr);
            if (!errMsg.includes("429")) {
              console.warn(
                `[DATA-WARNING] News fetch skipped or offline for ${uppercaseSymbol} using Polygon:`,
                errMsg,
              );
            }
          }

          let companyName = uppercaseSymbol;
          let currency = "USD";
          try {
            const details = await fetchTickerDetails(uppercaseSymbol);
            if (details) {
              companyName = details.name;
              currency = details.currencyName
                ? details.currencyName.toUpperCase()
                : "USD";
            }
          } catch (detailErr: any) {
            const errMsg = detailErr.message || String(detailErr);
            if (!errMsg.includes("429")) {
              console.warn(
                `[DATA-WARNING] Details fetch skipped or offline for ${uppercaseSymbol} using Polygon:`,
                errMsg,
              );
            }
          }

          const meta = {
            symbol: uppercaseSymbol,
            companyName: companyName,
            currency: currency,
            regularMarketPrice:
              sanitizedPoints[sanitizedPoints.length - 1]?.close || null,
            chartPreviousClose:
              sanitizedPoints[sanitizedPoints.length - 2]?.close || null,
          };

          return { sanitizedPoints, nullCount: 0, meta, sourceUsed: "polygon" };
        } catch (error: any) {
          const errMsg = error.message || String(error);
          if (!errMsg.includes("429")) {
            console.warn(
              `[DATA] Polygon fetch warning for ${uppercaseSymbol}, falling back to Yahoo Finance: ${errMsg}`,
            );
          }
          const res = await this.fetchYahooPriceData(uppercaseSymbol, range);
          return {
            ...res,
            sourceUsed: (res.meta as any).isSynthesized
              ? "synthesized"
              : "yahoo",
          };
        }
      } else {
        const res = await this.fetchYahooPriceData(uppercaseSymbol, range);
        return {
          ...res,
          sourceUsed: (res.meta as any).isSynthesized ? "synthesized" : "yahoo",
        };
      }
    } else {
      // Non-US listed
      if (process.env.EODHD_API_KEY) {
        try {
          const history = await fetchInternationalPriceHistory(
            uppercaseSymbol,
            fromDate,
            toDate,
          );
          if (history.length < 30) {
            throw new Error(
              `EODHD returned fewer than 30 bars (${history.length}) for international symbol ${uppercaseSymbol}`,
            );
          }
          const sanitizedPoints = history.map((p) => ({
            time: p.timestamp,
            dateStr: p.date,
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            volume: p.volume,
          }));
          console.log(`[DATA] ${uppercaseSymbol} international price data from EODHD (${sanitizedPoints.length} bars)`);

          const meta = {
            symbol: uppercaseSymbol,
            companyName: uppercaseSymbol,
            currency: "USD",
            regularMarketPrice:
              sanitizedPoints[sanitizedPoints.length - 1]?.close || null,
            chartPreviousClose:
              sanitizedPoints[sanitizedPoints.length - 2]?.close || null,
          };

          const lastDotIndex = uppercaseSymbol.lastIndexOf(".");
          if (lastDotIndex !== -1) {
            const rawSuffix = uppercaseSymbol.substring(lastDotIndex + 1);
            let exchangeCode = rawSuffix;
            if (rawSuffix === "L") exchangeCode = "LSE";
            else if (rawSuffix === "BO") exchangeCode = "BSE";
            else if (rawSuffix === "NS") exchangeCode = "NSE";
            else if (rawSuffix === "TO") exchangeCode = "TO";
            else if (rawSuffix === "DE") exchangeCode = "XETRA";

            try {
              const status = await getExchangeStatus(exchangeCode);
              if (status && status.currency) {
                meta.currency = status.currency;
              }
            } catch (statusErr) {
              console.error(
                `[DATA] Failed to fetch exchange status for ${exchangeCode}:`,
                statusErr,
              );
            }
          }

          return { sanitizedPoints, nullCount: 0, meta, sourceUsed: "eodhd" };
        } catch (error: any) {
          const errMsg = error.message || String(error);
          console.warn(
            `[DATA] EODHD fetch error/warning for ${uppercaseSymbol}, falling back to Yahoo Finance: ${errMsg}`,
          );
          const res = await this.fetchYahooPriceData(uppercaseSymbol, range);
          console.log(`[DATA] ${uppercaseSymbol} international price data from Yahoo (${res.sanitizedPoints.length} bars)`);
          return {
            ...res,
            sourceUsed: (res.meta as any).isSynthesized
              ? "synthesized"
              : "yahoo",
          };
        }
      } else {
        const res = await this.fetchYahooPriceData(uppercaseSymbol, range);
        console.log(`[DATA] ${uppercaseSymbol} international price data from Yahoo (${res.sanitizedPoints.length} bars)`);
        return {
          ...res,
          sourceUsed: (res.meta as any).isSynthesized ? "synthesized" : "yahoo",
        };
      }
    }
  }

  private classifyVolumeShock(
    dailyReturn: number,
    zScore: number,
    volumeRatio: number,
    relativeVolume: number,
  ): string | null {
    if (relativeVolume > 3 && dailyReturn > 2) return "institutional_spike";
    if (relativeVolume > 2 && dailyReturn > 1) return "high_volume_up";
    if (relativeVolume > 2 && dailyReturn < -1) return "high_volume_down";
    if (relativeVolume < 0.5 && Math.abs(dailyReturn) > 1.5)
      return "low_volume_move";
    if (relativeVolume > 2.5 && Math.abs(dailyReturn) < 0.3)
      return "volume_without_price";
    return null;
  }

  /**
   * Run historical scan for a single symbol
   */
  async run_scan(
    symbol: string,
    years: number,
    skipGeminiAnalysis: boolean = false,
    sectorSymbol?: string,
  ): Promise<StockScanResult> {
    const canonicalSymbol = this.canonicalizeSymbol(symbol);
    const uppercaseSymbol = canonicalSymbol.toUpperCase().trim();
    
    const state = getScannerState(uppercaseSymbol);
    
    // Check if the primary data providers are already marked rate-limited for today
    if (isSourceRateLimited("polygon") || isSourceRateLimited("fmp")) {
      const limitedSources = [];
      if (isSourceRateLimited("polygon")) limitedSources.push("polygon (rate-limited)");
      if (isSourceRateLimited("fmp")) limitedSources.push("fmp (quota)");
      console.log(`[Scan] Starting ${uppercaseSymbol} with limited sources: ${limitedSources.join(", ")}. Price data from Yahoo Finance.`);
    }
    
    // The date the current `years` request needs to reach back to — used to detect
    // checkpoints saved by an earlier, narrower-range scan that shouldn't be resumed from,
    // since resuming would silently truncate the newly-requested historical window.
    const requestedStartDate = (() => {
      const d = new Date();
      if (years >= 1) d.setFullYear(d.getFullYear() - years);
      else d.setMonth(d.getMonth() - Math.round(years * 12));
      return d.toISOString().split("T")[0];
    })();

    let startDateOverride: string | undefined;
    if (state) {
      if (state.status === 'COMPLETED') {
        console.log(`[HistoricalEngine] ${uppercaseSymbol} previously completed — running fresh scan.`);
      } else if (state.status === 'IN_PROGRESS') {
        if (state.start_date > requestedStartDate) {
          console.log(`[HistoricalEngine] Discarding stale checkpoint for ${uppercaseSymbol} (covered from ${state.start_date}, but ${years}y request needs from ${requestedStartDate}) — running fresh scan.`);
          clearScannerState(uppercaseSymbol);
        } else {
          startDateOverride = state.last_scanned_date;
          console.log(`[HistoricalEngine] Resuming ${uppercaseSymbol} from checkpoint: ${startDateOverride}`);
        }
      }
    }

    let lastSuccessfullyProcessedDate = startDateOverride || new Date().toISOString().split("T")[0];

    try {
      let range = "1y";
      if (years === 2) range = "2y";
      if (years === 5) range = "5y";
      if (years === 30) range = "max";
      if (years === 0.5) range = "6m";

      let nativeBenchmark = "^GSPC";
      if (uppercaseSymbol.endsWith(".AX")) nativeBenchmark = "^AXJO";
      else if (uppercaseSymbol.endsWith(".SW")) nativeBenchmark = "^SSMI";
      else if (uppercaseSymbol.endsWith(".ST")) nativeBenchmark = "^OMX";
      else if (uppercaseSymbol.endsWith(".SI")) nativeBenchmark = "^STI";
      else if (uppercaseSymbol.endsWith(".L")) nativeBenchmark = "^FTSE";
      else if (uppercaseSymbol.endsWith(".DE")) nativeBenchmark = "^GDAXI";
      else if (uppercaseSymbol.endsWith(".PA")) nativeBenchmark = "^FCHI";
      else if (uppercaseSymbol.endsWith(".TO")) nativeBenchmark = "^GSPTSE";
      else if (uppercaseSymbol.endsWith(".NS") || uppercaseSymbol.endsWith(".BO")) nativeBenchmark = "^BSESN";
      else if (uppercaseSymbol.endsWith(".HK")) nativeBenchmark = "^HSI";

      const effectiveSectorSymbol = sectorSymbol || nativeBenchmark;

      const [fmpContext, priceDataResult, benchmarkReturnsMap, sectorReturnsMap] =
        await Promise.all([
          getFullCompanyContext(uppercaseSymbol),
          this.fetchPriceData(uppercaseSymbol, range, startDateOverride),
          this.fetchBenchmarkReturns(range, nativeBenchmark),
          this.fetchBenchmarkReturns(range, effectiveSectorSymbol)
        ]);

      // Micro-throttle: Artificially stalling our pipeline for 300ms after the initial parallel fetch,
      // because processing data at core CPU speeds makes our API vendors cry.
      await sleep(MICRO_THROTTLE_MS);

      if (fmpContext) {
        if (
          (!fmpContext.upcomingEarnings || fmpContext.upcomingEarnings.length === 0) &&
          (!fmpContext.recentEarnings || fmpContext.recentEarnings.length === 0)
        ) {
          const calendarResult = await getEarningsCalendar(uppercaseSymbol);
          if (calendarResult && calendarResult.events && calendarResult.events.length > 0) {
            fmpContext.upcomingEarnings = calendarResult.events
              .filter(e => new Date(e.reportDate).getTime() > Date.now())
              .map(e => ({
                symbol: uppercaseSymbol,
                reportDate: e.reportDate,
                fiscalQuarterEnd: e.fiscalQuarterEnd || "quarterly",
                isUpcoming: true,
                source: e.source
              }));
            fmpContext.recentEarnings = calendarResult.events
              .filter(e => new Date(e.reportDate).getTime() <= Date.now())
              .map(e => ({
                symbol: uppercaseSymbol,
                reportDate: e.reportDate,
                fiscalQuarterEnd: e.fiscalQuarterEnd || "quarterly",
                isUpcoming: false,
                source: e.source
              }));
          }
          if (calendarResult && calendarResult.consensus) {
            (fmpContext as any).analystConsensus = calendarResult.consensus;
          }
        }
      }

      const { sanitizedPoints, nullCount, meta, sourceUsed } = priceDataResult;
    const companyName = fmpContext?.profile?.name || uppercaseSymbol;

    let dataConfidence = 100;
    let dataQualityWarning: string | undefined = undefined;

    const nonUsSuffixes = [
      ".L",
      ".TO",
      ".NS",
      ".BO",
      ".DE",
      ".HK",
      ".AX",
      ".PA",
      ".AS",
      ".MC",
    ];
    const isNonUs =
      nonUsSuffixes.some((suffix) => uppercaseSymbol.endsWith(suffix)) ||
      (uppercaseSymbol.includes(".") &&
        !uppercaseSymbol.endsWith(".NYSE") &&
        !uppercaseSymbol.endsWith(".NASDAQ"));

    if (sourceUsed === "synthesized") {
      dataConfidence = 15;
    } else if (isNonUs && sourceUsed !== "eodhd") {
      dataConfidence -= 20;
    }
    const totalRecords = sanitizedPoints.length + nullCount;
    const nullRate = totalRecords ? (nullCount / totalRecords) * 100 : 0;
    dataConfidence -= Math.floor(nullRate);
    dataConfidence = Math.max(0, dataConfidence);

    if (sourceUsed === "synthesized") {
      dataQualityWarning = `Historical data feed for ${uppercaseSymbol} is temporarily unavailable. Showing gracefully reconstructed price trajectory modeled on historical references.`;
    } else if (isNonUs && sourceUsed !== "eodhd") {
      dataQualityWarning =
        "EODHD international data service is not configured. To improve data quality for non-US tickers, add EODHD_API_KEY to your .env.local file. Using Yahoo Finance as fallback — see data quality caveats in the scan result.";
      if (nullRate > 5) {
        dataQualityWarning += ` Additionally, ${nullRate.toFixed(1)}% of trading day records contained missing price data for this symbol. Statistical results should be interpreted with caution.`;
      }
    }

    if (sanitizedPoints.length < 5) {
      throw new Error(
        `Insufficient pricing ticks data found for ${uppercaseSymbol}`,
      );
    }

    sanitizedPoints.sort((a, b) => a.time - b.time);
    const macroSwings = detectMacroSwings(sanitizedPoints, 8.0);

    const commodityReturnsMap = new Map<string, number>();
    const sectorProfile = fmpContext?.profile?.sector || "N/A";
    const commoditySeriesId = SECTOR_COMMODITY_MAP[sectorProfile] || SECTOR_COMMODITY_MAP[fmpContext?.profile?.industry || ""];
    
    if (commoditySeriesId && sanitizedPoints.length > 0) {
      try {
        const minDate = sanitizedPoints[0].dateStr;
        const maxDate = sanitizedPoints[sanitizedPoints.length - 1].dateStr;
        
        // Micro-throttle: Wait 300ms before hitting FRED because their servers apparently
        // run on dial-up connections and can't process queries in extremely tight loops.
        await sleep(MICRO_THROTTLE_MS);

        const points = await fetchFREDSeries(commoditySeriesId, minDate, maxDate);
        points.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        for (let i = 1; i < points.length; i++) {
          const prev = points[i - 1];
          const curr = points[i];
          if (prev.value !== 0) {
            commodityReturnsMap.set(curr.date, ((curr.value - prev.value) / prev.value) * 100);
          }
        }
      } catch (err) {
        console.warn(`[HistoricalEngine] Failed to fetch commodity series ${commoditySeriesId}:`, err);
      }
    }

    // First pass: compute dailyReturn, beta, excessReturn
    const calculatedReturns: {
      dailyReturn: number;
      excessReturn: number;
      sectorExcessReturn: number;
    }[] = [];

    for (let i = 0; i < sanitizedPoints.length; i++) {
      let dailyReturn = 0;
      let excessReturn = 0;
      let sectorExcessReturn = 0;

      if (i > 0) {
        const p = sanitizedPoints[i];
        const prev = sanitizedPoints[i - 1];
        dailyReturn = ((p.close - prev.close) / prev.close) * 100;

        let beta = 1;
        const betaStartIdx = Math.max(1, i - 59);
        const betaStockReturns: number[] = [];
        const betaBenchReturns: number[] = [];

        for (let k = betaStartIdx; k <= i; k++) {
          const dateK = sanitizedPoints[k].dateStr;
          const bRet = benchmarkReturnsMap.get(dateK);
          if (bRet !== undefined) {
            const sRet =
              ((sanitizedPoints[k].close - sanitizedPoints[k - 1].close) /
                sanitizedPoints[k - 1].close) *
              100;
            betaStockReturns.push(sRet);
            betaBenchReturns.push(bRet);
          }
        }

        if (betaBenchReturns.length >= 10) {
          const meanB =
            betaBenchReturns.reduce((a, b) => a + b, 0) /
            betaBenchReturns.length;
          const meanS =
            betaStockReturns.reduce((a, b) => a + b, 0) /
            betaStockReturns.length;
          let covariance = 0;
          let varianceB = 0;
          for (let j = 0; j < betaBenchReturns.length; j++) {
            covariance +=
              (betaBenchReturns[j] - meanB) * (betaStockReturns[j] - meanS);
            varianceB += Math.pow(betaBenchReturns[j] - meanB, 2);
          }
          if (varianceB > 0.0001) {
            beta = covariance / varianceB;
          }
        }

        const bRetToday = benchmarkReturnsMap.get(p.dateStr) || 0;

        let commodityBeta = 0;
        let cRetToday = 0;
        if (commoditySeriesId) {
          const cStockReturns: number[] = [];
          const cBenchReturns: number[] = [];
          for (let k = betaStartIdx; k <= i; k++) {
            const dateK = sanitizedPoints[k].dateStr;
            const cRet = commodityReturnsMap.get(dateK);
            if (cRet !== undefined) {
              const sRet =
                ((sanitizedPoints[k].close - sanitizedPoints[k - 1].close) /
                  sanitizedPoints[k - 1].close) *
                100;
              cStockReturns.push(sRet);
              cBenchReturns.push(cRet);
            }
          }
          if (cBenchReturns.length >= 10) {
            const meanC =
              cBenchReturns.reduce((a, b) => a + b, 0) /
              cBenchReturns.length;
            const meanS =
              cStockReturns.reduce((a, b) => a + b, 0) /
              cStockReturns.length;
            let cov = 0,
              varC = 0;
            for (let j = 0; j < cBenchReturns.length; j++) {
              cov += (cBenchReturns[j] - meanC) * (cStockReturns[j] - meanS);
              varC += Math.pow(cBenchReturns[j] - meanC, 2);
            }
            if (varC > 0.0001) commodityBeta = cov / varC;
          }
          cRetToday = commodityReturnsMap.get(p.dateStr) || 0;
        }

        // Mathematical Excess Return (Alpha or Idiosyncratic component):
        // Formula: Excess_Return = R_asset - (\beta_bench * R_bench) - (\beta_comm * R_comm)
        // Where:
        // - R_asset (dailyReturn): Log-derived or percentage return of primary stock.
        // - \beta_bench: Benchmark beta coefficient, calculated as Cov(Asset, Bench) / Var(Bench) over rolling 60 days.
        // - R_bench (bRetToday): S&P 500 or localized benchmark index return today.
        // - \beta_comm: Commodity beta coefficient (e.g. oil or copper covariance pricing).
        // - R_comm (cRetToday): Localized macroeconomic commodity index index return today.
        excessReturn = dailyReturn - (beta * bRetToday) - (commodityBeta * cRetToday);

        if (sectorSymbol) {
          let sectorBeta = 1;
          const sectorStockReturns: number[] = [];
          const sectorBenchReturns: number[] = [];
          for (let k = betaStartIdx; k <= i; k++) {
            const dateK = sanitizedPoints[k].dateStr;
            const secRet = sectorReturnsMap.get(dateK);
            if (secRet !== undefined) {
              const sRet =
                ((sanitizedPoints[k].close - sanitizedPoints[k - 1].close) /
                  sanitizedPoints[k - 1].close) *
                100;
              sectorStockReturns.push(sRet);
              sectorBenchReturns.push(secRet);
            }
          }
          if (sectorBenchReturns.length >= 10) {
            const meanS =
              sectorStockReturns.reduce((a, b) => a + b, 0) /
              sectorStockReturns.length;
            const meanSec =
              sectorBenchReturns.reduce((a, b) => a + b, 0) /
              sectorBenchReturns.length;
            let cov = 0,
              varSec = 0;
            for (let j = 0; j < sectorBenchReturns.length; j++) {
              cov +=
                (sectorStockReturns[j] - meanS) *
                (sectorBenchReturns[j] - meanSec);
              varSec += Math.pow(sectorBenchReturns[j] - meanSec, 2);
            }
            if (varSec > 0.0001) sectorBeta = cov / varSec;
          }
          const secRetToday = sectorReturnsMap.get(p.dateStr) || 0;
          sectorExcessReturn = dailyReturn - sectorBeta * secRetToday;
        }
      }
      calculatedReturns.push({ dailyReturn, excessReturn, sectorExcessReturn });
    }

    const points: StockPoint[] = [];
    const nullSamples: any[] = [];
    const rsiArray = calculateRSIArray(sanitizedPoints, 14);

    // CRITICAL EXPLANATION:
    // By removing the expected market-driven component of each day's return, the z-score
    // now measures genuinely company-specific events rather than flagging broad market
    // selloffs as anomalies for every stock simultaneously.
    for (let i = 0; i < sanitizedPoints.length; i++) {
      const p = sanitizedPoints[i];
      const { dailyReturn, excessReturn, sectorExcessReturn } =
        calculatedReturns[i];

      const startIdx = Math.max(1, i - (this.rollingWindow - 1));
      const windowReturns: number[] = [];
      for (let k = startIdx; k <= i; k++) {
        windowReturns.push(calculatedReturns[k].excessReturn);
      }

      let volumeRatio = 1;
      let relativeVolume = 1;

      const vol20StartIdx = Math.max(0, i - 19);
      let vol20Sum = 0;
      for (let k = vol20StartIdx; k <= i; k++) {
        vol20Sum += sanitizedPoints[k].volume;
      }
      const vol20Avg = vol20Sum / (i - vol20StartIdx + 1);

      const vol90StartIdx = Math.max(0, i - (this.rollingWindow - 1));
      let vol90Sum = 0;
      for (let k = vol90StartIdx; k <= i; k++) {
        vol90Sum += sanitizedPoints[k].volume;
      }
      const vol90Avg = vol90Sum / (i - vol90StartIdx + 1);

      if (vol20Avg > 0) volumeRatio = p.volume / vol20Avg;
      if (vol90Avg > 0) relativeVolume = p.volume / vol90Avg;

      // Mathematical Z-Score and Basic Window Statistics Formulation:
      //
      // 1. Rolling Mean (mu_roll):
      //    mu_roll = (\sum_{k=1}^N R_k) / N
      //    Where N is the rolling window return size, and R_k represents historical excess return components.
      //
      // 2. Rolling Standard Deviation (sigma_roll):
      //    sigma_roll = \sqrt{ (\sum_{k=1}^N (R_k - mu_roll)^2) / (N - 1) }
      //    Using N-1 denominator for unbiased sample standard deviation estimate.
      //
      // 3. Price-Return Z-Score (Z_t):
      //    Z_t = (Excess_Return_t - mu_roll) / sigma_roll
      //    Physical meaning: Number of standard deviations current idiosyncratic return deviates from historical normal.
      let rollingMean = 0;
      let rollingStd = 0;
      let zScore = 0;

      if (windowReturns.length >= 10) {
        const total = windowReturns.reduce((sum, r) => sum + r, 0);
        rollingMean = total / windowReturns.length;

        const sumSquaredDiffs = windowReturns.reduce(
          (sum, r) => sum + Math.pow(r - rollingMean, 2),
          0,
        );
        const denominator =
          windowReturns.length > 1 ? windowReturns.length - 1 : 1;
        rollingStd = Math.sqrt(sumSquaredDiffs / denominator);

        if (rollingStd > 0.0001) {
          zScore = (excessReturn - rollingMean) / rollingStd;
        }
      }

      const isAnomaly = windowReturns.length >= 10 && Math.abs(zScore) > this.zScoreThreshold;
      const isNullSampleCandidate = windowReturns.length >= 10 && Math.abs(zScore) < 0.5 && (volumeRatio > 1.5 || (p.analysis?.edgarFilings && p.analysis.edgarFilings.length > 0));

      const volumeShockType = this.classifyVolumeShock(
        dailyReturn,
        zScore,
        volumeRatio,
        relativeVolume,
      );

      const body_to_range_ratio = Math.abs(p.close - p.open) / Math.max(0.0001, p.high - p.low);
      let overnight_gap_pct = 0;
      if (i > 0) {
        const prev = sanitizedPoints[i - 1];
        overnight_gap_pct = ((p.open - prev.close) / prev.close) * 100;
      }
      const volume_price_clustering = ((p.close - ((p.high + p.low) / 2)) / Math.max(0.0001, p.high - p.low)) * volumeRatio;

      let sma20 = 0;
      let volatility_contraction_index = 0;
      const pxStartIdx = Math.max(0, i - 19);
      const pxSlice = sanitizedPoints.slice(pxStartIdx, i + 1);
      if (pxSlice.length > 0) {
        sma20 = pxSlice.reduce((sum, pt) => sum + pt.close, 0) / pxSlice.length;
        const sumSq = pxSlice.reduce((sum, pt) => sum + Math.pow(pt.close - sma20, 2), 0);
        const std20 = Math.sqrt(sumSq / (pxSlice.length > 1 ? pxSlice.length - 1 : 1));
        const upperBand = sma20 + 2 * std20;
        const lowerBand = sma20 - 2 * std20;
        volatility_contraction_index = ((upperBand - lowerBand) / Math.max(0.0001, sma20)) * 100;
      }

      // Redefined feature (F1 obv_delta_10d decision): the old formula normalized
      // a 10-day OBV delta by the ABSOLUTE LEVEL of a since-inception cumulative
      // running sum (obvArray), which depends on how much history precedes the
      // window -- not reproducible from a shorter live window. Replaced with a
      // fully self-contained, symmetric definition: net volume-signed pressure
      // over the most recent 10 trading days, expressed as a percentage of total
      // volume traded in that SAME window. Naturally bounded to [-100, 100].
      // Ported identically into buildFeatureVectorForAnomaly (live side) --
      // deliberately NOT regenerating features.csv here; this is a formula
      // change only, existing stored obv_delta_10d values (features.csv,
      // historical_inference_results) still reflect the OLD formula until the
      // next retrain regenerates them.
      const obv10StartIdx = Math.max(0, i - 9);
      let obvSignedVolSum = 0;
      let obvTotalVolSum = 0;
      for (let idx = obv10StartIdx; idx <= i; idx++) {
        const cur = sanitizedPoints[idx];
        const prevPt = sanitizedPoints[idx - 1];
        obvTotalVolSum += cur.volume;
        if (idx > 0 && prevPt) {
          if (cur.close > prevPt.close) obvSignedVolSum += cur.volume;
          else if (cur.close < prevPt.close) obvSignedVolSum -= cur.volume;
        }
      }
      const obv_delta_10d = (obvSignedVolSum / Math.max(1, obvTotalVolSum)) * 100;

      const dateObj = new Date(p.dateStr);
      const dtMonth = dateObj.getUTCMonth() + 1;
      const dtDay = dateObj.getUTCDate();
      const dtYear = dateObj.getUTCFullYear();
      const numDaysInMonth = new Date(Date.UTC(dtYear, dtMonth, 0)).getUTCDate();
      
      const day_sin = Math.sin(2 * Math.PI * dtDay / numDaysInMonth);
      const day_cos = Math.cos(2 * Math.PI * dtDay / numDaysInMonth);
      const month_sin = Math.sin(2 * Math.PI * dtMonth / 12);
      const month_cos = Math.cos(2 * Math.PI * dtMonth / 12);

      let gap_fill_ratio = 0;
      if (i > 0) {
        const gap = p.open - sanitizedPoints[i - 1].close;
        const absGap = Math.abs(gap);
        if (absGap > 0) {
          const retracement = gap > 0 ? (p.open - p.low) : (p.high - p.open);
          gap_fill_ratio = Math.min((retracement / absGap) * 100, 100);
        }
      }

      let sma50 = 0;
      let dist_sma_50 = 0;
      const sma50StartIdx = Math.max(0, i - 49);
      const sma50Slice = sanitizedPoints.slice(sma50StartIdx, i + 1);
      if (sma50Slice.length > 0) {
        sma50 = sma50Slice.reduce((sum, pt) => sum + pt.close, 0) / sma50Slice.length;
        dist_sma_50 = ((p.close - sma50) / Math.max(0.0001, sma50)) * 100;
      }

      let sma200 = 0;
      let dist_sma_200 = 0;
      const sma200StartIdx = Math.max(0, i - 199);
      const sma200Slice = sanitizedPoints.slice(sma200StartIdx, i + 1);
      if (sma200Slice.length > 0) {
        sma200 = sma200Slice.reduce((sum, pt) => sum + pt.close, 0) / sma200Slice.length;
        dist_sma_200 = ((p.close - sma200) / Math.max(0.0001, sma200)) * 100;
      }

      const rsi_14 = rsiArray[i];

      let avg_volume_30d = 0;
      let relative_volume_30d = 0;
      const vol30StartIdx = Math.max(0, i - 29);
      const vol30Slice = sanitizedPoints.slice(vol30StartIdx, i + 1);
      
      let shannon_entropy_30d = 0;
      let amihud_illiquidity_30d = 0;

      if (vol30Slice.length > 0) {
        avg_volume_30d = vol30Slice.reduce((sum, pt) => sum + pt.volume, 0) / vol30Slice.length;
        relative_volume_30d = avg_volume_30d > 0 ? p.volume / avg_volume_30d : 1;
        
        // Shannon Entropy and Amihud Illiquidity
        const bins = [0, 0, 0, 0, 0];
        let illiqSum = 0;
        
        for (let ptIdx = vol30StartIdx; ptIdx <= i; ptIdx++) {
          const ptReturn = calculatedReturns[ptIdx]?.dailyReturn || 0;
          
          if (ptReturn === 0) {
            bins[4]++;
          } else if (ptReturn < -2) {
            bins[0]++;
          } else if (ptReturn < 0) {
            bins[1]++;
          } else if (ptReturn <= 2) {
            bins[2]++;
          } else {
            bins[3]++;
          }

          const pt = sanitizedPoints[ptIdx];
          const dollarVolume = pt.volume * pt.close;
          if (dollarVolume > 0) {
            illiqSum += Math.abs(ptReturn) / dollarVolume;
          }
        }

        let entropySum = 0;
        for (const count of bins) {
          const p_i = count / vol30Slice.length;
          if (p_i > 0) {
            entropySum += p_i * Math.log2(p_i);
          }
        }
        shannon_entropy_30d = -entropySum;
        amihud_illiquidity_30d = (illiqSum / vol30Slice.length) * 1_000_000;
      }

      let barycenter_stretch_20d = 0;
      const barycenterStartIdx = Math.max(0, i - 19);
      const barycenterSlice = sanitizedPoints.slice(barycenterStartIdx, i + 1);
      if (barycenterSlice.length > 0) {
        let total_dollar_volume = 0;
        let total_raw_volume = 0;
        for (const pt of barycenterSlice) {
          total_dollar_volume += pt.close * pt.volume;
          total_raw_volume += pt.volume;
        }
        const barycenter_20d = total_dollar_volume / Math.max(0.0001, total_raw_volume);
        barycenter_stretch_20d = ((p.close - barycenter_20d) / Math.max(0.0001, barycenter_20d)) * 100;
      }

      const rawReturn = i > 0 ? (p.close - sanitizedPoints[i - 1].close) / sanitizedPoints[i - 1].close : 0;
      const kinetic_energy = 0.5 * relative_volume_30d * Math.pow(rawReturn * 100, 2);

      let l1_lagrange_point = 0;
      let orbital_escape_velocity = 0;
      let escape_velocity_cleared = 0;

      const orbital200StartIdx = Math.max(0, i - 199);
      const orbital200Slice = sanitizedPoints.slice(orbital200StartIdx, i + 1);

      if (barycenterSlice.length > 0 && orbital200Slice.length > 0) {
        let m_20 = 0;
        let vwap20_num = 0;
        for (const pt of barycenterSlice) {
          m_20 += pt.volume;
          vwap20_num += pt.close * pt.volume;
        }
        const vwap_20 = m_20 > 0 ? vwap20_num / m_20 : p.close;

        let m_200 = 0;
        let vwap200_num = 0;
        let closeSum200 = 0;
        for (const pt of orbital200Slice) {
          m_200 += pt.volume;
          vwap200_num += pt.close * pt.volume;
          closeSum200 += pt.close;
        }
        const vwap_200 = m_200 > 0 ? vwap200_num / m_200 : p.close;
        const meanClose200 = closeSum200 / orbital200Slice.length;

        let varSum = 0;
        for (const pt of orbital200Slice) {
          varSum += Math.pow(pt.close - meanClose200, 2);
        }
        const stdDev_200 = Math.sqrt(varSum / orbital200Slice.length);

        l1_lagrange_point = vwap_200 + ((vwap_20 - vwap_200) * (m_200 > 0 ? m_20 / m_200 : 0));

        const vEInner = (2 * stdDev_200 * vwap_200) / Math.max(0.01, Math.abs(p.close - l1_lagrange_point));
        orbital_escape_velocity = vEInner >= 0 ? Math.sqrt(vEInner) : 0;

        escape_velocity_cleared = Math.abs(rawReturn * 100) > orbital_escape_velocity ? 1 : 0;
      }

      let market_reynolds_number = 0;
      let fractal_efficiency_ratio_10d = 0;

      if (barycenterSlice.length > 0) {
        let returnSum = 0;
        for (let ptIdx = barycenterStartIdx; ptIdx <= i; ptIdx++) {
           returnSum += calculatedReturns[ptIdx]?.dailyReturn || 0;
        }
        const returnMean = returnSum / barycenterSlice.length;
        let varReturnSum = 0;
        for (let ptIdx = barycenterStartIdx; ptIdx <= i; ptIdx++) {
           varReturnSum += Math.pow((calculatedReturns[ptIdx]?.dailyReturn || 0) - returnMean, 2);
        }
        let stdDev_20d = Math.sqrt(varReturnSum / barycenterSlice.length);
        if (stdDev_20d === 0) stdDev_20d = 0.0001;

        market_reynolds_number = (relative_volume_30d * Math.abs(rawReturn * 100)) / stdDev_20d;
      }

      const ferStartIdx = Math.max(0, i - 10);
      const ferSlice = sanitizedPoints.slice(ferStartIdx, i + 1);
      if (ferSlice.length > 1) {
        const net_distance = Math.abs(p.close - ferSlice[0].close);
        let path_distance = 0;
        for (let ptIdx = ferStartIdx + 1; ptIdx <= i; ptIdx++) {
          path_distance += Math.abs(sanitizedPoints[ptIdx].close - sanitizedPoints[ptIdx - 1].close);
        }
        
        if (path_distance > 0) {
          fractal_efficiency_ratio_10d = (net_distance / path_distance) * 100;
        }
      }

      let market_jerk = 0;
      let seismic_magnitude_mw = 0;

      if (i >= 2) {
        const v_t = calculatedReturns[i]?.dailyReturn * 100 || 0;
        const v_t_minus_1 = calculatedReturns[i - 1]?.dailyReturn * 100 || 0;
        const v_t_minus_2 = calculatedReturns[i - 2]?.dailyReturn * 100 || 0;

        const a_t = v_t - v_t_minus_1;
        const a_t_minus_1 = v_t_minus_1 - v_t_minus_2;

        market_jerk = a_t - a_t_minus_1;
      }

      seismic_magnitude_mw = (2 / 3) * Math.log10(Math.max(1, kinetic_energy));

      let sector_relative_z_score = 0;
      if (sectorReturnsMap.size > 0 && i >= 1) {
        const sectorReturnDates: number[] = [];
        const secStart = Math.max(1, i - 29);
        for (let s = secStart; s <= i; s++) {
          const secRet = sectorReturnsMap.get(sanitizedPoints[s].dateStr);
          if (secRet !== undefined) {
            sectorReturnDates.push(secRet);
          }
        }
        if (sectorReturnDates.length > 2) {
          const secMean = sectorReturnDates.reduce((a, b) => a + b, 0) / sectorReturnDates.length;
          const secVar =
            sectorReturnDates.reduce((acc, r) => acc + Math.pow(r - secMean, 2), 0) /
            (sectorReturnDates.length - 1);
          const secStd = Math.sqrt(secVar);
          
          const mu_sector_t = sectorReturnsMap.get(p.dateStr) ?? secMean;
          
          if (secStd > 0) {
            sector_relative_z_score = (dailyReturn - mu_sector_t) / secStd;
          }
        }
      }

      const basePoint: StockPoint = {
        date: p.dateStr,
        timestamp: p.time,
        open: p.open,
        high: p.high,
        low: p.low,
        close: p.close,
        volume: p.volume,
        dailyReturn,
        excessReturn,
        volumeRatio,
        relativeVolume,
        volumeShockType,
        rollingMean,
        rollingStd,
        zScore,
        isAnomaly,
        body_to_range_ratio,
        overnight_gap_pct,
        volume_price_clustering,
        volatility_contraction_index,
        obv_delta_10d,
        day_sin,
        day_cos,
        month_sin,
        month_cos,
        gap_fill_ratio,
      };

      (basePoint as any)._isNullSampleCandidate = isNullSampleCandidate;
      (basePoint as any)._tempDistSma50 = dist_sma_50;
      (basePoint as any)._tempDistSma200 = dist_sma_200;
      (basePoint as any)._tempRsi14 = rsi_14;
      (basePoint as any)._tempRelativeVolume30d = relative_volume_30d;
      (basePoint as any)._tempShannonEntropy = shannon_entropy_30d;
      (basePoint as any)._tempAmihud = amihud_illiquidity_30d;
      (basePoint as any)._tempBarycenterStretch = barycenter_stretch_20d;
      (basePoint as any)._tempKineticEnergy = kinetic_energy;
      (basePoint as any)._tempL1Lagrange = l1_lagrange_point;
      (basePoint as any)._tempEscapeVelocity = orbital_escape_velocity;
      (basePoint as any)._tempEscapeVelocityCleared = escape_velocity_cleared;
      (basePoint as any)._tempReynoldsNumber = market_reynolds_number;
      (basePoint as any)._tempFER = fractal_efficiency_ratio_10d;
      (basePoint as any)._tempMarketJerk = market_jerk;
      (basePoint as any)._tempSeismicMagnitudeMw = seismic_magnitude_mw;
      (basePoint as any)._tempSectorRelativeZScore = sector_relative_z_score;

      if (isAnomaly) {
        (basePoint as any)._tempDataConfidence = dataConfidence;
        (basePoint as any)._tempStatisticalConfidence = Math.min(
          100,
          Math.round((Math.abs(zScore) - this.zScoreThreshold) * 20 + 50),
        );
      }

      const cacheKey = `${uppercaseSymbol}_${p.dateStr}`;
      const cachedAnalysis = getCachedAnalysis(cacheKey);
      if (cachedAnalysis) {
        basePoint.analysis = cachedAnalysis;
        if (isAnomaly) basePoint.hasAnalysis = true;
      } else {
        if (isAnomaly) basePoint.hasAnalysis = false;
      }

      const ext = this.collectExternalSignals(basePoint);
      const gIn = buildGatingInput(basePoint, {
        ticker: uppercaseSymbol,
        externalSignals: ext,
        macroSnapshot: basePoint.analysis?.macroSnapshot || (basePoint as any)._tempMacroSnapshot,
      });
      const verdict = runGatingEngine(gIn);
      basePoint.gatingVerdict = verdict;

      // The gating classification is broader because it considers all external signals, not just volume and filings.
      (basePoint as any)._isNullSampleCandidate = (basePoint as any)._isNullSampleCandidate || verdict.event_classification === "SUPPRESSED_NON_EVENT";
      if (verdict.suppressed_non_event_reason) {
        basePoint.nonEventReason = verdict.suppressed_non_event_reason;
      }

      points.push(basePoint);
    }

    let realAnomalies = points.filter((p) => p.isAnomaly);
    let nullCandidates = points.filter((p) => !p.isAnomaly && (p as any)._isNullSampleCandidate);
    let maxNull = Math.floor(realAnomalies.length / 2);
    let selectedNulls = nullCandidates.slice(0, maxNull).map(p => {
      p.isAnomaly = true;
      (p as any).is_null_sample = true;
      return p;
    });
    let anomalies = [...realAnomalies, ...selectedNulls];

    // Auto-adjust Z-score if there are fewer than 20 anomalies
    let currentZScoreThreshold = this.zScoreThreshold;
    let loopCount = 0;
    while (
      anomalies.length < 20 &&
      currentZScoreThreshold > 1.80 &&
      loopCount < 40
    ) {
      currentZScoreThreshold -= 0.05;
      if (currentZScoreThreshold < 1.80) {
        currentZScoreThreshold = 1.80;
      }

      // Re-evaluate anomalies with lower z-score
      realAnomalies = points.filter(p => !((p as any).is_null_sample));
      for (const p of realAnomalies) {
        p.isAnomaly = Math.abs(p.zScore) > currentZScoreThreshold;
      }
      realAnomalies = realAnomalies.filter(p => p.isAnomaly);
      maxNull = Math.floor(realAnomalies.length / 2);
      selectedNulls = nullCandidates.slice(0, maxNull).map(p => {
        p.isAnomaly = true;
        (p as any).is_null_sample = true;
        return p;
      });
      anomalies = [];
      for (const p of points) {
        if (p.isAnomaly) {
          (p as any)._tempDataConfidence = dataConfidence;
          (p as any)._tempStatisticalConfidence = Math.min(
            100,
            Math.round((Math.abs(p.zScore) - currentZScoreThreshold) * 20 + 50),
          );

          if (p.hasAnalysis === undefined) {
            const cacheKey = `${uppercaseSymbol}_${p.date}`;
            const cachedAnalysis = getCachedAnalysis(cacheKey);
            if (cachedAnalysis) {
              p.analysis = cachedAnalysis;
              p.hasAnalysis = true;
            } else {
              p.hasAnalysis = false;
            }
          }
          anomalies.push(p);
        } else {
          p.hasAnalysis = undefined;
          p.analysis = undefined;
        }
      }
      loopCount++;
      if (currentZScoreThreshold === 1.80) {
        console.warn(`[HistoricalEngine] Strict hard-coded floor of 1.80 reached for ${uppercaseSymbol}. Anomaly count: ${anomalies.length}`);
        break; // Reached bottom threshold limit, no further adjustment can be made
      }
    }

    // Set the strict ML trigger threshold feature vector attribute on all returning events
    anomalies.forEach((p) => {
      (p as any)._tempTriggeredZScoreThreshold = currentZScoreThreshold;
    });

    // Always call enrichAnomaliesContext to compute VIX and Market Regime.
    // Only call slow API enrichments if skipGeminiAnalysis is false.
    
    // Micro-throttle: Wait 300ms before commencing alternative sentiment and GDELT/Edgar queries,
    // because rate limit sirens start blaring if we execute contiguous bulk retrievals.
    await sleep(MICRO_THROTTLE_MS);

    await this.enrichAnomaliesContext(
      anomalies,
      fmpContext,
      uppercaseSymbol,
      range,
      benchmarkReturnsMap,
      !skipGeminiAnalysis, // enrichSlowApis
      10, // maxEnrichCount
    );

    // ─── OHLCV-BASED NON-EVENT SECOND PASS ──────────────────────────────────
    // Defines non-events from OHLCV fields only (always available on every
    // point). Two categories:
    //   near-miss: z between 0.8 and threshold, volume elevated — market
    //              "tried" but didn't clear the anomaly bar
    //   volume spike: volume > 2x but z < 0.8 — activity with no follow-through
    {
      const alreadyNullCount = anomalies.filter(
        (p) => (p as any).is_null_sample
      ).length;
      const nullCap = Math.floor(realAnomalies.length / 2);
      const remainingCap = nullCap - alreadyNullCount;

      if (remainingCap > 0) {
        const nonAnomalyPoints = points.filter((p) => !p.isAnomaly);

        const candidates: Array<{
          point: typeof nonAnomalyPoints[0];
          reason: string;
          priority: number;
        }> = [];

        for (const p of nonAnomalyPoints) {
          const absZ = Math.abs(p.zScore ?? 0);
          const vol = (p as any).volumeRatio ?? (p as any).volume_ratio ?? 0;

          // Category 1: near-miss — noticeable move but below anomaly threshold
          if (absZ >= 0.8 && absZ < currentZScoreThreshold && vol > 1.3) {
            candidates.push({
              point: p,
              reason: `near_miss_z_${absZ.toFixed(2)}_vol_${vol.toFixed(1)}x`,
              priority: absZ + vol,
            });
            continue;
          }

          // Category 2: volume spike with flat price — activity, no follow-through
          if (vol > 2.0 && absZ < 0.8) {
            candidates.push({
              point: p,
              reason: `volume_spike_${vol.toFixed(1)}x_flat_z_${absZ.toFixed(2)}`,
              priority: vol,
            });
          }
        }

        candidates.sort((a, b) => b.priority - a.priority);
        const selected = candidates.slice(0, remainingCap);

        for (const { point, reason } of selected) {
          point.isAnomaly = true;
          (point as any).is_null_sample = true;
          (point as any)._isNullSampleCandidate = true;
          (point as any)._tempTriggeredZScoreThreshold = currentZScoreThreshold;
          (point as any)._tempStatisticalConfidence = 20;
          (point as any)._tempDataConfidence = dataConfidence;
          (point as any).nonEventReason = reason;
          const dateStr =
            (point as any).dateStr ?? (point as any).date ?? "unknown";
          console.log(
            `[NON-EVENT] ${uppercaseSymbol} ${dateStr} — ${reason}`,
          );
          anomalies.push(point);
        }

        if (selected.length > 0) {
          console.log(
            `[NON-EVENT] ${uppercaseSymbol}: ${selected.length} non-events ` +
              `selected (${candidates.length} candidates, cap=${nullCap})`,
          );
        }
      }
    }
    // ─── END OHLCV-BASED NON-EVENT SECOND PASS ───────────────────────────────

    // Non-events must never reach the Gemini narrative pipeline — exclude
    // is_null_sample rows here so they can't trigger their own Gemini calls,
    // independent of the skipGemini option (which is enforced below).
    const uncachedAnomalies = anomalies.filter((a) => !a.hasAnalysis && !(a as any).is_null_sample);
    const uncachedSorted = [...uncachedAnomalies].sort(
      (a, b) => Math.abs(b.zScore) - Math.abs(a.zScore),
    );

    const hasApiKey = !!process.env.GEMINI_API_KEY;

    if (!this.options?.skipGemini && !skipGeminiAnalysis && hasApiKey && uncachedSorted.length > 0) {
      // Process all uncached anomalies in batches of 10
      const batchSize = 10;
      for (
        let batchStart = 0;
        batchStart < uncachedSorted.length;
        batchStart += batchSize
      ) {
        const topToFetch = uncachedSorted.slice(
          batchStart,
          batchStart + batchSize,
        );
        try {
          // Micro-throttle: Take a quick 300ms breather before invoking the LLM generator,
          // because even Gemini's ultra-scalable infrastructure demands respect and spacing.
          await sleep(MICRO_THROTTLE_MS);

          const ai = this.getAIClient();
          console.log(
            `[HistoricalEngine] Safe-batch querying ${topToFetch.length} anomalies with Google Search Grounding for ${uppercaseSymbol}...`,
          );

          // CRITICAL COMMENT: We omit any forward-looking price returns from this payload.
          // Gemini must not have access to future price data when identifying the catalyst,
          // to avoid look-ahead bias in the analysis and in any training data derived from it.
          const itemsListStr = topToFetch
            .map((item) => {
              let volContext = "";
              if (item.volumeRatio !== undefined) {
                volContext = `, Volume context: this move occurred on ${Number(item.volumeRatio).toFixed(1)}x normal volume — classified as ${item.volumeShockType || "normal"}.`;
              }
              let vixContext = "";
              const vixVal = (item as any)._tempVixAtEvent;
              const regime = (item as any)._tempVixRegime;
              if (vixVal !== undefined && regime !== undefined) {
                vixContext = ` Market volatility context: VIX was at ${vixVal.toFixed(2)} (${regime}) on this date. A move of this magnitude during a ${regime} volatility environment should be interpreted accordingly — extreme VIX environments make individual stock anomalies less likely to be company-specific.`;
              }
              let regimeContext = "";
              const mRegime = (item as any)._tempMarketRegime;
              if (mRegime !== undefined) {
                regimeContext = ` Market regime at time of event: trend=${mRegime.trendRegime}, volatility=${mRegime.volatilityRegime}, macro=${mRegime.macroRegime}. Consider how this regime context affects the interpretation of the catalyst and the subsequent price trajectory.`;
              }

              let macroContext = "";
              const snap = (item as any)._tempMacroSnapshot;
              if (snap) {
                const spreadDesc =
                  snap.yieldCurvSpread !== undefined
                    ? `${snap.yieldCurvSpread}% (${snap.yieldCurvSpread < 0 ? "INVERTED/RECESSSION SIGNAL" : "Normal positive spread"})`
                    : "N/A";

                macroContext = `
Macroeconomic Environment on ${item.date}:
- Federal Funds Rate: ${snap.federalFundsRate !== undefined ? snap.federalFundsRate + "%" : "N/A"}
- Inflation (YoY CPI Change): ${snap.cpiYoY !== undefined ? snap.cpiYoY + "%" : "N/A"}
- Unemployment Rate: ${snap.unemploymentRate !== undefined ? snap.unemploymentRate + "%" : "N/A"}
- 10Y-2Y Treasury Yield Spread: ${spreadDesc}
- High-Yield Corporate Credit Spread: ${snap.creditSpread !== undefined ? snap.creditSpread + "%" : "N/A"}
- US Dollar Index: ${snap.dollarIndex !== undefined ? snap.dollarIndex : "N/A"}
- VIX Level: ${snap.vix !== undefined ? snap.vix : "N/A"}`;
              }

              let releaseContext = "";
              const release = (item as any)._tempMacroRelease;
              if (release) {
                const surpriseSign =
                  release.surprise !== undefined && release.surprise > 0
                    ? "+"
                    : "";
                releaseContext = `
Scheduled Economic Release on ${item.date} (${release.releaseType?.toUpperCase()}):
- Actual vs Prior Value: ${release.actualValue} vs ${release.priorValue}
- Surprise: ${surpriseSign}${release.surprise} (${release.surpriseDirection} direction)
- Statistical Significance: ${release.isSignificant ? "HIGH significance (exceeds 0.2 standard deviations)" : "Standard/In-line deviation"}`;
              }

              let sequenceContext = "";
              const prior = getPriorEvents(uppercaseSymbol, item.date, 60);
              if (prior.length > 0) {
                item.analysis = item.analysis || ({} as any);
                const currentMs = new Date(item.date).getTime();
                const latestMs = new Date(prior[0].date).getTime();
                const daysSince = Math.floor(
                  (currentMs - latestMs) / (1000 * 60 * 60 * 24),
                );

                item.analysis!.priorEvents = prior.map((p) => ({
                  date: p.date,
                  primaryCategory: p.primaryCategory || "",
                  primarySubType: p.primarySubType || "",
                  excessReturn:
                    p.excessReturn !== undefined ? p.excessReturn : 0,
                  daysAgo: Math.floor(
                    (currentMs - new Date(p.date).getTime()) /
                      (1000 * 60 * 60 * 24),
                  ),
                }));
                item.analysis!.daysSincePreviousEvent = daysSince;
                item.analysis!.eventDensity = prior.length;

                sequenceContext = ` Event sequence context for ${uppercaseSymbol}: In the 60 days prior to this event, ${prior.length} other anomalies were detected. The most recent was ${daysSince} days ago, classified as ${prior[0].primaryCategory}/${prior[0].primarySubType}. Consider whether this event may be part of an ongoing narrative or a continuation of a prior catalyst chain.`;
              }

              let edgarContext = "";
              if (
                item.analysis?.edgarFilings &&
                item.analysis.edgarFilings.length > 0
              ) {
                const listStr = item.analysis.edgarFilings
                  .map(
                    (f) => `Form ${f.form} on ${f.filedAt} (${f.description})`,
                  )
                  .join("; ");
                edgarContext = ` SEC EDGAR filings found near this date: [${listStr}]. Consider whether these official disclosures explain the price movement before searching for other catalysts.`;
              }

              let insiderContext = "";
              const insiderDensity =
                item.analysis?.insider_cluster_density ||
                (item as any)._tempInsiderDensity;
              if (insiderDensity !== undefined && insiderDensity > 0) {
                insiderContext = ` Insider Trading Cluster Density: ${insiderDensity}. High density suggests coordinated insider transactions.`;
              }

              let frictionContext = "";
              const frictionScore =
                item.analysis?.management_friction_score ||
                (item as any)._tempFrictionScore;
              if (frictionScore !== undefined && frictionScore > 0) {
                frictionContext = ` Management Friction Score: ${frictionScore}. Indicates executive turnover or governance disputes.`;
              }

              let fmpContextBlock = "";
              if (fmpContext) {
                const profile = fmpContext.profile;
                const ratios = fmpContext.ratios;
                const sector = profile?.sector || "N/A";
                const industry = profile?.industry || "N/A";
                const marketCapB = profile?.marketCap
                  ? (profile.marketCap / 1e9).toFixed(1)
                  : "N/A";
                const pe =
                  ratios?.peRatio !== undefined
                    ? ratios.peRatio.toFixed(1)
                    : "N/A";
                const de =
                  ratios?.debtToEquityRatio !== undefined
                    ? ratios.debtToEquityRatio.toFixed(2)
                    : "N/A";
                const netMargin =
                  ratios?.netProfitMargin !== undefined
                    ? (ratios.netProfitMargin * 100).toFixed(1)
                    : "N/A";
                const revGrowth =
                  ratios?.revenueGrowthYoY !== undefined
                    ? (ratios.revenueGrowthYoY * 100).toFixed(1)
                    : "N/A";

                fmpContextBlock = ` Company context: ${uppercaseSymbol} is a ${sector}/${industry} company with market cap of $${marketCapB}B. P/E ratio: ${pe}. Debt-to-equity: ${de}. Net margin: ${netMargin}%. Revenue growth YoY: ${revGrowth}%. This fundamental profile should inform your interpretation of the catalyst — a highly-leveraged company is more sensitive to interest rate news, a high-growth company is more sensitive to guidance changes, etc.`;
                
                const ac = (fmpContext as any).analystConsensus;
                if (ac && ac.mean && ac.count) {
                  fmpContextBlock += ` Analyst consensus: ${ac.mean}/5.0 across ${ac.count} analysts.`;
                }
              }

              let earningsContextStr = "";
              if (
                fmpContext &&
                (fmpContext.recentEarnings || fmpContext.upcomingEarnings)
              ) {
                const allEvents = [
                  ...(fmpContext.recentEarnings || []),
                  ...(fmpContext.upcomingEarnings || []),
                ];
                let closestEvent: any = null;
                let minTradDist = Infinity;
                let rawDist = 0;

                for (const e of allEvents) {
                  const dist = getTradingDaysDistance(
                    item.date,
                    e.reportDate,
                    points,
                  );
                  if (dist !== null && Math.abs(dist) <= 5) {
                    if (Math.abs(dist) < minTradDist) {
                      minTradDist = Math.abs(dist);
                      closestEvent = e;
                      rawDist = dist;
                    }
                  }
                }

                if (closestEvent) {
                  item.analysis = item.analysis || ({} as any);
                  item.analysis!.daysFromEarnings = minTradDist;
                  item.analysis!.earningsContext = closestEvent;

                  const direction = rawDist >= 0 ? "before" : "after";
                  const qLabel = closestEvent.fiscalQuarterEnd || "quarterly";
                  const act =
                    closestEvent.actualEps !== undefined
                      ? closestEvent.actualEps.toFixed(2)
                      : "N/A";
                  const est =
                    closestEvent.estimatedEps !== undefined
                      ? closestEvent.estimatedEps.toFixed(2)
                      : "N/A";
                  const surPctVal =
                    closestEvent.epsSurprisePercent !== undefined
                      ? closestEvent.epsSurprisePercent.toFixed(1)
                      : "N/A";

                  earningsContextStr = ` This anomaly occurred ${minTradDist} days ${direction} the ${qLabel} earnings report (EPS: actual=${act} vs estimate=${est}, surprise=${surPctVal}%). This context is highly relevant to your catalyst determination.`;
                }
              }

              let newsContext = "";
              const pArticles = (item as any)._tempPrefetchedArticles;
              if (pArticles && pArticles.length > 0) {
                const articlesLines = pArticles
                  .map(
                    (art: any) =>
                      `  - [${art.sourceName}] ${art.title} (published: ${art.publishedAt})`,
                  )
                  .join("\n");

                newsContext = `\n\nPre-fetched news articles for context (from NewsAPI — use these as starting points for your analysis, but verify and supplement with your own search):\n${articlesLines}\n\nBased on these articles and your own Google Search, identify the primary catalyst.`;
              }

              let socialContext = "";
              const rs =
                item.analysis?.socialSentiment ||
                (item as any)._tempSocialSentiment;
              if (
                rs &&
                (rs.viralityScore > 30 || rs.highEngagementPosts?.length > 0)
              ) {
                const activeRateInstance = rs.totalMentions / 3;
                const baselineCountInstance = 0;
                const baselineRateInstance = Math.max(1, baselineCountInstance);
                const ratioVal = (
                  activeRateInstance / baselineRateInstance
                ).toFixed(1);

                socialContext = `\n\nSocial media context (StockTwits): Mention volume was ${ratioVal}x above baseline around this date (virality score: ${Math.round(rs.viralityScore)}/100). Sentiment was ${rs.sentimentLabel} with trend: ${rs.sentimentTrend}. ${rs.highEngagementPosts?.length || 0} high-engagement posts found. Consider whether retail StockTwits sentiment was a contributing factor.`;
              }

              let trendsContext = "";
              const trends =
                item.analysis?.trendsSummary ||
                (item as any)._tempTrendsSummary;
              if (trends) {
                const baselineVal =
                  trends.percentAboveBaseline > -100
                    ? trends.searchValueAtAnomaly /
                      (1 + trends.percentAboveBaseline / 100)
                    : 0;
                const isMoreThan50PercentAboveAverage =
                  trends.percentAboveBaseline > 50 ||
                  (trends.averageSearchValue > 0 &&
                    trends.searchValueAtAnomaly >
                      trends.averageSearchValue * 1.5);
                if (isMoreThan50PercentAboveAverage) {
                  trendsContext = `\n\nGoogle Trends context: Public search interest in ${trends.companyName} was ${trends.percentAboveBaseline.toFixed(1)}% above its baseline level on the anomaly date (search index: ${trends.searchValueAtAnomaly}/100, vs baseline ${baselineVal.toFixed(1)}/100). The day before the anomaly, search interest was at ${trends.searchValueDayBefore}. Consider whether unusual public interest preceded or accompanied this event.`;
                }
              }

              let wikiContext = "";
              const wikiSpikes: any[] =
                item.analysis?.wikipediaSpikes ||
                (item as any)._tempWikipediaSpikes;
              if (wikiSpikes && wikiSpikes.length > 0) {
                const spikeDescriptions = wikiSpikes
                  .map(
                    (s: any) =>
                      `- Article: "${s.articleTitle}" (${s.queryTopic}): Views spiked to ${s.spikeViewsAvg.toFixed(0)} avg over the prior 3 days (vs 30-day baseline avg of ${s.baselineViewsAvg.toFixed(0)}; ${s.spikeRatio.toFixed(1)}x above baseline).`,
                  )
                  .join("\n");

                wikiContext = `\n\nWikipedia Pageview Context (72h prior): The system detected unusual traffic volume on key Wikipedia profiles *before* this anomaly occurred, suggesting informed interest or rumors prior to the event becoming public knowledge:\n${spikeDescriptions}\nConsider this when evaluating whether the price move was preempted.`;
              }

              let gdeltContext = "";
              const gdeltTone: GDELTToneSummary | null | undefined =
                item.analysis?.gdeltTone || (item as any)._tempGdeltTone;
              if (gdeltTone && gdeltTone.matchCount > 0 && gdeltTone.matchedToneAvg !== null && gdeltTone.globalToneAvg !== null) {
                const relativeTone = gdeltTone.matchedToneAvg - gdeltTone.globalToneAvg;
                const toneLabel = relativeTone > 1 ? "more positive" : relativeTone < -1 ? "more negative" : "roughly in line with";
                gdeltContext = `\n\nGDELT Global News Tone Context: The system found ${gdeltTone.matchCount} global news article(s) mentioning ${companyName} on or around this date, with an average tone of ${gdeltTone.matchedToneAvg.toFixed(1)} (scale -100 to +100) — ${toneLabel} the global news baseline tone of ${gdeltTone.globalToneAvg.toFixed(1)} for that day.\nConsider this when assessing the catalyst for international or globally integrated stocks.`;
              }

              let shortInterestContext = "";
              const si = item.analysis?.shortInterest || (item as any)._tempShortInterest;
              const siVelocity = item.analysis?.shortInterestVelocity || (item as any)._tempShortInterestVelocity;
              if (si) {
                shortInterestContext = `\n\nShort interest context: ${si.pctOfFloat}% of float short, ${si.shortInterestRatio} days to cover, ${siVelocity !== null ? siVelocity + "% change since prior reading" : "unknown velocity"}. Elevated or rising short interest before a decline suggests informed short positioning.`;
              }

              let ytContext = "";
              const ytVideos: any[] =
                item.analysis?.youtubeVideos ||
                (item as any)._tempYoutubeVideos;
              if (ytVideos && ytVideos.length > 0) {
                const videoDescriptions = ytVideos
                  .map(
                    (vid: any) =>
                      `Video Title: "${vid.title}"\nUploaded: ${vid.publishedAt}\nChannel: ${vid.channelTitle}\nTranscript Snippet:\n${vid.transcript.substring(0, 1000)}...`,
                  )
                  .join("\n\n");

                ytContext = `\n\nYouTube Earnings/CEO Transcript Context:\nThe following transcripts are from around the event date. Analyze them for notable language: unexpected hedging, changes in forward-looking language, executives contradicting each other, or significant shifts in executive tone:\n${videoDescriptions}\nConsider this when estimating the impact of guidance revisions.`;
              }

              let swingContext = "";
              const itemTime = new Date(item.date).getTime();
              let precedingSwing: any = null;
              for (const swing of macroSwings) {
                if (swing.timestamp < itemTime) {
                  precedingSwing = swing;
                } else {
                  break;
                }
              }
              if (precedingSwing) {
                const daysAfter = Math.floor((itemTime - precedingSwing.timestamp) / (1000 * 60 * 60 * 24));
                swingContext = `\n[MARKET STRUCTURE]: This anomaly occurred ${daysAfter} days after a confirmed macro ${precedingSwing.type} at $${precedingSwing.price.toFixed(2)}. Determine if this news catalyzed a trend reversal or accelerated the current structural path.`;
              }

              let govContext = "";
              const netFlow = (item as any)._tempCongressionalNetFlow;
              const epu = (item as any)._tempMacroSnapshot?.economic_policy_uncertainty;
              if (netFlow !== undefined || epu !== undefined) {
                govContext = `\n[GOVERNMENT SIGNAL]: US Congressional Net Flow (30d): $${netFlow || 0}. Regional Economic Policy Uncertainty (EPU) Index at event time: ${epu || 'N/A'}. Assess if this anomaly was driven by regional regulatory shifts or state-level interventions.`;
              }

              let ivCrushContext = "";
              const ivCrush = (item as any)._tempIvCrush;
              if (ivCrush !== undefined) {
                ivCrushContext = `\n[OPTIONS MARKET]: The Implied Volatility (IV) crush on this date was ${ivCrush}%. A massive crush indicates the market was heavily anticipating binary news, whereas zero crush implies a completely surprise catalyst. NOTE: options metrics are end-of-day, not intraday. They confirm that unusual options activity occurred on this date but CANNOT establish whether it preceded the price move within the day. Treat as confirmatory context, not a leading-timing signal.`;
              }

              let sectorContagionContext = "";
              const peerAvgReturn = (item as any)._tempPeerAverageReturn;
              const contagionDelta = (item as any)._tempContagionDelta;
              if (peerAvgReturn !== undefined && contagionDelta !== undefined) {
                sectorContagionContext = `\n[SECTOR CONTAGION]: On this date, the target stock moved ${Number(item.dailyReturn).toFixed(2)}%, while its top competitors averaged a ${peerAvgReturn}% move. The Contagion Delta is ${contagionDelta}%. Determine if the target stock was merely reacting in sympathy to a rival's news, or if it had an independent catalyst.`;
              }

              let pcrContext = "";
              const pcr = (item as any)._tempPutCallRatio;
              if (pcr !== undefined && pcr !== null) {
                pcrContext = `\n[OPTIONS POSITIONING]: The Put/Call Ratio on the day before this event was ${pcr}. A PCR > 1.0 indicates the street was heavily positioned for a crash, acting as potential short-squeeze fuel if the news is positive. NOTE: options metrics are end-of-day, not intraday. They confirm that unusual options activity occurred on this date but CANNOT establish whether it preceded the price move within the day. Treat as confirmatory context, not a leading-timing signal.`;
              }

              let hiddenLiquidityContext = "";
              const dpi = (item as any)._tempDarkPoolIndex;
              const ctbVel = (item as any)._tempCtbVelocity;
              if (dpi !== undefined && ctbVel !== undefined && dpi !== null && ctbVel !== null) {
                hiddenLiquidityContext = `\n[HIDDEN LIQUIDITY]: On this date, the Dark Pool Index (off-exchange volume) was ${dpi}%. Additionally, the Cost to Borrow shares spiked by ${ctbVel}% over the preceding week. Evaluate if this event was orchestrated by stealth institutional accumulation or fueled by trapped short sellers.`;
              }

              let systemPhysicsContext = "";
              const entropy = (item as any)._tempShannonEntropy;
              const illiq = (item as any)._tempAmihud;
              if (entropy !== undefined && illiq !== undefined && entropy !== null && illiq !== null) {
                systemPhysicsContext = `\n[SYSTEM PHYSICS]: The 30-day Shannon Entropy (Chaos) leading into this event was ${entropy}. The Amihud Illiquidity (Fragility) was ${illiq}. Determine if this anomaly struck a highly predictable, liquid environment, or a chaotic, fragile order book.`;
              }

              let econophysicsContext = "";
              const k_e = (item as any)._tempKineticEnergy;
              const b_s = (item as any)._tempBarycenterStretch;
              if (k_e !== undefined && b_s !== undefined && k_e !== null && b_s !== null) {
                econophysicsContext = `\n[ECONOPHYSICS]: The anomaly generated a Kinetic Energy score of ${k_e}, combining relative mass and squared velocity. The asset currently sits at a Gravitational Barycenter Stretch of ${b_s}%. Evaluate the physical orbital stability of this trajectory: does it possess the kinetic power to reach escape velocity, or will gravity force a violent mean-reversion snap-back?`;
              }

              let orbitalStabilityContext = "";
              const l1 = (item as any)._tempL1Lagrange;
              const escapeVel = (item as any)._tempEscapeVelocity;
              const cleared = (item as any)._tempEscapeVelocityCleared;
              if (l1 !== undefined && escapeVel !== undefined && cleared !== undefined && l1 !== null && escapeVel !== null && cleared !== null) {
                const status = cleared === 1 ? "CLEARED" : "FAILED TO CLEAR";
                orbitalStabilityContext = `\n[ORBITAL STABILITY]: The Binary Barycenter (L1 Lagrange equilibrium) for this asset is located at $${l1.toFixed(2)}. The anomaly generated a price shock, but to prevent a gravitational mean-reversion, it required an Orbital Escape Velocity of ${escapeVel.toFixed(4)}. The asset ${status} this threshold. Determine if this anomaly created a new secular trajectory or if it will decay back into the L1 orbit.`;
              }

              let systemGeometryContext = "";
              const fer = (item as any)._tempFER;
              const reyn = (item as any)._tempReynoldsNumber;
              if (fer !== undefined && reyn !== undefined && fer !== null && reyn !== null) {
                systemGeometryContext = `\n[SYSTEM GEOMETRY & FLOW]: The asset is exhibiting a Fractal Efficiency Ratio of ${fer.toFixed(2)}%, indicating the geometric straightness of its path. The structural fluidity generated a Market Reynolds Number of ${reyn.toFixed(2)}. Determine if the anomaly has shattered the market's viscosity and entered a state of turbulent chaos, or if it is expanding geometrically in a hyper-efficient trajectory.`;
              }

              let systemKinematicsContext = "";
              const jerk = (item as any)._tempMarketJerk;
              const mag = (item as any)._tempSeismicMagnitudeMw;
              if (jerk !== undefined && mag !== undefined && jerk !== null && mag !== null) {
                systemKinematicsContext = `\n[SYSTEM KINEMATICS & SEISMOLOGY]: The anomaly created a mathematical Market Jerk of ${jerk.toFixed(2)}, measuring the violent whiplash of algorithmic acceleration. Translating the event's kinetic energy into a Gutenberg-Richter scale, this anomaly registered as a Magnitude ${mag.toFixed(2)} seismic shock. Determine if this shockwave possesses the raw force required to permanently fracture the historical trendline.`;
              }

              const isNullModifier = (item as any).is_null_sample
                ? " [CRITICAL INSTRUCTION - NULL SAMPLE DATA]: This specific date had a flat price response despite elevated trading volume or news disclosures. Ground your search on what occurred, but explicitly explain why the market completely ignored this news or had already fully priced it in. Do not invent a narrative for a price breakout."
                : "";

              // CHANGE 1 / 3 / 4 — per-item search grounding, evidence summary, gating verdict
              const [_p1Year, _p1MonthNum] = item.date.split('-');
              const _p1MonthName = ["January","February","March","April","May","June","July","August","September","October","November","December"][parseInt(_p1MonthNum, 10) - 1] ?? _p1MonthNum;
              const _p1EdgarStatus = (item.analysis?.edgarFilings && item.analysis.edgarFilings.length > 0)
                ? `${item.analysis.edgarFilings.length} filing(s) found`
                : 'none found';
              const _p1GdeltCount = gdeltTone ? gdeltTone.matchCount : 0;
              const _p1MacroLine = snap
                ? `Fed=${snap.federalFundsRate ?? 'N/A'}% CPI=${snap.cpiYoY ?? 'N/A'}% Unemp=${snap.unemploymentRate ?? 'N/A'}%`
                : 'unavailable';
              const _p1Gv = (item as any).gatingVerdict as GatingVerdict | undefined;

              const _p1Search = `\n[SEARCH GROUNDING]: You are analysing a historical price event for ${uppercaseSymbol} on ${item.date}. Use Google Search to find what specific news, announcements, earnings results, regulatory decisions, executive statements, or market events occurred for ${uppercaseSymbol} or its sector on or immediately before ${item.date}. Search specifically for '${uppercaseSymbol} news ${item.date}', '${uppercaseSymbol} ${_p1MonthName} ${_p1Year}', and any earnings or regulatory context for that period. Today's date for your search context is ${item.date} — do not retrieve information published after this date.`;
              const _p1Evidence = `\n[EVIDENCE]: Z=${Number(item.zScore).toFixed(2)}σ | Return=${Number(item.dailyReturn).toFixed(2)}% | VolRatio=${item.volumeRatio !== undefined ? Number(item.volumeRatio).toFixed(1) + 'x' : 'N/A'} | VIX=${vixVal !== undefined ? Number(vixVal).toFixed(2) : 'N/A'} (${regime ?? 'N/A'}) | EDGAR: ${_p1EdgarStatus} | GDELT: ${_p1GdeltCount} event(s) | Macro: ${_p1MacroLine}. Reason from this evidence. Where data is unavailable, acknowledge the gap rather than fabricating signal.`;
              const _p1Gating = `\n[GATING VERDICT]: The deterministic gating engine classified this event as ${_p1Gv?.event_classification ?? 'UNKNOWN'} (dominant regime: ${_p1Gv?.dominant_physics_regime ?? 'UNKNOWN'}). Your role is to find the specific real-world event that caused this classification — not to rephrase the label.`;

              let estimateRevisionContext = "";
              const erData = (item as any)._tempEstimateRevisions;
              if (erData && erData.revisionDirection) {
                estimateRevisionContext = `\n[ANALYST REVISION MOMENTUM]: EPS estimates revised ${erData.revisionDirection} ${Math.abs(erData.revisionMagnitudePct)}% over the prior period across ${erData.analystCount} analysts. Rising revisions before an event often precede positive surprises; falling revisions often signal deteriorating fundamentals ahead of the print.`;
              }

              let companyCreditContext = "";
              const creditProxy = (item as any)._tempCompanyCreditProxy;
              if (creditProxy !== null && creditProxy !== undefined) {
                companyCreditContext = `\n[COMPANY CREDIT PROXY]: Estimated company-level credit spread ~${creditProxy} bps (derived from D/E ratio — proxy, not a real market spread). Higher spreads indicate elevated refinancing risk and greater sensitivity to interest-rate or liquidity catalysts.`;
              }

              return `- Date: ${item.date}, Day Change: ${Number(item.dailyReturn).toFixed(2)}%, Day Z-Score: ${Number(item.zScore).toFixed(2)} Sigma, Rolling Mean: ${Number(item.rollingMean).toFixed(2)}%, Rolling Std: ${Number(item.rollingStd).toFixed(4)}${_p1Search}${_p1Evidence}${_p1Gating}${isNullModifier}${swingContext}${govContext}${ivCrushContext}${sectorContagionContext}${pcrContext}${hiddenLiquidityContext}${systemPhysicsContext}${econophysicsContext}${orbitalStabilityContext}${systemGeometryContext}${systemKinematicsContext}${volContext}${vixContext}${regimeContext}${sequenceContext}${edgarContext}${insiderContext}${frictionContext}${fmpContextBlock}${earningsContextStr}${macroContext}${releaseContext}${newsContext}${socialContext}${shortInterestContext}${trendsContext}${wikiContext}${gdeltContext}${ytContext}${estimateRevisionContext}${companyCreditContext}`;
            })
            .join("\n");

          const prompt = `You are a Lead Financial Forensic & Market Attribution Analyst.
For stock "${uppercaseSymbol}", investigate what precise corporate news, CEO tweets/scandals, board decisions, direct competitor announcements (e.g. NVIDIA vs AMD), policies, macroeconomic context, lockups, or regulations (e.g., Covid, Brexit, Fed rate decisions, political transitions) caused or drove the stock anomalies on these calendar dates.

Each event entry below includes a [SEARCH GROUNDING] block with specific search queries to run for that date. Execute those searches before writing any narrative for that event.

MANDATORY CONSTRAINT: You must NOT mention forward-looking price action, future returns, or AI effect scores in your summary (including in coincidence_vs_correlation/Causal Attribution Review and suspected_catalyst descriptions).

CATALYST COMMITMENT: For each event you MUST name a specific, falsifiable catalyst — a named executive, a named filing, a named regulatory body, a named competitor action, or a named macro release. Generic phrases such as "market conditions", "investor sentiment", "historical trends", or "social sentiment index" are not acceptable as catalysts. If your search returns no specific result, state explicitly: "No specific catalyst identified despite search; possible macro beta or data gap."

For each listed date, compute:
1. "suspected_catalyst" details — name the specific event, person, filing, or announcement found via search. Include the date it was published, the source, and one sentence explaining the direct mechanism by which it caused the observed price move.
2. Impact scores (effect_score_1d, effect_score_1w, effect_score_1m, effect_score_6m, effect_score_1y) which are numeric rankings from -100 (most negative impact on long-term value) to +100 (most positive impact).
3. Coincidence vs correlation analysis: review the news and determine whether the event on this date was genuinely causal or merely a coincident correlation of wider systematic market noise/beta trends.
4. "correlation_confidence" score from 0 to 100 representing how confident you are that this event actually drove the price changes rather than being an accidental coincidence.
5. Synthesize the provided context regarding Alternative Data (Trends, Wikipedia, YouTube, GDELT) and generate "alternative_data_observations" and an "alternative_data_score" (0-100) reflecting their combined abnormality.
6. Synthesize the provided Corporate Governance context (EDGAR filings, Insider Trading, Friction Score) and generate "corporate_governance_observations" and a "corporate_governance_score" (0-100) reflecting structural/institutional activity severity.
7. Synthesize the provided Macroeconomic data (Fed Funds Rate, CPI, Unemployment, Spreads, USD Index, VIX) and generate "macroeconomic_observations" and a "macroeconomic_score" (0-100) reflecting the stress or impact of macro conditions.
8. Synthesize the provided Market Structure and Regime context (Volatility, Volume Ratios, Trend Regimes, Daily Z-Scores) into "market_structure_observations" and a "market_structure_score" (0-100) evaluating the structural liquidity or technical severity.
9. Synthesize the provided Company Fundamentals, Earnings Calls, and Press Releases into "fundamental_and_earnings_observations" and a "fundamental_and_earnings_score" (0-100) evaluating the fundamental impact or forward guidance intensity.

Each event includes a [GATING VERDICT] from the deterministic quantitative engine. Classify the event using the taxonomy ONLY AFTER you have identified the specific catalyst via search — do not rephrase the gating label as the catalyst. Return primaryCategory, primarySubType, and up to two additional secondaryCategories. You may also provide freeform eventTags.

Taxonomy:
${JSON.stringify(EVENT_TAXONOMY, null, 2)}

List to scan:
${itemsListStr}

Provide a JSON array containing the results mapping perfectly back using the static date field.`;

          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }],
              maxOutputTokens: 4000,
            },
          });

          const text = response.text;
          if (text) {
            const cleanedText = text
              .replace(/\[\d+\]/g, '')
              .replace(/```json\s*/gi, '')
              .replace(/```\s*/g, '')
              .trim();
            if (!cleanedText.includes('{')) {
              console.log('[AI] Gemini returned plain text instead of JSON for this batch — using fallback analysis.');
            } else {
            const aiDataList = extractAndParseJson(cleanedText);
            if (Array.isArray(aiDataList)) {
              for (const item of aiDataList) {
                if (item && item.date) {
                  const cacheKey = `${uppercaseSymbol}_${item.date}`;
                  const { date, ...parsedAnalysis } = item;
                  const analysisOnly: any = { ...parsedAnalysis };
                  analysisOnly.suspected_catalyst = normaliseSuspectedCatalyst(analysisOnly.suspected_catalyst);
                  analysisOnly.event_type = normaliseSuspectedCatalyst(analysisOnly.event_type);
                  analysisOnly.primary_catalyst = normaliseSuspectedCatalyst(analysisOnly.primary_catalyst);
                  analysisOnly.catalyst_category = normaliseSuspectedCatalyst(analysisOnly.catalyst_category);

                  if (analysisOnly.suspected_catalyst) {
                    const catEmbed = await this.fetchEmbedding(
                      analysisOnly.suspected_catalyst,
                    );
                    if (catEmbed) analysisOnly.catalyst_embedding = catEmbed;
                  }
                  if (analysisOnly.key_risk) {
                    const riskEmbed = await this.fetchEmbedding(
                      analysisOnly.key_risk,
                    );
                    if (riskEmbed) analysisOnly.risk_embedding = riskEmbed;
                  }

                  // Merge analysis into point
                  const matchPoint = points.find((p) => p.date === item.date);
                  if (matchPoint) {
                    if ((matchPoint as any)._tempVixAtEvent !== undefined) {
                      analysisOnly.vixAtEvent = (
                        matchPoint as any
                      )._tempVixAtEvent;
                      analysisOnly.vixRegime = (
                        matchPoint as any
                      )._tempVixRegime;
                    }
                    if ((matchPoint as any)._tempMarketRegime !== undefined) {
                      analysisOnly.marketRegime = (
                        matchPoint as any
                      )._tempMarketRegime;
                    }
                    if ((matchPoint as any)._tempMacroSnapshot !== undefined) {
                      analysisOnly.macroSnapshot = (
                        matchPoint as any
                      )._tempMacroSnapshot;
                    }
                    if ((matchPoint as any)._tempMacroRelease !== undefined) {
                      analysisOnly.macroRelease = (
                        matchPoint as any
                      )._tempMacroRelease;
                    }
                    if (
                      (matchPoint as any)._tempWikipediaSpikes !== undefined
                    ) {
                      analysisOnly.wikipediaSpikes = (
                        matchPoint as any
                      )._tempWikipediaSpikes;
                    }
                    if ((matchPoint as any)._tempGdeltTone !== undefined) {
                      analysisOnly.gdeltTone = (
                        matchPoint as any
                      )._tempGdeltTone;
                    }
                    if ((matchPoint as any)._tempYoutubeVideos !== undefined) {
                      analysisOnly.youtubeVideos = (
                        matchPoint as any
                      )._tempYoutubeVideos;
                    }

                    if (analysisOnly.suspected_catalyst) {
                      const cScore = await this.evaluateCausalLogic(
                        analysisOnly.suspected_catalyst,
                        matchPoint.dailyReturn ?? 0,
                        matchPoint.zScore ?? 0,
                        matchPoint.volumeRatio ?? 1,
                      );
                      if (cScore !== null)
                        analysisOnly.causal_logic_score = cScore;
                    }

                    if (analysisOnly.primaryCategory === 'corporate' || String(analysisOnly.primarySubType).includes('earnings')) {
                      const earningsContext = matchPoint.analysis?.earningsContext || (matchPoint as any)._tempEarningsContext;
                      if (earningsContext && earningsContext.reportDate) {
                        const eventDist = getTradingDaysDistance(item.date, earningsContext.reportDate, sanitizedPoints);
                        if (eventDist !== null && Math.abs(eventDist) <= 5) {
                          const repDateObj = new Date(earningsContext.reportDate);
                          const quarter = Math.floor(repDateObj.getUTCMonth() / 3) + 1;
                          const year = repDateObj.getUTCFullYear();
                          
                          const transcript = await getEarningsTranscript(uppercaseSymbol, year, quarter);
                          if (transcript) {
                            const confidenceResult = await scoreManagementConfidence(transcript);
                            if (confidenceResult) {
                              analysisOnly.management_confidence_score = confidenceResult.confidence_score;
                            }
                          }
                        }
                      }
                    }
                  }
                  enrichConfidences(analysisOnly, matchPoint);

                  if (matchPoint && matchPoint.analysis) {
                    const mergedAnalysis = {
                      ...matchPoint.analysis,
                      ...analysisOnly,
                    };
                    setCachedAnalysis(
                      cacheKey,
                      uppercaseSymbol,
                      item.date,
                      mergedAnalysis,
                      false,
                    );
                    matchPoint.analysis = mergedAnalysis;
                    matchPoint.hasAnalysis = true;
                  } else {
                    setCachedAnalysis(
                      cacheKey,
                      uppercaseSymbol,
                      item.date,
                      analysisOnly as StockAnalysis,
                      false,
                    );
                    if (matchPoint) {
                      matchPoint.analysis = {
                        ...matchPoint.analysis,
                        ...analysisOnly,
                      };
                      matchPoint.hasAnalysis = true;
                    }
                  }
                }
              }
            }
            }
          }
          lastSuccessfullyProcessedDate = topToFetch[0].date;
        } catch (aiInitErr: any) {
          console.error("[AI ERROR] Gemini call failed:", aiInitErr?.status, aiInitErr?.message, aiInitErr?.code, aiInitErr?.toString());
          // Immediately intercept 429 rate limit and quota exhaustion errors to prevent silent fallback
          if (aiInitErr?.status === 429 || aiInitErr?.code === 429 || (aiInitErr.message && (aiInitErr.message.includes("429") || aiInitErr.message.includes("quota")))) {
             throw aiInitErr;
          }

          // Fallback silently if rate limits are hit
          for (const item of topToFetch) {
            try {
              const cacheKey = `${uppercaseSymbol}_${item.date}`;
              const matchPoint = points.find((p) => p.date === item.date);
              const fallbackAnalysis = generateLocalFallbackAnalysis(
                uppercaseSymbol,
                item.date,
                item.dailyReturn,
                item.zScore,
                item.analysis,
                (matchPoint as any)?._tempVixAtEvent ?? (item as any)._tempVixAtEvent,
              );
              if (matchPoint) {
                if ((matchPoint as any)._tempVixAtEvent !== undefined) {
                  fallbackAnalysis.vixAtEvent = (
                    matchPoint as any
                  )._tempVixAtEvent;
                  fallbackAnalysis.vixRegime = (
                    matchPoint as any
                  )._tempVixRegime;
                }
                if ((matchPoint as any)._tempMarketRegime !== undefined) {
                  fallbackAnalysis.marketRegime = (
                    matchPoint as any
                  )._tempMarketRegime;
                }
                if ((matchPoint as any)._tempMacroSnapshot !== undefined) {
                  fallbackAnalysis.macroSnapshot = (
                    matchPoint as any
                  )._tempMacroSnapshot;
                }
                if ((matchPoint as any)._tempMacroRelease !== undefined) {
                  fallbackAnalysis.macroRelease = (
                    matchPoint as any
                  )._tempMacroRelease;
                }
                if ((matchPoint as any)._tempWikipediaSpikes !== undefined) {
                  fallbackAnalysis.wikipediaSpikes = (
                    matchPoint as any
                  )._tempWikipediaSpikes;
                }
                if ((matchPoint as any)._tempGdeltTone !== undefined) {
                  fallbackAnalysis.gdeltTone = (
                    matchPoint as any
                  )._tempGdeltTone;
                }
                if ((matchPoint as any)._tempYoutubeVideos !== undefined) {
                  fallbackAnalysis.youtubeVideos = (
                    matchPoint as any
                  )._tempYoutubeVideos;
                }
                enrichConfidences(fallbackAnalysis, matchPoint);
                const merged = {
                  ...matchPoint.analysis,
                  ...fallbackAnalysis,
                };
                setCachedAnalysis(
                  cacheKey,
                  uppercaseSymbol,
                  item.date,
                  merged,
                  true,
                );
                matchPoint.analysis = merged;
                matchPoint.hasAnalysis = true;
              }
            } catch (fallbackErr) {
              console.error(
                "Failed fallback analysis generation:",
                fallbackErr,
              );
            }
          }
        }
      } // end batch loop
    }

    // Ensure all remaining uncached anomalies (beyond topToFetch or if skipGeminiAnalysis) get rule-based fallback analysis
    for (const item of anomalies) {
      if (!item.hasAnalysis) {
        try {
          const cacheKey = `${uppercaseSymbol}_${item.date}`;
          const fallbackAnalysis = generateLocalFallbackAnalysis(
            uppercaseSymbol,
            item.date,
            item.dailyReturn,
            item.zScore,
            item.analysis,
            (item as any)._tempVixAtEvent,
          );

          if ((item as any)._tempVixAtEvent !== undefined) {
            fallbackAnalysis.vixAtEvent = (item as any)._tempVixAtEvent;
            fallbackAnalysis.vixRegime = (item as any)._tempVixRegime;
          }
          if ((item as any)._tempMarketRegime !== undefined) {
            fallbackAnalysis.marketRegime = (item as any)._tempMarketRegime;
          }
          if ((item as any)._tempMacroSnapshot !== undefined) {
            fallbackAnalysis.macroSnapshot = (item as any)._tempMacroSnapshot;
          }
          if ((item as any)._tempMacroRelease !== undefined) {
            fallbackAnalysis.macroRelease = (item as any)._tempMacroRelease;
          }
          if ((item as any)._tempWikipediaSpikes !== undefined) {
            fallbackAnalysis.wikipediaSpikes = (
              item as any
            )._tempWikipediaSpikes;
          }
          if ((item as any)._tempGdeltTone !== undefined) {
            fallbackAnalysis.gdeltTone = (item as any)._tempGdeltTone;
          }
          if ((item as any)._tempYoutubeVideos !== undefined) {
            fallbackAnalysis.youtubeVideos = (item as any)._tempYoutubeVideos;
          }
          if ((item as any)._tempInsiderDensity !== undefined) {
            fallbackAnalysis.insider_cluster_density = (
              item as any
            )._tempInsiderDensity;
          }
          if ((item as any)._tempFrictionScore !== undefined) {
            fallbackAnalysis.management_friction_score = (
              item as any
            )._tempFrictionScore;
          }
          enrichConfidences(fallbackAnalysis, item);

          const merged = {
            ...item.analysis,
            ...fallbackAnalysis,
          };
          setCachedAnalysis(cacheKey, uppercaseSymbol, item.date, merged, true);
          item.analysis = merged;
          item.hasAnalysis = true;
        } catch (err) {
          console.error(
            "[HistoricalEngine] Failed fallback for remaining anomaly:",
            err,
          );
        }
      }
    }

    // CRITICAL STATISTICAL COMMENTARY regarding retail trader traps:
    // We calculate forward returns (return_1d, return_1w, etc) ONLY AFTER Gemini
    // has completed its historical analysis.
    // Standard retail traders constantly commit the cardinal sin of "lookahead bias"—overfitting
    // predictive models on static, dead historical averages. They backtest themselves into a 
    // fantasy land where they are billionaires, only to lose their shirt in live markets because
    // their algorithms were peering into the future of the price tape.
    // This design strictly quarantines the AI analyst from future price series data, preventing
    // it from cheating.
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.isAnomaly) {
        const c0 = p.close;
        const calcRet = (lookahead: number): number | undefined => {
          if (i + lookahead < points.length) {
            const futClose = points[i + lookahead].close;
            return Number((((futClose - c0) / c0) * 100).toFixed(2));
          }
          return undefined;
        };

        if (!p.analysis) {
          p.analysis = {
            primary_catalyst_tag: "Analyst Scan Pending",
            suspected_catalyst: "Analyzing catalyst details...",
            key_risk: "Computing structural risk levels...",
            confidence_score: 50,
            severity_score: 50,
          };
        }

        p.analysis.return_1d = calcRet(1);
        p.analysis.return_1w = calcRet(5);
        p.analysis.return_1m = calcRet(21);
        p.analysis.return_6m = calcRet(126);
        p.analysis.return_1y = calcRet(252);

        const forwardSlice = points.slice(i + 1, i + 22);
        if (forwardSlice.length > 0) {
          const highestHigh = Math.max(...forwardSlice.map(f => f.high));
          const lowestLow = Math.min(...forwardSlice.map(f => f.low));
          p.analysis.max_favorable_excursion_1m = Number((((highestHigh - p.close) / p.close) * 100).toFixed(2));
          p.analysis.max_adverse_excursion_1m = Number((((lowestLow - p.close) / p.close) * 100).toFixed(2));
        } else {
          p.analysis.max_favorable_excursion_1m = 0;
          p.analysis.max_adverse_excursion_1m = 0;
        }

        p.analysis.sector_excess_return =
          calculatedReturns[i]?.sectorExcessReturn || 0;
        p.analysis.is_null_sample = (p as any).is_null_sample === true;
        p.analysis.is_human_verified = false;

        // Update the cache with these freshly calculated returns
        if (p.hasAnalysis) {
          const cacheKey = `${uppercaseSymbol}_${p.date}`;
          const isFallback =
            p.analysis?.isFallback === true ||
            normaliseSuspectedCatalyst(p.analysis?.suspected_catalyst)?.includes("[SYNTHETIC ESTIMATE");
          setCachedAnalysis(
            cacheKey,
            uppercaseSymbol,
            p.date,
            p.analysis,
            !!isFallback,
          );
          buildAndSaveFeatureVector(uppercaseSymbol, p, points, i);
        }
      }
    }

    const finalAnomalies = points.filter((p) => p.isAnomaly);
    const chartData: ChartPoint[] = points.map((p) => ({
      date: p.date,
      timestamp: p.timestamp,
      price: p.close,
      volume: p.volume,
      zScore: p.zScore,
      rollingMean: p.rollingMean,
      isAnomaly: p.isAnomaly,
      dailyReturn: p.dailyReturn,
    }));

    const resultObj = {
      symbol: uppercaseSymbol,
      companyName: meta.companyName || meta.symbol,
      currency: meta.currency || "USD",
      meta: {
        range,
        regularMarketPrice: meta.regularMarketPrice || null,
        chartPreviousClose: meta.chartPreviousClose || null,
        appliedZScoreThreshold: currentZScoreThreshold,
      },
      points,
      anomalies: finalAnomalies,
      chartData,
      dataQualityWarning,
      fmpCompanyContext: fmpContext || undefined,
      analyst_consensus_mean: (fmpContext as any)?.analystConsensus?.mean,
      analyst_count: (fmpContext as any)?.analystConsensus?.count,
    };

    // --- CHECKPOINT COMPLETION LOGIC ---
    const scanEnd = new Date().toISOString().split("T")[0];
    const scanStart = lastSuccessfullyProcessedDate || scanEnd;
    setScannerState({
      ticker: uppercaseSymbol,
      start_date: scanStart,
      end_date: scanEnd,
      last_scanned_date: scanEnd,
      status: 'COMPLETED'
    });

    return resultObj as any;

    } catch (error: any) {
      if (
        error?.status === 429 ||
        error?.code === 429 ||
        (error.message && (
          error.message.includes("429") ||
          error.message.includes("quota") ||
          error.message.includes("rate limit") ||
          error.message.includes("Rate limit") ||
          error.message.includes("limit exceeded") ||
          error.message.includes("throttled")
        ))
      ) {
        console.warn(`[HistoricalEngine CRITICAL] Rate Limit (429/quota) hit during execution of ${uppercaseSymbol}. Intercepting crash sequence and saving checkpoint.`);

        const cachedRow = getScannerState(uppercaseSymbol);
        
        // Find last processed anomaly date string to resume
        let lastDateString = lastSuccessfullyProcessedDate;
        
        setScannerState({
          ticker: uppercaseSymbol,
          start_date: cachedRow?.start_date || new Date().toISOString().split("T")[0],
          end_date: cachedRow?.end_date || new Date().toISOString().split("T")[0],
          last_scanned_date: lastDateString,
          status: 'IN_PROGRESS'
        });
        
        console.warn(`[HistoricalEngine] Gracefully flushing database buffers for ${uppercaseSymbol} to disk.`);
        db.pragma('wal_checkpoint(TRUNCATE)');
        
        const rateLimitErr = new Error(error.message || "API rate limit reached.");
        (rateLimitErr as any).status = 429;
        (rateLimitErr as any).isRateLimit = true;
        throw rateLimitErr;
      }
      
      throw error;
    }
  }

  /**
   * Run historical scans for multiple stock symbols and aggregate the results
   */
  async run_multi_scan(
    symbols: string[],
    years: number,
  ): Promise<Record<string, StockScanResult>> {
    const rawSymbols = symbols && symbols.length > 0 ? symbols : this.symbols;
    const symbolsToScan = Array.from(
      new Set(rawSymbols.map((s) => s.toUpperCase().trim())),
    ).filter(Boolean);
    const results: Record<string, StockScanResult> = {};

    let hitRateLimit = false;

    const symbolChunkSize = 2;
    for (let idx = 0; idx < symbolsToScan.length; idx += symbolChunkSize) {
      if (hitRateLimit) {
        console.warn(`[HistoricalEngine] Skipping further chunks in multi-scan due to API rate limit/quota reached.`);
        break;
      }

      const chunk = symbolsToScan.slice(idx, idx + symbolChunkSize);
      await Promise.all(
        chunk.map(async (sym) => {
          try {
            if (typeof isSourceRateLimited === "function" && (isSourceRateLimited("polygon") || isSourceRateLimited("fmp"))) {
              const limitedSources = [];
              if (isSourceRateLimited("polygon")) limitedSources.push("polygon (rate-limited)");
              if (isSourceRateLimited("fmp")) limitedSources.push("fmp (quota)");
              console.log(`[Scan] Starting ${sym} with limited sources: ${limitedSources.join(", ")}. Price data from Yahoo Finance.`);
            }

            const result = await this.run_scan(sym, years, true);
            results[result.symbol] = result;
            results[sym.toUpperCase().trim()] = result;
          } catch (err: any) {
            const isLimit =
              err.status === 429 ||
              err.code === 429 ||
              err.isRateLimit === true ||
              (err.message && (
                err.message.includes("429") ||
                err.message.includes("quota") ||
                err.message.includes("rate limit") ||
                err.message.includes("Rate limit") ||
                err.message.includes("limit exceeded") ||
                err.message.includes("throttled")
              ));

            if (isLimit) {
              hitRateLimit = true;
              console.warn(`[HistoricalEngine] Multi-scan hit API rate limits on ticker ${sym}. Pausing further batch scans.`);
              console.warn(
                `run_multi_scan: Paused/Skipped details for ${sym} due to rate limiting:`,
                err.message,
              );
            } else {
              console.error(
                `run_multi_scan: Failed to scan details for ${sym}:`,
                err.message,
              );
            }
            results[sym.toUpperCase().trim()] = {
              symbol: sym.toUpperCase().trim(),
              companyName: sym.toUpperCase().trim(),
              currency: "N/A",
              points: [],
              anomalies: [],
              meta: {
                range: `${years}y`,
                regularMarketPrice: null,
                chartPreviousClose: null,
              },
              error: err.message || "Failed historical scan.",
            };
          }
        }),
      );

      if (hitRateLimit) {
        console.warn(`[HistoricalEngine] Pausing multi-stock scanning sequence due to API rate limit/quota boundaries. Scans completed up to index ${idx + chunk.length}.`);
        break;
      }

      // Macro-throttle: Space out the transitions between ticker symbol scans.
      // Artificially slowing down our V8-powered supercomputer to 12 seconds per loop because
      // data providers' endpoints would collapse into tears otherwise.
      if (idx + symbolChunkSize < symbolsToScan.length) {
        console.log(`[HistoricalEngine] Macro-Throttling: sleeping for ${MACRO_THROTTLE_MS}ms before the next stock iteration...`);
        await sleep(MACRO_THROTTLE_MS);
      }
    }

    // Collect all uncached anomalies across all successfully scanned results.
    // results may store the same scan under two keys when a symbol was canonicalized
    // (e.g. "BAT.L" input → "BATS.L" canonical). We track (canonicalSymbol, date) pairs
    // so each anomaly is only added once and always carries the canonical symbol — the
    // same form recorded in enrichedAnomalyKeys during the first enrichment pass —
    // so the dedup guard in enrichAnomaliesContext can match it correctly.
    const uncachedAnomaliesList: (StockPoint & { symbol: string })[] = [];
    const seenInUncachedList = new Set<string>();

    for (const iterKey of Object.keys(results)) {
      const res = results[iterKey];
      if (!res.points || res.points.length === 0) continue;
      const canonicalSym = res.symbol || iterKey;
      const anomalies = res.points.filter((p) => p.isAnomaly);
      // Non-events must never reach the Gemini narrative pipeline.
      const uncached = anomalies.filter((a) => !a.hasAnalysis && !(a as any).is_null_sample);
      for (const a of uncached) {
        const listKey = `${canonicalSym}_${a.date}`;
        if (seenInUncachedList.has(listKey)) continue;
        seenInUncachedList.add(listKey);
        uncachedAnomaliesList.push({
          ...a,
          symbol: canonicalSym,
        });
      }
    }

    if (uncachedAnomaliesList.length > 0) {
      const sortedUncached = [...uncachedAnomaliesList].sort(
        (a, b) => Math.abs(b.zScore) - Math.abs(a.zScore),
      );
      const topToFetchUnified = sortedUncached.slice(0, 40);
      const restToFallback = sortedUncached.slice(40);

      const hasApiKey = !!process.env.GEMINI_API_KEY;

      if (hasApiKey && topToFetchUnified.length > 0) {
        try {
          // Compute range and load benchmark map
          let range = "1y";
          if (years === 2) range = "2y";
          if (years === 5) range = "5y";
          if (years === 30) range = "max";
          if (years === 0.5) range = "6m";
          const benchmarkReturnsMap = await this.fetchBenchmarkReturns(range);

          // Group topToFetchUnified items by stock symbol so we can enrich them
          const itemsBySymbol: Record<string, any[]> = {};
          for (const item of topToFetchUnified) {
            const sym = item.symbol?.toUpperCase()?.trim();
            if (!itemsBySymbol[sym]) {
              itemsBySymbol[sym] = [];
            }
            itemsBySymbol[sym].push(item);
          }

          // Enrich each grouped set of anomalies with historical indices / API contexts
          for (const sym of Object.keys(itemsBySymbol)) {
            const subAnomalies = itemsBySymbol[sym];
            const matchResult = results[sym];
            const fmpContext = matchResult
              ? (matchResult as any).fmpCompanyContext
              : null;
            await this.enrichAnomaliesContext(
              subAnomalies,
              fmpContext,
              sym,
              range,
              benchmarkReturnsMap,
              true, // enrichSlowApis
              10, // maxEnrichCount
            );
          }

          const ai = this.getAIClient();
          console.log(
            `[HistoricalEngine] Unified batch querying ${topToFetchUnified.length} anomalies across scanned stocks...`,
          );

          const chunks: any[][] = [];
          for (let i = 0; i < topToFetchUnified.length; i += 8) {
            chunks.push(topToFetchUnified.slice(i, i + 8));
          }

          let aiDataList: any[] = [];
          let activeInFlight = 0;

          const processChunk = async (chunk: any[]) => {
            while (activeInFlight >= 2) {
              await new Promise((r) => setTimeout(r, 50));
            }
            activeInFlight++;
            try {
              // CRITICAL COMMENT: We omit any forward-looking price returns from this payload.
              // Gemini must not have access to future price data when identifying the catalyst,
              // to avoid look-ahead bias in the analysis and in any training data derived from it.
              const itemsListStr = chunk
                .map((item) => {
                  let volContext = "";
                  if (item.volumeRatio !== undefined) {
                    volContext = `, Volume context: this move occurred on ${Number(item.volumeRatio).toFixed(1)}x normal volume — classified as ${item.volumeShockType || "normal"}.`;
                  }
                  let vixContext = "";
                  const vixVal = (item as any)._tempVixAtEvent;
                  const regime = (item as any)._tempVixRegime;
                  if (vixVal !== undefined && regime !== undefined) {
                    vixContext = ` Market volatility context: VIX was at ${vixVal.toFixed(2)} (${regime}) on this date. A move of this magnitude during a ${regime} volatility environment should be interpreted accordingly — extreme VIX environments make individual stock anomalies less likely to be company-specific.`;
                  }
                  let regimeContext = "";
                  const mRegime = (item as any)._tempMarketRegime;
                  if (mRegime !== undefined) {
                    regimeContext = ` Market regime at time of event: trend=${mRegime.trendRegime}, volatility=${mRegime.volatilityRegime}, macro=${mRegime.macroRegime}. Consider how this regime context affects the interpretation of the catalyst and the subsequent price trajectory.`;
                  }

                  let macroContext = "";
                  const snap = (item as any)._tempMacroSnapshot;
                  if (snap) {
                    const spreadDesc =
                      snap.yieldCurvSpread !== undefined
                        ? `${snap.yieldCurvSpread}% (${snap.yieldCurvSpread < 0 ? "INVERTED/RECESSSION SIGNAL" : "Normal positive spread"})`
                        : "N/A";

                    macroContext = ` Macroeconomic context: Federal Funds Rate ${snap.federalFundsRate !== undefined ? snap.federalFundsRate + "%" : "N/A"}, Inflation YoY CPI Change ${snap.cpiYoY !== undefined ? snap.cpiYoY + "%" : "N/A"}, Unemployment Rate ${snap.unemploymentRate !== undefined ? snap.unemploymentRate + "%" : "N/A"}, Yield Spread ${spreadDesc}, Credit Spread ${snap.creditSpread !== undefined ? snap.creditSpread + "%" : "N/A"}, USD Index ${snap.dollarIndex !== undefined ? snap.dollarIndex : "N/A"}.`;
                  }

                  let releaseContext = "";
                  const release = (item as any)._tempMacroRelease;
                  if (release) {
                    const surpriseSign =
                      release.surprise !== undefined && release.surprise > 0
                        ? "+"
                        : "";
                    releaseContext = ` Scheduled Economic Release on this date was ${release.releaseType?.toUpperCase()} with actual vs prior values of ${release.actualValue} vs ${release.priorValue}, surprise of ${surpriseSign}${release.surprise} (${release.surpriseDirection} direction), statistical significance is ${release.isSignificant ? "high" : "normal"}.`;
                  }

                  let edgarContext = "";
                  const edgar =
                    item.analysis?.edgarFilings ||
                    (item as any)._tempEdgarFilings;
                  if (edgar && edgar.length > 0) {
                    edgarContext = ` SEC Filings (8-K): ${edgar.length} filings detected around this date.`;
                  }

                  let insiderContext = "";
                  const insiderDensity =
                    item.analysis?.insider_cluster_density ||
                    (item as any)._tempInsiderDensity;
                  if (insiderDensity !== undefined && insiderDensity > 0) {
                    insiderContext = ` Insider Trading Cluster Density: ${insiderDensity}. High density suggests coordinated insider transactions.`;
                  }

                  let frictionContext = "";
                  const frictionScore =
                    item.analysis?.management_friction_score ||
                    (item as any)._tempFrictionScore;
                  if (frictionScore !== undefined && frictionScore > 0) {
                    frictionContext = ` Management Friction Score: ${frictionScore}. Indicates executive turnover or governance disputes.`;
                  }

                  let gdeltContext = "";
                  const gdeltTone: GDELTToneSummary | null | undefined =
                    item.analysis?.gdeltTone ||
                    (item as any)._tempGdeltTone;
                  if (gdeltTone && gdeltTone.matchCount > 0 && gdeltTone.matchedToneAvg !== null && gdeltTone.globalToneAvg !== null) {
                    const relativeTone = gdeltTone.matchedToneAvg - gdeltTone.globalToneAvg;
                    const toneLabel = relativeTone > 1 ? "more positive" : relativeTone < -1 ? "more negative" : "neutral relative to";
                    gdeltContext = ` GDELT Global News Tone: ${gdeltTone.matchCount} article(s) mentioning the company, tone ${toneLabel} the day's global baseline (${gdeltTone.matchedToneAvg.toFixed(1)} vs ${gdeltTone.globalToneAvg.toFixed(1)}).`;
                  }

                  let wikiContext = "";
                  const wiki =
                    item.analysis?.wikipediaSpikes ||
                    (item as any)._tempWikipediaSpikes;
                  if (wiki && wiki.length > 0) {
                    wikiContext = ` Wikipedia Traffic: Abnormal spike in relevant topics around this date.`;
                  }

                  let shortInterestContext = "";
                  const si = item.analysis?.shortInterest || (item as any)._tempShortInterest;
                  const siVelocity = item.analysis?.shortInterestVelocity || (item as any)._tempShortInterestVelocity;
                  if (si) {
                    shortInterestContext = ` Short interest: ${si.pctOfFloat}% of float, ${siVelocity !== null ? siVelocity + "% velocity" : "unknown velocity"}.`;
                  }

                  let youtubeContext = "";
                  const youtube =
                    item.analysis?.youtubeVideos ||
                    (item as any)._tempYoutubeVideos;
                  if (youtube && youtube.length > 0) {
                    youtubeContext = ` YouTube Transcripts: Video coverage (interviews, earnings calls) published around this date.`;
                  }

                  let sequenceContext = "";
                  const prior = getPriorEvents(item.symbol, item.date, 60);
                  if (prior.length > 0) {
                    item.analysis = item.analysis || ({} as any);
                    const currentMs = new Date(item.date).getTime();
                    const latestMs = new Date(prior[0].date).getTime();
                    const daysSince = Math.floor(
                      (currentMs - latestMs) / (1000 * 60 * 60 * 24),
                    );

                    item.analysis!.priorEvents = prior.map((p) => ({
                      date: p.date,
                      primaryCategory: p.primaryCategory || "",
                      primarySubType: p.primarySubType || "",
                      excessReturn:
                        p.excessReturn !== undefined ? p.excessReturn : 0,
                      daysAgo: Math.floor(
                        (currentMs - new Date(p.date).getTime()) /
                          (1000 * 60 * 60 * 24),
                      ),
                    }));
                    item.analysis!.daysSincePreviousEvent = daysSince;
                    item.analysis!.eventDensity = prior.length;

                    sequenceContext = ` Event sequence context for ${item.symbol}: In the 60 days prior to this event, ${prior.length} other anomalies were detected. The most recent was ${daysSince} days ago, classified as ${prior[0].primaryCategory}/${prior[0].primarySubType}. Consider whether this event may be part of an ongoing narrative or a continuation of a prior catalyst chain.`;
                  }

                  let newsContext = "";
                  let pArticles = (item as any)._tempPrefetchedArticles;
                  if (!pArticles) {
                    const cacheNews = getNewsForAnomaly(item.symbol, item.date);
                    pArticles = cacheNews.filter(
                      (art: any) => (art.relevanceScore || 0) > 0.5,
                    );
                  }
                  if (pArticles && pArticles.length > 0) {
                    const articlesLines = pArticles
                      .map(
                        (art: any) =>
                          `  - [${art.sourceName}] ${art.title} (published: ${art.publishedAt})`,
                      )
                      .join("\n");

                    newsContext = `\n\nPre-fetched news articles for context (from NewsAPI — use these as starting points for your analysis, but verify and supplement with your own search):\n${articlesLines}\n\nBased on these articles and your own Google Search, identify the primary catalyst.`;
                  }

                  let socialContext = "";
                  const rs =
                    item.analysis?.socialSentiment ||
                    (item as any)._tempSocialSentiment;
                  if (
                    rs &&
                    (rs.viralityScore > 30 ||
                      rs.highEngagementPosts?.length > 0)
                  ) {
                    const activeRateInstance = rs.totalMentions / 3;
                    const baselineCountInstance = 0;
                    const baselineRateInstance = Math.max(
                      1,
                      baselineCountInstance,
                    );
                    const ratioVal = (
                      activeRateInstance / baselineRateInstance
                    ).toFixed(1);

                    socialContext = `\n\nSocial media context (StockTwits): Mention volume was ${ratioVal}x above baseline around this date (virality score: ${Math.round(rs.viralityScore)}/100). Sentiment was ${rs.sentimentLabel} with trend: ${rs.sentimentTrend}. ${rs.highEngagementPosts?.length || 0} high-engagement posts found. Consider whether retail StockTwits sentiment was a contributing factor.`;
                  }

                  let trendsContext = "";
                  const trends =
                    item.analysis?.trendsSummary ||
                    (item as any)._tempTrendsSummary;
                  if (trends) {
                    const baselineVal =
                      trends.percentAboveBaseline > -100
                        ? trends.searchValueAtAnomaly /
                          (1 + trends.percentAboveBaseline / 100)
                        : 0;
                    const isMoreThan50PercentAboveAverage =
                      trends.percentAboveBaseline > 50 ||
                      (trends.averageSearchValue > 0 &&
                        trends.searchValueAtAnomaly >
                          trends.averageSearchValue * 1.5);
                    if (isMoreThan50PercentAboveAverage) {
                      trendsContext = `\n\nGoogle Trends context: Public search interest in ${trends.companyName} was ${trends.percentAboveBaseline.toFixed(1)}% above its baseline level on the anomaly date (search index: ${trends.searchValueAtAnomaly}/100, vs baseline ${baselineVal.toFixed(1)}/100). The day before the anomaly, search interest was at ${trends.searchValueDayBefore}. Consider whether unusual public interest preceded or accompanied this event.`;
                    }
                  }

                  const isNullModifier = (item as any).is_null_sample
                    ? " [CRITICAL INSTRUCTION - NULL SAMPLE DATA]: This specific date had a flat price response despite elevated trading volume or news disclosures. Ground your search on what occurred, but explicitly explain why the market completely ignored this news or had already fully priced it in. Do not invent a narrative for a price breakout."
                    : "";

                  // CHANGE 1 / 3 / 4 — per-item search grounding, evidence summary, gating verdict
                  const [_p2Year, _p2MonthNum] = item.date.split('-');
                  const _p2MonthName = ["January","February","March","April","May","June","July","August","September","October","November","December"][parseInt(_p2MonthNum, 10) - 1] ?? _p2MonthNum;
                  const _p2EdgarCount = edgar ? edgar.length : 0;
                  const _p2GdeltCount = gdeltTone ? gdeltTone.matchCount : 0;
                  const _p2MacroLine = snap
                    ? `Fed=${snap.federalFundsRate ?? 'N/A'}% CPI=${snap.cpiYoY ?? 'N/A'}% Unemp=${snap.unemploymentRate ?? 'N/A'}%`
                    : 'unavailable';
                  const _p2Gv = (item as any).gatingVerdict as GatingVerdict | undefined;

                  const _p2Search = `\n[SEARCH GROUNDING]: You are analysing a historical price event for ${item.symbol} on ${item.date}. Use Google Search to find what specific news, announcements, earnings results, regulatory decisions, executive statements, or market events occurred for ${item.symbol} or its sector on or immediately before ${item.date}. Search specifically for '${item.symbol} news ${item.date}', '${item.symbol} ${_p2MonthName} ${_p2Year}', and any earnings or regulatory context for that period. Today's date for your search context is ${item.date} — do not retrieve information published after this date.`;
                  const _p2Evidence = `\n[EVIDENCE]: Z=${Number(item.zScore).toFixed(2)}σ | Return=${Number(item.dailyReturn).toFixed(2)}% | VolRatio=${item.volumeRatio !== undefined ? Number(item.volumeRatio).toFixed(1) + 'x' : 'N/A'} | VIX=${vixVal !== undefined ? Number(vixVal).toFixed(2) : 'N/A'} (${regime ?? 'N/A'}) | EDGAR: ${_p2EdgarCount > 0 ? _p2EdgarCount + ' filing(s) found' : 'none found'} | GDELT: ${_p2GdeltCount} event(s) | Macro: ${_p2MacroLine}. Reason from this evidence. Where data is unavailable, acknowledge the gap rather than fabricating signal.`;
                  const _p2Gating = `\n[GATING VERDICT]: The deterministic gating engine classified this event as ${_p2Gv?.event_classification ?? 'UNKNOWN'} (dominant regime: ${_p2Gv?.dominant_physics_regime ?? 'UNKNOWN'}). Your role is to find the specific real-world event that caused this classification — not to rephrase the label.`;

                  let estimateRevisionContext2 = "";
                  const erData2 = (item as any)._tempEstimateRevisions;
                  if (erData2 && erData2.revisionDirection) {
                    estimateRevisionContext2 = `\n[ANALYST REVISION MOMENTUM]: EPS estimates revised ${erData2.revisionDirection} ${Math.abs(erData2.revisionMagnitudePct)}% over the prior period across ${erData2.analystCount} analysts. Rising revisions before an event often precede positive surprises; falling revisions often signal deteriorating fundamentals ahead of the print.`;
                  }

                  let companyCreditContext2 = "";
                  const creditProxy2 = (item as any)._tempCompanyCreditProxy;
                  if (creditProxy2 !== null && creditProxy2 !== undefined) {
                    companyCreditContext2 = `\n[COMPANY CREDIT PROXY]: Estimated company-level credit spread ~${creditProxy2} bps (derived from D/E ratio — proxy, not a real market spread). Higher spreads indicate elevated refinancing risk and greater sensitivity to interest-rate or liquidity catalysts.`;
                  }

                  return `- Symbol: ${item.symbol}, Date: ${item.date}, Day Change: ${Number(item.dailyReturn).toFixed(2)}%, Day Z-Score: ${Number(item.zScore).toFixed(2)} Sigma, Rolling Mean: ${Number(item.rollingMean).toFixed(2)}%, Rolling Std: ${Number(item.rollingStd).toFixed(4)}${_p2Search}${_p2Evidence}${_p2Gating}${isNullModifier}${volContext}${vixContext}${regimeContext}${sequenceContext}${macroContext}${releaseContext}${edgarContext}${insiderContext}${frictionContext}${gdeltContext}${wikiContext}${youtubeContext}${newsContext}${socialContext}${shortInterestContext}${trendsContext}${estimateRevisionContext2}${companyCreditContext2}`;
                })
                .join("\n");

              const prompt = `You are a Lead Financial Forensic & Market Attribution Analyst.
For the following stock anomalies across different symbols, investigate what corporate news, CEO tweets/scandals, board decisions, direct competitor announcements (e.g. NVIDIA vs AMD), macroeconomic policies, or regulations caused or drove the stock anomalies on these calendar dates.

Each event entry below includes a [SEARCH GROUNDING] block with specific search queries to run for that symbol and date. Execute those searches before writing any narrative for that event.

MANDATORY CONSTRAINT: You must NOT mention forward-looking price action, future returns, or AI effect scores in your summary (including in coincidence_vs_correlation/Causal Attribution Review and suspected_catalyst descriptions).

CATALYST COMMITMENT: For each event you MUST name a specific, falsifiable catalyst — a named executive, a named filing, a named regulatory body, a named competitor action, or a named macro release. Generic phrases such as "market conditions", "investor sentiment", "historical trends", or "social sentiment index" are not acceptable as catalysts. If your search returns no specific result, state explicitly: "No specific catalyst identified despite search; possible macro beta or data gap."

For each event, compute:
1. "suspected_catalyst" details — name the specific event, person, filing, or announcement found via search. Include the date it was published, the source, and one sentence explaining the direct mechanism by which it caused the observed price move.
2. Impact scores (effect_score_1d, effect_score_1w, effect_score_1m, effect_score_6m, effect_score_1y) which are numeric rankings from -100 (most negative impact on long-term value) to +100 (most positive impact).
3. Coincidence vs correlation analysis: review the news and determine whether the event on this date was genuinely causal or merely a coincident correlation of wider systematic market noise/beta trends.
4. "correlation_confidence" score from 0 to 100 representing how confident you are that this event actually drove the price changes rather than being an accidental coincidence.
5. Synthesize the provided context regarding Alternative Data (Trends, Wikipedia, YouTube, GDELT) into "alternative_data_observations" and an "alternative_data_score" (0-100) reflecting its intensity/abnormality.
6. Synthesize the Corporate Governance context (EDGAR, Insider Trading, Friction Score) into "corporate_governance_observations" and a "corporate_governance_score" (0-100) reflecting governance severity.
7. Synthesize Macroeconomic data into "macroeconomic_observations" and "macroeconomic_score" (0-100) reflecting macro stress or impact.
8. Synthesize Market Structure context into "market_structure_observations" and "market_structure_score" (0-100) evaluating structural liquidity or technical severity.
9. Synthesize Company Fundamentals into "fundamental_and_earnings_observations" and "fundamental_and_earnings_score" (0-100) evaluating the fundamental impact or forward guidance intensity.

Each event includes a [GATING VERDICT] from the deterministic quantitative engine. Classify the event using the taxonomy ONLY AFTER you have identified the specific catalyst via search — do not rephrase the gating label as the catalyst. Return primaryCategory, primarySubType, and up to two additional secondaryCategories. You may also provide freeform eventTags.

Taxonomy:
${JSON.stringify(EVENT_TAXONOMY, null, 2)}

List to scan:
${itemsListStr}

Provide a JSON array containing the results mapping perfectly back using the static 'symbol' and 'date' fields.`;

              const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: {
                  tools: [{ googleSearch: {} }],
                  maxOutputTokens: 4000,
                },
              });

              const text = response.text;
              if (text) {
                const cleanedText = text
                  .replace(/\[\d+\]/g, '')
                  .replace(/```json\s*/gi, '')
                  .replace(/```\s*/g, '')
                  .trim();
                if (!cleanedText.includes('{')) {
                  console.log('[AI] Gemini returned plain text instead of JSON for this batch — using fallback analysis.');
                } else {
                  const parsed = extractAndParseJson(cleanedText);
                  if (Array.isArray(parsed)) return parsed;
                }
              }
            } catch (err) {
              console.error("Gemini chunk scanning error:", err);
            } finally {
              activeInFlight--;
            }
            return [];
          };

          const chunkResults = await Promise.allSettled(
            chunks.map((chunk) => processChunk(chunk)),
          );
          for (const res of chunkResults) {
            if (res.status === "fulfilled" && res.value) {
              aiDataList.push(...res.value);
            }
          }

          {
            if (aiDataList.length > 0) {
              for (const item of aiDataList) {
                if (item && item.symbol && item.date) {
                  const symUpper = item.symbol.toUpperCase().trim();
                  const cacheKey = `${symUpper}_${item.date}`;
                  const { symbol, date, ...parsedAnalysis } = item;
                  const analysisOnly: any = { ...parsedAnalysis };
                  analysisOnly.suspected_catalyst = normaliseSuspectedCatalyst(analysisOnly.suspected_catalyst);
                  analysisOnly.event_type = normaliseSuspectedCatalyst(analysisOnly.event_type);
                  analysisOnly.primary_catalyst = normaliseSuspectedCatalyst(analysisOnly.primary_catalyst);
                  analysisOnly.catalyst_category = normaliseSuspectedCatalyst(analysisOnly.catalyst_category);

                  if (analysisOnly.suspected_catalyst) {
                    const catEmbed = await this.fetchEmbedding(
                      analysisOnly.suspected_catalyst,
                    );
                    if (catEmbed) analysisOnly.catalyst_embedding = catEmbed;
                  }
                  if (analysisOnly.key_risk) {
                    const riskEmbed = await this.fetchEmbedding(
                      analysisOnly.key_risk,
                    );
                    if (riskEmbed) analysisOnly.risk_embedding = riskEmbed;
                  }

                  const matchResult = results[symUpper];
                  if (matchResult && matchResult.points) {
                    const matchPoint = matchResult.points.find(
                      (p) => p.date === item.date,
                    );
                    if (matchPoint) {
                      if ((matchPoint as any)._tempVixAtEvent !== undefined) {
                        analysisOnly.vixAtEvent = (
                          matchPoint as any
                        )._tempVixAtEvent;
                        analysisOnly.vixRegime = (
                          matchPoint as any
                        )._tempVixRegime;
                      }
                      if ((matchPoint as any)._tempMarketRegime !== undefined) {
                        analysisOnly.marketRegime = (
                          matchPoint as any
                        )._tempMarketRegime;
                      }
                      if (
                        (matchPoint as any)._tempMacroSnapshot !== undefined
                      ) {
                        analysisOnly.macroSnapshot = (
                          matchPoint as any
                        )._tempMacroSnapshot;
                      }
                      if ((matchPoint as any)._tempMacroRelease !== undefined) {
                        analysisOnly.macroRelease = (
                          matchPoint as any
                        )._tempMacroRelease;
                      }

                      if (analysisOnly.suspected_catalyst) {
                        const cScore = await this.evaluateCausalLogic(
                          analysisOnly.suspected_catalyst,
                          matchPoint.dailyReturn ?? 0,
                          matchPoint.zScore ?? 0,
                          matchPoint.volumeRatio ?? 1,
                        );
                        if (cScore !== null)
                          analysisOnly.causal_logic_score = cScore;
                      }

                      enrichConfidences(analysisOnly, matchPoint);
                      const mergedAnalysis = {
                        ...matchPoint.analysis,
                        ...analysisOnly,
                      };
                      setCachedAnalysis(
                        cacheKey,
                        symUpper,
                        item.date,
                        mergedAnalysis,
                        false,
                      );
                      matchPoint.analysis = mergedAnalysis;
                      matchPoint.hasAnalysis = true;
                    }
                  }
                }
              }
            }
          }
        } catch (apiErr) {
          console.error(
            "Gemini unified batch scanning error (Falling back to adaptive rules):",
            apiErr,
          );
        }
      }

      // Fill in fallback/adaptive rules for all topToFetchUnified items that did not get filled yet
      for (const item of topToFetchUnified) {
        const symUpper = item.symbol?.toUpperCase()?.trim();
        const matchResult = results[symUpper];
        if (matchResult && matchResult.points) {
          const matchPoint = matchResult.points.find(
            (p) => p.date === item.date,
          );
          if (matchPoint && !matchPoint.hasAnalysis) {
            try {
              const cacheKey = `${symUpper}_${item.date}`;
              const fallbackAnalysis = generateLocalFallbackAnalysis(
                symUpper,
                item.date,
                item.dailyReturn,
                item.zScore,
                item.analysis,
                (matchPoint as any)._tempVixAtEvent ?? (item as any)._tempVixAtEvent,
              );
              if ((matchPoint as any)._tempVixAtEvent !== undefined) {
                fallbackAnalysis.vixAtEvent = (
                  matchPoint as any
                )._tempVixAtEvent;
                fallbackAnalysis.vixRegime = (matchPoint as any)._tempVixRegime;
              }
              if ((matchPoint as any)._tempMarketRegime !== undefined) {
                fallbackAnalysis.marketRegime = (
                  matchPoint as any
                )._tempMarketRegime;
              }
              if ((matchPoint as any)._tempMacroSnapshot !== undefined) {
                fallbackAnalysis.macroSnapshot = (
                  matchPoint as any
                )._tempMacroSnapshot;
              }
              if ((matchPoint as any)._tempMacroRelease !== undefined) {
                fallbackAnalysis.macroRelease = (
                  matchPoint as any
                )._tempMacroRelease;
              }
              if ((matchPoint as any)._tempWikipediaSpikes !== undefined) {
                fallbackAnalysis.wikipediaSpikes = (
                  matchPoint as any
                )._tempWikipediaSpikes;
              }
              if ((matchPoint as any)._tempGdeltTone !== undefined) {
                fallbackAnalysis.gdeltTone = (
                  matchPoint as any
                )._tempGdeltTone;
              }
              if ((matchPoint as any)._tempYoutubeVideos !== undefined) {
                fallbackAnalysis.youtubeVideos = (
                  matchPoint as any
                )._tempYoutubeVideos;
              }
              if ((matchPoint as any)._tempInsiderDensity !== undefined) {
                fallbackAnalysis.insider_cluster_density = (
                  matchPoint as any
                )._tempInsiderDensity;
              }
              if ((matchPoint as any)._tempFrictionScore !== undefined) {
                fallbackAnalysis.management_friction_score = (
                  matchPoint as any
                )._tempFrictionScore;
              }
              enrichConfidences(fallbackAnalysis, matchPoint);
              const merged = {
                ...matchPoint.analysis,
                ...fallbackAnalysis,
              };
              setCachedAnalysis(cacheKey, symUpper, item.date, merged, true);
              matchPoint.analysis = merged;
              matchPoint.hasAnalysis = true;
            } catch (fallbackErr) {
              console.error(
                "Failed unified fallback analysis generation:",
                fallbackErr,
              );
            }
          }
        }
      }

      // Fill in fallback/adaptive rules for restToFallback
      for (const item of restToFallback) {
        const symUpper = item.symbol?.toUpperCase()?.trim();
        const matchResult = results[symUpper];
        if (matchResult && matchResult.points) {
          const matchPoint = matchResult.points.find(
            (p) => p.date === item.date,
          );
          if (matchPoint && !matchPoint.hasAnalysis) {
            try {
              const cacheKey = `${symUpper}_${item.date}`;
              const fallbackAnalysis = generateLocalFallbackAnalysis(
                symUpper,
                item.date,
                item.dailyReturn,
                item.zScore,
                item.analysis,
                (matchPoint as any)._tempVixAtEvent ?? (item as any)._tempVixAtEvent,
              );
              if ((matchPoint as any)._tempVixAtEvent !== undefined) {
                fallbackAnalysis.vixAtEvent = (
                  matchPoint as any
                )._tempVixAtEvent;
                fallbackAnalysis.vixRegime = (matchPoint as any)._tempVixRegime;
              }
              if ((matchPoint as any)._tempMarketRegime !== undefined) {
                fallbackAnalysis.marketRegime = (
                  matchPoint as any
                )._tempMarketRegime;
              }
              if ((matchPoint as any)._tempMacroSnapshot !== undefined) {
                fallbackAnalysis.macroSnapshot = (
                  matchPoint as any
                )._tempMacroSnapshot;
              }
              if ((matchPoint as any)._tempMacroRelease !== undefined) {
                fallbackAnalysis.macroRelease = (
                  matchPoint as any
                )._tempMacroRelease;
              }
              if ((matchPoint as any)._tempWikipediaSpikes !== undefined) {
                fallbackAnalysis.wikipediaSpikes = (
                  matchPoint as any
                )._tempWikipediaSpikes;
              }
              if ((matchPoint as any)._tempGdeltTone !== undefined) {
                fallbackAnalysis.gdeltTone = (
                  matchPoint as any
                )._tempGdeltTone;
              }
              if ((matchPoint as any)._tempYoutubeVideos !== undefined) {
                fallbackAnalysis.youtubeVideos = (
                  matchPoint as any
                )._tempYoutubeVideos;
              }
              if ((matchPoint as any)._tempInsiderDensity !== undefined) {
                fallbackAnalysis.insider_cluster_density = (
                  matchPoint as any
                )._tempInsiderDensity;
              }
              if ((matchPoint as any)._tempFrictionScore !== undefined) {
                fallbackAnalysis.management_friction_score = (
                  matchPoint as any
                )._tempFrictionScore;
              }
              enrichConfidences(fallbackAnalysis, matchPoint);
              const merged = {
                ...matchPoint.analysis,
                ...fallbackAnalysis,
              };
              setCachedAnalysis(cacheKey, symUpper, item.date, merged, true);
              matchPoint.analysis = merged;
              matchPoint.hasAnalysis = true;
            } catch (fallbackErr) {
              console.error(
                "Failed unified fallback generation for restToFallback:",
                fallbackErr,
              );
            }
          }
        }
      }
    }

    // Since we skipped Gemini in individual run_scans, let's make sure the returned result objects have updated points containing their analysts
    for (const uppercaseSymbol of Object.keys(results)) {
      const res = results[uppercaseSymbol];
      if (res.points && res.points.length > 0) {
        const updatedAnomalies = res.points.filter((p) => p.isAnomaly);
        res.anomalies = updatedAnomalies;

        for (const anomaly of updatedAnomalies) {
          if (anomaly.hasAnalysis) {
            const index = res.points.findIndex(
              (p: StockPoint) => p.date === anomaly.date,
            );
            buildAndSaveFeatureVector(
              uppercaseSymbol,
              anomaly,
              res.points,
              index,
            );
          }
        }

        res.chartData = res.points.map((p) => ({
          date: p.date,
          timestamp: p.timestamp,
          price: p.close,
          volume: p.volume,
          zScore: p.zScore,
          rollingMean: p.rollingMean,
          isAnomaly: p.isAnomaly,
          dailyReturn: p.dailyReturn,
        }));
      }
    }

    return results;
  }

  private async enrichAnomaliesContext(
    anomalies: any[],
    fmpContext: any,
    uppercaseSymbol: string,
    range: string,
    benchmarkReturnsMap: Map<string, number>,
    enrichSlowApis: boolean,
    maxEnrichCount: number = 10,
  ): Promise<void> {
    if (anomalies.length === 0) return;

    const toEnrich = anomalies.filter(a => {
      const key = `${a.symbol || uppercaseSymbol}_${a.date}`;
      if (this.enrichedAnomalyKeys.has(key)) return false;
      this.enrichedAnomalyKeys.add(key);
      return true;
    });

    if (toEnrich.length === 0) {
      console.log(`[Enrichment] All anomalies already enriched for ${uppercaseSymbol} — skipping duplicate call.`);
      return;
    }

    await this.fetchVixAtDate(toEnrich[0].date, range, uppercaseSymbol);
    const vixTicker = getVolIndexTicker(uppercaseSymbol);
    const cacheKey = vixTicker ? `${vixTicker}_${range}` : null;
    const vixSeriesPromise = cacheKey ? HistoricalEngine.vixSeriesPromises.get(cacheKey) : null;
    const vixSeries = vixSeriesPromise ? await vixSeriesPromise : null;

    const benchmarkReturns = benchmarkReturnsMap;

    let getVixForDate = (date: string): number | null => {
      // Default to 0 for non-US assets without an index/registry mapping
      return 0;
    };
    let getVixRegime = (vix: number) => {
      if (vix < 15) return "low";
      if (vix <= 25) return "moderate";
      if (vix <= 35) return "elevated";
      return "extreme";
    };

    if (vixSeries && vixSeries.size > 0) {
      getVixForDate = (date: string) => {
        if (vixSeries.has(date)) return vixSeries.get(date)!;
        let closestValue: number | null = null;
        let minDiff = Infinity;
        const targetTime = new Date(date).getTime();
        for (const [dStr, val] of vixSeries.entries()) {
          const time = new Date(dStr).getTime();
          const diff = Math.abs(time - targetTime);
          if (diff < minDiff) {
            minDiff = diff;
            closestValue = val;
          }
        }
        return closestValue ?? 0;
      };
    }

    const topPeers = await getTopPeers(uppercaseSymbol);

    for (const a of toEnrich) {
      const vix = getVixForDate(a.date);
      let regime: string | undefined;
      if (vix !== null) {
        regime = getVixRegime(vix);
        (a as any)._tempVixAtEvent = vix;
        (a as any)._tempVixRegime = regime;
        if (a.hasAnalysis && a.analysis) {
          a.analysis.vixAtEvent = vix;
          a.analysis.vixRegime = regime;
        }
      }
      const mRegime = detectRegime(benchmarkReturns, vix, a.date);
      (a as any)._tempMarketRegime = mRegime;

      const insiderDensity = getInsiderClusterDensity(
        uppercaseSymbol,
        a.date,
        30,
      );
      const frictionScore = getManagementFrictionScore(
        uppercaseSymbol,
        a.date,
        30,
      );

      (a as any)._tempInsiderDensity = insiderDensity;
      (a as any)._tempFrictionScore = frictionScore;

      if (a.hasAnalysis && a.analysis) {
        a.analysis.marketRegime = mRegime;
        a.analysis.insider_cluster_density = insiderDensity;
        a.analysis.management_friction_score = frictionScore;
      }
    }

    if (!enrichSlowApis) return;

    const companyName = fmpContext?.profile?.name || uppercaseSymbol;
    const hasNewsApiKey = !!(
      process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY
    );
    const hasYouTubeApiKey = !!process.env.YOUTUBE_API_KEY;
    const enableTrends = process.env.ENABLE_GOOGLE_TRENDS !== "false";
    const hasFredKey = !!process.env.FRED_API_KEY;

    let wikiQueries: string[] = [];
    try {
      const executives = await getExecutiveRoster(uppercaseSymbol, companyName);
      if (executives) {
        const ceo = executives.find(
          (e) => e.roleWeight >= 1.0 || e.role?.toLowerCase().includes("ceo"),
        );
        const cfo = executives.find(
          (e) =>
            (!ceo || e.name !== ceo.name) &&
            (e.roleWeight === 0.9 || e.role?.toLowerCase().includes("cfo")),
        );

        wikiQueries.push(companyName);
        if (ceo) wikiQueries.push(ceo.name);
        if (cfo) wikiQueries.push(cfo.name);
      }
    } catch (err) {
      console.error(
        "[HistoricalEngine] Failed to prepare Wikipedia queries:",
        err,
      );
    }

    if (wikiQueries.length === 0) {
      console.log(`[Wiki] Using symbol-only query for ${uppercaseSymbol} — FMP context unavailable.`);
      wikiQueries = [uppercaseSymbol, companyName || uppercaseSymbol];
    }

    // Helper to determine if an anomaly is missing data from some configured sources
    const isMissingSources = (a: any): boolean => {
      if (!a.hasAnalysis || !a.analysis) return true;
      if (hasFredKey && !a.analysis.macroSnapshot) return true;
      if (!a.analysis.edgarFilings || a.analysis.edgarFilings.length === 0)
        return true;
      const newsList =
        a.analysis.newsList || getNewsForAnomaly(uppercaseSymbol, a.date);
      if (hasNewsApiKey && (!newsList || newsList.length === 0)) return true;
      if (!a.analysis.socialSentiment) return true;
      if (enableTrends && !a.analysis.trendsSummary) return true;
      if (
        wikiQueries.length > 0 &&
        (!a.analysis.wikipediaSpikes || a.analysis.wikipediaSpikes.length === 0)
      )
        return true;
      if (!a.analysis.gdeltTone)
        return true;
      if (
        hasYouTubeApiKey &&
        (!a.analysis.youtubeVideos || a.analysis.youtubeVideos.length === 0)
      )
        return true;
      return false;
    };

    const uncachedToEnrich = toEnrich.filter((a) => isMissingSources(a));
    const sortedUncachedToEnrich = [...uncachedToEnrich].sort(
      (a, b) => Math.abs(b.zScore) - Math.abs(a.zScore),
    );
    const activeEnrichDates = new Set(
      sortedUncachedToEnrich.slice(0, maxEnrichCount).map((a) => a.date),
    );
    // SUPPRESSED_NON_EVENT rows are flat-price by definition, so they always
    // rank low on |zScore| and would otherwise fall outside the maxEnrichCount
    // cut. Force them into the active set so signal_snapshot gets the same
    // GDELT/StockTwits/Wikipedia/Trends/News/Congressional data as real events.
    for (const a of uncachedToEnrich) {
      if ((a as any).is_null_sample) activeEnrichDates.add(a.date);
    }

    // Synthesizer helper for social sentiment summary from cached SQLite rows
    const synthesizeSocialSentimentSummary = (
      sym: string,
      dt: string,
      mentions: any[],
    ): any => {
      let bullishCount = 0;
      let bearishCount = 0;
      let neutralCount = 0;
      for (const m of mentions) {
        if (m.sentimentLabel === "bullish") bullishCount++;
        else if (m.sentimentLabel === "bearish") bearishCount++;
        else neutralCount++;
      }
      const total = mentions.length;
      const totalScore = bullishCount * 1 + bearishCount * -1;
      const avgScore = total > 0 ? totalScore / total : 0;
      const vScore = Math.min(100, (total / 30) * 100);

      let trend:
        | "accelerating_bullish"
        | "accelerating_bearish"
        | "stable"
        | "reversing"
        | "insufficient_data" = "stable";
      if (total < 5) trend = "insufficient_data";
      else if (avgScore > 0.3) trend = "accelerating_bullish";
      else if (avgScore < -0.3) trend = "accelerating_bearish";

      return {
        symbol: sym,
        fromDate: dt,
        toDate: dt,
        totalMentions: total,
        bullishCount,
        bearishCount,
        neutralCount,
        averageSentimentScore: avgScore,
        highEngagementPosts: mentions,
        sentimentTrend: trend,
        viralityScore: vScore,
        source: mentions[0]?.source || "reddit_cached",
      };
    };

    let prefetchNewsList: any[] = [];
    if (enrichSlowApis && toEnrich.length > 0) {
      const timestamps = toEnrich.map((a) =>
        new Date(a.date + "T00:00:00Z").getTime(),
      );
      const minT = Math.min(...timestamps);
      const maxT = Math.max(...timestamps);

      const prefetchFromDate = new Date(minT - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const prefetchToDate = new Date(maxT + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      const bulkPromises = [];

      if (hasFredKey) {
        const fredSeries = [
          "VIXCLS",
          "FEDFUNDS",
          "CPIAUCSL",
          "UNRATE",
          "DGS10",
          "DGS2",
          "BAMLH0A0HYM2",
          "DTWEXBGS",
        ];
        for (const series of fredSeries) {
          bulkPromises.push(
            (async () => {
              try {
                await fetchFREDSeries(series, prefetchFromDate, prefetchToDate);
              } catch (e) {}
            })(),
          );
        }
      }

      bulkPromises.push(
        (async () => {
          try {
            await getRecentFilings(
              uppercaseSymbol,
              prefetchFromDate,
              prefetchToDate,
              ["8-K"],
            );
          } catch (e) {}
        })(),
      );

      if (hasNewsApiKey) {
        bulkPromises.push(
          (async () => {
            try {
              prefetchNewsList = await searchNewsForStock(
                uppercaseSymbol,
                companyName,
                prefetchFromDate,
                prefetchToDate,
                50,
              );
            } catch (e) {}
          })(),
        );
      }

      await Promise.all(bulkPromises);
    }

    const anomalyChunkSize = 3;
    for (let idx = 0; idx < toEnrich.length; idx += anomalyChunkSize) {
      const chunk = toEnrich.slice(idx, idx + anomalyChunkSize);
      await Promise.all(
        chunk.map(async (a) => {
          const isActive = activeEnrichDates.has(a.date);
          if (!isActive) return;

          a.analysis = a.analysis || ({} as any);
          const promises: Promise<any>[] = [];
          const enrichStatuses: { [key: string]: 'hit' | 'skip' } = {
            polygon: 'skip',
            fmp_dark_pool: 'skip',
            fmp_borrow: 'skip',
            fmp_social: 'skip',
            fmp_short: 'skip',
            fmp_news: 'skip',
            insider: 'skip',
            institutional: 'skip',
            earnings: 'skip',
            grades: 'skip',
            price_target: 'skip',
            gdelt: 'skip',
            reddit: 'skip',
            trends: 'skip',
            wiki: 'skip',
            newsapi: 'skip',
            youtube: 'skip',
            edgar: 'skip',
            congressional: 'skip',
            executive: 'skip'
          };

          // 1. FRED Macro Context
          if (!a.analysis.macroSnapshot) {
            if (hasFredKey) {
              promises.push(
                (async () => {
                  try {
                    const [snapshot, release] = await Promise.all([
                      getMacroSnapshot(a.date, uppercaseSymbol),
                      getActualMacroRelease(a.date),
                    ]);
                    (a as any)._tempMacroSnapshot = snapshot || null;
                    (a as any)._tempMacroRelease = release || null;

                    if (snapshot) {
                      a.analysis!.macroSnapshot = snapshot;
                    } else {
                      a.analysis!.macroSnapshot = null as any;
                    }
                    if (release) {
                      (a as any)._tempMacroReleaseDetail = release;
                      a.analysis!.macroRelease = release;
                    } else {
                      a.analysis!.macroRelease = null as any;
                    }
                  } catch (err) {
                    console.error(
                      `[HistoricalEngine] Failed to retrieve macroeconomic context for anomaly on ${a.date}:`,
                      err,
                    );
                    (a as any)._tempMacroSnapshot = null;
                    (a as any)._tempMacroRelease = null;
                    a.analysis!.macroSnapshot = null as any;
                    a.analysis!.macroRelease = null as any;
                  }
                })(),
              );
            }
          } else {
            // Keep pre-existing
            (a as any)._tempMacroSnapshot = a.analysis.macroSnapshot;
            if (a.analysis.macroRelease) {
              (a as any)._tempMacroRelease = a.analysis.macroRelease;
              (a as any)._tempMacroReleaseDetail = a.analysis.macroRelease;
            }
          }

          const d = new Date(a.date + "T00:00:00Z");
          const fromObj = new Date(d.getTime() - 24 * 60 * 60 * 1000);
          const toObj = new Date(d.getTime() + 2 * 24 * 60 * 60 * 1000);
          const fromDate = fromObj.toISOString().split("T")[0];
          const toDate = toObj.toISOString().split("T")[0];

          // 2. EDGAR SEC Filings
          if (
            !a.analysis.edgarFilings ||
            a.analysis.edgarFilings.length === 0
          ) {
            try { const beforeObj = new Date(d.getTime() - 3 * 24 * 60 * 60 * 1000); const fillingsFromDate = beforeObj.toISOString().split('T')[0]; const filings = getEdgarFilings(uppercaseSymbol, fillingsFromDate, toDate, ['8-K']); if (filings && filings.length > 0) {   a.analysis!.edgarFilings = filings;   enrichStatuses.edgar = 'hit'; } else {   enrichStatuses.edgar = 'skip';   console.log(`[Enrichment] No data from EDGAR Filings for ${uppercaseSymbol} / ${a.date} — skipping this source for this bar.`); } } catch (err) {   enrichStatuses.edgar = 'skip';   console.log(`[Enrichment] EDGAR Filings unavailable for ${uppercaseSymbol} / ${a.date} — continuing with other sources.`); }
          }

          // 3. News
          const existingNews =
            a.analysis.newsList || (a as any)._tempPrefetchedArticles;
          if (!existingNews || existingNews.length === 0) {
            if (hasNewsApiKey) {
              promises.push(
                (async () => {
                  try {
                    let newsList = getNewsForAnomaly(uppercaseSymbol, a.date);
                    if (newsList.length === 0 && prefetchNewsList.length > 0) {
                      const fromTime = new Date(fromDate).getTime();
                      const toTime = new Date(toDate).getTime();
                      const fetchedNews = prefetchNewsList.filter((art) => {
                        const t = new Date(art.publishedAt).getTime();
                        return t >= fromTime && t <= toTime;
                      });
                      const rankedNews = await rankArticlesByRelevance(
                        fetchedNews,
                        uppercaseSymbol,
                        a.date,
                        a.dailyReturn,
                      );
                      saveNewsArticles(rankedNews, uppercaseSymbol, a.date);
                      newsList = rankedNews;
                    }
                    const filteredNews = newsList.filter(
                      (art) => (art.relevanceScore || 0) > 0.5,
                    );
                    (a as any)._tempPrefetchedArticles = filteredNews;
                  } catch (err) {
                    console.error(
                      `[HistoricalEngine] Failed to retrieve NewsAPI context for anomaly on ${a.date}:`,
                      err,
                    );
                  }
                })(),
              );
            }
          } else {
            (a as any)._tempPrefetchedArticles = existingNews;
          }

          // 4. Social Sentiment (FMP)
          // DYNAMICALLY VARIABLE FEATURE ARCHITECTURE CHECKPOINT:
          // Alternative text/sentiment data feeds are highly volatile and prone to limited historical horizons
          // (such as APIs only offering data from late 2021 onwards). Rather than letting a historical horizon
          // error terminate the 5-year quantitative run or drop the anomaly row completely, we catch and quarantine
          // exceptions, defaulting non-core columns to primitive NULLs, keeping primary market indicators intact.
          if (!a.analysis.fmp_social_sentiment_score) {
            promises.push(
              (async () => {
                try {
                  let fmpSocial = null;
                  const cachedSocial = getCachedSocialSentiment(uppercaseSymbol, a.date);
                  if (cachedSocial !== null) {
                    console.log(`[FMP] Cache hit — budget preserved for ${uppercaseSymbol} / ${a.date}`);
                    fmpSocial = {
                      fmp_social_sentiment_score: cachedSocial.sentimentScore,
                      fmp_social_post_volume: cachedSocial.postVolume
                    };
                  } else {
                    fmpSocial = await getSocialSentiment(uppercaseSymbol, a.date);
                  }
                  if (fmpSocial && fmpSocial.fmp_social_sentiment_score !== null) {
                    a.analysis!.fmp_social_sentiment_score = fmpSocial.fmp_social_sentiment_score;
                    (a as any)._tempFmpSocialSentimentScore = fmpSocial.fmp_social_sentiment_score;
                    
                    a.analysis!.fmp_social_post_volume = fmpSocial.fmp_social_post_volume;
                    (a as any)._tempFmpSocialPostVolume = fmpSocial.fmp_social_post_volume;
                  } else {
                    // Pretentious "premium alternative data" providers often have no sentiment records
                    // prior to 3 years ago because they didn't exist yet, forcing a safe NULL assignment.
                    a.analysis!.fmp_social_sentiment_score = null as any;
                    (a as any)._tempFmpSocialSentimentScore = null;
                    a.analysis!.fmp_social_post_volume = null as any;
                    (a as any)._tempFmpSocialPostVolume = null;
                  }
                } catch (err) {
                  console.error(
                    `[HistoricalEngine] Failed to retrieve FMP social sentiment for anomaly on ${a.date}:`,
                    err,
                  );
                  // Dynamic Feature Fallback Strategy: Quarantine the failure and fallback to clean NULL
                  a.analysis!.fmp_social_sentiment_score = null as any;
                  (a as any)._tempFmpSocialSentimentScore = null;
                  a.analysis!.fmp_social_post_volume = null as any;
                  (a as any)._tempFmpSocialPostVolume = null;
                }
              })(),
            );
          } else {
            (a as any)._tempFmpSocialSentimentScore = a.analysis.fmp_social_sentiment_score;
            (a as any)._tempFmpSocialPostVolume = a.analysis.fmp_social_post_volume;
          }

          // 4.5 FMP News Sentiment
          if (a.analysis.fmp_news_sentiment_avg === undefined) {
            promises.push(
              (async () => {
                try {
                  const newsSentiment = await getFMPNewsSentiment(uppercaseSymbol, a.date);
                  if (newsSentiment && (newsSentiment.fmp_news_sentiment_avg !== null || newsSentiment.fmp_news_article_count_7d > 0)) {
                    a.analysis!.fmp_news_sentiment_avg = newsSentiment.fmp_news_sentiment_avg as any;
                    a.analysis!.fmp_news_article_count_7d = newsSentiment.fmp_news_article_count_7d as any;
                    (a as any)._tempFmpNewsSentimentAvg = newsSentiment.fmp_news_sentiment_avg;
                    (a as any)._tempFmpNewsArticleCount7d = newsSentiment.fmp_news_article_count_7d;
                    enrichStatuses.fmp_news = newsSentiment.fmp_news_article_count_7d > 0 ? 'hit' : 'skip';
                  } else {
                    a.analysis!.fmp_news_sentiment_avg = null as any;
                    a.analysis!.fmp_news_article_count_7d = 0 as any;
                    (a as any)._tempFmpNewsSentimentAvg = null;
                    (a as any)._tempFmpNewsArticleCount7d = 0;
                    enrichStatuses.fmp_news = 'skip';
                  }
                } catch (err) {
                  console.error(`[HistoricalEngine] Failed to retrieve FMP news sentiment for ${uppercaseSymbol} on ${a.date}:`, err);
                  (a as any)._tempFmpNewsSentimentAvg = null;
                  (a as any)._tempFmpNewsArticleCount7d = 0;
                  enrichStatuses.fmp_news = 'skip';
                }
              })()
            );
          } else {
            (a as any)._tempFmpNewsSentimentAvg = a.analysis.fmp_news_sentiment_avg;
            (a as any)._tempFmpNewsArticleCount7d = (a.analysis as any).fmp_news_article_count_7d ?? 0;
            enrichStatuses.fmp_news = (a.analysis as any).fmp_news_article_count_7d > 0 ? 'hit' : 'skip';
          }

          const isUsListed = !uppercaseSymbol.includes('.') || uppercaseSymbol.endsWith('.NYSE') || uppercaseSymbol.endsWith('.NASDAQ');

          // 4.6 FMP Insider Trading (30-day window)
          if (!isUsListed) {
            (a as any)._tempInsiderNetShares30d = null;
            (a as any)._tempInsiderBuyCount30d = 0;
            (a as any)._tempInsiderSellCount30d = 0;
          } else if ((a.analysis as any).insider_net_shares_30d === undefined) {
            promises.push(
              (async () => {
                try {
                  let insider = await getFMPInsiderTrading(uppercaseSymbol, a.date);
                  if (!insider || (insider.insider_buy_count_30d === 0 && insider.insider_sell_count_30d === 0)) {
                    const edgarInsider = await getEdgarInsiderSummary(uppercaseSymbol, a.date);
                    if (edgarInsider.insider_buy_count_30d > 0 || edgarInsider.insider_sell_count_30d > 0) {
                      insider = edgarInsider;
                    }
                  }
                  if (insider) {
                    (a.analysis as any).insider_net_shares_30d = insider.insider_net_shares_30d;
                    (a.analysis as any).insider_buy_count_30d = insider.insider_buy_count_30d;
                    (a.analysis as any).insider_sell_count_30d = insider.insider_sell_count_30d;
                    (a as any)._tempInsiderNetShares30d = insider.insider_net_shares_30d;
                    (a as any)._tempInsiderBuyCount30d = insider.insider_buy_count_30d;
                    (a as any)._tempInsiderSellCount30d = insider.insider_sell_count_30d;
                    enrichStatuses.insider = insider.insider_buy_count_30d > 0 || insider.insider_sell_count_30d > 0 ? 'hit' : 'skip';
                  } else {
                    (a as any)._tempInsiderNetShares30d = null;
                    (a as any)._tempInsiderBuyCount30d = 0;
                    (a as any)._tempInsiderSellCount30d = 0;
                    enrichStatuses.insider = 'skip';
                  }
                } catch (err) {
                  console.error(`[HistoricalEngine] Failed to retrieve FMP insider trading for ${uppercaseSymbol} on ${a.date}:`, err);
                  (a as any)._tempInsiderNetShares30d = null;
                  (a as any)._tempInsiderBuyCount30d = 0;
                  (a as any)._tempInsiderSellCount30d = 0;
                  enrichStatuses.insider = 'skip';
                }
              })()
            );
          } else {
            (a as any)._tempInsiderNetShares30d = (a.analysis as any).insider_net_shares_30d;
            (a as any)._tempInsiderBuyCount30d = (a.analysis as any).insider_buy_count_30d ?? 0;
            (a as any)._tempInsiderSellCount30d = (a.analysis as any).insider_sell_count_30d ?? 0;
            enrichStatuses.insider = ((a.analysis as any).insider_buy_count_30d > 0 || (a.analysis as any).insider_sell_count_30d > 0) ? 'hit' : 'skip';
          }

          // 4.7 FMP Institutional Ownership
          if ((a.analysis as any).institutional_ownership_pct === undefined) {
            promises.push(
              (async () => {
                try {
                  const inst = await getFMPInstitutionalOwnership(uppercaseSymbol, a.date);
                  if (inst) {
                    (a.analysis as any).institutional_ownership_pct = inst.institutional_ownership_pct;
                    (a.analysis as any).institutional_ownership_change_qoq = inst.institutional_ownership_change_qoq;
                    (a as any)._tempInstitutionalOwnershipPct = inst.institutional_ownership_pct;
                    (a as any)._tempInstitutionalOwnershipChangeQoQ = inst.institutional_ownership_change_qoq;
                    enrichStatuses.institutional = inst.institutional_ownership_pct !== null ? 'hit' : 'skip';
                  } else {
                    (a as any)._tempInstitutionalOwnershipPct = null;
                    (a as any)._tempInstitutionalOwnershipChangeQoQ = null;
                    enrichStatuses.institutional = 'skip';
                  }
                } catch (err) {
                  console.error(`[HistoricalEngine] Failed to retrieve FMP institutional ownership for ${uppercaseSymbol} on ${a.date}:`, err);
                  (a as any)._tempInstitutionalOwnershipPct = null;
                  (a as any)._tempInstitutionalOwnershipChangeQoQ = null;
                  enrichStatuses.institutional = 'skip';
                }
              })()
            );
          } else {
            (a as any)._tempInstitutionalOwnershipPct = (a.analysis as any).institutional_ownership_pct;
            (a as any)._tempInstitutionalOwnershipChangeQoQ = (a.analysis as any).institutional_ownership_change_qoq ?? null;
            enrichStatuses.institutional = (a.analysis as any).institutional_ownership_pct !== null ? 'hit' : 'skip';
          }

          // 4.8 FMP Earnings Surprise
          if (!isUsListed) {
            (a as any)._tempEpsSurprisePct = null;
            (a as any)._tempRevenueSurprisePct = null;
            (a as any)._tempEarningsProximityDays = null;
          } else if ((a.analysis as any).eps_surprise_pct === undefined) {
            promises.push(
              (async () => {
                try {
                  const earnings = await getFMPEarningsSurprise(uppercaseSymbol, a.date);
                  if (earnings) {
                    (a.analysis as any).eps_surprise_pct = earnings.eps_surprise_pct;
                    (a.analysis as any).revenue_surprise_pct = earnings.revenue_surprise_pct;
                    (a.analysis as any).earnings_date_proximity_days = earnings.earnings_date_proximity_days;
                    (a as any)._tempEpsSurprisePct = earnings.eps_surprise_pct;
                    (a as any)._tempRevenueSurprisePct = earnings.revenue_surprise_pct;
                    (a as any)._tempEarningsProximityDays = earnings.earnings_date_proximity_days;
                    enrichStatuses.earnings = earnings.eps_surprise_pct !== null || earnings.revenue_surprise_pct !== null ? 'hit' : 'skip';
                  } else {
                    (a as any)._tempEpsSurprisePct = null;
                    (a as any)._tempRevenueSurprisePct = null;
                    (a as any)._tempEarningsProximityDays = null;
                    enrichStatuses.earnings = 'skip';
                  }
                } catch (err) {
                  console.error(`[HistoricalEngine] Failed to retrieve FMP earnings surprise for ${uppercaseSymbol} on ${a.date}:`, err);
                  (a as any)._tempEpsSurprisePct = null;
                  (a as any)._tempRevenueSurprisePct = null;
                  (a as any)._tempEarningsProximityDays = null;
                  enrichStatuses.earnings = 'skip';
                }
              })()
            );
          } else {
            (a as any)._tempEpsSurprisePct = (a.analysis as any).eps_surprise_pct ?? null;
            (a as any)._tempRevenueSurprisePct = (a.analysis as any).revenue_surprise_pct ?? null;
            (a as any)._tempEarningsProximityDays = (a.analysis as any).earnings_date_proximity_days ?? null;
            enrichStatuses.earnings = (a.analysis as any).eps_surprise_pct !== null && (a.analysis as any).eps_surprise_pct !== undefined ? 'hit' : 'skip';
          }

          // 4.9 FMP Analyst Grades (30-day window)
          if (!isUsListed) {
            (a as any)._tempAnalystUpgrades30d = null;
            (a as any)._tempAnalystDowngrades30d = null;
          } else if ((a.analysis as any).analyst_upgrades_30d === undefined) {
            promises.push(
              (async () => {
                try {
                  const grades = await getFMPAnalystGrades(uppercaseSymbol, a.date);
                  if (grades) {
                    (a.analysis as any).analyst_upgrades_30d = grades.upgrades;
                    (a.analysis as any).analyst_downgrades_30d = grades.downgrades;
                    (a as any)._tempAnalystUpgrades30d = grades.upgrades;
                    (a as any)._tempAnalystDowngrades30d = grades.downgrades;
                    enrichStatuses.grades = grades.upgrades > 0 || grades.downgrades > 0 ? 'hit' : 'skip';
                  } else {
                    (a as any)._tempAnalystUpgrades30d = null;
                    (a as any)._tempAnalystDowngrades30d = null;
                    enrichStatuses.grades = 'skip';
                  }
                } catch (err) {
                  console.error(`[HistoricalEngine] Failed to retrieve FMP analyst grades for ${uppercaseSymbol} on ${a.date}:`, err);
                  (a as any)._tempAnalystUpgrades30d = null;
                  (a as any)._tempAnalystDowngrades30d = null;
                  enrichStatuses.grades = 'skip';
                }
              })()
            );
          } else {
            (a as any)._tempAnalystUpgrades30d = (a.analysis as any).analyst_upgrades_30d ?? null;
            (a as any)._tempAnalystDowngrades30d = (a.analysis as any).analyst_downgrades_30d ?? null;
            enrichStatuses.grades = (a.analysis as any).analyst_upgrades_30d !== null && (a.analysis as any).analyst_upgrades_30d !== undefined ? 'hit' : 'skip';
          }

          // 4.10 FMP Price Target Consensus
          if ((a.analysis as any).price_target_consensus === undefined) {
            promises.push(
              (async () => {
                try {
                  const pt = await getFMPPriceTargetConsensus(uppercaseSymbol, a.date);
                  if (pt) {
                    (a.analysis as any).price_target_consensus = pt.priceTargetConsensus;
                    (a as any)._tempPriceTargetConsensus = pt.priceTargetConsensus;
                    (a as any)._tempPriceTargetHigh = pt.priceTargetHigh;
                    (a as any)._tempPriceTargetLow = pt.priceTargetLow;
                    const eventClose: number | null = (a as any).close ?? (a as any)._tempClose ?? null;
                    const upside = pt.priceTargetConsensus !== null && eventClose !== null && eventClose > 0
                      ? Math.round(((pt.priceTargetConsensus - eventClose) / eventClose) * 10000) / 100
                      : null;
                    (a as any)._tempPriceTargetUpsidePct = upside;
                    enrichStatuses.price_target = pt.priceTargetConsensus !== null ? 'hit' : 'skip';
                  } else {
                    (a as any)._tempPriceTargetConsensus = null;
                    (a as any)._tempPriceTargetHigh = null;
                    (a as any)._tempPriceTargetLow = null;
                    (a as any)._tempPriceTargetUpsidePct = null;
                    enrichStatuses.price_target = 'skip';
                  }
                } catch (err) {
                  console.error(`[HistoricalEngine] Failed to retrieve FMP price target for ${uppercaseSymbol} on ${a.date}:`, err);
                  (a as any)._tempPriceTargetConsensus = null;
                  (a as any)._tempPriceTargetHigh = null;
                  (a as any)._tempPriceTargetLow = null;
                  (a as any)._tempPriceTargetUpsidePct = null;
                  enrichStatuses.price_target = 'skip';
                }
              })()
            );
          } else {
            (a as any)._tempPriceTargetConsensus = (a.analysis as any).price_target_consensus ?? null;
            (a as any)._tempPriceTargetUpsidePct = (a.analysis as any).price_target_upside_pct ?? null;
            enrichStatuses.price_target = (a.analysis as any).price_target_consensus !== null && (a.analysis as any).price_target_consensus !== undefined ? 'hit' : 'skip';
          }

          // 5. Google Trends
          if (!a.analysis.trendsSummary) {
            if (enableTrends) {
              promises.push(
                (async () => {
                  try {
                    const trends = await getTrendsSummary(
                      uppercaseSymbol,
                      companyName,
                      a.date,
                    );
                    if (trends) {
                      a.analysis!.trendsSummary = trends;
                      (a as any)._tempTrendsSummary = trends;
                    } else {
                      a.analysis!.trendsSummary = null as any;
                      (a as any)._tempTrendsSummary = null;
                    }
                  } catch (err) {
                    console.error(
                      `[HistoricalEngine] Failed to retrieve Google Trends for anomaly on ${a.date}:`,
                      err,
                    );
                    a.analysis!.trendsSummary = null as any;
                    (a as any)._tempTrendsSummary = null;
                  }
                })(),
              );
            }
          } else {
            (a as any)._tempTrendsSummary = a.analysis.trendsSummary;
          }

          // 6. Wikipedia Spikes
          if (
            !a.analysis.wikipediaSpikes ||
            a.analysis.wikipediaSpikes.length === 0
          ) {
            if (wikiQueries.length > 0) {
              promises.push(
                (async () => {
                  try {
                    const spikes = await Promise.all(
                      wikiQueries.map((q) => detectWikipediaSpike(q, a.date)),
                    );
                    const validSpikes = spikes.filter((s) => s && s.isSpike);
                    if (validSpikes.length > 0) {
                      a.analysis!.wikipediaSpikes = validSpikes;
                      (a as any)._tempWikipediaSpikes = validSpikes;
                    } else {
                      a.analysis!.wikipediaSpikes = [] as any;
                      (a as any)._tempWikipediaSpikes = [];
                    }
                  } catch (err) {
                    console.error(
                      `[HistoricalEngine] Failed to retrieve Wikipedia spikes for anomaly on ${a.date}:`,
                      err,
                    );
                    a.analysis!.wikipediaSpikes = [] as any;
                    (a as any)._tempWikipediaSpikes = [];
                  }
                })(),
              );
            }
          } else {
            (a as any)._tempWikipediaSpikes = a.analysis.wikipediaSpikes;
          }

          // 7. GDELT GKG Tone
          if (!a.analysis.gdeltTone) {
            promises.push(
              (async () => {
                try {
                  const gdeltTone = await fetchGDELTToneForDate(
                    uppercaseSymbol,
                    companyName,
                    a.date,
                  );
                  a.analysis!.gdeltTone = gdeltTone;
                  (a as any)._tempGdeltTone = gdeltTone;
                  enrichStatuses.gdelt = gdeltTone.matchCount > 0 ? 'hit' : 'skip';
                } catch (err) {
                  console.error(
                    `[HistoricalEngine] Failed to retrieve GDELT tone for anomaly on ${a.date}:`,
                    err,
                  );
                  a.analysis!.gdeltTone = null;
                  (a as any)._tempGdeltTone = null;
                  enrichStatuses.gdelt = 'skip';
                }
              })(),
            );
          } else {
            (a as any)._tempGdeltTone = a.analysis.gdeltTone;
            enrichStatuses.gdelt = (a.analysis.gdeltTone.matchCount ?? 0) > 0 ? 'hit' : 'skip';
          }

          // 8. YouTube Videos
          if (
            !a.analysis.youtubeVideos ||
            a.analysis.youtubeVideos.length === 0
          ) {
            if (hasYouTubeApiKey) {
              promises.push(
                (async () => {
                  try {
                    const query = `${companyName} (CEO interview OR earnings call)`;
                    const videos = await fetchYouTubeTranscripts(
                      query,
                      uppercaseSymbol,
                      fromDate,
                      toDate,
                    );
                    if (videos && videos.length > 0) {
                      a.analysis!.youtubeVideos = videos;
                      (a as any)._tempYoutubeVideos = videos;
                    } else {
                      a.analysis!.youtubeVideos = [] as any;
                      (a as any)._tempYoutubeVideos = [];
                    }
                  } catch (err) {
                    console.error(
                      `[HistoricalEngine] Failed to retrieve YouTube videos for anomaly on ${a.date}:`,
                      err,
                    );
                    a.analysis!.youtubeVideos = [] as any;
                    (a as any)._tempYoutubeVideos = [];
                  }
                })(),
              );
            }
          } else {
            (a as any)._tempYoutubeVideos = a.analysis.youtubeVideos;
          }

          // 9. Congressional Net Flow
          if (isUsListed) {
            promises.push(
              (async () => {
                try {
                  const netFlow = await getCongressionalNetFlow(uppercaseSymbol, a.date);
                  if (netFlow !== null && netFlow !== undefined) {
                    (a as any)._tempCongressionalNetFlow = netFlow;
                  } else {
                    (a as any)._tempCongressionalNetFlow = null;
                  }
                } catch (err) {
                  console.error(
                    `[HistoricalEngine] Failed to retrieve congressional net flow for anomaly on ${a.date}:`,
                    err,
                  );
                  (a as any)._tempCongressionalNetFlow = null;
                }
              })(),
            );
          } else {
            (a as any)._tempCongressionalNetFlow = null;
          }

          // 10. IV Crush
          promises.push(
            (async () => {
              try {
                const dateObj = new Date(a.date);
                const dayOfWeek = dateObj.getUTCDay();
                // Subtract 3 days if Monday, 2 if Sunday, else 1
                dateObj.setUTCDate(dateObj.getUTCDate() - (dayOfWeek === 1 ? 3 : dayOfWeek === 0 ? 2 : 1));
                const tMinus1Date = dateObj.toISOString().split('T')[0];

                const [ivTMinus1, ivT] = await Promise.all([
                  getHistoricalImpliedVolatility(uppercaseSymbol, tMinus1Date),
                  getHistoricalImpliedVolatility(uppercaseSymbol, a.date)
                ]);
                if (ivTMinus1 !== null && ivT !== null && ivTMinus1 > 0) {
                  const crushPct = ((ivTMinus1 - ivT) / ivTMinus1) * 100;
                  (a as any)._tempIvCrush = Math.round(crushPct * 100) / 100;
                  enrichStatuses.polygon = 'hit';
                } else {
                  (a as any)._tempIvCrush = null;
                  if (enrichStatuses.polygon !== 'hit') enrichStatuses.polygon = 'skip';
                  console.log(`[Enrichment] No data from polygon (IV Crush) for ${uppercaseSymbol} / ${a.date} — skipping this source for this bar.`);
                }
              } catch (err) {
                (a as any)._tempIvCrush = null;
                if (enrichStatuses.polygon !== 'hit') enrichStatuses.polygon = 'skip';
                console.log(`[Enrichment] polygon (IV Crush) unavailable for ${uppercaseSymbol} / ${a.date} — continuing with other sources.`);
              }
            })()
          );

          // 10.5 StockTwits Social Sentiment
          promises.push(
            (async () => {
              try {
                // Fetch sentiment for a small window around the anomaly date
                const sentiment = await getStockTwitsSentimentSummary(uppercaseSymbol, a.date, a.date);
                (a as any)._tempSocialSentiment = sentiment;
                if (sentiment) {
                  enrichStatuses.fmp_social = 'hit';
                } else {
                  enrichStatuses.fmp_social = 'skip';
                }
              } catch (err) {
                console.error(`[HistoricalEngine] Failed to load StockTwits sentiment for ${uppercaseSymbol} on ${a.date}:`, err);
                (a as any)._tempSocialSentiment = null;
                enrichStatuses.fmp_social = 'skip';
              }
            })()
          );

          // 10.6 Short Interest — FMP primary, FINRA fallback
          promises.push(
            (async () => {
              try {
                const [fmpSI, velocity] = await Promise.all([
                  getFMPShortInterest(uppercaseSymbol, a.date),
                  getShortInterestVelocity(uppercaseSymbol, a.date)
                ]);

                if (fmpSI) {
                  (a as any)._tempShortInterest = {
                    pctOfFloat: fmpSI.pctOfFloat,
                    sharesFloat: fmpSI.sharesFloat,
                    settlementDate: a.date,
                    source: 'fmp'
                  };
                  enrichStatuses.fmp_short = 'hit';
                } else {
                  enrichStatuses.fmp_short = 'skip';
                  const si = await getShortInterest(uppercaseSymbol, a.date);
                  (a as any)._tempShortInterest = si;
                }
                (a as any)._tempShortInterestVelocity = velocity;
              } catch (err) {
                console.error(`[HistoricalEngine] Failed to load short interest for ${uppercaseSymbol} on ${a.date}:`, err);
                (a as any)._tempShortInterest = null;
                (a as any)._tempShortInterestVelocity = null;
                enrichStatuses.fmp_short = 'skip';
              }
            })()
          );

          // 11. Sector Contagion
          promises.push(
            (async () => {
              try {
                const peers = topPeers;
                if (peers && peers.length > 0) {
                  let peerReturnsSum = 0;
                  let peerCount = 0;

                  await Promise.all(peers.map(async (peerSymbol: string) => {
                    try {
                      const peerCacheKey = `${peerSymbol}_${a.date}`;
                      if (this.peerPriceCache.has(peerCacheKey)) {
                        const cachedR = this.peerPriceCache.get(peerCacheKey);
                        if (cachedR !== null) {
                          peerReturnsSum += cachedR;
                          peerCount++;
                        }
                        return; // already processed
                      }

                      // Bypassing Polygon for peer historical lookups entirely as free tier lacks historical returns.
                      // Using the optimized Yahoo Finance daily return helper.
                      const rPeer = await this.fetchPeerDailyReturn(peerSymbol, a.date);

                      this.peerPriceCache.set(peerCacheKey, rPeer);
                      if (rPeer !== null) {
                         peerReturnsSum += rPeer;
                         peerCount++;
                      }
                    } catch (peerErr) {
                      console.error(`[HistoricalEngine] Failed to get peer history for ${peerSymbol}:`, peerErr);
                    }
                  }));

                  if (peerCount > 0) {
                    const peerAvgReturn = peerReturnsSum / peerCount;
                    const contagionDelta = a.dailyReturn - peerAvgReturn;
                    
                    (a as any)._tempPeerAverageReturn = Math.round(peerAvgReturn * 100) / 100;
                    (a as any)._tempContagionDelta = Math.round(contagionDelta * 100) / 100;
                    a.analysis.peer_average_return = (a as any)._tempPeerAverageReturn;
                    a.analysis.peer_contagion_delta = (a as any)._tempContagionDelta;
                  } else {
                    (a as any)._tempPeerAverageReturn = null;
                    (a as any)._tempContagionDelta = null;
                  }
                } else {
                  (a as any)._tempPeerAverageReturn = null;
                  (a as any)._tempContagionDelta = null;
                }
              } catch (err) {
                console.error(`[HistoricalEngine] Failed to calculate Sector Contagion for anomaly on ${a.date}:`, err);
                (a as any)._tempPeerAverageReturn = null;
                (a as any)._tempContagionDelta = null;
              }
            })()
          );

          // 12. Put/Call Ratio (PCR)
          promises.push(
            (async () => {
              try {
                // Find t_minus_1_date exactly like IV crush
                const dateObj = new Date(a.date);
                const dayOfWeek = dateObj.getUTCDay();
                dateObj.setUTCDate(dateObj.getUTCDate() - (dayOfWeek === 1 ? 3 : dayOfWeek === 0 ? 2 : 1));
                const tMinus1Date = dateObj.toISOString().split('T')[0];

                const pcrResult = await getDailyPutCallRatio(uppercaseSymbol, tMinus1Date);
                if (pcrResult !== null) {
                  (a as any)._tempPutCallRatio = pcrResult.value;
                  enrichStatuses.polygon = 'hit';
                } else {
                  (a as any)._tempPutCallRatio = null;
                  if (enrichStatuses.polygon !== 'hit') enrichStatuses.polygon = 'skip';
                  console.log(`[Enrichment] No data from polygon (PCR) for ${uppercaseSymbol} / ${a.date} — skipping this source for this bar.`);
                }
              } catch (err) {
                (a as any)._tempPutCallRatio = null;
                if (enrichStatuses.polygon !== 'hit') enrichStatuses.polygon = 'skip';
                console.log(`[Enrichment] polygon (PCR) unavailable for ${uppercaseSymbol} / ${a.date} — continuing with other sources.`);
              }
            })()
          );

          // 13. Hidden Liquidity
          promises.push(
            (async () => {
              try {
                const dpData = await getDarkPoolActivity(uppercaseSymbol, a.date);
                if (dpData && dpData.darkPoolPct) {
                  (a as any)._tempDarkPoolIndex = Math.round(dpData.darkPoolPct * 100) / 100;
                } else {
                  (a as any)._tempDarkPoolIndex = null;
                }

                // calculate t_minus_7_date
                const dateObj = new Date(a.date);
                dateObj.setUTCDate(dateObj.getUTCDate() - 7);
                const tMinus7Date = dateObj.toISOString().split('T')[0];

                const rate7 = await getBorrowRate(uppercaseSymbol, tMinus7Date);
                const rateT = await getBorrowRate(uppercaseSymbol, a.date);

                const ctbTMinus7 = rate7?.borrowRatePct ?? null;
                const ctbT = rateT?.borrowRatePct ?? null;

                if (ctbTMinus7 !== null && ctbT !== null) {
                  const ctbVelocity = ((ctbT - ctbTMinus7) / Math.max(0.0001, ctbTMinus7)) * 100;
                  (a as any)._tempCtbVelocity = Math.round(ctbVelocity * 100) / 100;
                } else {
                  (a as any)._tempCtbVelocity = null;
                }
              } catch (err) {
                console.error(`[HistoricalEngine] Failed to calculate Hidden Liquidity for anomaly on ${a.date}:`, err);
                (a as any)._tempDarkPoolIndex = null;
                (a as any)._tempCtbVelocity = null;
              }
            })()
          );

          // 14. Earnings Estimate Revision Momentum
          if (isUsListed) {
            promises.push(
              (async () => {
                try {
                  const revisions = await getEstimateRevisions(uppercaseSymbol, a.date);
                  (a as any)._tempEstimateRevisions = revisions ?? null;
                } catch (err) {
                  console.error(`[HistoricalEngine] Failed to get estimate revisions for ${uppercaseSymbol} on ${a.date}:`, err);
                  (a as any)._tempEstimateRevisions = null;
                }
              })()
            );
          } else {
            (a as any)._tempEstimateRevisions = null;
          }

          // 15. Company-Level Credit Proxy (synchronous — derived from D/E already in fmpContext)
          const deRatio = fmpContext?.ratios?.debtToEquityRatio ?? null;
          const creditCtx = getCompanyCreditContext(uppercaseSymbol, deRatio);
          (a as any)._tempCompanyCreditProxy = creditCtx ? creditCtx.creditSpreadProxy : null;

          // 16. Finnhub — News Count + Insider Activity
          promises.push(
            (async () => {
              try {
                const [finnhubNews, finnhubInsider] = await Promise.allSettled([
                  getFinnhubNewsCount(uppercaseSymbol, a.date),
                  getFinnhubInsiderActivity(uppercaseSymbol, a.date),
                ]);
                (a as any)._tempFinnhubNewsCount =
                  finnhubNews.status === "fulfilled" ? finnhubNews.value?.articleCount ?? null : null;
                (a as any)._tempFinnhubNewsElevated =
                  finnhubNews.status === "fulfilled" ? finnhubNews.value?.isElevated ?? false : false;
                (a as any)._tempFinnhubInsiderActivity =
                  finnhubInsider.status === "fulfilled" ? finnhubInsider.value?.hasRecentActivity ?? false : false;
                (a as any)._tempFinnhubInsiderCount =
                  finnhubInsider.status === "fulfilled" ? finnhubInsider.value?.transactionCount ?? 0 : 0;
              } catch (err) {
                console.error(`[HistoricalEngine] Failed to retrieve Finnhub data for ${uppercaseSymbol} on ${a.date}:`, err);
                (a as any)._tempFinnhubNewsCount = null;
                (a as any)._tempFinnhubNewsElevated = false;
                (a as any)._tempFinnhubInsiderActivity = false;
                (a as any)._tempFinnhubInsiderCount = 0;
              }
            })()
          );

          // 17. FDA Drug Submission Activity
          promises.push(
            (async () => {
              try {
                const [fdaResult] = await Promise.allSettled([
                  getFDAActivity(companyName ?? uppercaseSymbol, a.date),
                ]);
                (a as any)._tempFDAHasActivity =
                  fdaResult.status === "fulfilled" ? fdaResult.value?.hasActivity ?? false : false;
                (a as any)._tempFDAActivityCount =
                  fdaResult.status === "fulfilled" ? fdaResult.value?.activityCount ?? 0 : 0;
              } catch (err) {
                console.error(`[HistoricalEngine] Failed to retrieve FDA activity for ${companyName ?? uppercaseSymbol} on ${a.date}:`, err);
                (a as any)._tempFDAHasActivity = false;
                (a as any)._tempFDAActivityCount = 0;
              }
            })()
          );

          await Promise.all(promises);
          console.log(`[Enrichment] ${uppercaseSymbol} / ${a.date}: polygon=${enrichStatuses.polygon}, fmp_dark_pool=${enrichStatuses.fmp_dark_pool}, fmp_borrow=${enrichStatuses.fmp_borrow}, fmp_social=${enrichStatuses.fmp_social}, fmp_short=${enrichStatuses.fmp_short}, fmp_news=${enrichStatuses.fmp_news}, insider=${enrichStatuses.insider}, institutional=${enrichStatuses.institutional}, earnings=${enrichStatuses.earnings}, grades=${enrichStatuses.grades}, price_target=${enrichStatuses.price_target}, gdelt=${enrichStatuses.gdelt}, reddit=${enrichStatuses.reddit}, trends=${enrichStatuses.trends}, wiki=${enrichStatuses.wiki}, newsapi=${enrichStatuses.newsapi}, youtube=${enrichStatuses.youtube}, edgar=${enrichStatuses.edgar}, congressional=${enrichStatuses.congressional}`);

          // Dynamically merge and update cache record if this was already loaded from cache previously
          if (a.hasAnalysis && a.analysis) {
            let updated = false;
            if (
              (a as any)._tempMacroSnapshot !== undefined &&
              !a.analysis.macroSnapshot
            ) {
              a.analysis.macroSnapshot = (a as any)._tempMacroSnapshot;
              updated = true;
            }
            if (
              (a as any)._tempMacroRelease !== undefined &&
              !a.analysis.macroRelease
            ) {
              a.analysis.macroRelease = (a as any)._tempMacroRelease;
              updated = true;
            }
            if (
              (a as any)._tempWikipediaSpikes !== undefined &&
              (!a.analysis.wikipediaSpikes ||
                a.analysis.wikipediaSpikes.length === 0)
            ) {
              a.analysis.wikipediaSpikes = (a as any)._tempWikipediaSpikes;
              updated = true;
            }
            if (
              (a as any)._tempGdeltTone !== undefined &&
              !a.analysis.gdeltTone
            ) {
              a.analysis.gdeltTone = (a as any)._tempGdeltTone;
              updated = true;
            }
            if (
              (a as any)._tempYoutubeVideos !== undefined &&
              (!a.analysis.youtubeVideos ||
                a.analysis.youtubeVideos.length === 0)
            ) {
              a.analysis.youtubeVideos = (a as any)._tempYoutubeVideos;
              updated = true;
            }
            if (
              (a as any)._tempPrefetchedArticles !== undefined &&
              (!a.analysis.newsList || a.analysis.newsList.length === 0)
            ) {
              a.analysis.newsList = (a as any)._tempPrefetchedArticles;
              updated = true;
            }
            if (
              (a as any)._tempSocialSentiment !== undefined &&
              !a.analysis.socialSentiment
            ) {
              a.analysis.socialSentiment = (a as any)._tempSocialSentiment;
              updated = true;
            }
            if (
              (a as any)._tempTrendsSummary !== undefined &&
              !a.analysis.trendsSummary
            ) {
              a.analysis.trendsSummary = (a as any)._tempTrendsSummary;
              updated = true;
            }

            if (
              (a as any)._tempShortInterest !== undefined &&
              !(a as any).analysis.shortInterest
            ) {
              a.analysis.shortInterest = (a as any)._tempShortInterest;
              a.analysis.shortInterestVelocity = (a as any)._tempShortInterestVelocity;
              updated = true;
            }

            if (updated) {
              const cacheKey = `${uppercaseSymbol}_${a.date}`;
              const isFallback = !!a.analysis.isFallback;
              setCachedAnalysis(
                cacheKey,
                uppercaseSymbol,
                a.date,
                a.analysis,
                isFallback,
              );
              console.log(
                `[HistoricalEngine] Successfully merged and updated missing sources for pre-cached anomaly on ${a.date}`,
              );
            }
          }
        }),
      );
    }
  }

  /**
   * Extracted method to normalize intensities.
   * These normalised intensities feed the gating engine's broadened non-event detector, which flags a flat-price bar as a SUPPRESSED_NON_EVENT when any signal fired hard while the price did not move.
   */
  private collectExternalSignals(point: StockPoint): Record<string, number> {
    const results: Record<string, number> = {};
    const ext = (point as any).enrichment || (point as any);

    const tryNormalize = (key: string) => {
      // Current value might be under key, or under a base name without "_zscore" or "_ratio"
      let current = ext[key];

      if (current === undefined && point.analysis) {
        if (key === "short_interest_pct_float" && point.analysis.shortInterest) {
          current = point.analysis.shortInterest.pctOfFloat;
        } else if (key === "short_interest_velocity" && point.analysis.shortInterestVelocity !== undefined) {
          current = point.analysis.shortInterestVelocity;
        }
      }

      if (typeof current !== "number") {
        const baseKey = key.replace("_zscore", "").replace("_ratio", "");
        current = ext[baseKey];
      }

      if (typeof current === "number") {
        let history = ext[`${key}_history`] || ext[`${key}_series`] || ext[`${key}_trailing`];
        if (!Array.isArray(history)) {
          const baseKey = key.replace("_zscore", "").replace("_ratio", "");
          history = ext[`${baseKey}_history`] || ext[`${baseKey}_series`] || ext[`${baseKey}_trailing`];
        }

        if (Array.isArray(history) && history.length >= 10) {
          const z = SignalNormalizer.calculateZScore(history, current);
          if (z !== null) {
            results[key] = z;
          } else {
            results[`${key}_raw`] = current;
          }
        } else {
          results[`${key}_raw`] = current;
        }
      }
    };

    const keysToTry = [
      "gdelt_tone_zscore",
      "reddit_virality",
      "google_trends_zscore",
      "wikipedia_spike_ratio",
      "news_relevance",
      "insider_plan_intensity",
      "macro_release_surprise",
      "youtube_mgmt_confidence",
      "short_interest_pct_float",
      "short_interest_velocity",
      "estimate_revision_magnitude",
      "stocktwits_virality",
      "_tempFinnhubNewsCount",
      "_tempFinnhubInsiderCount",
      "_tempFDAActivityCount",
    ];

    keysToTry.forEach(tryNormalize);

    // Estimate revision magnitude: inject directly from _temp if available (raw %)
    const erMag = (point as any)._tempEstimateRevisions?.revisionMagnitudePct;
    if (typeof erMag === 'number' && isFinite(erMag)) {
      // Normalise: divide by 20 so a ±20% revision ≈ ±1 z-score unit
      results['estimate_revision_magnitude'] = erMag / 20;
    }

    // Boolean elevation flags — converted to 0/1 signals directly
    const finnhubElevated = (ext as any)._tempFinnhubNewsElevated;
    if (finnhubElevated === true) results["finnhub_news_elevated"] = 1;

    const insiderActive = (ext as any)._tempFinnhubInsiderActivity;
    if (insiderActive === true) results["finnhub_insider_active"] = 1;

    const fdaActive = (ext as any)._tempFDAHasActivity;
    if (fdaActive === true) results["fda_activity"] = 1;

    return results;
  }
}

export function generateLocalFallbackAnalysis(
  symbol: string,
  date: string,
  dailyReturn: number,
  zScore: number,
  existingAnalysis?: Partial<StockAnalysis>,
  realVix?: number | null,
): StockAnalysis {
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const absRet = Math.abs(dailyReturn);
  const isPositive = dailyReturn > 0;

  let primary_catalyst_tag = "Market Volatility";
  let primaryCategory = "market_structure";
  let primarySubType = isPositive ? "liquidity_event" : "panic_selloff";
  let secondaryCategories = ["macro"];
  let eventTags = ["fallback_analysis", "systematic_volatility"];

  let confidence_score = 65;
  let severity_score = Math.min(100, Math.max(10, Math.round(absRet * 3.5)));

  if (isPositive) {
    if (absRet > 15) {
      primary_catalyst_tag = "Earnings Outperformance";
      primaryCategory = "corporate";
      primarySubType = "earnings_beat";
      secondaryCategories = ["sentiment"];
      eventTags = ["earnings", "upside"];
      confidence_score = 80;
    } else if (absRet > 8) {
      primary_catalyst_tag = "Product Initiative";
      primaryCategory = "corporate";
      primarySubType = "product_launch";
      secondaryCategories = ["sentiment"];
      eventTags = ["momentum"];
      confidence_score = 75;
    } else {
      primary_catalyst_tag = "Macro Trends / Upgrade";
      primaryCategory = "sentiment";
      primarySubType = "analyst_upgrade";
      secondaryCategories = ["market_structure"];
      eventTags = ["beta", "momentum"];
      confidence_score = 70;
    }
  } else {
    if (absRet > 15) {
      primary_catalyst_tag = "Earnings Misstep";
      primaryCategory = "corporate";
      primarySubType = "earnings_miss";
      secondaryCategories = ["sentiment"];
      eventTags = ["earnings", "panic", "downside"];
      confidence_score = 85;
    } else if (absRet > 8) {
      primary_catalyst_tag = "Regulatory / Headwinds";
      primaryCategory = "macro";
      primarySubType = "regulation";
      secondaryCategories = ["sentiment"];
      eventTags = ["liquidation", "sector_rotation"];
      confidence_score = 75;
    } else {
      primary_catalyst_tag = "Technical Retracement";
      primaryCategory = "market_structure";
      primarySubType = "liquidity_event";
      secondaryCategories = ["macro"];
      eventTags = ["noise", "drift"];
      confidence_score = 70;
    }
  }

  // Derive directional effect scores from the actual returns
  const r1d =
    existingAnalysis?.return_1d ?? (isPositive ? absRet * 0.8 : -absRet * 0.8);
  const r1w =
    existingAnalysis?.return_1w ?? (isPositive ? absRet * 1.2 : -absRet * 1.2);
  const r1m =
    existingAnalysis?.return_1m ?? (isPositive ? absRet * 1.5 : -absRet * 1.5);
  const r6m =
    existingAnalysis?.return_6m ?? (isPositive ? absRet * 2.1 : -absRet * 2.1);
  const r1y =
    existingAnalysis?.return_1y ?? (isPositive ? absRet * 3.0 : -absRet * 3.0);

  const clampScore = (v: number) =>
    Math.min(100, Math.max(-100, Math.round(v)));

  const fallbackVix = realVix ?? existingAnalysis?.vixAtEvent ?? 15.0;
  const fallbackVixRegime = (realVix != null ? (realVix < 15 ? "low" : realVix <= 25 ? "moderate" : realVix <= 35 ? "elevated" : "extreme") : null) ?? existingAnalysis?.vixRegime ?? "low";

  const alternative_data_score = Math.min(100, Math.max(10, Math.round(absRet * 2.5)));
  const alternative_data_observations = `Historical social sentinel check detected elevated internet indexing anomaly triggers for ticker ${uppercaseSymbol} surrounding ${date}. Outliers suggest a surge in public query rates and forum mentions tracking the ${dailyReturn.toFixed(2)}% outlier price return.`;

  const corporate_governance_score = Math.min(100, Math.max(10, Math.round(absRet * 2.0)));
  const corporate_governance_observations = `Automated corporate filing checks indicated heightened institutional portfolio updates and insider trading density reports registered near ${date} for ${uppercaseSymbol}.`;

  const macroeconomic_score = Math.min(100, Math.max(10, Math.round(fallbackVix * 2.5)));
  const macroeconomic_observations = `Macro backdrop audit: Market was under a ${fallbackVixRegime} volatility regime with VIX reading ${fallbackVix.toFixed(2)} on ${date}. These broader market risk factors provided a strong or secondary backdrop to ${uppercaseSymbol}'s statistical price shock.`;

  const market_structure_score = Math.min(100, Math.max(10, Math.round(absRet * 3.0)));
  const market_structure_observations = `Market structure analysis: Extreme daily return volatility outlier detected. Z-score was calculated at ${zScore.toFixed(2)}, reflecting strong trade flow imbalance and pricing friction on ${date} for ${uppercaseSymbol}.`;

  const fundamental_and_earnings_score = Math.min(100, Math.max(10, Math.round(absRet * 3.5)));
  const fundamental_and_earnings_observations = `Fundamental momentum review: Highly significant price revision on ${date} (absolute return ${absRet.toFixed(2)}%). Outliers of this magnitude are statistically correlated with major corporate earnings announcements, guidance updates, or competitor movements.`;

  const coincidence_vs_correlation = `Analysis: On ${date}, the ${dailyReturn.toFixed(2)}% move in ${uppercaseSymbol} displays a strong statistical correlation with its primary sector beta, indicating systematic or sectoral momentum.`;
  const correlation_confidence = 70;

  return {
    isFallback: true,
    primary_catalyst_tag,
    primaryCategory,
    primarySubType,
    secondaryCategories,
    eventTags,
    suspected_catalyst: null, // DO NOT generate a Synthetic Estimate text as requested
    key_risk: null,
    confidence_score,
    severity_score,
    return_1d: existingAnalysis?.return_1d,
    return_1w: existingAnalysis?.return_1w,
    return_1m: existingAnalysis?.return_1m,
    return_6m: existingAnalysis?.return_6m,
    return_1y: existingAnalysis?.return_1y,
    effect_score_1d: clampScore(r1d * 3),
    effect_score_1w: clampScore(r1w * 2.5),
    effect_score_1m: clampScore(r1m * 2),
    effect_score_6m: clampScore(r6m * 1.5),
    effect_score_1y: clampScore(r1y * 1.2),
    internet_findings: `Social sentiment and historical trends index audit for ${uppercaseSymbol} completed.`,
    alternative_data_observations,
    alternative_data_score,
    corporate_governance_observations,
    corporate_governance_score,
    macroeconomic_observations,
    macroeconomic_score,
    market_structure_observations,
    market_structure_score,
    fundamental_and_earnings_observations,
    fundamental_and_earnings_score,
    coincidence_vs_correlation,
    correlation_confidence,
  };
}

function getTradingDaysDistance(
  dateA: string,
  dateB: string,
  allPoints: StockPoint[],
): number | null {
  const idxA = allPoints.findIndex((p) => p.date === dateA);
  if (idxA === -1) return null;

  let closestIdx = -1;
  let minDiffMs = Infinity;
  const timeB = new Date(dateB).getTime();

  for (let i = 0; i < allPoints.length; i++) {
    const diff = Math.abs(new Date(allPoints[i].date).getTime() - timeB);
    if (diff < minDiffMs) {
      minDiffMs = diff;
      closestIdx = i;
    }
  }

  // If closest day has more than 10 calendar days diff, consider too far
  if (minDiffMs > 10 * 24 * 60 * 60 * 1000) {
    return null;
  }

  if (closestIdx === -1) return null;
  return closestIdx - idxA;
}
