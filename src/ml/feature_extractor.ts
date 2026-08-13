import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, getCachedCompanyProfile } from '../../db';

type Json = Record<string, any>;

interface EventFeatureRow {
  cache_key: string;
  symbol: string;
  date: string;
  primaryCategory: string | null;
  features_json: string;
  max_favorable_excursion_1m: number | null;
  max_adverse_excursion_1m: number | null;
  forward_return_3m: number | null;
  forward_return_6m: number | null;
  forward_return_12m: number | null;
  forward_return_2d: number | null;
  forward_return_3d: number | null;
  forward_return_2w: number | null;
  pre_return_3d: number | null;
  pre_return_5d: number | null;
  pre_return_10d: number | null;
  pre_return_21d: number | null;
  pre_vol_ratio_5d: number | null;
  pre_vol_ratio_10d: number | null;
  is_null_sample: number | null;
  signal_snapshot_json: string | null;
  confidence_tier: string | null;
}

const PRIMARY_CATEGORIES = ['market_structure', 'sentiment', 'corporate', 'macro', 'technical'];
const SECTORS = [
  'Technology', 'Healthcare', 'Financials', 'Energy', 'Consumer', 'Industrials',
  'Materials', 'Utilities', 'Real Estate', 'Communication Services', 'Other',
];
const NULL_INDICATOR_THRESHOLD = 0.10;

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// 0.0 = new moon, 0.5 = full moon, 1.0 = new moon again
function computeLunarPhase(date: unknown): number | null {
  if (typeof date !== 'string') return null;
  const eventDate = new Date(date);
  if (Number.isNaN(eventDate.getTime())) return null;
  const knownNewMoon = new Date('2000-01-06').getTime();
  const lunarCycle = 29.53058770576; // days
  const daysSinceNew = (eventDate.getTime() - knownNewMoon) / 86400000;
  return ((daysSinceNew % lunarCycle) / lunarCycle + 1) % 1;
}

function encodeVixRegime(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  switch (v.toLowerCase()) {
    case 'low': return 0;
    case 'moderate': return 1;
    case 'high': return 2;
    default: return null;
  }
}

function encodeTrendRegime(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  switch (v.toLowerCase()) {
    case 'bear': return -1;
    case 'sideways': return 0;
    case 'bull': return 1;
    default: return null;
  }
}

export function normaliseSector(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'Other';
  const s = raw.toLowerCase();
  if (s.includes('tech')) return 'Technology';
  if (s.includes('health')) return 'Healthcare';
  if (s.includes('financ')) return 'Financials';
  if (s.includes('energy')) return 'Energy';
  if (s.includes('consumer')) return 'Consumer';
  if (s.includes('industrial')) return 'Industrials';
  if (s.includes('material')) return 'Materials';
  if (s.includes('utilit')) return 'Utilities';
  if (s.includes('real estate')) return 'Real Estate';
  if (s.includes('communication')) return 'Communication Services';
  return 'Other';
}

const sectorCache = new Map<string, string | null>();

function lookupCompanySector(symbol: string): string | null {
  if (sectorCache.has(symbol)) return sectorCache.get(symbol) as string | null;
  let sector: string | null = null;
  try {
    const cached = getCachedCompanyProfile(symbol);
    sector = cached?.profile.sector ?? null;
  } catch {
    sector = null;
  }
  sectorCache.set(symbol, sector);
  return sector;
}

