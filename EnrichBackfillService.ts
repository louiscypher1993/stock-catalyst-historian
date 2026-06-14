import { db, setEventFeatures, getCompetitorEventDensity, getCachedCompanyProfile } from './db';
import { EventFeatureVector } from './src/types';
import {
  getFMPNewsSentiment,
  getFMPInsiderTrading,
  getFMPInstitutionalOwnership,
  getFMPEarningsSurprise,
  getFMPAnalystGrades,
  getFMPPriceTargetConsensus,
  getEarningsTranscript,
  isFmpPremium,
} from './FMPService';
import { getTrendsSummary } from './GoogleTrendsService';
import { detectWikipediaSpike } from './WikipediaService';
import { getShortInterest } from './FinraShortInterestService';
import { getCongressionalNetFlow } from './CongressionalTradingService';
import { scoreManagementConfidence } from './EarningsSentimentService';

const BATCH_SIZE = 500;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Local copy — cannot import from LiveInferenceService (circular dependency)
function getMostRecentEarningsQuarter(runDate: string): { year: number; quarter: number } {
  const d = new Date(runDate);
  const month = d.getMonth() + 1; // 1-12
  const year = d.getFullYear();
  if (month <= 3) return { year: year - 1, quarter: 4 };
  if (month <= 6) return { year, quarter: 1 };
  if (month <= 9) return { year, quarter: 2 };
  return { year, quarter: 3 };
}

// Same weighted composite as the live pipeline's digital_exhaust_velocity_14d,
// but stocktwits_virality_z is excluded (no reliable historical StockTwits data for backfill).
function computeDigitalExhaustVelocity(googleZ: number | null, wikiZ: number | null): number | null {
  const inputs = [
    { v: googleZ, w: 0.30 },
    { v: wikiZ, w: 0.20 },
  ];
  const avail = inputs.filter(i => i.v !== null);
  if (avail.length < 2) return null;
  const totalW = avail.reduce((sum, i) => sum + i.w, 0);
  const raw = avail.reduce((sum, i) => sum + i.v! * i.w, 0) / totalW;
  return Math.max(-3, Math.min(3, raw));
}

interface BackfillStatus {
  isRunning: boolean;
  processed: number;
  total: number;
  errors: number;
}

const state: BackfillStatus = { isRunning: false, processed: 0, total: 0, errors: 0 };

export function getBackfillStatus(): BackfillStatus {
  return { ...state };
}

