import { markSourceRateLimited, isSourceRateLimited } from "./DataSourceRegistry";
import { CompanyProfile, CompanyFinancialRatios, EarningsEvent } from "./src/types";

export function isFmpPremium(): boolean {
  const tier = process.env.FMP_TIER ?? 'auto';
  if (tier === 'premium') return true;
  if (tier === 'free') return false;
  // Auto: Premium until subscription expires Jul 6 2026
  return new Date() < new Date('2026-07-06T23:59:59Z');
}

export let fmpDailyRequestCount = 0;
export let fmpDailyResetDate = new Date().toISOString().split('T')[0];
export const FMP_DAILY_BUDGET = Number(
  process.env.FMP_DAILY_BUDGET ?? (isFmpPremium() ? 1000000 : 250)
);

let fmpMinuteRequestCount = 0;
let fmpMinuteResetTime = Date.now() + 60000;
const FMP_MINUTE_LIMIT = Number(
  process.env.FMP_MINUTE_LIMIT ?? (isFmpPremium() ? 700 : 5)
);

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
  if (Date.now() > fmpMinuteResetTime) {
    fmpMinuteRequestCount = 0;
    fmpMinuteResetTime = Date.now() + 60000;
  }
  if (fmpMinuteRequestCount >= FMP_MINUTE_LIMIT) {
    console.warn(`[FMP] Per-minute limit of ${FMP_MINUTE_LIMIT} requests reached — throttling.`);
    return false;
  }
  fmpDailyRequestCount++;
  fmpMinuteRequestCount++;
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
  getCachedEstimateRevisions, setCachedEstimateRevisions,
  getCachedFmpNewsSentiment, setCachedFmpNewsSentiment,
  getCachedFmpInsiderTrading, setCachedFmpInsiderTrading,
  getCachedFmpInstitutionalOwnership, setCachedFmpInstitutionalOwnership,
  getCachedFmpEarningsSurprise, setCachedFmpEarningsSurprise,
  getCachedEarningsHistory, setCachedEarningsHistory,
  getCachedFmpAnalystGrades, setCachedFmpAnalystGrades,
  getCachedGradesHistory, setCachedGradesHistory,
  getCachedFmpPriceTarget, setCachedFmpPriceTarget
} from "./db";

export async function getHistoricalDarkPoolVolume(symbol: string, date: string): Promise<number | null> {
  if (!isFmpPremium()) return null;
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
  if (!isFmpPremium()) return null;
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

// Set once if the earning-call-transcript endpoint returns 402 Payment Required.
let _earningsTranscriptUnavailable = false;

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

    if (_earningsTranscriptUnavailable) return null;
    if (isSourceRateLimited('fmp')) return null;

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      console.warn(`[FMP] API key missing for earnings transcript fetch`);
      return null;
    }

    const url = `https://financialmodelingprep.com/stable/earning-call-transcript?symbol=${uppercaseSymbol}&year=${year}&quarter=${quarter}&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);

    if (!res.ok && res.status === 402) {
      if (!_earningsTranscriptUnavailable) {
        console.warn('[FMP] earning-call-transcript endpoint requires a higher plan — disabling for this session.');
        _earningsTranscriptUnavailable = true;
      }
      return null;
    }

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

// Set once if the analyst-estimates endpoint proves unavailable on the current plan.
let _estimateRevisionsEndpointUnavailable = false;

/**
 * Derives EPS estimate revision momentum by comparing the two most recent
 * consecutive consensus periods from FMP /api/v4/analyst-estimates/{symbol}.
 * Returns null gracefully if the endpoint is unavailable or data is insufficient.
 * Results are cached per symbol/month to avoid repeat calls.
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
    // Symbol is a path segment on v4, not a query param — /stable/analyst-estimates?symbol=X
    // was producing HTTP 400 for every symbol because that endpoint requires a different format.
    const url = `https://financialmodelingprep.com/stable/analyst-estimates?symbol=${uppercaseSymbol}&period=annual&page=0&limit=5&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);

    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) {}
      if (res.status === 403 && (body.includes('Exclusive Endpoint') || body.includes('Legacy Endpoint') || body.includes('Professional plan'))) {
        if (!_estimateRevisionsEndpointUnavailable) {
          console.warn('[FMP] analyst-estimates endpoint is not available on the current plan — disabling for this session.');
          _estimateRevisionsEndpointUnavailable = true;
        }
        return null;
      }
      // Suppress per-symbol noise; a single debug line is enough
      console.debug(`[FMP] getEstimateRevisions HTTP ${res.status} for ${uppercaseSymbol} — skipping`);
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
 * Uses /api/v4/historical/social-sentiment with a ±7-day window, then picks
 * the entry on or immediately before the target date (t=0 or closest trailing).
 * Requires FMP Premium.
 */
