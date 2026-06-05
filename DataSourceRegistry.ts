import { DataSourceRecord } from './src/types';
import { logDataSourceFetch, getDataSourceLogs } from './db';


const rateLimitedSourcesMap = new Map<string, number>();

export function markSourceRateLimited(sourceId: string, durationMs: number = 60000) {
  const expiresAt = Date.now() + durationMs;
  rateLimitedSourcesMap.set(sourceId, expiresAt);
  if (SOURCE_REGISTRY[sourceId as keyof typeof SOURCE_REGISTRY]) {
    SOURCE_REGISTRY[sourceId as keyof typeof SOURCE_REGISTRY].isActive = false;
  }
  console.warn(`[RATE LIMIT] Source ${sourceId} is marked rate-limited and will cool down for ${durationMs / 1000} seconds.`);
}

export function isSourceRateLimited(sourceId: string): boolean {
  if (rateLimitedSourcesMap.has(sourceId)) {
    const expiresAt = rateLimitedSourcesMap.get(sourceId)!;
    if (Date.now() < expiresAt) {
      return true;
    }
    // Rate limit expired! Remove it.
    rateLimitedSourcesMap.delete(sourceId);
    if (SOURCE_REGISTRY[sourceId as keyof typeof SOURCE_REGISTRY]) {
      SOURCE_REGISTRY[sourceId as keyof typeof SOURCE_REGISTRY].isActive = true;
    }
  }
  return false;
}

export function getRateLimitedSources() {
  const active: string[] = [];
  for (const [id, expiresAt] of rateLimitedSourcesMap.entries()) {
    if (Date.now() < expiresAt) {
      active.push(id);
    } else {
      rateLimitedSourcesMap.delete(id);
      if (SOURCE_REGISTRY[id as keyof typeof SOURCE_REGISTRY]) {
        SOURCE_REGISTRY[id as keyof typeof SOURCE_REGISTRY].isActive = true;
      }
    }
  }
  return active.map(id => SOURCE_REGISTRY[id as keyof typeof SOURCE_REGISTRY]?.name || id);
}

