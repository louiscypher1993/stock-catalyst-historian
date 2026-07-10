import { getEventsWithSignals } from "./db";
import { SignalValidationReport, SignalValidationEntry } from "./src/types";

const NUMERIC_SIGNAL_KEYS: (keyof NonNullable<import("./src/types").EventFeatureVector["signal_snapshot"]>)[] = [
  "excess_return",
  "z_score",
  "atr_shock_score",
  "volume_ratio",
  "shannon_entropy",
  "amihud_illiquidity",
  "fractal_efficiency",
  "short_interest_pct_float",
  "short_interest_velocity",
  "put_call_ratio",
  "iv_rank",
  "dark_pool_index",
  "vix",
  "yield_curve_spread",
  "credit_spread",
  "macro_release_surprise",
  "gdelt_tone_z",
  "stocktwits_virality_z",
  "google_trends_z",
  "wikipedia_spike_z",
  "news_relevance_z",
  "congressional_net_flow",
  // Added 2026-07-10 recon: 13 of the 22 newer signal_snapshot fields that
  // existed in the data but were never wired into this service's allowlists.
  // Population rates checked against a live sample of event_features before
  // adding (n=13,362, ~20% of the table) -- all confirmed to have real,
  // non-degenerate variance. Several are sparse (event-conditional fields
  // only populate near their trigger, e.g. earnings surprises), which is
  // expected, not a data-quality problem; the service's own minEvents
  // threshold already handles that by reporting "insufficient data" rather
  // than a misleading result.
  "fmp_news_sentiment_avg",
  // fmp_news_article_count_7d: right-censored -- 82.7% of populated values
  // are pinned at exactly 50 (an FMP API pagination cap, not a true count),
  // so correlation results for this one should be read as "low vs. capped
  // news volume," not a clean continuous signal.
  "fmp_news_article_count_7d",
  // ~280 rows in the full dataset (0.4%) -- sparse but real, non-zero values.
  "insider_net_shares_30d",
  "eps_surprise_pct",
  "revenue_surprise_pct",
  "earnings_date_proximity_days",
  "analyst_upgrades_30d",
  "analyst_downgrades_30d",
  "price_target_consensus",
  // ~1,646 rows in the full dataset (2.5%) -- sparse but usable.
  "price_target_upside_pct",
  "competitor_event_density",
  // ~110 rows in the full dataset (0.16%) -- very sparse, likely to show
  // "insufficient data" at most horizons; included for completeness since
  // it's not degenerate, just rare.
  "management_confidence_score",
  "digital_exhaust_velocity",
  // NOT added, and why (all confirmed via live data sample, not assumed):
  //   estimate_revision_direction/magnitude, company_credit_proxy,
  //   institutional_ownership_pct: 0% populated -- structurally empty,
  //     same tier as the already-known short_interest_pct_float gap.
  //   short_interest_pct, short_interest_ratio: 0% populated -- confirmed
  //     this is the SAME structural gap as short_interest_pct_float, not a
  //     separate working field under a different name.
  //   congressional_net_flow_30d: 100% populated but every sampled value
  //     (n=13,362) is exactly 0 -- zero variance, correlation is
  //     mathematically undefined (this service's own pearson() returns null
  //     when the signal has no spread), so including it would silently
  //     report "no meaningful predictive power" for a misleading reason.
  //   divergence_detected: boolean-typed, and this service's numeric/
  //     categorical branches only handle `typeof === 'number'` or
  //     `'string'` -- a boolean matches neither, so it would silently no-op
  //     if added. Also always `false` in every sampled row (n=13,362) even
  //     setting the type issue aside. Needs a logic change to support at
  //     all, out of scope for this array-only extension.
];

const CATEGORICAL_SIGNAL_KEYS: (keyof NonNullable<import("./src/types").EventFeatureVector["signal_snapshot"]>)[] = [
  "vix_regime",
  "trend_regime",
  "event_classification",
  "dominant_physics_regime",
  // earnings_primary_concern NOT added: confirmed via live sample (n=110
  // populated rows) that this is high-cardinality free text (each value is
  // close to a unique sentence, e.g. "Rising Traffic Acquisition Costs" /
  // "UK Housing Market Health"), not a small repeating category set like
  // vix_regime. This service's categorical bucketing groups by exact string
  // match, so this field would produce ~110 singleton buckets -- technically
  // running, but statistically meaningless best/worst category output.
];

// Pearson correlation between two equal-length arrays
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? null : num / den;
}

