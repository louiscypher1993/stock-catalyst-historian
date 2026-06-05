import { markSourceRateLimited, isSourceRateLimited } from "./DataSourceRegistry";
import { CompanyProfile, CompanyFinancialRatios, EarningsEvent } from "./src/types";

export let fmpDailyRequestCount = 0;
export let fmpDailyResetDate = new Date().toISOString().split('T')[0];
export const FMP_DAILY_BUDGET = 200;

export function checkAndIncrementFmpBudget(): boolean {
  const today = new Date().toISOString().split('T')[0];
  if (today !== fmpDailyResetDate) {
    fmpDailyRequestCount = 0;
    fmpDailyResetDate = today;
  }
  if (fmpDailyRequestCount >= FMP_DAILY_BUDGET) {
    console.warn(`[FMP] Daily budget of ${FMP_DAILY_BUDGET} requests reached.\n        No further FMP calls will be made today. Resets at midnight UTC.`);
    return false;
  }
  fmpDailyRequestCount++;
  console.log(`[FMP] Request ${fmpDailyRequestCount}/${FMP_DAILY_BUDGET} used today.`);
  return true;
}

import { 
  getCachedCompanyProfile, 
  setCachedCompanyProfile, 
  getCachedFinancialRatios, 
  setCachedFinancialRatios, 
  getCachedEarningsCalendar, 
  insertEarningsCalendar,
  logDataSourceFetch,
  getCachedMarketStructure,
  setCachedMarketStructure
} from "./db";

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

export async function bulkPrefetchStaticMetadata(symbols: string[]): Promise<void> {
  if (isSourceRateLimited('fmp')) return;
  const uppercaseSymbols = Array.from(new Set(symbols.map(s => s.toUpperCase().trim())));
  
  // Filter out those we already have cached profiles for
  const missingProfiles = uppercaseSymbols.filter(s => {
    const cached = getCachedCompanyProfile(s);
    if (!cached) return true;
    const cacheAgeMs = Date.now() - new Date(cached.cachedAt).getTime();
    return cacheAgeMs > 7 * 24 * 60 * 60 * 1000;
  });

  const missingPeers = uppercaseSymbols.filter(s => {
    const cached = getCachedPeers(s);
    return !cached;
  });

  const missingRatios = uppercaseSymbols.filter(s => {
    const cached = getCachedFinancialRatios(s);
    return !cached;
  });

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) return;

  // 1. Bulk Profile Fetch
  if (missingProfiles.length > 0) {
    for (const sym of missingProfiles) {
      try {
        const url = `https://financialmodelingprep.com/stable/profile?symbol=${sym}&apikey=${apiKey}`;
        const res = await fetchWithTimeout(url);
        const data = await handleFmpResponse(res, 'bulkPrefetchStaticMetadata_profile');
        if (Array.isArray(data)) {
          for (const item of data) {
            const returnedSym = item.symbol;
            if (returnedSym) {
              setCachedCompanyProfile({
                symbol: returnedSym,
                name: item.companyName || item.name || returnedSym,
                price: item.price !== undefined ? Number(item.price) : undefined,
                beta: item.beta !== undefined ? Number(item.beta) : undefined,
                sector: item.sector || "Unknown",
                industry: item.industry || "Unknown",
                subIndustry: item.subIndustry || undefined,
                exchange: item.exchange || item.exchangeShortName || "Unknown",
                marketCap: item.mktCap || 0,
                employees: item.fullTimeEmployees ? Number(item.fullTimeEmployees) : undefined,
                description: item.description || "",
                country: item.country || "US",
                currency: item.currency || "USD",
                ipoDate: item.ipoDate || undefined,
                isActivelyTrading: item.isActivelyTrading ?? true,
                source: "fmp"
              });
            }
          }
        }
      } catch (err) {
        console.error(`[FMP] Bulk profile fetch fail:`, err);
      }
    }
  }

  if (missingPeers.length > 0) {
    for (const sym of missingPeers) {
      try {
        const url = `https://financialmodelingprep.com/stable/stock-peers?symbol=${sym}&apikey=${apiKey}`;
        const res = await fetchWithTimeout(url);
        const data = await handleFmpResponse(res, 'bulkPrefetchStaticMetadata_peers');
        if (Array.isArray(data)) {
          for (const item of data) {
            const returnedSym = item.symbol;
            if (returnedSym && item.peersList) {
              setCachedPeers(returnedSym, item.peersList);
            }
          }
        }
      } catch (err) { }
    }
  }

  // 3. Bulk Ratios Fetch
  if (missingRatios.length > 0) {
    for (const sym of missingRatios) {
      try {
        const url = `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${sym}&apikey=${apiKey}`;
        const res = await fetchWithTimeout(url);
        const data = await handleFmpResponse(res, 'bulkPrefetchStaticMetadata_ratios');
        if (Array.isArray(data)) {
          for (const item of data) {
            const returnedSym = item.symbol;
            if (returnedSym) {
              setCachedFinancialRatios({
                symbol: returnedSym,
                currentRatio: item.currentRatioTTM || 0,
                quickRatio: item.quickRatioTTM || 0,
                grossProfitMargin: item.grossProfitMarginTTM || 0,
                operatingProfitMargin: item.operatingProfitMarginTTM || 0,
                netProfitMargin: item.netProfitMarginTTM || 0,
                returnOnEquity: item.returnOnEquityTTM || 0,
                returnOnAssets: item.returnOnAssetsTTM || 0,
                debtToEquity: item.debtToEquityTTM || 0,
                interestCoverage: item.interestCoverageTTM || 0,
                pbRatio: item.priceToBookRatioTTM || 0,
                peRatio: item.peRatioTTM || 0,
                pegRatio: item.pegRatioTTM || 0,
                source: "fmp",
                fetchedAt: new Date().toISOString()
              } as any);
            }
          }
        }
      } catch (err) { }
    }
  }
}

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