export const SOURCE_REGISTRY = {
  yahoo: {
    id: "yahoo",
    name: "Yahoo Finance",
    capabilities: ["price_ohlcv"],
    isPrimary: false,      // (will be demoted to fallback as we add better sources)
    isActive: true,
    baseUrl: "https://query1.finance.yahoo.com",
    rateLimit: { requestsPerMinute: 60, requestsPerDay: 2000 },
    notes: "Unofficial API. No SLA. Degraded quality for non-US tickers."
  },
  polygon: {
    id: "polygon",
    name: "Polygon.io",
    capabilities: ["price_ohlcv", "news", "sentiment"],
    isPrimary: true,
    isActive: false,       // (set to true after API key is configured)
    baseUrl: "https://api.polygon.io",
    rateLimit: { requestsPerMinute: 5, requestsPerDay: 1000 },
    notes: "Official API with SLA. Free tier: 5 req/min, unlimited historical."
  },
  edgar: {
    id: "edgar",
    name: "SEC EDGAR",
    capabilities: ["filings", "insider", "fundamentals"],
    isPrimary: true,
    isActive: false,
    baseUrl: "https://data.sec.gov",
    rateLimit: { requestsPerMinute: 10, requestsPerDay: 10000 },
    notes: "Free. Official SEC data. No API key required. 10 req/sec limit."
  },
  fmp: {
    id: "fmp",
    name: "Financial Modeling Prep",
    capabilities: ["fundamentals", "earnings_calendar", "ratios"],
    isPrimary: true,
    isActive: false,
    baseUrl: "https://financialmodelingprep.com/stable",
    rateLimit: { requestsPerMinute: 300, requestsPerDay: 250 },
    notes: "Free tier: 250 req/day. Covers fundamentals, ratios, earnings dates."
  },
  eodhd: {
    id: "eodhd",
    name: "EODHD Historical Data",
    capabilities: ["price_ohlcv"],
    isPrimary: true,
    isActive: false,
    baseUrl: "https://eodhd.com/api",
    rateLimit: { requestsPerMinute: 1000, requestsPerDay: 100000 },
    notes: "Best international coverage. 70+ exchanges. Paid service."
  },
  fred: {
    id: "fred",
    name: "Federal Reserve FRED",
    capabilities: ["macro"],
    isPrimary: true,
    isActive: false,
    baseUrl: "https://api.stlouisfed.org/fred",
    rateLimit: { requestsPerMinute: 120, requestsPerDay: 120000 },
    notes: "Free. Official Federal Reserve data. API key required (free signup)."
  },
  newsapi: {
    id: "newsapi",
    name: "NewsAPI.org",
    capabilities: ["news"],
    isPrimary: true,
    isActive: false,
    baseUrl: "https://newsapi.org/v2",
    rateLimit: { requestsPerMinute: 100, requestsPerDay: 100 },
    notes: "Free tier: 100 req/day, recent articles only. Paid unlocks archives."
  },
  wikipedia: {
    id: "wikipedia",
    name: "Wikipedia Pageviews API",
    capabilities: ["executive", "sentiment", "company"],
    isPrimary: false,
    isActive: true, // completely free/open
    baseUrl: "https://wikimedia.org/api/rest_v1",
    rateLimit: { requestsPerMinute: 100, requestsPerDay: 1000000 },
    notes: "Free public API. Checks for prior knowledge via page view spikes."
  },
  gdelt: {
    id: "gdelt",
    name: "GDELT Project",
    capabilities: ["news", "sentiment", "events", "international"],
    isPrimary: false,
    isActive: true, // completely free/open
    baseUrl: "https://data.gdeltproject.org",
    rateLimit: { requestsPerMinute: 30, requestsPerDay: 5000 },
    notes: "Free global news event database."
  },
  youtube: {
    id: "youtube",
    name: "YouTube Data API v3",
    capabilities: ["transcripts", "executive", "earnings"],
    isPrimary: false,
    isActive: false, // requires YOUTUBE_API_KEY
    baseUrl: "https://www.googleapis.com/youtube/v3",
    rateLimit: { requestsPerMinute: 60, requestsPerDay: 10000 },
    notes: "Free tier 10k units/day. Used for earnings calls and CEO interviews transcripts."
  },
  stocktwits: {
    id: "stocktwits",
    name: "StockTwits API",
    capabilities: ["sentiment"],
    isPrimary: true,
    isActive: true, // No API key required
    baseUrl: "https://api.stocktwits.com",
    rateLimit: { requestsPerMinute: 200, requestsPerDay: 50000 },
    notes: "Free. No authentication required. Pre-labeled sentiment streams."
  }
};

// Dynamically activate data sources depending on modern environment configuration keys
if (typeof process !== "undefined" && process.env) {
  if (process.env.POLYGON_API_KEY) {
    SOURCE_REGISTRY.polygon.isActive = true;
  }
  if (process.env.FMP_API_KEY) {
    SOURCE_REGISTRY.fmp.isActive = true;
  }
  if (process.env.EODHD_API_KEY) {
    SOURCE_REGISTRY.eodhd.isActive = true;
  }
  if (process.env.FRED_API_KEY) {
    SOURCE_REGISTRY.fred.isActive = true;
  }
  if (process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY) {
    SOURCE_REGISTRY.newsapi.isActive = true;
  }
  if (process.env.YOUTUBE_API_KEY) {
    SOURCE_REGISTRY.youtube.isActive = true;
  }
}

export function logFetch(record: DataSourceRecord): void {
  logDataSourceFetch(record);
}

export function getSourceHistory(sourceId: string, limit: number = 100): DataSourceRecord[] {
  return getDataSourceLogs(sourceId, undefined, undefined, limit);
}

