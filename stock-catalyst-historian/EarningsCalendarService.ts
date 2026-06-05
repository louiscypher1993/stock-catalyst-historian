import {
  getYahooEarningsCache,
  setYahooEarningsCache,
  getNasdaqEarningsCache,
  setNasdaqEarningsCache,
  getEdgarFilings
} from "./db";

export interface EarningsCalendarResult {
  events: Array<{
    reportDate: string;
    fiscalQuarterEnd?: string;
    estimatedEps?: number;
    actualEps?: number;
    source: string;
  }>;
  consensus?: {
    mean: number;
    count: number;
  };
}

export async function getEarningsCalendar(symbol: string): Promise<EarningsCalendarResult | null> {
  const uppercaseSymbol = symbol.toUpperCase().trim();

  // SOURCE 1: Yahoo Finance
  const yahooResult = await getYahooEarnings(uppercaseSymbol);
  if (yahooResult) {
    return yahooResult;
  }

  // SOURCE 2: Nasdaq
  const nasdaqResult = await getNasdaqEarnings(uppercaseSymbol);
  if (nasdaqResult && nasdaqResult.length > 0) {
    return { events: nasdaqResult };
  }

  // SOURCE 3: EDGAR 8-K
  const edgarResult = getEdgarEarningsProxy(uppercaseSymbol);
  if (edgarResult && edgarResult.length > 0) {
    return { events: edgarResult };
  }

  return null;
}

async function getYahooEarnings(symbol: string): Promise<EarningsCalendarResult | null> {
  try {
    const cached = getYahooEarningsCache(symbol);
    if (cached) return cached;

    const res = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=calendarEvents,earningsHistory,financialData`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) return null;

    const data = await res.json();
    const result = data.quoteSummary?.result?.[0];
    if (!result) return null;

    const events: any[] = [];
    
    // Parse calendarEvents
    const calendarDates = result.calendarEvents?.earnings?.earningsDate;
    if (calendarDates && Array.isArray(calendarDates)) {
      for (const d of calendarDates) {
        if (d && d.raw) {
          events.push({
            reportDate: new Date(d.raw * 1000).toISOString().split("T")[0],
            source: "yahoo"
          });
        }
      }
    }

    // Parse earningsHistory
    const history = result.earningsHistory?.history;
    if (history && Array.isArray(history)) {
      for (const h of history) {
        if (h && h.quarter && h.quarter.raw) {
          // Use quarter as a proxy for reportDate if we don't have it, or just use it as quarter end.
          const dateStr = new Date(h.quarter.raw * 1000).toISOString().split("T")[0];
          events.push({
            reportDate: dateStr,
            fiscalQuarterEnd: "quarterly",
            estimatedEps: h.epsEstimate?.raw,
            actualEps: h.epsActual?.raw,
            source: "yahoo"
          });
        }
      }
    }

    // Parse consensus
    let consensus: { mean: number; count: number } | undefined = undefined;
    const finData = result.financialData;
    if (finData && finData.recommendationMean?.raw && finData.numberOfAnalystOpinions?.raw) {
      consensus = {
        mean: finData.recommendationMean.raw,
        count: finData.numberOfAnalystOpinions.raw
      };
    }

    if (events.length === 0 && !consensus) return null;

    const finalResult = { events, consensus };
    setYahooEarningsCache(symbol, finalResult);
    return finalResult;
  } catch (error) {
    console.error(`[Yahoo] Error fetching earnings calendar for ${symbol}:`, error);
    return null;
  }
}

async function getNasdaqEarnings(symbol: string): Promise<any[] | null> {
  try {
    const cached = getNasdaqEarningsCache(symbol);
    if (cached) return cached;

    // The prompt says: "GET https://api.nasdaq.com/api/calendar/earnings?date={YYYY-MM-DD}&symbol={symbol}"
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`https://api.nasdaq.com/api/calendar/earnings?date=${today}&symbol=${symbol}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) return null;
    
    const data = await res.json();
    const events: any[] = [];
    if (data && data.data && data.data.rows) {
      for (const row of data.data.rows) {
        events.push({
          reportDate: row.reportDate ?? today,
          fiscalQuarterEnd: row.fiscalQuarterEnding,
          estimatedEps: row.epsForecast,
          source: "nasdaq"
        });
      }
    }

    if (events.length > 0) {
      setNasdaqEarningsCache(symbol, events);
      return events;
    }
    return null;
  } catch (error) {
    console.error(`[Nasdaq] Error fetching earnings calendar for ${symbol}:`, error);
    return null;
  }
}

function getEdgarEarningsProxy(symbol: string): any[] {
  try {
    const filings = getEdgarFilings(symbol, "2000-01-01", "2099-12-31", ["8-K"]);
    const events: any[] = [];
    for (const f of filings) {
      if (f.description && (f.description.toLowerCase().includes("earnings") || f.description.toLowerCase().includes("results"))) {
        events.push({
          reportDate: f.filedAt.split("T")[0],
          source: "edgar_proxy"
        });
      }
    }
    return events;
  } catch (err) {
    return [];
  }
}
