import { logFetch } from "./DataSourceRegistry";
import {
  getCachedFinnhubData,
  setCachedFinnhubData,
} from "./db";

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
let finnhubAvailable = !!FINNHUB_API_KEY;

if (!FINNHUB_API_KEY) {
  console.warn("[Finnhub] FINNHUB_API_KEY not set — service disabled");
}

function offsetDate(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export async function getFinnhubNewsCount(
  symbol: string,
  date: string
): Promise<{ articleCount: number; isElevated: boolean } | null> {
  if (!finnhubAvailable) return null;

  const cached = getCachedFinnhubData(symbol, date, "news");
  if (cached !== null) return cached;

  const start = Date.now();
  try {
    const from = offsetDate(date, -2);
    const to = offsetDate(date, 2);
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;

    const res = await fetch(url);

    if (res.status === 401 || res.status === 403) {
      console.warn(`[Finnhub] Auth failure (${res.status}) — disabling service permanently`);
      finnhubAvailable = false;
      return null;
    }

    if (!res.ok) {
      logFetch({
        sourceId: "finnhub",
        sourceName: "Finnhub",
        dataType: "company_news",
        symbol: symbol.toUpperCase(),
        fetchedAt: new Date().toISOString(),
        coverageStart: from,
        coverageEnd: to,
        recordCount: 0,
        success: false,
        latencyMs: Date.now() - start,
        isFallback: false,
      });
      return null;
    }

    const articles: any[] = await res.json();
    const articleCount = Array.isArray(articles) ? articles.length : 0;
    const result = { articleCount, isElevated: articleCount > 5 };

    setCachedFinnhubData(symbol, date, "news", result);

    logFetch({
      sourceId: "finnhub",
      sourceName: "Finnhub",
      dataType: "company_news",
      symbol: symbol.toUpperCase(),
      fetchedAt: new Date().toISOString(),
      coverageStart: from,
      coverageEnd: to,
      recordCount: articleCount,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false,
    });

    return result;
  } catch (err) {
    console.error("[Finnhub] getFinnhubNewsCount error:", err);
    return null;
  }
}

export async function getFinnhubInsiderActivity(
  symbol: string,
  date: string
): Promise<{ hasRecentActivity: boolean; transactionCount: number } | null> {
  if (!finnhubAvailable) return null;

  const cached = getCachedFinnhubData(symbol, date, "insider");
  if (cached !== null) return cached;

  const start = Date.now();
  try {
    const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`;

    const res = await fetch(url);

    if (res.status === 401 || res.status === 403) {
      console.warn(`[Finnhub] Auth failure (${res.status}) — disabling service permanently`);
      finnhubAvailable = false;
      return null;
    }

    if (!res.ok) {
      logFetch({
        sourceId: "finnhub",
        sourceName: "Finnhub",
        dataType: "insider_transactions",
        symbol: symbol.toUpperCase(),
        fetchedAt: new Date().toISOString(),
        coverageStart: date,
        coverageEnd: date,
        recordCount: 0,
        success: false,
        latencyMs: Date.now() - start,
        isFallback: false,
      });
      return null;
    }

    const body: { data?: any[] } = await res.json();
    const transactions = Array.isArray(body.data) ? body.data : [];

    const eventTime = new Date(date).getTime();
    const windowMs = 5 * 24 * 60 * 60 * 1000;
    const filtered = transactions.filter((t: any) => {
      if (!t.transactionDate) return false;
      return Math.abs(new Date(t.transactionDate).getTime() - eventTime) <= windowMs;
    });

    const transactionCount = filtered.length;
    const result = { hasRecentActivity: transactionCount > 0, transactionCount };

    setCachedFinnhubData(symbol, date, "insider", result);

    logFetch({
      sourceId: "finnhub",
      sourceName: "Finnhub",
      dataType: "insider_transactions",
      symbol: symbol.toUpperCase(),
      fetchedAt: new Date().toISOString(),
      coverageStart: date,
      coverageEnd: date,
      recordCount: transactionCount,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false,
    });

    return result;
  } catch (err) {
    console.error("[Finnhub] getFinnhubInsiderActivity error:", err);
    return null;
  }
}