export function getSourceReliability(sourceId: string): {
  successRate: number;      // (percentage of fetches that succeeded)
  avgLatencyMs: number;     // (average fetch latency)
  lastSuccess: string | null;
  lastFailure: string | null;
  totalFetches: number;
} {
  const history = getDataSourceLogs(sourceId, undefined, undefined, 1000);
  const totalFetches = history.length;
  if (totalFetches === 0) {
    return {
      successRate: 100,
      avgLatencyMs: 0,
      lastSuccess: null,
      lastFailure: null,
      totalFetches: 0
    };
  }

  const successful = history.filter(h => h.success);
  const successRate = (successful.length / totalFetches) * 100;

  let sumLatency = 0;
  let latencyCount = 0;
  let lastSuccess: string | null = null;
  let lastFailure: string | null = null;

  // We loop to find the average and the most recent successful and failed dates.
  // Note: getDataSourceLogs returns rows ordered by fetched_at desc, so the first
  // occurrence of success/failure is the most recent.
  for (const r of history) {
    if (r.latencyMs !== undefined) {
      sumLatency += r.latencyMs;
      latencyCount++;
    }
    if (r.success && !lastSuccess) {
      lastSuccess = r.fetchedAt;
    }
    if (!r.success && !lastFailure) {
      lastFailure = r.fetchedAt;
    }
  }

  const avgLatencyMs = latencyCount > 0 ? (sumLatency / latencyCount) : 0;

  return {
    successRate,
    avgLatencyMs,
    lastSuccess,
    lastFailure,
    totalFetches
  };
}

export function getDataLineage(symbol: string, dataType: string): DataSourceRecord[] {
  return getDataSourceLogs(undefined, symbol, dataType);
}

export function getBestAvailableSource(dataType: string): string | null {
  const candidates = Object.values(SOURCE_REGISTRY).filter(src => src.capabilities.includes(dataType));
  if (candidates.length === 0) {
    return null;
  }

  let bestSourceId: string | null = null;
  let bestMetric = -1;

  for (const src of candidates) {
    const stats = getSourceReliability(src.id);
    let score = stats.successRate;

    // Tie breakers and default routing prioritization:
    if (src.isPrimary) {
      score += 0.01;
    }
    if (src.isActive) {
      score += 0.1;
    }

    if (score > bestMetric) {
      bestMetric = score;
      bestSourceId = src.id;
    }
  }

  return bestSourceId;
}

export class DataLoaderQueue {
  private queue: { task: () => Promise<any>; resolve: (value: any) => void; reject: (reason?: any) => void }[] = [];
  private timer: NodeJS.Timeout | null = null;
  private concurrencyLimit: number = 5;
  private isProcessing: boolean = false;

  public async enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      if (!this.timer && !this.isProcessing) {
        this.timer = setTimeout(() => this.processQueue(), 50);
      }
    });
  }

  private async processQueue() {
    this.isProcessing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.concurrencyLimit);
      await Promise.allSettled(
        batch.map(async (item) => {
          try {
            const result = await item.task();
            item.resolve(result);
          } catch (error) {
            item.reject(error);
          }
        })
      );
    }
    
    this.isProcessing = false;
    if (this.queue.length > 0 && !this.timer) {
      this.timer = setTimeout(() => this.processQueue(), 50);
    }
  }
}

export const globalDataLoaderQueue = new DataLoaderQueue();

export class GlobalRequestThrottler {
  private queue: { task: () => Promise<any>; resolve: (value: any) => void; reject: (reason?: any) => void; delayMs: number }[] = [];
  private isProcessing: boolean = false;

  public async enqueue<T>(task: () => Promise<T>, delayMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject, delayMs });
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        try {
          const result = await item.task();
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
        await new Promise(r => setTimeout(r, item.delayMs));
      }
    }
    this.isProcessing = false;
  }
}

export const googleTrendsThrottler = new GlobalRequestThrottler();