export async function getSocialSentiment(symbol: string, date: string): Promise<{ fmp_social_sentiment_score: number | null, fmp_social_post_volume: number | null }> {
  const NULL_RESULT = { fmp_social_sentiment_score: null, fmp_social_post_volume: null };
  if (!isFmpPremium()) return NULL_RESULT;
  if (!checkAndIncrementFmpBudget()) return NULL_RESULT;
  if (isSourceRateLimited('fmp')) return NULL_RESULT;
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

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      console.warn('[FMP] Missing FMP_API_KEY — skipping social sentiment.');
      return NULL_RESULT;
    }

    const targetMs = new Date(date).getTime();
    const fromDate = new Date(targetMs - 5 * 86400000).toISOString().split('T')[0];
    const toDate = new Date(targetMs + 2 * 86400000).toISOString().split('T')[0];

    const url = `https://financialmodelingprep.com/api/v4/historical/social-sentiment?symbol=${uppercaseSymbol}&from=${fromDate}&to=${toDate}&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);
    const data = await handleFmpResponse(res, 'getSocialSentiment');

    if (!Array.isArray(data) || data.length === 0) return NULL_RESULT;

    // Find the entry on or immediately before the target date
    const sorted = [...data]
      .filter((r: any) => r.date != null)
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const entry = sorted.find((r: any) => r.date.slice(0, 10) <= date) ?? sorted[0];
    if (!entry) return NULL_RESULT;

    // Average StockTwits + Twitter sentiment scores; fall back to whichever is available
    const stwit = typeof entry.stocktwitsSentiment === 'number' ? entry.stocktwitsSentiment : null;
    const twit  = typeof entry.twitterSentiment    === 'number' ? entry.twitterSentiment    : null;
    const sentimentScore =
      stwit !== null && twit !== null ? (stwit + twit) / 2 :
      stwit ?? twit;

    const postVolume =
      (typeof entry.stocktwitsPosts === 'number' ? entry.stocktwitsPosts : 0) +
      (typeof entry.twitterPosts    === 'number' ? entry.twitterPosts    : 0) || null;

    if (sentimentScore !== null) {
      setCachedSocialSentiment(uppercaseSymbol, date, sentimentScore, postVolume ?? 0);
      logDataSourceFetch({
        sourceId: 'fmp',
        sourceName: 'Financial Modeling Prep',
        dataType: 'social_sentiment',
        symbol: uppercaseSymbol,
        fetchedAt: new Date().toISOString(),
        success: true,
        latencyMs: Date.now() - startTime,
        isFallback: false
      });
      console.log(`[FMP] Social Sentiment for ${uppercaseSymbol} / ${date}: score=${Math.round(sentimentScore * 1000) / 1000}, volume=${postVolume}`);
    }

    return {
      fmp_social_sentiment_score: sentimentScore !== null ? Math.round(sentimentScore * 10000) / 10000 : null,
      fmp_social_post_volume: postVolume
    };
  } catch (error: any) {
    console.error(`[FMP] Error fetching social sentiment for ${uppercaseSymbol}:`, error.message);
    return NULL_RESULT;
  }
}

/**
 * Fetches news articles for the symbol in the 7 days before `date` from
 * FMP /api/v3/stock_news and computes average sentiment (-1 to +1) and article count.
 * Requires FMP Premium for the sentimentScore field; falls back to mapping
 * "positive/negative/neutral" strings if the numeric score is absent.
 */
export async function getFMPNewsSentiment(
  symbol: string,
  date: string
): Promise<{ fmp_news_sentiment_avg: number | null; fmp_news_article_count_7d: number } | null> {
  if (!checkAndIncrementFmpBudget()) return null;
  if (isSourceRateLimited('fmp')) return null;

  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  const cached = getCachedFmpNewsSentiment(uppercaseSymbol, date);
  if (cached !== null) {
    console.log(`[FMP] News sentiment cache hit for ${uppercaseSymbol} / ${date}`);
    return { fmp_news_sentiment_avg: cached.sentimentAvg, fmp_news_article_count_7d: cached.articleCount };
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[FMP] Missing FMP_API_KEY — skipping news sentiment.');
    return null;
  }

  try {
    const targetMs = new Date(date).getTime();
    const fromDate = new Date(targetMs - 7 * 86400000).toISOString().split('T')[0];
    const toDate = date;

    const url = `https://financialmodelingprep.com/stable/news/stock-latest?symbols=${uppercaseSymbol}&from=${fromDate}&to=${toDate}&limit=50&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);
    let data = await handleFmpResponse(res, 'getFMPNewsSentiment');

    if (Array.isArray(data) && data.length > 0) {
      // If the endpoint returns unfiltered results, fall back to press-releases
      if (data[0]?.symbol && String(data[0].symbol).toUpperCase() !== uppercaseSymbol) {
        const prUrl = `https://financialmodelingprep.com/stable/news/press-releases?symbols=${uppercaseSymbol}&from=${fromDate}&to=${toDate}&limit=50&apikey=${apiKey}`;
        const prRes = await fetchWithTimeout(prUrl);
        const prData = await handleFmpResponse(prRes, 'getFMPNewsSentiment');
        if (Array.isArray(prData) && prData.length > 0) {
          data = prData;
          console.log('[FMP] Fell back to press-releases for', uppercaseSymbol, '— first article symbol:', data[0]?.symbol);
        }
      }
    }

    if (!Array.isArray(data) || data.length === 0) {
      setCachedFmpNewsSentiment(uppercaseSymbol, date, null, 0);
      return { fmp_news_sentiment_avg: null, fmp_news_article_count_7d: 0 };
    }

    const POSITIVE_WORDS = ['beat', 'surge', 'record', 'raised', 'upgraded', 'strong', 'growth', 'profit'];
    const NEGATIVE_WORDS = ['miss', 'fell', 'cut', 'downgrade', 'loss', 'weak', 'decline', 'below', 'warn'];

    const scores: number[] = [];
    for (const article of data) {
      const text: string = (article.text || '').toLowerCase();
      const words = text.split(/\W+/).filter(Boolean);
      if (words.length === 0) continue;
      const pos = words.filter((w: string) => POSITIVE_WORDS.includes(w)).length;
      const neg = words.filter((w: string) => NEGATIVE_WORDS.includes(w)).length;
      const raw = (pos - neg) / words.length * 100;
      scores.push(Math.max(-1, Math.min(1, raw)));
    }

    const articleCount = data.length;
    const sentimentAvg = scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10000) / 10000
      : null;

    setCachedFmpNewsSentiment(uppercaseSymbol, date, sentimentAvg, articleCount);
    logDataSourceFetch({
      sourceId: 'fmp',
      sourceName: 'Financial Modeling Prep',
      dataType: 'stock_news_sentiment',
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false
    });
    console.log(`[FMP] News sentiment for ${uppercaseSymbol} / ${date}: avg=${sentimentAvg}, articles=${articleCount}`);
    return { fmp_news_sentiment_avg: sentimentAvg, fmp_news_article_count_7d: articleCount };
  } catch (err: any) {
    console.warn(`[FMP] getFMPNewsSentiment failed for ${uppercaseSymbol}: ${err.message}`);
    return null;
  }
}