async function handleFmpResponse(res: Response, functionName: string): Promise<any> {
  if (!res.ok) {
    let bodyText = "";
    try { bodyText = await res.text(); } catch (e) {}
    if (res.status === 429) {
      markSourceRateLimited('fmp');
      console.warn(`[FMP] 429 Rate limited on ${functionName}`);
    } else if (res.status === 403) {
      if (bodyText.includes("Legacy Endpoint") || bodyText.includes("Exclusive Endpoint")) {
        console.warn(`[FMP] 403 PERMANENT endpoint/plan problem for ${functionName}: ${bodyText}`);
      } else if (bodyText.includes("limit") || bodyText.includes("bandwidth")) {
        markSourceRateLimited('fmp');
        console.warn(`[FMP] 403 Bandwidth/limit reached on ${functionName}`);
      } else {
        console.warn(`[FMP] 403 forbidden on ${functionName}. Response: ${bodyText}`);
      }
    } else {
      console.warn(`[FMP] API returned status ${res.status} on ${functionName}`);
    }
    return null;
  }
  return res.json();
}

/**
 * Sub-task B: getCompanyProfile
 * GET https://financialmodelingprep.com/stable/profile?symbol={symbol}&apikey={FMP_API_KEY}
 */
export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  if (!checkAndIncrementFmpBudget()) return null;
  if (isSourceRateLimited('fmp')) return null;
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  try {
    // 1. Check SQLite Cache
    const cached = getCachedCompanyProfile(uppercaseSymbol);
    if (cached) {
      const cacheAgeMs = Date.now() - new Date(cached.cachedAt).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (cacheAgeMs < sevenDaysMs) {
        console.log(`[FMP] Profile cache hit for ${uppercaseSymbol} (${(cacheAgeMs / 1000 / 60 / 60).toFixed(1)} hrs old)`);
        return cached.profile;
      }
    }

    // 2. Fallback to API if cache missing or expired
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      console.warn("[FMP] Missing FMP_API_KEY standard environment variable. Cannot call FMP profile API.");
      return cached ? cached.profile : null; // fallback to expired instead of returning null if we have it
    }

    const url = `https://financialmodelingprep.com/stable/profile?symbol=${uppercaseSymbol}&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);
    const data = await handleFmpResponse(res, 'getCompanyProfile');

    if (!data || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    const item = data[0];
    const profile: CompanyProfile = {
      symbol: item.symbol || uppercaseSymbol,
      name: item.companyName || item.name || uppercaseSymbol,
      price: item.price !== undefined ? Number(item.price) : undefined,
      beta: item.beta !== undefined ? Number(item.beta) : undefined,
      sector: item.sector || "Unknown",
      industry: item.industry || "Unknown",
      subIndustry: item.subIndustry || undefined,
      exchange: item.exchange || item.exchangeShortName || "Unknown",
      marketCap: item.mktCap || 0,
      employees: item.fullTimeEmployees ? Number(item.fullTimeEmployees) : undefined,
      description: item.description || "",
      country: item.country || "US",
      currency: item.currency || "USD",
      ipoDate: item.ipoDate || undefined,
      isActivelyTrading: item.isActivelyTrading ?? true,
      source: "fmp"
    };

    // 3. Update SQLite Cache
    setCachedCompanyProfile(profile);

    // 4. Log Fetch to DataSourceRegistry
    logDataSourceFetch({
      sourceId: "fmp",
      sourceName: "Financial Modeling Prep",
      dataType: "fundamentals",
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      recordCount: 1,
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    return profile;
  } catch (err: any) {
    console.error(`[FMP] getCompanyProfile failed for ${uppercaseSymbol}:`, err.message || err);

    // Dynamic logging of failure
    logDataSourceFetch({
      sourceId: "fmp",
      sourceName: "Financial Modeling Prep",
      dataType: "fundamentals",
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      recordCount: 0,
      success: false,
      errorMessage: err.message || String(err),
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    // Return stale cache if available, else null
    const cached = getCachedCompanyProfile(uppercaseSymbol);
    return cached ? cached.profile : null;
  }
}

/**
 * Sub-task C: getFinancialRatios
 * GET https://financialmodelingprep.com/stable/ratios-ttm?symbol={symbol}&apikey={FMP_API_KEY}
 */
export async function getFinancialRatios(symbol: string): Promise<CompanyFinancialRatios | null> {
  if (!checkAndIncrementFmpBudget()) return null;
  if (isSourceRateLimited('fmp')) return null;
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  try {
    // 1. Check SQLite Cache
    const cached = getCachedFinancialRatios(uppercaseSymbol);
    if (cached) {
      const cacheAgeMs = Date.now() - new Date(cached.cachedAt).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (cacheAgeMs < sevenDaysMs) {
        console.log(`[FMP] Ratios cache hit for ${uppercaseSymbol} (${(cacheAgeMs / 1000 / 60 / 60).toFixed(1)} hrs old)`);
        return cached.ratios;
      }
    }

    // 2. Fetch from API
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      console.warn("[FMP] Missing FMP_API_KEY. Cannot call FMP ratios API.");
      return cached ? cached.ratios : null;
    }

    const url = `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${uppercaseSymbol}&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);
    const data = await handleFmpResponse(res, 'getFinancialRatios');

    if (!data || !Array.isArray(data) || data.length === 0) {
      return null;
    }

    const item = data[0];
    const ratios: CompanyFinancialRatios = {
      symbol: uppercaseSymbol,
      date: item.date || new Date().toISOString().split("T")[0],
      peRatio: item.peRatioTTM ?? item.peRatio ?? undefined,
      pegRatio: item.pegRatioTTM ?? item.pegRatio ?? undefined,
      priceToSalesRatio: item.priceToSalesRatioTTM ?? item.priceToSalesRatio ?? undefined,
      priceToBookRatio: item.priceToBookRatioTTM ?? item.priceToBookRatio ?? undefined,
      debtToEquityRatio: item.debtEquityRatioTTM ?? item.debtToEquityRatio ?? undefined,
      currentRatio: item.currentRatioTTM ?? item.currentRatio ?? undefined,
      returnOnEquity: item.returnOnEquityTTM ?? item.returnOnEquity ?? undefined,
      returnOnAssets: item.returnOnAssetsTTM ?? item.returnOnAssets ?? undefined,
      grossProfitMargin: item.grossProfitMarginTTM ?? item.grossProfitMargin ?? undefined,
      operatingProfitMargin: item.operatingProfitMarginTTM ?? item.operatingProfitMargin ?? undefined,
      netProfitMargin: item.netProfitMarginTTM ?? item.netProfitMargin ?? undefined,
      // Fallbacks in case growth / FCF is present on the endpoint or can be parsed
      revenueGrowthYoY: item.revenueGrowthYoYTTM ?? item.revenueGrowthYoY ?? item.revenueGrowthTTM ?? undefined,
      earningsGrowthYoY: item.earningsGrowthYoYTTM ?? item.earningsGrowthYoY ?? item.epsGrowthTTM ?? undefined,
      freeCashFlowPerShare: item.freeCashFlowPerShareTTM ?? item.freeCashFlowPerShare ?? undefined,
      source: "fmp"
    };

    // 3. Update SQLite Cache
    setCachedFinancialRatios(ratios);

    // 4. Log Fetch
    logDataSourceFetch({
      sourceId: "fmp",
      sourceName: "Financial Modeling Prep",
      dataType: "ratios",
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      recordCount: 1,
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    return ratios;
  } catch (err: any) {
    console.error(`[FMP] getFinancialRatios failed for ${uppercaseSymbol}:`, err.message || err);

    logDataSourceFetch({
      sourceId: "fmp",
      sourceName: "Financial Modeling Prep",
      dataType: "ratios",
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      recordCount: 0,
      success: false,
      errorMessage: err.message || String(err),
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    const cached = getCachedFinancialRatios(uppercaseSymbol);
    return cached ? cached.ratios : null;
  }
}

/**
 * Sub-task D: getEarningsCalendar
 * GET https://financialmodelingprep.com/stable/earnings?symbol={symbol}&apikey={FMP_API_KEY}&limit=20
 */
export async function getEarningsCalendar(
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<EarningsEvent[]> {
  if (!checkAndIncrementFmpBudget()) return [];
  if (isSourceRateLimited('fmp')) return [];
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  try {
    // 1. Check SQLite Cache (valid for 7 days)
    const cachedEvents = getCachedEarningsCalendar(uppercaseSymbol, fromDate, toDate);
    if (cachedEvents !== null) {
      console.log(`[FMP] Earnings calendar cache hit for ${uppercaseSymbol} - returned ${cachedEvents.length} events matching range ${fromDate} to ${toDate}`);
      return cachedEvents;
    }

    // 2. Fetch from API
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      console.warn("[FMP] Missing FMP_API_KEY. Cannot call FMP earnings calendar API.");
      // Fallback to expired cache if available, but return empty array if no cache exists
      return cachedEvents || [];
    }

    const url = `https://financialmodelingprep.com/stable/earnings?symbol=${uppercaseSymbol}&apikey=${apiKey}&limit=20`;
    const res = await fetchWithTimeout(url);
    const data = await handleFmpResponse(res, 'getEarningsCalendar');

    if (!data || !Array.isArray(data)) {
      return [];
    }

    const todayStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const events: EarningsEvent[] = data.map((item: any) => {
      const eDate = item.date || todayStr;
      const eps = item.eps !== undefined && item.eps !== null ? Number(item.eps) : undefined;
      const epsEstimated = item.epsEstimated !== undefined && item.epsEstimated !== null ? Number(item.epsEstimated) : undefined;
      
      let epsSurprise: number | undefined = undefined;
      if (eps !== undefined && epsEstimated !== undefined) {
        epsSurprise = eps - epsEstimated;
      }
      
      let epsSurprisePercent: number | undefined = undefined;
      if (epsSurprise !== undefined && epsEstimated) {
        epsSurprisePercent = (epsSurprise / Math.abs(epsEstimated)) * 100;
      }

      return {
        symbol: uppercaseSymbol,
        reportDate: eDate,
        fiscalQuarterEnd: item.fiscalEnding || eDate,
        estimatedEps: epsEstimated,
        actualEps: eps,
        epsSurprise,
        epsSurprisePercent,
        isUpcoming: eDate > todayStr,
        source: "fmp"
      };
    });

    // 3. Cache ALL returned events in DB (which upserts)
    if (events.length > 0) {
      insertEarningsCalendar(events);
    }

    // 4. Log fetch
    logDataSourceFetch({
      sourceId: "fmp",
      sourceName: "Financial Modeling Prep",
      dataType: "earnings_calendar",
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      recordCount: events.length,
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    // 5. Filter to request range
    return events.filter(e => e.reportDate >= fromDate && e.reportDate <= toDate);
  } catch (err: any) {
    console.error(`[FMP] getEarningsCalendar failed for ${uppercaseSymbol}:`, err.message || err);

    logDataSourceFetch({
      sourceId: "fmp",
      sourceName: "Financial Modeling Prep",
      dataType: "earnings_calendar",
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      recordCount: 0,
      success: false,
      errorMessage: err.message || String(err),
      latencyMs: Date.now() - startTime,
      isFallback: false
    });

    // Fallback to expired cache matching subset range
    const offlineCached = getCachedEarningsCalendar(uppercaseSymbol, fromDate, toDate);
    return offlineCached || [];
  }
}

import {
  getCachedPeers, setCachedPeers,
  getCachedEarningsTranscript, setCachedEarningsTranscript,
  getCachedDarkPool, setCachedDarkPool,
  getCachedBorrowRate, setCachedBorrowRate,
  getCachedSocialSentiment, setCachedSocialSentiment,
  getCachedEstimateRevisions, setCachedEstimateRevisions
} from "./db";

export async function getHistoricalDarkPoolVolume(symbol: string, date: string): Promise<number | null> {
  if (!checkAndIncrementFmpBudget()) return null;
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  try {
    const cached = getCachedDarkPool(uppercaseSymbol, date);
    if (cached !== null) {
      console.log(`[FMP] Dark Pool cache hit for ${uppercaseSymbol} / ${date}`);
      return cached.value;
    }

    console.log(`[FMP] getHistoricalDarkPoolVolume has no free-tier stable endpoint — skipping.`);
    return null;
  } catch (error) {
    console.error(`[FMP] Failed to fetch dark pool volume for ${symbol}:`, error);
    return null;
  }
}

export async function getHistoricalBorrowRate(symbol: string, date: string): Promise<number | null> {
  if (!checkAndIncrementFmpBudget()) return null;
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  try {
    const cached = getCachedBorrowRate(uppercaseSymbol, date);
    if (cached !== null) {
      console.log(`[FMP] CTB cache hit for ${uppercaseSymbol} / ${date}`);
      return cached.value;
    }

    console.log(`[FMP] getHistoricalBorrowRate has no free-tier stable endpoint — skipping.`);
    return null;
  } catch (error) {
    console.error(`[FMP] Failed to fetch borrow rate for ${symbol}:`, error);
    return null;
  }
}

/**
 * Fetches the top competitors/peers for a given symbol from FMP.
 */
export async function getTopPeers(symbol: string): Promise<string[]> {
  if (!checkAndIncrementFmpBudget()) return [];
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  try {
    const cached = getCachedPeers(uppercaseSymbol);
    if (cached) {
      console.log(`[FMP] Stock Peers cache hit for ${uppercaseSymbol}`);
      return cached;
    }

    if (isSourceRateLimited('fmp')) return [];

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      console.warn(`[FMP] API key missing for stock peers fetch`);
      return [];
    }

    const res = await fetchWithTimeout(`https://financialmodelingprep.com/stable/stock-peers?symbol=${uppercaseSymbol}&apikey=${apiKey}`);
    const data = await handleFmpResponse(res, 'getTopPeers');

    if (Array.isArray(data) && data.length > 0) {
      const peerListObj = data.find((item: any) => item.symbol === uppercaseSymbol);
      if (peerListObj && Array.isArray(peerListObj.peersList)) {
        const peers = peerListObj.peersList.slice(0, 3);
        setCachedPeers(uppercaseSymbol, peers);
        
        logDataSourceFetch({
          sourceId: 'fmp',
          sourceName: 'Financial Modeling Prep',
          dataType: 'stock_peers',
          symbol: uppercaseSymbol,
          fetchedAt: new Date().toISOString(),
          success: true,
          latencyMs: Date.now() - startTime,
          isFallback: false
        });
        return peers;
      }
    }

    return [];
  } catch (error) {
    console.error(`[FMP] Failed to fetch stock peers for ${symbol}:`, error);
    return [];
  }
}

/**
 * Fetches an earnings call transcript for a given symbol, year, and quarter.
 */
export async function getEarningsTranscript(symbol: string, year: number, quarter: number): Promise<string | null> {
  if (!checkAndIncrementFmpBudget()) return null;
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  try {
    const cached = getCachedEarningsTranscript(uppercaseSymbol, year, quarter);
    if (cached) {
      console.log(`[FMP] Earnings Transcript cache hit for ${uppercaseSymbol} / Q${quarter} ${year}`);
      return cached;
    }

    if (isSourceRateLimited('fmp')) return null;

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      console.warn(`[FMP] API key missing for earnings transcript fetch`);
      return null;
    }

    const url = `https://financialmodelingprep.com/stable/earning-call-transcript?symbol=${uppercaseSymbol}&year=${year}&quarter=${quarter}&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);
    const data = await handleFmpResponse(res, 'getEarningsTranscript');

    if (Array.isArray(data) && data.length > 0) {
      const transcript = data[0].content;
      setCachedEarningsTranscript(uppercaseSymbol, year, quarter, transcript);
      
      logDataSourceFetch({
        sourceId: 'fmp',
        sourceName: 'Financial Modeling Prep',
        dataType: 'earning_call_transcript',
        symbol: uppercaseSymbol,
        fetchedAt: new Date().toISOString(),
        success: true,
        latencyMs: Date.now() - startTime,
        isFallback: false
      });
      return transcript;
    }
    
    return null;
  } catch (error) {
    console.error(`[FMP] Failed to fetch earnings transcript for ${symbol} Q${quarter} ${year}:`, error);
    return null;
  }
}

/**
 * Sub-task E: getFullCompanyContext
 * Calls profile, ratios, and earnings in parallel.
 * Fits ranges intelligently.
 */
export async function getFullCompanyContext(symbol: string): Promise<{
  profile: CompanyProfile | null;
  ratios: CompanyFinancialRatios | null;
  recentEarnings: EarningsEvent[];
  upcomingEarnings: EarningsEvent[];
}> {
  const uppercaseSymbol = symbol.toUpperCase().trim();

  // Load a historical lookback to lookforward window covering both past anomalies and future earnings
  const fromDate = "2010-01-01";
  const toDate = "2028-12-31"; // Dynamic forward window

  const [profile, ratios, earnings] = await Promise.all([
    getCompanyProfile(uppercaseSymbol),
    getFinancialRatios(uppercaseSymbol),
    getEarningsCalendar(uppercaseSymbol, fromDate, toDate)
  ]);

  const recentEarnings = earnings.filter(e => !e.isUpcoming);
  const upcomingEarnings = earnings.filter(e => e.isUpcoming);

  console.log(`[FMP] Full context loaded for ${uppercaseSymbol}: sector=${profile?.sector || "N/A"}, marketCap=${profile?.marketCap || 0}, ${earnings.length} earnings events`);

  return {
    profile,
    ratios,
    recentEarnings,
    upcomingEarnings
  };
}

/**
 * Fetches market structure (short interest, options flow) from FMP
 */
export async function getMarketStructure(symbol: string, date: string): Promise<{ short_interest_ratio: number | null, options_put_call_ratio: number | null }> {
  if (!checkAndIncrementFmpBudget()) return { short_interest_ratio: null, options_put_call_ratio: null };
  if (isSourceRateLimited('fmp')) return { short_interest_ratio: null, options_put_call_ratio: null };
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  try {
    const cached = getCachedMarketStructure(uppercaseSymbol, date);
    if (cached) {
      console.log(`[FMP] Market Structure cache hit for ${uppercaseSymbol} / ${date}`);
      return cached.data;
    }

    console.log(`[FMP] getMarketStructure has no free-tier stable endpoint — skipping.`);
    return { short_interest_ratio: null, options_put_call_ratio: null };

  } catch (err: any) {
    logDataSourceFetch({
      sourceId: "fmp",
      sourceName: "Financial Modeling Prep",
      dataType: "market_structure",
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      success: false,
      isFallback: false,
      latencyMs: Date.now() - startTime,
      errorMessage: err.message
    });
    console.error(`[FMP] Market Structure fetch error for ${symbol}:`, err);
    return { short_interest_ratio: null, options_put_call_ratio: null };
  }
}

// Set once when the analyst-estimates endpoint proves unavailable on the free tier, to avoid log spam.
let _estimateRevisionsEndpointUnavailable = false;

/**
 * Derives EPS estimate revision momentum in the ~8 weeks before the event date.
 * Uses FMP /stable/analyst-estimates to compare consecutive consensus periods.
 * Returns null (without an API call) if the endpoint is known to be off the free tier.
 * Results are cached for 30 days.
 */
export async function getEstimateRevisions(
  symbol: string,
  date: string
): Promise<{ revisionDirection: "up" | "down" | "flat"; revisionMagnitudePct: number; analystCount: number } | null> {
  if (_estimateRevisionsEndpointUnavailable) return null;
  if (!checkAndIncrementFmpBudget()) return null;
  if (isSourceRateLimited('fmp')) return null;

  const uppercaseSymbol = symbol.toUpperCase().trim();
  const yearMonth = date.slice(0, 7); // "YYYY-MM" — cache key granularity

  const cached = getCachedEstimateRevisions(uppercaseSymbol, yearMonth);
  if (cached !== null) {
    console.log(`[FMP] Estimate revisions cache hit for ${uppercaseSymbol} / ${yearMonth}`);
    return cached;
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[FMP] Missing FMP_API_KEY — skipping estimate revisions.');
    return null;
  }

  try {
    const url = `https://financialmodelingprep.com/stable/analyst-estimates?symbol=${uppercaseSymbol}&limit=5&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);

    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) {}
      if (res.status === 403 && (body.includes('Exclusive Endpoint') || body.includes('Legacy Endpoint') || body.includes('Professional plan'))) {
        if (!_estimateRevisionsEndpointUnavailable) {
          console.warn('[FMP] analyst-estimates endpoint is not on the free tier — disabling for this session.');
          _estimateRevisionsEndpointUnavailable = true;
        }
        return null;
      }
      console.warn(`[FMP] getEstimateRevisions HTTP ${res.status} for ${uppercaseSymbol}`);
      return null;
    }

    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) {
      // < 2 periods → cannot compute a revision delta
      return null;
    }

    // Sort ascending by date so index 0 is the oldest available period
    const sorted = [...data]
      .filter((r: any) => r.estimatedEpsAvg != null)
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (sorted.length < 2) return null;

    // Compare the two most recent consecutive periods
    const older = sorted[sorted.length - 2];
    const newer = sorted[sorted.length - 1];

    const oldEps = Number(older.estimatedEpsAvg);
    const newEps = Number(newer.estimatedEpsAvg);

    if (!isFinite(oldEps) || !isFinite(newEps) || oldEps === 0) return null;

    const magnitudePct = ((newEps - oldEps) / Math.abs(oldEps)) * 100;
    const direction: "up" | "down" | "flat" =
      magnitudePct > 1 ? "up" : magnitudePct < -1 ? "down" : "flat";
    const analystCount = Number(newer.numberAnalystEstimated ?? older.numberAnalystEstimated ?? 0);

    const result = {
      revisionDirection: direction,
      revisionMagnitudePct: Math.round(magnitudePct * 100) / 100,
      analystCount,
    };

    setCachedEstimateRevisions(uppercaseSymbol, yearMonth, result);
    console.log(`[FMP] Estimate revisions for ${uppercaseSymbol}: ${direction} ${result.revisionMagnitudePct}% (${analystCount} analysts)`);
    return result;
  } catch (err: any) {
    console.warn(`[FMP] getEstimateRevisions failed for ${uppercaseSymbol}: ${err.message}`);
    return null;
  }
}