// Each accessor checks signal_snapshot_json (snap) first, then falls back to features_json (f).
const NUMERIC_ACCESSORS: Record<string, (f: Json, snap: Json | null) => number | null> = {
  // Price / volume signals
  z_score: (f, s) => numOrNull(s?.z_score ?? f.z_score ?? f.zScore),
  excess_return: (f, s) => numOrNull(s?.excess_return ?? f.excessReturn),
  atr_shock_score: (f, s) => numOrNull(s?.atr_shock_score ?? f.atrShockScore),
  volume_ratio: (f, s) => numOrNull(s?.volume_ratio ?? f.volumeRatio),
  relative_volume_30d: (f) => numOrNull(f.relative_volume_30d),
  body_to_range_ratio: (f) => numOrNull(f.body_to_range_ratio),
  overnight_gap_pct: (f) => numOrNull(f.overnight_gap_pct),
  gap_fill_ratio: (f) => numOrNull(f.gap_fill_ratio),
  obv_delta_10d: (f) => numOrNull(f.obv_delta_10d),
  dist_sma_50: (f) => numOrNull(f.dist_sma_50),
  dist_sma_200: (f) => numOrNull(f.dist_sma_200),
  rsi_14: (f) => numOrNull(f.rsi_14),

  // Market regime
  // vix_close (training convention, HistoricalEngine.ts:492/535): raw VIX / 100.
  // f.vix_close/f.vixAtEvent are assumed already in that scale when present
  // (e.g. a caller that pre-scaled it). s?.vix (signal_snapshot_json's cached
  // "vix" field) is confirmed raw-scale in every case checked -- live inference
  // never sets f.vix_close/f.vixAtEvent at all, so it always fell through to
  // this raw, undivided branch, producing a ~100x-too-large value relative to
  // training. Scaling only this fallback (not the whole accessor) avoids
  // double-dividing an already-scaled f.vix_close/f.vixAtEvent.
  vix_close: (f, s) => {
    const fromF = numOrNull(f.vix_close ?? f.vixAtEvent);
    if (fromF !== null) return fromF;
    const fromSnap = numOrNull(s?.vix);
    return fromSnap === null ? null : fromSnap / 100;
  },
  vix_regime: (f, s) => encodeVixRegime(s?.vix_regime ?? f.vixRegime),
  trend_regime: (f, s) => encodeTrendRegime(s?.trend_regime ?? f.trendRegime),
  yield_curve_spread: (f, s) => numOrNull(s?.yield_curve_spread ?? f.yield_curve_spread),
  credit_spread: (f, s) => numOrNull(s?.credit_spread ?? f.credit_spread),
  economic_policy_uncertainty: (f) => numOrNull(f.economic_policy_uncertainty),

  // Physics / complexity signals
  shannon_entropy_30d: (f, s) => numOrNull(f.shannon_entropy_30d ?? s?.shannon_entropy),
  amihud_illiquidity_30d: (f, s) => numOrNull(f.amihud_illiquidity_30d ?? s?.amihud_illiquidity),
  fractal_efficiency_ratio_10d: (f, s) => numOrNull(f.fractal_efficiency_ratio_10d ?? s?.fractal_efficiency),
  market_reynolds_number: (f) => numOrNull(f.market_reynolds_number),
  kinetic_energy: (f) => numOrNull(f.kinetic_energy),
  seismic_magnitude_mw: (f) => numOrNull(f.seismic_magnitude_mw),
  barycenter_stretch_20d: (f) => numOrNull(f.barycenter_stretch_20d),
  sector_relative_z_score: (f, s) => numOrNull(f.sector_relative_z_score ?? s?.sector_relative_z_score),

  // Enrichment signals
  gdelt_tone_z: (f, s) => numOrNull(s?.gdelt_tone_z ?? f.gdelt_tone_z),
  stocktwits_virality_z: (f, s) => numOrNull(s?.stocktwits_virality_z ?? f.stocktwits_virality_z),
  google_trends_z: (f, s) => numOrNull(s?.google_trends_z ?? f.google_trends_z),
  wikipedia_spike_z: (f, s) => numOrNull(s?.wikipedia_spike_z ?? f.wikipedia_spike_z),
  news_relevance_z: (f, s) => numOrNull(s?.news_relevance_z ?? f.news_relevance_z),
  short_interest_pct_float: (f, s) => numOrNull(s?.short_interest_pct_float ?? f.short_interest_pct_float ?? f.short_interest_pct),
  put_call_ratio_t_minus_1: (f, s) => numOrNull(f.put_call_ratio_t_minus_1 ?? s?.put_call_ratio),
  dark_pool_index: (f, s) => numOrNull(f.dark_pool_index ?? s?.dark_pool_index),
  ctb_velocity_7d: (f) => numOrNull(f.ctb_velocity_7d),
  iv_crush_pct: (f, s) => numOrNull(f.iv_crush_pct ?? s?.iv_rank),
  peer_average_return: (f) => numOrNull(f.peer_average_return),
  peer_contagion_delta: (f) => numOrNull(f.peer_contagion_delta),
  congressional_net_flow_30d: (f, s) => numOrNull(f.congressional_net_flow_30d ?? s?.congressional_net_flow),
  competitor_event_density: (f) => numOrNull(f.competitor_event_density),
  insider_net_shares_30d: (f, s) => numOrNull(f.insider_net_shares_30d ?? s?.insider_net_shares_30d),
  institutional_ownership_pct: (f, s) => numOrNull(f.institutional_ownership_pct ?? s?.institutional_ownership_pct),
  eps_surprise_pct: (f, s) => numOrNull(f.eps_surprise_pct ?? s?.eps_surprise_pct),
  revenue_surprise_pct: (f, s) => numOrNull(f.revenue_surprise_pct ?? s?.revenue_surprise_pct),
  earnings_date_proximity_days: (f, s) => numOrNull(f.earnings_date_proximity_days ?? s?.earnings_date_proximity_days),
  analyst_upgrades_30d: (f, s) => numOrNull(f.analyst_upgrades_30d ?? s?.analyst_upgrades_30d),
  analyst_downgrades_30d: (f, s) => numOrNull(f.analyst_downgrades_30d ?? s?.analyst_downgrades_30d),
  price_target_consensus: (f, s) => numOrNull(f.price_target_consensus ?? s?.price_target_consensus),
  price_target_upside_pct: (f, s) => numOrNull(f.price_target_upside_pct ?? s?.price_target_upside_pct),
  fmp_news_sentiment_avg: (f, s) => numOrNull(f.fmp_news_sentiment_avg ?? s?.fmp_news_sentiment_avg),
  fmp_news_article_count_7d: (f, s) => numOrNull(f.fmp_news_article_count_7d ?? s?.fmp_news_article_count_7d),
  av_news_sentiment: (f, s) => numOrNull(s?.av_news_sentiment ?? f.av_news_sentiment),
  digital_exhaust_velocity_14d: (f, s) => {
    const stocktwitsZ = numOrNull(s?.stocktwits_virality_z);
    const googleZ     = numOrNull(s?.google_trends_z);
    const wikiZ       = numOrNull(s?.wikipedia_spike_z);
    const inputs = [
      { v: stocktwitsZ, w: 0.35 },
      { v: googleZ,     w: 0.30 },
      { v: wikiZ,       w: 0.20 },
    ];
    const avail = inputs.filter(i => i.v !== null);
    if (avail.length < 2) return null;
    const totalW = avail.reduce((sum, i) => sum + i.w, 0);
    const raw    = avail.reduce((sum, i) => sum + i.v! * i.w, 0) / totalW;
    return Math.max(-3, Math.min(3, raw));
  },

  // Temporal features
  day_sin: (f) => numOrNull(f.day_sin),
  day_cos: (f) => numOrNull(f.day_cos),
  month_sin: (f) => numOrNull(f.month_sin),
  month_cos: (f) => numOrNull(f.month_cos),
  lunar_phase: (f) => computeLunarPhase(f.date),
};

