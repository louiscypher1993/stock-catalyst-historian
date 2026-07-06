import { getCachedAlphaVantageNewsSentiment, setCachedAlphaVantageNewsSentiment, logDataSourceFetch } from "./db";

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Free tier: 25 requests/day (hard limit). The counter is in-memory per process
// and GitHub Actions runs 3x/day with a fresh process + fresh SQLite cache, so
// 3 x 8 = 24 stays under the daily limit.
let avDailyRequestCount = 0;
let avDailyResetDate = new Date().toISOString().split('T')[0];
const ALPHAVANTAGE_DAILY_BUDGET = 8;

export function checkAndIncrementAlphaVantageBudget(): boolean {
  const today = new Date().toISOString().split('T')[0];
  if (today !== avDailyResetDate) {
    avDailyRequestCount = 0;
    avDailyResetDate = today;
  }
  if (avDailyRequestCount >= ALPHAVANTAGE_DAILY_BUDGET) {
    console.warn(`[AlphaVantage] Daily budget of ${ALPHAVANTAGE_DAILY_BUDGET} requests reached. No further calls until reset.`);
    return false;
  }
  avDailyRequestCount++;
  console.log(`[AlphaVantage] Request ${avDailyRequestCount}/${ALPHAVANTAGE_DAILY_BUDGET} used today.`);
  return true;
}

/**
 * Fetches recent news for the symbol from Alpha Vantage's NEWS_SENTIMENT endpoint and
 * aggregates feed items into an average sentiment score, scoped to articles that carry
 * a measurable relevance_score for this ticker (per-ticker relevance lives under each
 * feed item's ticker_sentiment array, not at the top level).
 */
export async function getAlphaVantageNewsSentiment(
  symbol: string,
  date: string
): Promise<{ sentiment_avg: number | null; relevance_count: number } | null> {
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  const cached = getCachedAlphaVantageNewsSentiment(uppercaseSymbol, date);
  if (cached !== null) {
    console.log(`[AlphaVantage] News sentiment cache hit for ${uppercaseSymbol} / ${date}`);
    return { sentiment_avg: cached.sentimentAvg, relevance_count: cached.relevanceCount };
  }

  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey) {
    console.warn('[AlphaVantage] Missing ALPHAVANTAGE_API_KEY — skipping news sentiment.');
    return null;
  }

  if (!checkAndIncrementAlphaVantageBudget()) return null;

  try {
    const timeFrom = `${date.replace(/-/g, '')}T0000`;
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(uppercaseSymbol)}&time_from=${timeFrom}&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      console.warn(`[AlphaVantage] API returned status ${res.status} for ${uppercaseSymbol}`);
      return null;
    }

    const data: any = await res.json();
    const feed: any[] = Array.isArray(data?.feed) ? data.feed : [];

    if (feed.length === 0) {
      setCachedAlphaVantageNewsSentiment(uppercaseSymbol, date, null, 0);
      return { sentiment_avg: null, relevance_count: 0 };
    }

    // Relevance-weighted aggregation of the per-ticker sentiment score. Only
    // articles with relevance >= 0.3 qualify, and a minimum of 2 qualifying
    // articles is required before we report a non-null average. Result is
    // clamped to [-1, 1].
    const qualifying: { score: number; relevance: number }[] = [];
    for (const article of feed) {
      const tickerEntry = Array.isArray(article.ticker_sentiment)
        ? article.ticker_sentiment.find((t: any) => String(t.ticker).toUpperCase() === uppercaseSymbol)
        : null;
      if (!tickerEntry) continue;

      const relevance = parseFloat(tickerEntry.relevance_score);
      if (!Number.isFinite(relevance) || relevance < 0.3) continue;

      const score = parseFloat(tickerEntry.ticker_sentiment_score);
      if (!Number.isFinite(score)) continue;
      qualifying.push({ score, relevance });
    }

    const relevanceCount = qualifying.length;
    let sentimentAvg: number | null = null;
    if (relevanceCount >= 2) {
      const weightedSum = qualifying.reduce((a, q) => a + q.score * q.relevance, 0);
      const totalWeight = qualifying.reduce((a, q) => a + q.relevance, 0);
      const raw = Math.max(-1, Math.min(1, weightedSum / totalWeight));
      sentimentAvg = Math.round(raw * 10000) / 10000;
    }

    setCachedAlphaVantageNewsSentiment(uppercaseSymbol, date, sentimentAvg, relevanceCount);
    logDataSourceFetch({
      sourceId: 'alphavantage',
      sourceName: 'Alpha Vantage',
      dataType: 'news_sentiment',
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false,
    });
    console.log(`[AlphaVantage] News sentiment for ${uppercaseSymbol} / ${date}: avg=${sentimentAvg}, relevant=${relevanceCount}`);
    return { sentiment_avg: sentimentAvg, relevance_count: relevanceCount };
  } catch (err: any) {
    console.warn(`[AlphaVantage] getAlphaVantageNewsSentiment failed for ${uppercaseSymbol}: ${err.message}`);
    return null;
  }
}