/**
 * Fetches historical social sentiment from FMP for a given symbol and date.
 * Looks for exact match on date (t=0), or closest trailing day.
 */
export async function getSocialSentiment(symbol: string, date: string): Promise<{ fmp_social_sentiment_score: number | null, fmp_social_post_volume: number | null }> {
  if (!checkAndIncrementFmpBudget()) return { fmp_social_sentiment_score: null, fmp_social_post_volume: null };
  if (isSourceRateLimited('fmp')) return { fmp_social_sentiment_score: null, fmp_social_post_volume: null };
  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  try {
    const cached = getCachedSocialSentiment(uppercaseSymbol, date);
    if (cached) {
      console.log(`[FMP] Social Sentiment cache hit for ${uppercaseSymbol} / ${date}`);
      return {
        fmp_social_sentiment_score: cached.sentimentScore,
        fmp_social_post_volume: cached.postVolume
      };
    }

    console.log(`[FMP] getSocialSentiment has no free-tier stable endpoint — skipping.`);
    return { fmp_social_sentiment_score: null, fmp_social_post_volume: null };
  } catch (error: any) {
    console.error(`[FMP] Error fetching social sentiment for ${uppercaseSymbol}:`, error.message);
    return { fmp_social_sentiment_score: null, fmp_social_post_volume: null };
  }
}