// Rank array (1-based, average ranks for ties)
function rank(arr: number[]): number[] {
  const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(arr.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length - 1 && sorted[j + 1].v === sorted[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[sorted[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 2) return null;
  return pearson(rank(xs), rank(ys));
}

function median(sorted: number[]): number {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[m - 1] + sorted[m]) / 2
    : sorted[m];
}

function interpretIC(ic: number | null, n: number): string {
  if (ic === null) return "Insufficient data.";
  const abs = Math.abs(ic);
  const dir = ic > 0 ? "positive" : "negative";
  const suffix = `(IC = ${ic.toFixed(3)}, n = ${n})`;
  if (abs >= 0.3) return `Strong ${dir} predictor ${suffix}`;
  if (abs >= 0.15) return `Moderate ${dir} predictor ${suffix}`;
  if (abs >= 0.05) return `Weak ${dir} signal ${suffix}`;
  return `No meaningful predictive power ${suffix}`;
}

function quartileMeans(
  signalVals: number[],
  returnVals: number[]
): { high: number | null; low: number | null } {
  const pairs = signalVals
    .map((s, i) => ({ s, r: returnVals[i] }))
    .sort((a, b) => a.s - b.s);
  const q = Math.floor(pairs.length / 4);
  if (q === 0) return { high: null, low: null };
  const lowGroup = pairs.slice(0, q).map((p) => p.r);
  const highGroup = pairs.slice(pairs.length - q).map((p) => p.r);
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  return { high: mean(highGroup), low: mean(lowGroup) };
}

export async function runSignalValidation(options?: {
  minEvents?: number;
  horizon?: "1d" | "1w" | "1m";
}): Promise<SignalValidationReport> {
  const horizon = options?.horizon ?? "1w";
  const minEvents = options?.minEvents ?? 30;
  const SUGGESTED_TARGET = 200;

  const returnKey =
    horizon === "1d" ? "return_1d" : horizon === "1w" ? "return_1w" : "return_1m";

  const events = getEventsWithSignals();

  const validEvents = events.filter(
    (e) => e.signal_snapshot != null && e[returnKey] != null
  );

  const total = validEvents.length;

  if (total < minEvents) {
    return {
      generatedAt: new Date().toISOString(),
      totalEventsAnalysed: total,
      horizon,
      signals: [],
      datasetTooSmall: {
        message: `Collect at least ${SUGGESTED_TARGET} events for stable signal validation; currently have ${total}.`,
        currentCount: total,
        suggestedTarget: SUGGESTED_TARGET,
      },
    };
  }

  const signals: SignalValidationEntry[] = [];

  // Numeric signals
  for (const key of NUMERIC_SIGNAL_KEYS) {
    const pairs: { signal: number; ret: number }[] = [];
    for (const e of validEvents) {
      const snap = e.signal_snapshot!;
      const sv = snap[key];
      const rv = e[returnKey];
      if (typeof sv === "number" && sv !== null && typeof rv === "number" && rv !== null) {
        pairs.push({ signal: sv, ret: rv });
      }
    }

    if (pairs.length < minEvents) {
      signals.push({
        name: key,
        sampleSize: pairs.length,
        pearson: null,
        spearman: null,
        informationCoefficient: null,
        meanReturnWhenHigh: null,
        meanReturnWhenLow: null,
        interpretation: `Insufficient data (${pairs.length} observations; need ${minEvents}).`,
        insufficientData: true,
      });
      continue;
    }

    const xs = pairs.map((p) => p.signal);
    const ys = pairs.map((p) => p.ret);
    const p = pearson(xs, ys);
    const s = spearman(xs, ys);
    const { high, low } = quartileMeans(xs, ys);

    signals.push({
      name: key,
      sampleSize: pairs.length,
      pearson: p !== null ? +p.toFixed(4) : null,
      spearman: s !== null ? +s.toFixed(4) : null,
      informationCoefficient: s !== null ? +s.toFixed(4) : null,
      meanReturnWhenHigh: high !== null ? +high.toFixed(4) : null,
      meanReturnWhenLow: low !== null ? +low.toFixed(4) : null,
      interpretation: interpretIC(s, pairs.length),
    });
  }

  // Categorical signals
  for (const key of CATEGORICAL_SIGNAL_KEYS) {
    const byCategory = new Map<string, number[]>();
    for (const e of validEvents) {
      const snap = e.signal_snapshot!;
      const sv = snap[key];
      const rv = e[returnKey];
      if (typeof sv === "string" && sv !== null && typeof rv === "number" && rv !== null) {
        if (!byCategory.has(sv)) byCategory.set(sv, []);
        byCategory.get(sv)!.push(rv);
      }
    }

    const totalCount = Array.from(byCategory.values()).reduce((a, b) => a + b.length, 0);

    const categoryBreakdown = Array.from(byCategory.entries()).map(([category, rets]) => {
      const sorted = [...rets].sort((a, b) => a - b);
      return {
        category,
        count: rets.length,
        meanReturn: +( rets.reduce((a, b) => a + b, 0) / rets.length ).toFixed(4),
        medianReturn: +median(sorted).toFixed(4),
      };
    }).sort((a, b) => b.meanReturn - a.meanReturn);

    if (totalCount < minEvents) {
      signals.push({
        name: key,
        sampleSize: totalCount,
        pearson: null,
        spearman: null,
        informationCoefficient: null,
        meanReturnWhenHigh: null,
        meanReturnWhenLow: null,
        interpretation: `Insufficient data (${totalCount} observations; need ${minEvents}).`,
        insufficientData: true,
        categoryBreakdown,
      });
      continue;
    }

    const best = categoryBreakdown[0];
    const worst = categoryBreakdown[categoryBreakdown.length - 1];
    signals.push({
      name: key,
      sampleSize: totalCount,
      pearson: null,
      spearman: null,
      informationCoefficient: null,
      meanReturnWhenHigh: best?.meanReturn ?? null,
      meanReturnWhenLow: worst?.meanReturn ?? null,
      interpretation: `Categorical: best category "${best?.category}" (mean ${best?.meanReturn?.toFixed(3)}), worst "${worst?.category}" (mean ${worst?.meanReturn?.toFixed(3)}). ${categoryBreakdown.length} categories observed.`,
      categoryBreakdown,
    });
  }

  // Sort by absolute IC descending (nulls last), categorical entries after numerics
  signals.sort((a, b) => {
    const aIC = a.informationCoefficient !== null ? Math.abs(a.informationCoefficient) : -1;
    const bIC = b.informationCoefficient !== null ? Math.abs(b.informationCoefficient) : -1;
    return bIC - aIC;
  });

  return {
    generatedAt: new Date().toISOString(),
    totalEventsAnalysed: total,
    horizon,
    signals,
  };
}