// Regression / classification targets
const TARGET_ACCESSORS: Record<string, (f: Json, row: EventFeatureRow) => number | null> = {
  forward_return_1d: (f) => numOrNull(f.forward_return_1d),
  forward_return_1w: (f) => numOrNull(f.forward_return_1w),
  forward_return_1m: (f) => numOrNull(f.forward_return_1m),
  max_favorable_excursion_1m: (f, row) => numOrNull(row.max_favorable_excursion_1m ?? f.max_favorable_excursion_1m),
  max_adverse_excursion_1m: (f, row) => numOrNull(row.max_adverse_excursion_1m ?? f.max_adverse_excursion_1m),
  forward_return_3m: (f, row) => numOrNull(row.forward_return_3m ?? null),
  forward_return_6m: (f, row) => numOrNull(row.forward_return_6m ?? null),
  forward_return_12m: (f, row) => numOrNull(row.forward_return_12m ?? null),
  forward_return_2d: (f, row) => numOrNull(row.forward_return_2d ?? null),
  forward_return_3d: (f, row) => numOrNull(row.forward_return_3d ?? null),
  forward_return_2w: (f, row) => numOrNull(row.forward_return_2w ?? null),
};

const NUMERIC_FEATURE_NAMES = Object.keys(NUMERIC_ACCESSORS);
const TARGET_NAMES = Object.keys(TARGET_ACCESSORS);