/**
 * Fetches insider transactions for the symbol in the 30 days before `date` from
 * FMP /api/v4/insider-trading and computes net shares, buy count, and sell count.
 * Requires FMP Premium.
 */
export async function getFMPInsiderTrading(
  symbol: string,
  date: string
): Promise<{ insider_net_shares_30d: number | null; insider_buy_count_30d: number; insider_sell_count_30d: number } | null> {
  if (!checkAndIncrementFmpBudget()) return null;
  if (isSourceRateLimited('fmp')) return null;

  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  const cached = getCachedFmpInsiderTrading(uppercaseSymbol, date);
  if (cached !== null) {
    console.log(`[FMP] Insider trading cache hit for ${uppercaseSymbol} / ${date}`);
    return { insider_net_shares_30d: cached.netShares, insider_buy_count_30d: cached.buyCount, insider_sell_count_30d: cached.sellCount };
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[FMP] Missing FMP_API_KEY — skipping insider trading.');
    return null;
  }

  try {
    const url = `https://financialmodelingprep.com/stable/insider-trading/search?symbol=${uppercaseSymbol}&limit=20&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);
    const data = await handleFmpResponse(res, 'getFMPInsiderTrading');

    if (!Array.isArray(data) || data.length === 0) {
      setCachedFmpInsiderTrading(uppercaseSymbol, date, null, 0, 0);
      return { insider_net_shares_30d: null, insider_buy_count_30d: 0, insider_sell_count_30d: 0 };
    }

    const cutoffMs = new Date(date).getTime() - 30 * 86400000;
    const window = data.filter((tx: any) => {
      const txDate = tx.transactionDate || tx.filingDate || tx.date;
      if (!txDate) return false;
      return new Date(txDate).getTime() >= cutoffMs && new Date(txDate).getTime() <= new Date(date).getTime();
    });

    let buyShares = 0;
    let sellShares = 0;
    let buyCount = 0;
    let sellCount = 0;

    for (const tx of window) {
      const txType: string = (tx.transactionType || '').toUpperCase();
      const shares = typeof tx.securitiesTransacted === 'number' ? tx.securitiesTransacted :
                     typeof tx.shares === 'number' ? tx.shares : 0;
      if (txType.startsWith('P') || txType.includes('PURCHASE') || txType.includes('BUY') || txType === 'A') {
        buyShares += shares;
        buyCount++;
      } else if (txType.startsWith('S') || txType.includes('SALE') || txType.includes('SELL')) {
        sellShares += shares;
        sellCount++;
      }
    }

    const netShares = (buyCount > 0 || sellCount > 0) ? Math.round(buyShares - sellShares) : null;

    setCachedFmpInsiderTrading(uppercaseSymbol, date, netShares, buyCount, sellCount);
    logDataSourceFetch({
      sourceId: 'fmp',
      sourceName: 'Financial Modeling Prep',
      dataType: 'insider_trading',
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false
    });
    console.log(`[FMP] Insider trading for ${uppercaseSymbol} / ${date}: net=${netShares}, buys=${buyCount}, sells=${sellCount}`);
    return { insider_net_shares_30d: netShares, insider_buy_count_30d: buyCount, insider_sell_count_30d: sellCount };
  } catch (err: any) {
    console.warn(`[FMP] getFMPInsiderTrading failed for ${uppercaseSymbol}: ${err.message}`);
    return null;
  }
}

function dateToYearQuarter(date: string): { year: number; quarter: number } {
  const d = new Date(date);
  const month = d.getUTCMonth() + 1; // 1-12
  return { year: d.getUTCFullYear(), quarter: Math.ceil(month / 3) };
}

// Set once if the institutional-ownership endpoint returns 402 Payment Required.
let _institutionalOwnershipUnavailable = false;

export async function getFMPInstitutionalOwnership(
  symbol: string,
  date: string
): Promise<{ institutional_ownership_pct: number | null; institutional_ownership_change_qoq: number | null } | null> {
  if (!isFmpPremium()) return { institutional_ownership_pct: null, institutional_ownership_change_qoq: null };
  if (_institutionalOwnershipUnavailable) return null;
  if (!checkAndIncrementFmpBudget()) return null;
  if (isSourceRateLimited('fmp')) return null;

  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  const cached = getCachedFmpInstitutionalOwnership(uppercaseSymbol, date);
  if (cached !== null) {
    console.log(`[FMP] Institutional ownership cache hit for ${uppercaseSymbol} / ${date}`);
    return { institutional_ownership_pct: cached.ownershipPct, institutional_ownership_change_qoq: cached.changeQoQ };
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[FMP] Missing FMP_API_KEY — skipping institutional ownership.');
    return null;
  }

  try {
    const { year, quarter } = dateToYearQuarter(date);
    const url = `https://financialmodelingprep.com/stable/institutional-ownership/symbol-positions-summary?symbol=${uppercaseSymbol}&year=${year}&quarter=${quarter}&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);

    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch (_) {}
      if (res.status === 402) {
        if (!_institutionalOwnershipUnavailable) {
          console.warn('[FMP] institutional-ownership endpoint requires a higher plan — disabling for this session.');
          _institutionalOwnershipUnavailable = true;
        }
        return null;
      }
      if (res.status === 429) {
        markSourceRateLimited('fmp');
        console.warn('[FMP] 429 Rate limited on getFMPInstitutionalOwnership');
      } else {
        console.debug(`[FMP] getFMPInstitutionalOwnership HTTP ${res.status} for ${uppercaseSymbol} — skipping`);
      }
      return null;
    }

    const data: any[] = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      setCachedFmpInstitutionalOwnership(uppercaseSymbol, date, null, null);
      return { institutional_ownership_pct: null, institutional_ownership_change_qoq: null };
    }

    // Sort descending by quarter date; pick entry on or before event date
    const sorted = [...data]
      .filter((r: any) => r.date != null)
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const current = sorted.find((r: any) => String(r.date).slice(0, 10) <= date) ?? sorted[0];
    if (!current) {
      setCachedFmpInstitutionalOwnership(uppercaseSymbol, date, null, null);
      return { institutional_ownership_pct: null, institutional_ownership_change_qoq: null };
    }

    // Extract ownership pct — handle both 0-1 fraction and 0-100 scale
    const rawPct: number | null =
      typeof current.institutionalOwnershipPercentage === 'number' ? current.institutionalOwnershipPercentage :
      typeof current.percentOwned === 'number' ? current.percentOwned :
      typeof current.ownershipPercentage === 'number' ? current.ownershipPercentage :
      null;

    let ownershipPct: number | null = null;
    if (rawPct !== null) {
      ownershipPct = rawPct <= 1 ? Math.round(rawPct * 10000) / 100 : Math.round(rawPct * 100) / 100;
    }

    // QoQ change: prefer an explicit field, fall back to computing from previous quarter
    let changeQoQ: number | null = null;
    const rawChange: number | null =
      typeof current.quarterlyChange === 'number' ? current.quarterlyChange :
      typeof current.changeInOwnership === 'number' ? current.changeInOwnership :
      null;

    if (rawChange !== null) {
      changeQoQ = rawChange <= 1 && rawChange >= -1
        ? Math.round(rawChange * 10000) / 100
        : Math.round(rawChange * 100) / 100;
    } else if (ownershipPct !== null && sorted.length > 1) {
      const currentIdx = sorted.indexOf(current);
      const prior = sorted[currentIdx + 1];
      if (prior) {
        const priorRaw: number | null =
          typeof prior.institutionalOwnershipPercentage === 'number' ? prior.institutionalOwnershipPercentage :
          typeof prior.percentOwned === 'number' ? prior.percentOwned :
          typeof prior.ownershipPercentage === 'number' ? prior.ownershipPercentage :
          null;
        if (priorRaw !== null) {
          const priorPct = priorRaw <= 1 ? priorRaw * 100 : priorRaw;
          changeQoQ = Math.round((ownershipPct - priorPct) * 100) / 100;
        }
      }
    }

    setCachedFmpInstitutionalOwnership(uppercaseSymbol, date, ownershipPct, changeQoQ);
    logDataSourceFetch({
      sourceId: 'fmp',
      sourceName: 'Financial Modeling Prep',
      dataType: 'institutional_ownership',
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false
    });
    console.log(`[FMP] Institutional ownership for ${uppercaseSymbol} / ${date}: pct=${ownershipPct}, qoq_change=${changeQoQ}`);
    return { institutional_ownership_pct: ownershipPct, institutional_ownership_change_qoq: changeQoQ };
  } catch (err: any) {
    console.warn(`[FMP] getFMPInstitutionalOwnership failed for ${uppercaseSymbol}: ${err.message}`);
    return null;
  }
}