export async function startBackfill(symbols?: string[], forceAll = false): Promise<void> {
  if (state.isRunning) return;
  state.isRunning = true;
  state.processed = 0;
  state.errors = 0;
  state.total = 0;

  try {
    const upperSymbols = symbols && symbols.length > 0 ? symbols.map(s => s.toUpperCase()) : [];
    const whereClause = upperSymbols.length > 0
      ? `WHERE symbol IN (${upperSymbols.map(() => '?').join(',')})`
      : '';

    const countRow = db
      .prepare(`SELECT COUNT(*) as count FROM event_features ${whereClause}`)
      .get(...(upperSymbols as unknown[])) as { count: number };
    state.total = countRow.count;

    const dataQuery = `SELECT cache_key, symbol, date, features_json, signal_snapshot_json FROM event_features ${whereClause} ORDER BY date DESC`;

    let offset = 0;
    while (offset < state.total) {
      const batch = db
        .prepare(`${dataQuery} LIMIT ${BATCH_SIZE} OFFSET ${offset}`)
        .all(...(upperSymbols as unknown[])) as {
          cache_key: string;
          symbol: string;
          date: string;
          features_json: string;
          signal_snapshot_json: string | null;
        }[];

      if (batch.length === 0) break;

      for (const row of batch) {
        try {
          const features: EventFeatureVector = JSON.parse(row.features_json);
          if (row.signal_snapshot_json) {
            features.signal_snapshot = JSON.parse(row.signal_snapshot_json);
          }

          const isUsListed = !row.symbol.includes('.') || row.symbol.endsWith('.NYSE') || row.symbol.endsWith('.NASDAQ');

          if (!forceAll) {
            const managementConfidenceDone = !isUsListed
              || !process.env.GEMINI_API_KEY
              || !isFmpPremium()
              || features.signal_snapshot?.management_confidence_score !== undefined;
            const allPopulated =
              features.fmp_news_sentiment_avg !== undefined &&
              features.insider_net_shares_30d !== undefined &&
              features.institutional_ownership_pct !== undefined &&
              (features.eps_surprise_pct !== undefined && features.eps_surprise_pct !== null) &&
              features.confidence_tier !== undefined &&
              features.competitor_event_density !== undefined &&
              features.signal_snapshot?.digital_exhaust_velocity !== undefined &&
              features.signal_snapshot?.short_interest_pct !== undefined &&
              features.signal_snapshot?.congressional_net_flow_30d !== undefined &&
              managementConfidenceDone;
            if (allPopulated) {
              state.processed++;
              if (state.processed % 100 === 0) {
                console.log(`[Backfill] ${state.processed}/${state.total} rows enriched`);
              }
              continue;
            }
          }

          let changed = false;

          if (forceAll || features.fmp_news_sentiment_avg === undefined) {
            const result = await getFMPNewsSentiment(row.symbol, row.date);
            if (result !== null) {
              // fmp_news_sentiment_avg is typed as number but can be null in practice
              (features as any).fmp_news_sentiment_avg = result.fmp_news_sentiment_avg;
              features.fmp_news_article_count_7d = result.fmp_news_article_count_7d;
              if (features.signal_snapshot) {
                features.signal_snapshot.fmp_news_sentiment_avg = result.fmp_news_sentiment_avg;
                features.signal_snapshot.fmp_news_article_count_7d = result.fmp_news_article_count_7d;
              }
              changed = true;
            }
          }

          if (isUsListed && (forceAll || features.insider_net_shares_30d === undefined)) {
            const result = await getFMPInsiderTrading(row.symbol, row.date);
            if (result !== null) {
              features.insider_net_shares_30d = result.insider_net_shares_30d;
              features.insider_buy_count_30d = result.insider_buy_count_30d;
              features.insider_sell_count_30d = result.insider_sell_count_30d;
              if (features.signal_snapshot) {
                features.signal_snapshot.insider_net_shares_30d = result.insider_net_shares_30d;
              }
              changed = true;
            }
          }

          if (forceAll || features.institutional_ownership_pct === undefined) {
            const result = await getFMPInstitutionalOwnership(row.symbol, row.date);
            if (result !== null) {
              features.institutional_ownership_pct = result.institutional_ownership_pct;
              features.institutional_ownership_change_qoq = result.institutional_ownership_change_qoq;
              if (features.signal_snapshot) {
                features.signal_snapshot.institutional_ownership_pct = result.institutional_ownership_pct;
              }
              changed = true;
            }
          }

          if (isUsListed && (forceAll || features.eps_surprise_pct === undefined || features.eps_surprise_pct === null)) {
            const result = await getFMPEarningsSurprise(row.symbol, row.date);
            if (result !== null) {
              features.eps_surprise_pct = result.eps_surprise_pct;
              features.revenue_surprise_pct = result.revenue_surprise_pct;
              features.earnings_date_proximity_days = result.earnings_date_proximity_days;
              if (features.signal_snapshot) {
                features.signal_snapshot.eps_surprise_pct = result.eps_surprise_pct;
                features.signal_snapshot.revenue_surprise_pct = result.revenue_surprise_pct;
                features.signal_snapshot.earnings_date_proximity_days = result.earnings_date_proximity_days;
              }
              changed = true;
            }
          }

          if (isUsListed && (forceAll || features.analyst_upgrades_30d === undefined || features.analyst_upgrades_30d === null || features.analyst_upgrades_30d === 0)) {
            const result = await getFMPAnalystGrades(row.symbol, row.date);
            if (result !== null) {
              features.analyst_upgrades_30d = result.upgrades;
              features.analyst_downgrades_30d = result.downgrades;
              if (features.signal_snapshot) {
                features.signal_snapshot.analyst_upgrades_30d = result.upgrades;
                features.signal_snapshot.analyst_downgrades_30d = result.downgrades;
              }
              changed = true;
            }
          }

          if (forceAll || features.price_target_consensus === undefined) {
            const result = await getFMPPriceTargetConsensus(row.symbol, row.date);
            if (result !== null) {
              const consensus = result.priceTargetConsensus;
              // close is not part of EventFeatureVector's type but may be present on stored rows
              const close = (features as any).close as number | null | undefined;
              const upside = consensus !== null && close !== null && close !== undefined && close !== 0
                ? Math.round(((consensus - close) / close) * 10000) / 100
                : null;
              features.price_target_consensus = consensus;
              features.price_target_upside_pct = upside;
              if (features.signal_snapshot) {
                features.signal_snapshot.price_target_consensus = consensus;
                features.signal_snapshot.price_target_upside_pct = upside;
              }
              changed = true;
            }
          }

          if (forceAll || features.confidence_tier === undefined) {
            const threshold = features.triggered_z_score_threshold ?? null;
            if (threshold !== null) {
              const tier: string = threshold >= 2.15 ? 'high' : threshold >= 1.8 ? 'medium' : 'low';
              features.confidence_tier = tier;
              features.confidence_tier_high = tier === 'high' ? 1 : 0;
              features.confidence_tier_medium = tier === 'medium' ? 1 : 0;
              features.confidence_tier_low = tier === 'low' ? 1 : 0;
              changed = true;
            }
          }

          // competitor_event_density: count of other same-sector anomaly events
          // in the 14 days before this event (pure SQLite, no API calls)
          if (forceAll || features.competitor_event_density === undefined) {
            const density = getCompetitorEventDensity(row.symbol, row.date);
            features.competitor_event_density = density;
            if (features.signal_snapshot) {
              features.signal_snapshot.competitor_event_density = density;
            }
            changed = true;
          }

          // digital_exhaust_velocity: weighted composite of google_trends_z + wikipedia_spike_z
          // (stocktwits excluded — no reliable historical data for backfill)
          if (features.signal_snapshot && (forceAll || features.signal_snapshot.digital_exhaust_velocity === undefined)) {
            const companyName = getCachedCompanyProfile(row.symbol)?.profile.name ?? row.symbol;

            let googleZ: number | null = features.signal_snapshot.google_trends_z ?? null;
            if (googleZ === null) {
              try {
                const trends = await getTrendsSummary(row.symbol, companyName, row.date);
                if (trends && typeof trends.google_trends_shock_ratio === 'number') {
                  googleZ = trends.google_trends_shock_ratio - 1;
                  features.signal_snapshot.google_trends_z = googleZ;
                }
              } catch (err) {
                console.error(`[Backfill] Google Trends error for ${row.symbol}/${row.date}:`, err);
              }
            }

            let wikiZ: number | null = features.signal_snapshot.wikipedia_spike_z ?? null;
            if (wikiZ === null) {
              try {
                const spike = await detectWikipediaSpike(companyName, row.date);
                if (spike) {
                  wikiZ = spike.spikeRatio;
                  features.signal_snapshot.wikipedia_spike_z = wikiZ;
                }
              } catch (err) {
                console.error(`[Backfill] Wikipedia spike error for ${row.symbol}/${row.date}:`, err);
              }
            }

            features.signal_snapshot.digital_exhaust_velocity = computeDigitalExhaustVelocity(googleZ, wikiZ);
            changed = true;
          }

          // short_interest: nearest FINRA short interest data point to the event date
          if (features.signal_snapshot && (forceAll || features.signal_snapshot.short_interest_pct === undefined)) {
            try {
              const si = await getShortInterest(row.symbol, row.date);
              features.signal_snapshot.short_interest_pct = si?.pctOfFloat ?? null;
              features.signal_snapshot.short_interest_ratio = si?.shortInterestRatio ?? null;
              if (si) {
                features.short_interest_pct = si.pctOfFloat;
                features.short_interest_ratio = si.shortInterestRatio;
              }
              changed = true;
            } catch (err) {
              console.error(`[Backfill] FINRA short interest error for ${row.symbol}/${row.date}:`, err);
            }
          }

          // congressional_net_flow_30d: sum of net congressional trades in the 30 days before the event
          if (features.signal_snapshot && (forceAll || features.signal_snapshot.congressional_net_flow_30d === undefined)) {
            try {
              const netFlow = await getCongressionalNetFlow(row.symbol, row.date);
              features.congressional_net_flow_30d = netFlow;
              features.signal_snapshot.congressional_net_flow_30d = netFlow;
              changed = true;
            } catch (err) {
              console.error(`[Backfill] Congressional net flow error for ${row.symbol}/${row.date}:`, err);
            }
          }

          // earnings_transcript_sentiment: Gemini-scored management confidence from the most
          // recent earnings call transcript before the event (FMP Premium + Gemini required)
          if (
            isUsListed &&
            features.signal_snapshot &&
            (forceAll || features.signal_snapshot.management_confidence_score === undefined) &&
            process.env.GEMINI_API_KEY &&
            isFmpPremium()
          ) {
            try {
              const { year, quarter } = getMostRecentEarningsQuarter(row.date);
              const transcript = await getEarningsTranscript(row.symbol, year, quarter);
              if (transcript) {
                const score = await scoreManagementConfidence(transcript);
                await delay(3000); // rate limit: max 1 Gemini call per 3 seconds
                features.signal_snapshot.management_confidence_score = score?.confidence_score ?? null;
                features.signal_snapshot.earnings_primary_concern = score?.primary_concern ?? null;
                if (score) {
                  features.management_confidence_score = score.confidence_score;
                }
              } else {
                features.signal_snapshot.management_confidence_score = null;
                features.signal_snapshot.earnings_primary_concern = null;
              }
              changed = true;
            } catch (err) {
              console.error(`[Backfill] Earnings transcript sentiment error for ${row.symbol}/${row.date}:`, err);
            }
          }

          if (changed) {
            setEventFeatures(row.cache_key, features);
          }
        } catch (err) {
          console.error(`[Backfill] Error on ${row.symbol}/${row.date}:`, err);
          state.errors++;
        }

        state.processed++;
        if (state.processed % 100 === 0) {
          console.log(`[Backfill] ${state.processed}/${state.total} rows enriched`);
        }
      }

      offset += BATCH_SIZE;
    }

    console.log(`[Backfill] Complete. ${state.processed}/${state.total} rows processed, ${state.errors} errors.`);
  } finally {
    state.isRunning = false;
  }
}