// Pre-event lookback features: dedicated SQLite columns on event_features,
// read directly from the row rather than via NUMERIC_ACCESSORS (f, snap).
const PRE_RETURN_FIELD_NAMES = [
  'pre_return_3d', 'pre_return_5d', 'pre_return_10d', 'pre_return_21d',
  'pre_vol_ratio_5d', 'pre_vol_ratio_10d',
];

type CategoryContext = Pick<EventFeatureRow, 'symbol' | 'primaryCategory' | 'confidence_tier'>;

function getPrimaryCategory(f: Json, snap: Json | null, row: CategoryContext): string {
  const candidate = snap?.primaryCategory ?? f.primaryCategory ?? row.primaryCategory ?? null;
  if (typeof candidate === 'string' && PRIMARY_CATEGORIES.includes(candidate)) return candidate;
  // Matches the deterministic classifier's default in HistoricalEngine.ts
  return 'market_structure';
}

function getSector(f: Json, snap: Json | null, row: CategoryContext): string {
  const candidate = snap?.sector ?? f.sector ?? (row as Json).sector ?? null;
  if (typeof candidate === 'string' && candidate.trim()) return normaliseSector(candidate);
  return normaliseSector(lookupCompanySector(row.symbol));
}

function getConfidenceTier(f: Json, snap: Json | null, row: CategoryContext): { high: number; medium: number; low: number } {
  const high = numOrNull(f.confidence_tier_high ?? snap?.confidence_tier_high);
  const medium = numOrNull(f.confidence_tier_medium ?? snap?.confidence_tier_medium);
  const low = numOrNull(f.confidence_tier_low ?? snap?.confidence_tier_low);
  if (high !== null || medium !== null || low !== null) {
    return { high: high ?? 0, medium: medium ?? 0, low: low ?? 0 };
  }
  const tier = f.confidence_tier ?? snap?.confidence_tier ?? row.confidence_tier ?? null;
  if (tier === 'high') return { high: 1, medium: 0, low: 0 };
  if (tier === 'medium') return { high: 0, medium: 1, low: 0 };
  if (tier === 'low') return { high: 0, medium: 0, low: 1 };
  return { high: 0, medium: 0, low: 0 };
}