// Set once if the earnings-surprises endpoint proves unavailable on the current plan.
let _earningsSurpriseEndpointUnavailable = false;

export async function getFMPEarningsSurprise(
  symbol: string,
  date: string
): Promise<{ eps_surprise_pct: number | null; revenue_surprise_pct: number | null; earnings_date_proximity_days: number | null } | null> {
  if (_earningsSurpriseEndpointUnavailable) return null;
  if (isSourceRateLimited('fmp')) return null;

  const uppercaseSymbol = symbol.toUpperCase().trim();

  // Check per-row cache first (keeps backward compat for already-computed rows)
  const cached = getCachedFmpEarningsSurprise(uppercaseSymbol, date);
  if (cached !== null) {
    console.log(`[FMP] Earnings surprise cache hit for ${uppercaseSymbol} / ${date}`);
    return { eps_surprise_pct: cached.epsSurprisePct, revenue_surprise_pct: cached.revenueSurprisePct, earnings_date_proximity_days: cached.proximityDays };
  }

  // Check per-symbol history cache — avoids re-fetching for every row of the same symbol
  let history = getCachedEarningsHistory(uppercaseSymbol);

  if (!history) {
    // No symbol-level cache — fetch full history from FMP
    if (!checkAndIncrementFmpBudget()) return null;

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      console.warn('[FMP] Missing FMP_API_KEY — skipping earnings surprise.');
      return null;
    }

    try {
      const url = `https://financialmodelingprep.com/stable/earnings?symbol=${uppercaseSymbol}&limit=200&apikey=${apiKey}`;
      const res = await fetchWithTimeout(url);

      if (!res.ok) {
        let body = '';
        try { body = await res.text(); } catch (_) {}
        if (res.status === 403 && (body.includes('Exclusive Endpoint') || body.includes('Legacy Endpoint') || body.includes('Professional plan'))) {
          if (!_earningsSurpriseEndpointUnavailable) {
            console.warn('[FMP] earnings endpoint is not available on the current plan — disabling for this session.');
            _earningsSurpriseEndpointUnavailable = true;
          }
          return null;
        }
        if (res.status === 429) {
          markSourceRateLimited('fmp');
          console.warn('[FMP] 429 Rate limited on getFMPEarningsSurprise');
        } else if (res.status === 402) {
          console.debug(`[FMP] getFMPEarningsSurprise 402 for ${uppercaseSymbol} (not covered for this symbol) — skipping`);
        } else {
          console.debug(`[FMP] getFMPEarningsSurprise HTTP ${res.status} for ${uppercaseSymbol} — skipping`);
        }
        return null;
      }

      const data: any[] = await res.json();
      if (!Array.isArray(data)) return null;

      setCachedEarningsHistory(uppercaseSymbol, data);
      history = data;
      console.log(`[FMP] Earnings history fetched for ${uppercaseSymbol}: ${data.length} entries cached`);
    } catch (err: any) {
      console.warn(`[FMP] getFMPEarningsSurprise fetch failed for ${uppercaseSymbol}: ${err.message}`);
      return null;
    }
  }

  const eventMs = new Date(date).getTime();
  const cutoffMs = eventMs - 30 * 24 * 60 * 60 * 1000;

  const recent = history
    .filter((r: any) => {
      if (!r.date) return false;
      if (r.epsActual === null || r.epsActual === undefined) return false;
      const t = new Date(String(r.date).slice(0, 10)).getTime();
      return t >= cutoffMs && t <= eventMs;
    })
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (recent.length === 0) {
    setCachedFmpEarningsSurprise(uppercaseSymbol, date, null, null, null);
    return { eps_surprise_pct: null, revenue_surprise_pct: null, earnings_date_proximity_days: null };
  }

  const entry = recent[0];
  const earningsMs = new Date(String(entry.date).slice(0, 10)).getTime();
  const proximityDays = Math.round((eventMs - earningsMs) / (24 * 60 * 60 * 1000));

  let epsSurprisePct: number | null = null;
  const actualEps: number | null = typeof entry.epsActual === 'number' ? entry.epsActual : null;
  const estimatedEps: number | null = typeof entry.epsEstimated === 'number' ? entry.epsEstimated : null;
  if (actualEps !== null && estimatedEps !== null && estimatedEps !== 0) {
    epsSurprisePct = Math.round(((actualEps - estimatedEps) / Math.abs(estimatedEps)) * 10000) / 100;
  }

  let revenueSurprisePct: number | null = null;
  const actualRev: number | null = typeof entry.revenueActual === 'number' ? entry.revenueActual : null;
  const estimatedRev: number | null = typeof entry.revenueEstimated === 'number' ? entry.revenueEstimated : null;
  if (actualRev !== null && estimatedRev !== null && estimatedRev !== 0) {
    revenueSurprisePct = Math.round(((actualRev - estimatedRev) / Math.abs(estimatedRev)) * 10000) / 100;
  }

  setCachedFmpEarningsSurprise(uppercaseSymbol, date, epsSurprisePct, revenueSurprisePct, proximityDays);
  console.log(`[FMP] Earnings surprise for ${uppercaseSymbol} / ${date}: eps_pct=${epsSurprisePct}, rev_pct=${revenueSurprisePct}, proximity=${proximityDays}d`);
  return { eps_surprise_pct: epsSurprisePct, revenue_surprise_pct: revenueSurprisePct, earnings_date_proximity_days: proximityDays };
}

