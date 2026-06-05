import { markSourceRateLimited, isSourceRateLimited } from "./DataSourceRegistry";
import { PriceDataPoint } from "./src/types";
import { logDataSourceFetch } from "./db";

/**
 * Robust fetch wrapper with timeout
 */
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

/**
 * Helper to convert Yahoo Finance symbols to EODHD format
 */
function convertSymbolToEODHD(yahooSymbol: string): string {
  const symbolUpper = yahooSymbol.toUpperCase().trim();
  const lastDotIndex = symbolUpper.lastIndexOf(".");
  if (lastDotIndex === -1) {
    return symbolUpper;
  }
  const ticker = symbolUpper.substring(0, lastDotIndex);
  const suffix = symbolUpper.substring(lastDotIndex + 1);

  switch (suffix) {
    case "L":
      return `${ticker}.LSE`;
    case "BO":
      return `${ticker}.BSE`;
    case "NS":
      return `${ticker}.NSE`;
    case "TO":
      return `${ticker}.TO`;
    case "DE":
      return `${ticker}.XETRA`;
    case "SS":
      return `${ticker}.SH`;
    case "SZ":
      return `${ticker}.SZ`;
    case "AX":
      return `${ticker}.AU`;
    case "HK":
    case "PA":
    case "AS":
    case "MC":
      // These naturally match EODHD's format, just pass them through without a warning.
      return symbolUpper;
    default:
      console.warn(`[EODHD] Unrecognized Yahoo Finance suffix: .${suffix}. Keeping as is.`);
      return symbolUpper;
  }
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

/**
 * Sub-task A: fetchInternationalPriceHistory
 */
export async function fetchInternationalPriceHistory(
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<PriceDataPoint[]> {
  const startTime = Date.now();
  const eodhdSymbol = convertSymbolToEODHD(symbol);

  if (isSourceRateLimited('eodhd')) {
    console.warn('[eodhd] Skipping fetch due to rate limit being hit previously.');
    return [];
  }
  
  try {
    const apiKey = process.env.EODHD_API_KEY;
    if (!apiKey) {
      console.warn("[EODHD] Missing EODHD_API_KEY environment variable. Skipping EODHD fetch.");
      return [];
    }

    const slices = sliceDateRange(fromDate, toDate, 1);
    console.log(`[EODHDService] Slicing fetch range for ${symbol} from ${fromDate} to ${toDate} into ${slices.length} annual chunks.`);

    let allPoints: PriceDataPoint[] = [];

    for (const slice of slices) {
      const url = `https://eodhd.com/api/eod/${eodhdSymbol}?api_token=${apiKey}&from=${slice.from}&to=${slice.to}&period=d&fmt=json`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        if (res.status === 429) {
          markSourceRateLimited('eodhd');
        } else if (res.status === 403) {
          console.warn(`[EODHD] 403 forbidden for ${eodhdSymbol}.`);
          continue;
        }
        if (res.status === 404) {
          console.warn(`[EODHD] Symbol not found (status 404) for ${eodhdSymbol} during slice ${slice.from} - ${slice.to}.`);
          continue;
        }
        console.warn(`[EODHD] API returned status ${res.status}`);
        return allPoints.length > 0 ? allPoints : [];
      }

      const data = await res.json();
      if (!data || !Array.isArray(data)) {
        continue;
      }

      const points: PriceDataPoint[] = data.map((item: any) => {
        const dateStr = item.date;
        return {
          date: dateStr,
          timestamp: new Date(dateStr).getTime(),
          open: item.open !== undefined && item.open !== null ? Number(item.open) : 0,
          high: item.high !== undefined && item.high !== null ? Number(item.high) : 0,
          low: item.low !== undefined && item.low !== null ? Number(item.low) : 0,
          close: item.adjusted_close !== undefined && item.adjusted_close !== null ? Number(item.adjusted_close) : (item.close !== undefined && item.close !== null ? Number(item.close) : 0),
          volume: item.volume !== undefined && item.volume !== null ? Number(item.volume) : 0,
          source: "eodhd"
        };
      });

      allPoints.push(...points);

      // Yield event loop
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Deduplicate and sort ascending by date
    const uniqPointsMap = new Map<string, PriceDataPoint>();
    for (const p of allPoints) {
      uniqPointsMap.set(p.date, p);
    }
    const points = Array.from(uniqPointsMap.values());
    points.sort((a, b) => a.date.localeCompare(b.date));

    // Log to DataSourceRegistry
    logDataSourceFetch({
      sourceId: "eodhd",
      sourceName: "EODHD Historical Data",
      dataType: "price_ohlcv",
      symbol: symbol.toUpperCase().trim(),
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      recordCount: points.length,
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    return points;
  } catch (err: any) {
    console.error(`[EODHD] fetchInternationalPriceHistory failed for ${symbol} / ${eodhdSymbol}:`, err.message || err);

    logDataSourceFetch({
      sourceId: "eodhd",
      sourceName: "EODHD Historical Data",
      dataType: "price_ohlcv",
      symbol: symbol.toUpperCase().trim(),
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      recordCount: 0,
      success: false,
      errorMessage: err.message || String(err),
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    return [];
  }
}

/**
 * Sub-task C: getExchangeStatus
 */
export async function getExchangeStatus(exchangeCode: string): Promise<{
  isOpen: boolean;
  timezone: string;
  tradingDays: string[];
  currency: string;
} | null> {
  const startTime = Date.now();
  
  if (isSourceRateLimited('eodhd')) {
    console.warn('[eodhd] Skipping fetch due to rate limit being hit previously.');
    return null;
  }
  
  try {
    const apiKey = process.env.EODHD_API_KEY;
    if (!apiKey) {
      console.warn("[EODHD] Missing EODHD_API_KEY. Skipping getExchangeStatus.");
      return null;
    }

    const url = `https://eodhd.com/api/exchange-details/${exchangeCode.toUpperCase()}?api_token=${apiKey}&fmt=json`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      if (res.status === 429) {
        markSourceRateLimited('eodhd');
      } else if (res.status === 403) {
        console.warn(`[EODHD] 403 forbidden for getExchangeStatus ${exchangeCode}.`);
      } else {
        console.warn(`[EODHD] Exchange Details returned status ${res.status}`);
      }
      return null;
    }

    const item = await res.json();
    if (!item) {
      return null;
    }

    // Determine exchange isOpen
    let isOpen = true;
    if (item.IsOpen !== undefined) isOpen = !!item.IsOpen;
    else if (item.isOpen !== undefined) isOpen = !!item.isOpen;
    else if (item.TradingHours && item.TradingHours.IsOpen !== undefined) isOpen = !!item.TradingHours.IsOpen;
    else if (item.TradingHours && item.TradingHours.isOpen !== undefined) isOpen = !!item.TradingHours.isOpen;

    // Determine exchange timezone
    const timezone = item.Timezone || item.timezone || (item.TradingHours && (item.TradingHours.Timezone || item.TradingHours.timezone)) || "UTC";

    // Determine exchange tradingDays
    let tradingDays: string[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const rawWorkingDays = item.WorkingDays || item.workingDays || item.working_days;
    if (rawWorkingDays) {
      if (Array.isArray(rawWorkingDays)) {
        tradingDays = rawWorkingDays.map(d => String(d).trim());
      } else if (typeof rawWorkingDays === "string") {
        tradingDays = rawWorkingDays.split(",").map(d => d.trim()).filter(Boolean);
      }
    }

    // Determine currency
    const currency = item.Currency || item.currency || "USD";

    // Log fetch inside DataSourceRegistry
    logDataSourceFetch({
      sourceId: "eodhd",
      sourceName: "EODHD Historical Data",
      dataType: "exchange_details",
      symbol: exchangeCode.toUpperCase().trim(),
      fetchedAt: new Date().toISOString(),
      recordCount: 1,
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    return {
      isOpen,
      timezone,
      tradingDays,
      currency
    };
  } catch (err: any) {
    console.error(`[EODHD] getExchangeStatus failed for ${exchangeCode}:`, err.message || err);

    logDataSourceFetch({
      sourceId: "eodhd",
      sourceName: "EODHD Historical Data",
      dataType: "exchange_details",
      symbol: exchangeCode.toUpperCase().trim(),
      fetchedAt: new Date().toISOString(),
      recordCount: 0,
      success: false,
      errorMessage: err.message || String(err),
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    return null;
  }
}
