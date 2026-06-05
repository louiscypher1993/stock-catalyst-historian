import { PriceDataPoint, PolygonNewsItem, PolygonTickerDetails } from "./src/types";
import { logFetch, markSourceRateLimited, isSourceRateLimited } from "./DataSourceRegistry";
import { fetchInternationalPriceHistory } from "./EODHDService";
import { db, getCachedPCR, setCachedPCR } from "./db";

// ... existing code ...

const nonUsSuffixes = ['.L', '.TO', '.NS', '.BO', '.DE', '.HK', '.AX', '.SW', '.ST', '.SI', '.PA', '.AS', '.MC'];

export async function getGroupedDailyMarketData(date: string): Promise<Record<string, PriceDataPoint>> {
  if (isSourceRateLimited('polygon')) return {};

  // Check SQLite cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS polygon_grouped_daily_cache (
      date TEXT,
      symbol TEXT,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume REAL,
      vwap REAL,
      transactions INTEGER,
      PRIMARY KEY (date, symbol)
    )
  `);

  const stmt = db.prepare(`SELECT * FROM polygon_grouped_daily_cache WHERE date = ?`);
  const rows = stmt.all(date) as any[];

  if (rows && rows.length > 0) {
    const result: Record<string, PriceDataPoint> = {};
    for (const r of rows) {
      result[r.symbol] = {
        date: r.date,
        timestamp: new Date(r.date).getTime(),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        vwap: r.vwap,
        transactions: r.transactions,
        source: "polygon_grouped"
      };
    }
    return result;
  }

  const start = Date.now();
  try {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) return {};

    const url = `https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`;
    const res = await polygonFetch(url, apiKey);
    
    if (!res.ok) {
      if (res.status === 429 || res.status === 403) {
        markSourceRateLimited('polygon', 60000);
      }
      return {};
    }

    const data = await res.json() as any;
    if (data.status !== "OK" && data.status !== "DELAYED") {
      return {};
    }

    const results = data.results || [];
    const resultMap: Record<string, PriceDataPoint> = {};

    db.exec('BEGIN TRANSACTION');
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO polygon_grouped_daily_cache (
        date, symbol, open, high, low, close, volume, vwap, transactions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const r of results) {
      const sym = r.T;
      if (!sym) continue;

      const pt: PriceDataPoint = {
        date: date,
        timestamp: r.t || new Date(date).getTime(),
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
        vwap: r.vw,
        transactions: r.n,
        source: "polygon_grouped"
      };

      resultMap[sym] = pt;

      insertStmt.run(
        date,
        sym,
        pt.open ?? null,
        pt.high ?? null,
        pt.low ?? null,
        pt.close ?? null,
        pt.volume ?? null,
        pt.vwap ?? null,
        pt.transactions ?? null
      );
    }
    db.exec('COMMIT');

    logFetch({
      sourceId: "polygon",
      sourceName: "Polygon.io",
      dataType: "price_ohlcv",
      symbol: "ALL_US_STOCKS",
      fetchedAt: new Date().toISOString(),
      coverageStart: date,
      coverageEnd: date,
      recordCount: results.length,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    return resultMap;
  } catch (error: any) {
    console.error(`[PolygonService] Grouped daily fetch failed for ${date}:`, error.message);
    return {};
  }
}
const isNonUsSymbol = (symbol: string): boolean => {
  const upper = symbol.toUpperCase().trim();
  return nonUsSuffixes.some(suffix => upper.endsWith(suffix)) || (upper.includes('.') && !upper.endsWith('.NYSE') && !upper.endsWith('.NASDAQ'));
};

let lastPolygonRequestTime = 0;
let lastPolygonPromise: Promise<any> = Promise.resolve();

/**
 * Sequential execution queue helper to guarantee that Polygon requests occur
 * no more than once every 15 seconds (15000ms), avoiding rate-limiting penalties.
 */
async function queuedPolygonFetch<T>(fetchFn: () => Promise<T>): Promise<T> {
  const minInterval = 15000; // 15 seconds

  const currentPromise = lastPolygonPromise.then(async () => {
    const now = Date.now();
    const timeSinceLast = now - lastPolygonRequestTime;
    if (timeSinceLast < minInterval && lastPolygonRequestTime > 0) {
      const delay = minInterval - timeSinceLast;
      console.log(`[Polygon Queue] Throttling for ${delay}ms to enforce the strict 15-second spacing rule...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    lastPolygonRequestTime = Date.now();
    return fetchFn();
  });

  lastPolygonPromise = currentPromise.catch(() => {});
  return currentPromise;
}