export async function getFMPAnalystGrades(
  symbol: string,
  date: string
): Promise<{ upgrades: number; downgrades: number; strongBuyCount: number; sellCount: number } | null> {
  if (isSourceRateLimited('fmp')) return null;

  const uppercaseSymbol = symbol.toUpperCase().trim();

  // Check per-row cache first (keeps backward compat for already-computed rows)
  const cached = getCachedFmpAnalystGrades(uppercaseSymbol, date);
  if (cached !== null) {
    console.log(`[FMP] Analyst grades cache hit for ${uppercaseSymbol} / ${date}`);
    return cached;
  }

  // Check per-symbol history cache — avoids re-fetching for every row of the same symbol
  let history = getCachedGradesHistory(uppercaseSymbol);

  if (!history) {
    if (!checkAndIncrementFmpBudget()) return null;

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) {
      console.warn('[FMP] Missing FMP_API_KEY — skipping analyst grades.');
      return null;
    }

    try {
      const url = `https://financialmodelingprep.com/stable/grades-historical?symbol=${uppercaseSymbol}&limit=200&apikey=${apiKey}`;
      const res = await fetchWithTimeout(url);

      if (!res.ok) {
        if (res.status === 429) {
          markSourceRateLimited('fmp');
          console.warn('[FMP] 429 Rate limited on getFMPAnalystGrades');
        } else {
          console.debug(`[FMP] getFMPAnalystGrades HTTP ${res.status} for ${uppercaseSymbol} — skipping`);
        }
        return null;
      }

      const data: any[] = await res.json();
      if (!Array.isArray(data)) return null;

      setCachedGradesHistory(uppercaseSymbol, data);
      history = data;
      console.log(`[FMP] Grades history fetched for ${uppercaseSymbol}: ${data.length} entries cached`);
    } catch (err: any) {
      console.warn(`[FMP] getFMPAnalystGrades fetch failed for ${uppercaseSymbol}: ${err.message}`);
      return null;
    }
  }

  if (history.length === 0) {
    setCachedFmpAnalystGrades(uppercaseSymbol, date, 0, 0, 0, 0);
    return { upgrades: 0, downgrades: 0, strongBuyCount: 0, sellCount: 0 };
  }

  // Find the snapshot at event date and 30 days prior
  const eventMs = new Date(date).getTime();
  const priorMs = eventMs - 30 * 24 * 60 * 60 * 1000;

  const sorted = [...history].sort((a: any, b: any) =>
    new Date(String(b.date).slice(0, 10)).getTime() - new Date(String(a.date).slice(0, 10)).getTime()
  );

  const snapshotAt = (targetMs: number) =>
    sorted.find((r: any) => r.date && new Date(String(r.date).slice(0, 10)).getTime() <= targetMs) ?? null;

  const atEvent = snapshotAt(eventMs);
  const atPrior = snapshotAt(priorMs);

  // Bullish = strongBuy + buy; Bearish = sell + strongSell
  const bullish = (r: any): number =>
    (r.analystRatingsStrongBuy ?? 0) + (r.analystRatingsBuy ?? 0);
  const bearish = (r: any): number =>
    (r.analystRatingsSell ?? 0) + (r.analystRatingsStrongSell ?? 0);

  let upgrades = 0;
  let downgrades = 0;

  if (atEvent && atPrior) {
    const bullishDelta = bullish(atEvent) - bullish(atPrior);
    const bearishDelta = bearish(atEvent) - bearish(atPrior);
    upgrades = Math.max(0, bullishDelta);
    downgrades = Math.max(0, bearishDelta);
  }

  const strongBuyCount = atEvent ? (atEvent.analystRatingsStrongBuy ?? 0) : 0;
  const sellCount = atEvent ? ((atEvent.analystRatingsSell ?? 0) + (atEvent.analystRatingsStrongSell ?? 0)) : 0;

  const result = { upgrades, downgrades, strongBuyCount, sellCount };
  setCachedFmpAnalystGrades(uppercaseSymbol, date, result.upgrades, result.downgrades, result.strongBuyCount, result.sellCount);
  console.log(`[FMP] Analyst grades for ${uppercaseSymbol} / ${date}: upgrades=${upgrades}, downgrades=${downgrades}, strongBuy=${strongBuyCount}, sell=${sellCount}`);
  return result;
}