function getIsNullSample(f: Json, row: EventFeatureRow): number {
  if (typeof row.is_null_sample === 'number') return row.is_null_sample;
  if (typeof f.is_null_sample === 'number') return f.is_null_sample;
  if (typeof f.is_null_sample === 'boolean') return f.is_null_sample ? 1 : 0;
  return 0;
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

interface ExtractedRecord {
  cache_key: string;
  symbol: string;
  date: string;
  numeric: Record<string, number | null>;
  targets: Record<string, number | null>;
  primaryCategory: string;
  sector: string;
  confidenceTier: { high: number; medium: number; low: number };
  isNullSample: number;
}

export interface FeatureExtractionResult {
  rowCount: number;
  columnCount: number;
  csvPath: string;
  metadataPath: string;
}

export function extractFeatures(): FeatureExtractionResult {
  const rows = db.prepare(`
    SELECT cache_key, symbol, date, primaryCategory, features_json,
           max_favorable_excursion_1m, max_adverse_excursion_1m,
           forward_return_3m, forward_return_6m, forward_return_12m,
           forward_return_2d, forward_return_3d, forward_return_2w,
           pre_return_3d, pre_return_5d, pre_return_10d, pre_return_21d,
           pre_vol_ratio_5d, pre_vol_ratio_10d,
           is_null_sample, signal_snapshot_json, confidence_tier
    FROM event_features
    WHERE signal_snapshot_json IS NOT NULL
  `).all() as EventFeatureRow[];

  const records: ExtractedRecord[] = [];

  for (const row of rows) {
    let f: Json;
    try {
      f = JSON.parse(row.features_json) as Json;
    } catch {
      continue;
    }

    let snap: Json | null = null;
    if (row.signal_snapshot_json) {
      try {
        snap = JSON.parse(row.signal_snapshot_json) as Json;
      } catch {
        snap = null;
      }
    }

    const numeric: Record<string, number | null> = {};
    for (const name of NUMERIC_FEATURE_NAMES) {
      numeric[name] = NUMERIC_ACCESSORS[name](f, snap);
    }

    // Pre-event lookback features: direct row reads (not in features_json/signal_snapshot_json).
    numeric.pre_return_3d = numOrNull(row.pre_return_3d);
    numeric.pre_return_5d = numOrNull(row.pre_return_5d);
    numeric.pre_return_10d = numOrNull(row.pre_return_10d);
    numeric.pre_return_21d = numOrNull(row.pre_return_21d);
    numeric.pre_vol_ratio_5d = numOrNull(row.pre_vol_ratio_5d);
    numeric.pre_vol_ratio_10d = numOrNull(row.pre_vol_ratio_10d);

    const targets: Record<string, number | null> = {};
    for (const name of TARGET_NAMES) {
      targets[name] = TARGET_ACCESSORS[name](f, row);
    }

    records.push({
      cache_key: row.cache_key,
      symbol: row.symbol,
      date: row.date,
      numeric,
      targets,
      primaryCategory: getPrimaryCategory(f, snap, row),
      sector: getSector(f, snap, row),
      confidenceTier: getConfidenceTier(f, snap, row),
      isNullSample: getIsNullSample(f, row),
    });
  }

  const totalRows = records.length;

  // Determine null rates for numeric signals + regression targets
  const nullCounts: Record<string, number> = {};
  for (const name of [...NUMERIC_FEATURE_NAMES, ...TARGET_NAMES, ...PRE_RETURN_FIELD_NAMES]) {
    nullCounts[name] = 0;
  }
  for (const rec of records) {
    for (const name of NUMERIC_FEATURE_NAMES) {
      if (rec.numeric[name] === null) nullCounts[name]++;
    }
    for (const name of TARGET_NAMES) {
      if (rec.targets[name] === null) nullCounts[name]++;
    }
    for (const name of PRE_RETURN_FIELD_NAMES) {
      if (rec.numeric[name] === null) nullCounts[name]++;
    }
  }

  const needsIndicator: Record<string, boolean> = {};
  for (const name of [...NUMERIC_FEATURE_NAMES, ...TARGET_NAMES, ...PRE_RETURN_FIELD_NAMES]) {
    needsIndicator[name] = totalRows > 0 && (nullCounts[name] / totalRows) > NULL_INDICATOR_THRESHOLD;
  }

  // Build column list
  const columns: string[] = ['cache_key', 'symbol', 'date'];
  for (const name of NUMERIC_FEATURE_NAMES) {
    columns.push(name);
    if (needsIndicator[name]) columns.push(`${name}_is_null`);
  }
  for (const name of PRE_RETURN_FIELD_NAMES) {
    columns.push(name);
    if (needsIndicator[name]) columns.push(`${name}_is_null`);
  }
  for (const cat of PRIMARY_CATEGORIES) {
    columns.push(`primaryCategory_${cat}`);
  }
  for (const sec of SECTORS) {
    columns.push(`sector_${sec.replace(/ /g, '_')}`);
  }
  columns.push('confidence_tier_high', 'confidence_tier_medium', 'confidence_tier_low');
  columns.push('is_null_sample');
  for (const name of TARGET_NAMES) {
    columns.push(name);
    if (needsIndicator[name]) columns.push(`${name}_is_null`);
  }

  // Build CSV rows
  const lines: string[] = [columns.join(',')];
  for (const rec of records) {
    const values: (string | number)[] = [rec.cache_key, rec.symbol, rec.date];
    for (const name of NUMERIC_FEATURE_NAMES) {
      const v = rec.numeric[name];
      values.push(v === null ? 0 : v);
      if (needsIndicator[name]) values.push(v === null ? 1 : 0);
    }
    for (const name of PRE_RETURN_FIELD_NAMES) {
      const v = rec.numeric[name];
      values.push(v === null ? 0 : v);
      if (needsIndicator[name]) values.push(v === null ? 1 : 0);
    }
    for (const cat of PRIMARY_CATEGORIES) {
      values.push(rec.primaryCategory === cat ? 1 : 0);
    }
    for (const sec of SECTORS) {
      values.push(rec.sector === sec ? 1 : 0);
    }
    values.push(rec.confidenceTier.high, rec.confidenceTier.medium, rec.confidenceTier.low);
    values.push(rec.isNullSample);
    // TARGETS, NOT FEATURES. The zero-fill above is right for a feature (missing input,
    // paired with an indicator) and WRONG for a label: it turns "this outcome has not
    // happened yet" into "the outcome was exactly 0%", and
    // train_all_models_v9.py:308's dropna(subset=[label_col]) only sees NaN, never 0.0,
    // so the row is kept and trained on.
    //
    // Measured on the production features.csv 2026-08-13: inside each horizon's maturity
    // window the exact-zero rate is 100% (1M 12/12, 3M 1189/1189, 6M 3830/3830,
    // 12M 7115/7115) — impossible for a continuous return series. Cross-checked against
    // the existing indicator: 6,782 of 6,863 zero-valued 6M labels carry
    // forward_return_6m_is_null = 1, and NO flagged row has a non-zero value.
    //
    // Empty serialises to NaN via pandas, so dropna now works for EVERY head — including
    // 1M/3M/2W, which never got an indicator because their null rate sits under
    // NULL_INDICATOR_THRESHOLD and so had no way to be identified at all.
    for (const name of TARGET_NAMES) {
      const v = rec.targets[name];
      values.push(v === null ? '' : v);
      if (needsIndicator[name]) values.push(v === null ? 1 : 0);
    }
    lines.push(values.map(csvEscape).join(','));
  }

  const outDir = path.dirname(fileURLToPath(import.meta.url));
  const csvPath = path.join(outDir, 'features.csv');
  const metadataPath = path.join(outDir, 'feature_metadata.json');

  fs.writeFileSync(csvPath, lines.join('\n') + '\n', 'utf-8');

  // Build metadata
  const metadataColumns: Json[] = [
    { name: 'cache_key', type: 'string', null_count: 0, null_rate: 0, fill_rate: 1 },
    { name: 'symbol', type: 'string', null_count: 0, null_rate: 0, fill_rate: 1 },
    { name: 'date', type: 'string', null_count: 0, null_rate: 0, fill_rate: 1 },
  ];

  const pushNumericColumn = (name: string) => {
    const nullCount = nullCounts[name];
    metadataColumns.push({
      name,
      type: 'number',
      null_count: nullCount,
      null_rate: totalRows > 0 ? nullCount / totalRows : 0,
      fill_rate: totalRows > 0 ? (totalRows - nullCount) / totalRows : 1,
      has_null_indicator: needsIndicator[name],
    });
    if (needsIndicator[name]) {
      metadataColumns.push({ name: `${name}_is_null`, type: 'binary', null_count: 0, null_rate: 0, fill_rate: 1 });
    }
  };

  for (const name of NUMERIC_FEATURE_NAMES) pushNumericColumn(name);
  for (const name of PRE_RETURN_FIELD_NAMES) pushNumericColumn(name);

  for (const cat of PRIMARY_CATEGORIES) {
    metadataColumns.push({ name: `primaryCategory_${cat}`, type: 'binary', null_count: 0, null_rate: 0, fill_rate: 1 });
  }
  for (const sec of SECTORS) {
    metadataColumns.push({ name: `sector_${sec.replace(/ /g, '_')}`, type: 'binary', null_count: 0, null_rate: 0, fill_rate: 1 });
  }
  for (const name of ['confidence_tier_high', 'confidence_tier_medium', 'confidence_tier_low', 'is_null_sample']) {
    metadataColumns.push({ name, type: 'binary', null_count: 0, null_rate: 0, fill_rate: 1 });
  }

  for (const name of TARGET_NAMES) pushNumericColumn(name);

  const metadata = {
    generated_at: new Date().toISOString(),
    row_count: totalRows,
    column_count: columns.length,
    null_fill_value: 0,
    null_indicator_threshold: NULL_INDICATOR_THRESHOLD,
    columns: metadataColumns,
  };

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

  return { rowCount: totalRows, columnCount: columns.length, csvPath, metadataPath };
}

// Context required to resolve primaryCategory / sector / confidence_tier one-hot encodings
// for a feature vector that isn't backed by an event_features row (e.g. live inference).
export type LiveFeatureContext = CategoryContext;

let indicatorFlagsCache: Record<string, boolean> | null = null;

// Reads which numeric features need a `_is_null` companion column, as decided when
// features.csv / feature_metadata.json were last generated by extractFeatures().
function getIndicatorFlags(): Record<string, boolean> {
  if (indicatorFlagsCache) return indicatorFlagsCache;
  const flags: Record<string, boolean> = {};
  try {
    const metadataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'feature_metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as { columns: Json[] };
    for (const col of metadata.columns) {
      if (col.has_null_indicator) flags[col.name as string] = true;
    }
  } catch {
    // feature_metadata.json not yet generated; treat as no indicator columns
  }
  indicatorFlagsCache = flags;
  return flags;
}

// Builds the same flat numeric feature vector (NUMERIC_ACCESSORS + one-hot
// primaryCategory/sector + confidence_tier + _is_null indicators) that
// extractFeatures() writes per row to features.csv, for a single ad-hoc
// features/signal_snapshot pair (e.g. a live inference candidate).
export function buildLiveFeatureVector(f: Json, snap: Json | null, row: LiveFeatureContext): Record<string, number> {
  const indicatorFlags = getIndicatorFlags();
  const vector: Record<string, number> = {};

  for (const name of NUMERIC_FEATURE_NAMES) {
    const v = NUMERIC_ACCESSORS[name](f, snap);
    vector[name] = v === null ? 0 : v;
    if (indicatorFlags[name]) {
      vector[`${name}_is_null`] = v === null ? 1 : 0;
    }
  }

  const primaryCategory = getPrimaryCategory(f, snap, row);
  for (const cat of PRIMARY_CATEGORIES) {
    vector[`primaryCategory_${cat}`] = primaryCategory === cat ? 1 : 0;
  }

  const sector = getSector(f, snap, row);
  for (const sec of SECTORS) {
    vector[`sector_${sec.replace(/ /g, '_')}`] = sector === sec ? 1 : 0;
  }

  const tier = getConfidenceTier(f, snap, row);
  vector.confidence_tier_high = tier.high;
  vector.confidence_tier_medium = tier.medium;
  vector.confidence_tier_low = tier.low;

  return vector;
}

const isMain = process.argv[1] !== undefined &&
  (process.argv[1].endsWith('feature_extractor.ts') || process.argv[1].includes('feature_extractor'));

if (isMain) {
  const result = extractFeatures();
  console.log(`[FeatureExtractor] Extracted ${result.rowCount} rows x ${result.columnCount} columns`);
  console.log(`[FeatureExtractor] CSV written to: ${result.csvPath}`);
  console.log(`[FeatureExtractor] Metadata written to: ${result.metadataPath}`);
}