async function polygonFetch(
  url: string,
  apiKey: string,
  retriesRemaining = 3,
  delayMs = 2500
): Promise<Response> {
  return queuedPolygonFetch(async () => {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    if (res.status === 429) {
      if (retriesRemaining > 0) {
        console.warn(`[Polygon] HTTP 429 (Rate Limit). Retrying in ${delayMs}ms. Retries left: ${retriesRemaining}`);
        markSourceRateLimited('polygon', delayMs + 500);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return polygonFetch(url, apiKey, retriesRemaining - 1, delayMs * 2);
      } else {
        console.warn(`[Polygon] Rate limit exceeded permanently for current window. Marking rate-limited for 60 seconds.`);
        markSourceRateLimited('polygon', 60000);
      }
    }

    return res;
  });
}

function sliceDateRange(fromDateStr: string, toDateStr: string, chunkYears: number = 1): Array<{ from: string; to: string }> {
  const fromDate = new Date(fromDateStr);
  const toDate = new Date(toDateStr);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate > toDate) {
    return [{ from: fromDateStr, to: toDateStr }];
  }

  const slices: Array<{ from: string; to: string }> = [];
  let currentStart = new Date(fromDate);

  while (currentStart <= toDate) {
    const currentEnd = new Date(currentStart);
    currentEnd.setFullYear(currentEnd.getFullYear() + chunkYears);
    currentEnd.setDate(currentEnd.getDate() - 1);

    if (currentEnd >= toDate) {
      slices.push({
        from: currentStart.toISOString().split('T')[0],
        to: toDate.toISOString().split('T')[0]
      });
      break;
    } else {
      slices.push({
        from: currentStart.toISOString().split('T')[0],
        to: currentEnd.toISOString().split('T')[0]
      });
    }

    const nextStart = new Date(currentEnd);
    nextStart.setDate(nextStart.getDate() + 1);
    currentStart = nextStart;
  }

  return slices;
}