export async function getFMPPriceTargetConsensus(
  symbol: string,
  date: string
): Promise<{ priceTargetConsensus: number | null; priceTargetHigh: number | null; priceTargetLow: number | null } | null> {
  if (!checkAndIncrementFmpBudget()) return null;
  if (isSourceRateLimited('fmp')) return null;

  const uppercaseSymbol = symbol.toUpperCase().trim();
  const startTime = Date.now();

  const cached = getCachedFmpPriceTarget(uppercaseSymbol, date);
  if (cached !== null) {
    console.log(`[FMP] Price target cache hit for ${uppercaseSymbol} / ${date}`);
    return cached;
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn('[FMP] Missing FMP_API_KEY — skipping price target consensus.');
    return null;
  }

  try {
    const url = `https://financialmodelingprep.com/stable/price-target-consensus?symbol=${uppercaseSymbol}&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url);
    const data = await handleFmpResponse(res, 'getFMPPriceTargetConsensus');

    const entry = Array.isArray(data) ? data[0] : data;
    if (!entry || typeof entry !== 'object') {
      setCachedFmpPriceTarget(uppercaseSymbol, date, null, null, null);
      return { priceTargetConsensus: null, priceTargetHigh: null, priceTargetLow: null };
    }

    const consensus: number | null = typeof entry.targetConsensus === 'number' ? entry.targetConsensus :
                                     typeof entry.priceTargetAverage === 'number' ? entry.priceTargetAverage : null;
    const high: number | null = typeof entry.targetHigh === 'number' ? entry.targetHigh :
                                typeof entry.priceTargetHigh === 'number' ? entry.priceTargetHigh : null;
    const low: number | null = typeof entry.targetLow === 'number' ? entry.targetLow :
                               typeof entry.priceTargetLow === 'number' ? entry.priceTargetLow : null;

    setCachedFmpPriceTarget(uppercaseSymbol, date, consensus, high, low);
    logDataSourceFetch({
      sourceId: 'fmp',
      sourceName: 'Financial Modeling Prep',
      dataType: 'price_target_consensus',
      symbol: uppercaseSymbol,
      fetchedAt: new Date().toISOString(),
      success: true,
      latencyMs: Date.now() - startTime,
      isFallback: false
    });
    console.log(`[FMP] Price target for ${uppercaseSymbol} / ${date}: consensus=${consensus}, high=${high}, low=${low}`);
    return { priceTargetConsensus: consensus, priceTargetHigh: high, priceTargetLow: low };
  } catch (err: any) {
    console.warn(`[FMP] getFMPPriceTargetConsensus failed for ${uppercaseSymbol}: ${err.message}`);
    return null;
  }
}
