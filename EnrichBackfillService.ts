import { db, setEventFeatures } from './db';
import { EventFeatureVector } from './src/types';
import {
  getFMPNewsSentiment,
  getFMPInsiderTrading,
  getFMPInstitutionalOwnership,
  getFMPEarningsSurprise,
  getFMPAnalystGrades,
  getFMPPriceTargetConsensus,
} from './FMPService';

const BATCH_SIZE = 500;

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

          if (!forceAll) {
            const allPopulated =
              features.fmp_news_sentiment_avg !== undefined &&
              features.insider_net_shares_30d !== undefined &&
              features.institutional_ownership_pct !== undefined &&
              (features.eps_surprise_pct !== undefined && features.eps_surprise_pct !== null) &&
              features.confidence_tier !== undefined;
            if (allPopulated) {
              state.processed++;
              if (state.processed % 100 === 0) {
                console.log(`[Backfill] ${state.processed}/${state.total} rows enriched`);
              }
              continue;
            }
          }

          let changed = false;
          const isUsListed = !row.symbol.includes('.') || row.symbol.endsWith('.NYSE') || row.symbol.endsWith('.NASDAQ');

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