export async function fetchPriceHistory(
  symbol: string,
  fromDate: string,
  toDate: string,
  timespan: "day" | "week" = "day"
): Promise<PriceDataPoint[]> {
  if (isNonUsSymbol(symbol)) {
    console.log(`[PolygonService] Routing non-US listing ${symbol} to EODHD historical price fetching`);
    return fetchInternationalPriceHistory(symbol, fromDate, toDate);
  }

  if (isSourceRateLimited('polygon')) {
    console.warn('[Polygon] Skipping fetch due to rate limit being hit previously.');
    return [];
  }
  const start = Date.now();
  try {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) {
      console.warn("[Polygon] POLYGON_API_KEY is not configured in the environment. Skipping API fetch.");
      return [];
    }

    const slices = sliceDateRange(fromDate, toDate, 1);
    console.log(`[PolygonService] Slicing fetch range for ${symbol} from ${fromDate} to ${toDate} into ${slices.length} annual chunks.`);

    let allPoints: PriceDataPoint[] = [];

    for (const slice of slices) {
      const url = `https://api.polygon.io/v2/aggs/ticker/${symbol.toUpperCase()}/range/1/${timespan}/${slice.from}/${slice.to}?adjusted=true&sort=asc&limit=50000`;
      const res = await polygonFetch(url, apiKey);
      if (!res.ok) {
        if (res.status === 429) {
          markSourceRateLimited('polygon', 60000);
        } else if (res.status === 403) {
          console.warn(`[PolygonService] 403 forbidden on fetchPriceHistory for ${symbol}.`);
          throw new Error("POLYGON_403");
        }
        return allPoints.length > 0 ? allPoints : [];
      }
      const data = await res.json() as any;
      if (data.status !== "OK" && data.status !== "DELAYED" && data.status !== "NOT_FOUND" && data.status !== "NO_RESULTS") {
        console.warn(`[PolygonService] Polygon API returned status: ${data.status}`);
        return allPoints.length > 0 ? allPoints : [];
      }
      const results = data.results || [];
      const points: PriceDataPoint[] = results.map((r: any) => {
        let dateStr = "";
        try {
          dateStr = new Date(r.t).toISOString().split('T')[0];
        } catch (e) {
          dateStr = new Date().toISOString().split('T')[0];
        }
        return {
          date: dateStr,
          timestamp: r.t,
          open: r.o,
          high: r.h,
          low: r.l,
          close: r.c,
          volume: r.v,
          vwap: r.vw,
          transactions: r.n,
          source: "polygon"
        };
      });
      allPoints.push(...points);

      // Yield event loop
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const uniqPointsMap = new Map<string, PriceDataPoint>();
    for (const p of allPoints) {
      uniqPointsMap.set(p.date, p);
    }
    const points = Array.from(uniqPointsMap.values());
    points.sort((a, b) => a.date.localeCompare(b.date));

    logFetch({
      sourceId: "polygon",
      sourceName: "Polygon.io",
      dataType: "price_ohlcv",
      symbol,
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      recordCount: points.length,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    return points;
  } catch (error: any) {
    logFetch({
      sourceId: "polygon",
      sourceName: "Polygon.io",
      dataType: "price_ohlcv",
      symbol,
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      success: false,
      errorMessage: error.message || String(error),
      latencyMs: Date.now() - start,
      isFallback: false
    });
    return [];
  }
}

export async function fetchNewsForSymbol(
  symbol: string,
  fromDate: string,
  toDate: string,
  limit: number = 50
): Promise<PolygonNewsItem[]> {
  
  if (isSourceRateLimited('polygon')) {
    console.warn('[Polygon] Skipping fetch due to rate limit being hit previously.');
    return [];
  }
  const start = Date.now();
  try {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) {
      console.warn("[Polygon] POLYGON_API_KEY is not configured in the environment. Skipping API news fetch.");
      return [];
    }
    const url = `https://api.polygon.io/v2/reference/news?ticker=${symbol.toUpperCase()}&published_utc.gte=${fromDate}&published_utc.lte=${toDate}&limit=${limit}&sort=published_utc&order=desc`;
    const res = await polygonFetch(url, apiKey);
    if (!res.ok) {
      if (res.status === 429) {
        markSourceRateLimited('polygon', 60000);
      } else if (res.status === 403) {
        console.warn(`[PolygonService] 403 forbidden on fetchNewsForSymbol for ${symbol}.`);
      }
      return [];
    }
    const data = await res.json() as any;
    const results = data.results || [];
    const newsItems: PolygonNewsItem[] = results.map((r: any) => {
      let publishedAt = "";
      try {
        publishedAt = new Date(r.published_utc || Date.now()).toISOString().substring(0, 16) + 'Z';
      } catch (e) {
        publishedAt = new Date().toISOString().substring(0, 16) + 'Z';
      }

      let sentimentObj: PolygonNewsItem['sentiment'] = undefined;
      if (r.insights && Array.isArray(r.insights)) {
        const matchingInsight = r.insights.find((ins: any) => ins.ticker?.toUpperCase() === symbol.toUpperCase()) || r.insights[0];
        if (matchingInsight) {
          sentimentObj = {
            title: matchingInsight.sentiment || "neutral",
            body: matchingInsight.sentiment_reasoning || undefined
          };
        }
      } else if (r.sentiment) {
        sentimentObj = {
          title: r.sentiment.title || "neutral",
          body: r.sentiment.body || undefined
        };
      }

      return {
        id: r.id || r.uuid || Math.random().toString(36).substring(2),
        publishedAt,
        title: r.title || "Untitled Article",
        description: r.description || undefined,
        articleUrl: r.article_url || r.articleUrl || r.amp_url || "",
        tickers: r.tickers || [],
        source: r.publisher?.name || r.source?.name || "Unknown",
        sentiment: sentimentObj
      };
    });

    logFetch({
      sourceId: "polygon",
      sourceName: "Polygon.io",
      dataType: "news",
      symbol,
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      recordCount: newsItems.length,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    return newsItems;
  } catch (error: any) {
    logFetch({
      sourceId: "polygon",
      sourceName: "Polygon.io",
      dataType: "news",
      symbol,
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      success: false,
      errorMessage: error.message || String(error),
      latencyMs: Date.now() - start,
      isFallback: false
    });
    return [];
  }
}

export async function getDailyPutCallRatio(
  symbol: string,
  date: string
): Promise<number | null> {
  const start = Date.now();
  const uppercaseSymbol = symbol.toUpperCase().trim();
  
  try {
    const cachedPcr = getCachedPCR(uppercaseSymbol, date);
    if (cachedPcr !== null) {
      console.log(`[Polygon] PCR cache hit for ${uppercaseSymbol} on ${date}`);
      return cachedPcr;
    }

    if (!process.env.POLYGON_OPTIONS_ENABLED || isSourceRateLimited('polygon')) {
      return null;
    }

    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) {
      console.warn("[Polygon] POLYGON_API_KEY is not configured. Simulating PCR.");
      return null;
    }

    // In a full implementation, we'd query Polygon's Options endpoint for total call and put volume
    // Since Polygon doesn't have a simple aggregate PCR endpoint, we simulate this call natively structure-wise
    // and implement the dummy calc, but we represent the actual mathematical intent below:
    
    // Theoretical fetching of options flow snapshot
    const url = `https://api.polygon.io/v3/snapshot/options/${uppercaseSymbol}?date=${date}`;
    const res = await polygonFetch(url, apiKey, 1, 1000);

    if (!res.ok) {
      return null;
    }
    const data = await res.json() as any;

    let vol_puts = 0;
    let vol_calls = 0;

    if (data.results && Array.isArray(data.results)) {
      for (const contract of data.results) {
        if (contract.details && contract.details.contract_type) {
          const type = contract.details.contract_type.toLowerCase();
          const volume = contract.day?.volume || 0;
          if (type === 'put') {
            vol_puts += volume;
          } else if (type === 'call') {
            vol_calls += volume;
          }
        }
      }
    } else {
      // Simulate real looking data if not found or empty
      return null;
    }

    // Math calculation exactly matching requirement
    let pcr = vol_calls === 0 ? 10.0 : vol_puts / vol_calls;
    // Cap at 10.0 to prevent infinite
    if (pcr > 10.0) pcr = 10.0;
    
    // Round to 3 decimals
    pcr = Math.round(pcr * 1000) / 1000;

    setCachedPCR(uppercaseSymbol, date, pcr);
    
    logFetch({
      sourceId: 'polygon',
      sourceName: 'Polygon.io',
      dataType: 'options_pcr',
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    return pcr;
  } catch (error: any) {
    console.warn(`[Polygon] Failed to calculate PCR for ${symbol} on ${date}:`, error.message);
    return null;
  }
}

export async function getHistoricalImpliedVolatility(
  symbol: string,
  date: string
): Promise<number | null> {
  if (!process.env.POLYGON_OPTIONS_ENABLED || isSourceRateLimited('polygon')) {
    return null;
  }

  const start = Date.now();
  try {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) {
      console.warn("[Polygon] POLYGON_API_KEY is not configured in the environment. Using generic placeholder IV.");
      // Simulated response to prevent build failure and test engine behavior
      return null;
    }
    
    // Theoretical fetching of nearest-term ATM implied volatility
    const url = `https://api.polygon.io/v3/snapshot/options/${symbol.toUpperCase()}?date=${date}`;
    // We wrap this inside polygonFetch or similar.
    const res = await polygonFetch(url, apiKey, 1, 1000);
    
    if (!res.ok) {
      return null;
    }
    const data = await res.json() as any;
    
    // If we had a real result parsing logic here:
    // Assuming the API returns a list of contracts, we'd find the ATM one and extract IV.
    // For now we will check if there's a returned field.
    if (data.results && data.results.length > 0) {
      const firstContract = data.results[0];
      if (firstContract.implied_volatility) {
        return firstContract.implied_volatility;
      }
    }
    
    return null;
  } catch (error: any) {
    console.warn(`[PolygonService] Failed to fetch IV for ${symbol} on ${date}:`, error.message);
    return null;
  }
}

export async function fetchTickerDetails(
  symbol: string
): Promise<PolygonTickerDetails | null> {
  if (isSourceRateLimited('polygon')) {
    return null;
  }
  const start = Date.now();
  try {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) {
      console.warn("[Polygon] POLYGON_API_KEY is not configured in the environment. Skipping API ticker details fetch.");
      return null;
    }
    const url = `https://api.polygon.io/v3/reference/tickers/${symbol.toUpperCase()}`;
    const res = await polygonFetch(url, apiKey);
    if (!res.ok) {
      if (res.status === 429) {
        markSourceRateLimited('polygon', 60000);
      } else if (res.status === 403) {
        console.warn(`[PolygonService] 403 forbidden on fetchTickerDetails for ${symbol}.`);
      }
      return null;
    }
    const data = await res.json() as any;
    const r = data.results;
    if (!r) {
      return null;
    }

    const details: PolygonTickerDetails = {
      symbol: r.ticker || r.symbol || symbol.toUpperCase(),
      name: r.name || "",
      market: r.market || "stocks",
      locale: r.locale || "us",
      primaryExchange: r.primary_exchange || r.primaryExchange || "",
      type: r.type || "CS",
      active: r.active !== undefined ? r.active : true,
      currencyName: r.currency_name || r.currencyName || "usd",
      marketCap: r.market_cap !== undefined ? r.market_cap : r.marketCap,
      phoneNumber: r.phone_number || r.phoneNumber,
      description: r.description,
      sicCode: r.sic_code || r.sicCode,
      sicDescription: r.sic_description || r.sicDescription,
      totalEmployees: r.total_employees !== undefined ? r.total_employees : r.totalEmployees,
      listDate: r.list_date || r.listDate,
      shareClassSharesOutstanding: r.share_class_shares_outstanding !== undefined ? r.share_class_shares_outstanding : r.shareClassSharesOutstanding,
      weightedSharesOutstanding: r.weighted_shares_outstanding !== undefined ? r.weighted_shares_outstanding : r.weightedSharesOutstanding,
      source: "polygon"
    };

    logFetch({
      sourceId: "polygon",
      sourceName: "Polygon.io",
      dataType: "fundamentals",
      symbol,
      fetchedAt: new Date().toISOString(),
      recordCount: 1,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    return details;
  } catch (error: any) {
    logFetch({
      sourceId: "polygon",
      sourceName: "Polygon.io",
      dataType: "fundamentals",
      symbol,
      fetchedAt: new Date().toISOString(),
      success: false,
      errorMessage: error.message || String(error),
      latencyMs: Date.now() - start,
      isFallback: false
    });
    return null;
  }
}
