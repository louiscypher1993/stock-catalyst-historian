import { MacroDataPoint, MacroSnapshot } from "./src/types";
import { insertFREDDataPoints, getFREDDataPoints, getCachedMacroSnapshot, setCachedMacroSnapshot } from "./db";
import { logFetch, markSourceRateLimited, isSourceRateLimited } from "./DataSourceRegistry";

const SERIES_INFO: Record<string, { name: string, units: string }> = {
  VIXCLS: { name: "CBOE Volatility Index", units: "Index" },
  FEDFUNDS: { name: "Effective Federal Funds Rate", units: "Percent" },
  CPIAUCSL: { name: "Consumer Price Index", units: "Index 1982-1984=100" },
  UNRATE: { name: "Civilian Unemployment Rate", units: "Percent" },
  DGS10: { name: "10-Year Treasury Constant Maturity Rate", units: "Percent" },
  DGS2: { name: "2-Year Treasury Constant Maturity Rate", units: "Percent" },
  BAMLH0A0HYM2: { name: "ICE BofA US High Yield Index Option-Adjusted Spread", units: "Percent" },
  DTWEXBGS: { name: "Nominal Broad US Dollar Index", units: "Index" },
  DEXINUS: { name: "India / U.S. Foreign Exchange Rate", units: "Indian Rupees to One U.S. Dollar" },
  DEXJPUS: { name: "Japan / U.S. Foreign Exchange Rate", units: "Japanese Yen to One U.S. Dollar" },
  DEXKOUS: { name: "South Korea / U.S. Foreign Exchange Rate", units: "South Korean Won to One U.S. Dollar" },
  DEXUSUK: { name: "U.S. / U.K. Foreign Exchange Rate", units: "U.S. Dollars to One British Pound Sterling" },
};

let fredQueuePromise = Promise.resolve();

export async function fetchFREDSeries(
  seriesId: string,
  fromDate: string,
  toDate: string
): Promise<MacroDataPoint[]> {
  const start = Date.now();
  
  if (isSourceRateLimited('fred')) {
    console.warn('[fred] Skipping fetch due to rate limit being hit previously.');
    return [];
  }
  
  const uppercaseSeries = seriesId.toUpperCase().trim();

  // First, check the SQLite cache
  const cachedRows = getFREDDataPoints(uppercaseSeries, fromDate, toDate);
  if (cachedRows.length > 0) {
    const seriesMeta = SERIES_INFO[uppercaseSeries] || { name: uppercaseSeries, units: "Units" };
    return cachedRows.map(row => ({
      seriesId: uppercaseSeries,
      seriesName: seriesMeta.name,
      date: row.date,
      value: row.value,
      units: row.units,
      source: "fred"
    }));
  }

  // Check if API key is present
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.warn(`[FREDService] FRED_API_KEY is not configured. Cache empty for range ${fromDate} - ${toDate} on ${uppercaseSeries}.`);
    return [];
  }

  return new Promise((resolveResolve, rejectResolve) => {
    fredQueuePromise = fredQueuePromise.then(async () => {
      try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${uppercaseSeries}&observation_start=${fromDate}&observation_end=${toDate}&api_key=${apiKey}&file_type=json&sort_order=asc`;
        let attempt = 0;
        const maxAttempts = 3;

        while (attempt < maxAttempts) {
          attempt++;
          // Sleep before making actual API call to prevent rate limiting 429s (max 120 per min usually, but concurrent bursts are bad)
          const baseDelay = attempt === 1 ? 500 : 1000 * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, baseDelay));

          try {
            const res = await fetch(url);
            if (!res.ok) {
              if (res.status === 429) {
                console.warn(`[FREDService] HTTP 429 Rate Limit Hit for ${uppercaseSeries}. Attempt ${attempt}/${maxAttempts}.`);
                if (attempt < maxAttempts) continue;
                markSourceRateLimited('fred');
              } else if (res.status === 403) {
                console.warn(`[FREDService] 403 forbidden`);
              }
              const text = await res.text();
              console.warn(`[FREDService] Request failed HTTP ${res.status}: ${text}`);
              resolveResolve([]);
              return;
            }

            const data = await res.json() as any;
            const observations = data.observations || [];
            const seriesMeta = SERIES_INFO[uppercaseSeries] || { name: uppercaseSeries, units: "Units" };

            const points: MacroDataPoint[] = observations
              .filter((o: any) => o.value !== "null" && o.value !== "." && o.value !== undefined && o.value !== null)
              .map((o: any) => ({
                seriesId: uppercaseSeries,
                seriesName: seriesMeta.name,
                date: o.date,
                value: parseFloat(o.value),
                units: seriesMeta.units,
                source: "fred"
              }))
              .filter((p: any) => !isNaN(p.value));

            // Cache the retrieved data points
            if (points.length > 0) {
              insertFREDDataPoints(points);
            }

            logFetch({
              sourceId: "fred",
              sourceName: "Federal Reserve FRED",
              dataType: "macro",
              symbol: uppercaseSeries,
              fetchedAt: new Date().toISOString(),
              coverageStart: fromDate,
              coverageEnd: toDate,
              recordCount: points.length,
              success: true,
              latencyMs: Date.now() - start,
              isFallback: false
            });

            resolveResolve(points);
            return;
          } catch (error: any) {
            if (attempt < maxAttempts && (error.message?.includes("429") || error.message?.includes("fetch failed"))) {
              console.warn(`[FREDService] Retrying due to error: ${error.message}`);
              continue;
            }
            
            logFetch({
              sourceId: "fred",
              sourceName: "Federal Reserve FRED",
              dataType: "macro",
              symbol: uppercaseSeries,
              fetchedAt: new Date().toISOString(),
              coverageStart: fromDate,
              coverageEnd: toDate,
              success: false,
              errorMessage: error.message || String(error),
              latencyMs: Date.now() - start,
              isFallback: false
            });
            if (error.message?.includes("HTTP 400") || error.message?.includes("400") || error.message?.includes("HTTP 404")) {
              console.warn(`[FREDService] Gracefully bypassed unavailable macro series ${uppercaseSeries} (does not exist on FRED).`);
            } else {
              console.error(`[FREDService] Failed to fetch macro series ${uppercaseSeries}:`, error);
            }
            resolveResolve([]);
            return;
          }
        }
        resolveResolve([]);
      } catch (err) {
        resolveResolve([]);
      }
    }).catch(() => resolveResolve([]));
  });
}

export async function getMacroSnapshot(date: string, symbol: string = ""): Promise<MacroSnapshot> {
  // Check the SQLite cache for the completed snapshot first
  const cachedSnapshot = getCachedMacroSnapshot(date);
  if (cachedSnapshot && typeof cachedSnapshot.economic_policy_uncertainty !== 'undefined') {
    return cachedSnapshot;
  }

  // Determine a 30-day window around the target date
  const target = new Date(date);
  const tMinus30 = new Date(target.getTime() - 30 * 24 * 60 * 60 * 1000);
  const tPlus30 = new Date(target.getTime() + 30 * 24 * 60 * 60 * 1000);
  const fromDate = tMinus30.toISOString().split("T")[0];
  const toDate = tPlus30.toISOString().split("T")[0];

  // For YoY calculation of CPI, we span further back to locate a point exactly 1 year ago
  const cpiFromDate = new Date(target.getTime() - (365 + 45) * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  let epuSeries = "USEPUINDXD";
  const upperSymbol = symbol.toUpperCase();
  if (upperSymbol.endsWith('.L')) epuSeries = "UKEPUINDXM";
  else if (upperSymbol.endsWith('.DE')) epuSeries = "DEUEPUINDXD";
  else if (upperSymbol.endsWith('.PA')) epuSeries = "FRAEPUINDXD";
  else if (upperSymbol.endsWith('.MI')) epuSeries = "ITAEPUINDXD";
  else if (upperSymbol.endsWith('.MC')) epuSeries = "ESPEPUINDXD";
  else if (upperSymbol.endsWith('.AS')) epuSeries = "NLDEPUINDXD";
  else if (upperSymbol.endsWith('.TO')) epuSeries = "CANEPUINDXM";
  else if (upperSymbol.endsWith('.AX')) epuSeries = "AUSEPUINDXM";
  else if (upperSymbol.endsWith('.SW')) epuSeries = "WUIMACHE";
  else if (upperSymbol.endsWith('.ST')) epuSeries = "SWEEPUINDXM";
  else if (upperSymbol.endsWith('.SI')) epuSeries = "SGPWUI";
  else if (upperSymbol.endsWith('.NS') || upperSymbol.endsWith('.BO')) epuSeries = "INDEPUINDXM";
  else if (upperSymbol.endsWith('.T')) epuSeries = "WUIJPN";
  else if (upperSymbol.endsWith('.HK') || upperSymbol.endsWith('.SZ')) epuSeries = "CHNEPUINDXD";
  else if (upperSymbol.match(/\.(VI|BR|CO|HE|IR|LS|OS|OL)$/)) epuSeries = "EUEPUINDXD";

  // Fetch all FRED series sequentially to avoid FRED API rate limits (HTTP 429)
  const vixPoints = await fetchFREDSeries("VIXCLS", fromDate, toDate);
  const fedFundsPoints = await fetchFREDSeries("FEDFUNDS", fromDate, toDate);
  const cpiPoints = await fetchFREDSeries("CPIAUCSL", cpiFromDate, toDate);
  const unratePoints = await fetchFREDSeries("UNRATE", fromDate, toDate);
  const dgs10Points = await fetchFREDSeries("DGS10", fromDate, toDate);
  const dgs2Points = await fetchFREDSeries("DGS2", fromDate, toDate);
  const creditPoints = await fetchFREDSeries("BAMLH0A0HYM2", fromDate, toDate);
  const dollarPoints = await fetchFREDSeries("DTWEXBGS", fromDate, toDate);
  const epuPoints = await fetchFREDSeries(epuSeries, fromDate, toDate);

  // Find nearest values
  const nearestVix = findNearest(vixPoints, date);
  const nearestFedFunds = findNearest(fedFundsPoints, date);
  // Filter outCPIPoints to near our target date before finding the nearest current CPI
  const validCurrentCpiPoints = cpiPoints.filter(p => {
    const t = new Date(p.date).getTime();
    return t >= target.getTime() - 45 * 24 * 60 * 60 * 1000;
  });
  const nearestCpi = findNearest(validCurrentCpiPoints, date);
  const nearestUnrate = findNearest(unratePoints, date);
  const nearestDgs10 = findNearest(dgs10Points, date);
  const nearestDgs2 = findNearest(dgs2Points, date);
  const nearestCredit = findNearest(creditPoints, date);
  const nearestDollar = findNearest(dollarPoints, date);
  const nearestEpu = findNearest(epuPoints, date);

  // Compute YoY inflation rate manually comparing to 1 year back
  let cpiYoY: number | undefined = undefined;
  if (nearestCpi) {
    const currentCpiVal = nearestCpi.value;
    const currentCpiDate = new Date(nearestCpi.date);
    const oneYearPriorTargetTime = new Date(currentCpiDate.getFullYear() - 1, currentCpiDate.getMonth(), currentCpiDate.getDate()).getTime();

    let priorCpiPoints = cpiPoints.filter(p => {
      const diff = Math.abs(new Date(p.date).getTime() - oneYearPriorTargetTime);
      return diff < 45 * 24 * 60 * 60 * 1000;
    });
    const nearestPriorCpi = findNearest(priorCpiPoints, new Date(oneYearPriorTargetTime).toISOString().split("T")[0]);

    if (nearestPriorCpi && nearestPriorCpi.value > 0) {
      cpiYoY = ((currentCpiVal - nearestPriorCpi.value) / nearestPriorCpi.value) * 100;
      cpiYoY = Math.round(cpiYoY * 100) / 100;
    }
  }

  // Compute yield curve spread
  let yieldCurvSpread: number | undefined = undefined;
  if (nearestDgs10 && nearestDgs2) {
    // 10Y minus 2Y spread (multiplied by 100 to convert to basis points, or express as raw percentage difference)
    yieldCurvSpread = nearestDgs10.value - nearestDgs2.value;
    yieldCurvSpread = Math.round(yieldCurvSpread * 100) / 100;
  }

  // Check if we retrieved actual FRED data. If absolutely empty, use beautiful fallback context to prevent crash.
  const hasRealData = !!(nearestVix || nearestFedFunds || nearestCpi || nearestUnrate || nearestDgs10 || nearestDgs2);

  const snapshot: MacroSnapshot = {
    date,
    vix: nearestVix ? Math.round(nearestVix.value * 100) / 100 : undefined,
    federalFundsRate: nearestFedFunds ? Math.round(nearestFedFunds.value * 100) / 100 : undefined,
    cpiYoY,
    unemploymentRate: nearestUnrate ? Math.round(nearestUnrate.value * 100) / 100 : undefined,
    tenYearTreasury: nearestDgs10 ? Math.round(nearestDgs10.value * 100) / 100 : undefined,
    twoYearTreasury: nearestDgs2 ? Math.round(nearestDgs2.value * 100) / 100 : undefined,
    yieldCurvSpread,
    creditSpread: nearestCredit ? Math.round(nearestCredit.value * 100) / 100 : undefined,
    dollarIndex: nearestDollar ? Math.round(nearestDollar.value * 100) / 100 : undefined,
    economic_policy_uncertainty: nearestEpu ? Math.round(nearestEpu.value * 100) / 100 : undefined,
    source: hasRealData ? "fred" : "fallback"
  };

  if (!hasRealData) {
    // Elegant baseline fallback values for demonstration if FRED API yields zero results
    snapshot.vix = 14.85;
    snapshot.federalFundsRate = 5.25;
    snapshot.cpiYoY = 3.2;
    snapshot.unemploymentRate = 3.9;
    snapshot.tenYearTreasury = 4.15;
    snapshot.twoYearTreasury = 4.45;
    snapshot.yieldCurvSpread = -0.3;
    snapshot.creditSpread = 1.18;
    snapshot.dollarIndex = 104.5;
  }

  // Cache the complete macro snapshot in SQLite
  setCachedMacroSnapshot(date, snapshot);

  return snapshot;
}

/**
 * Derives a company-level credit context proxy from the debt-to-equity (D/E) ratio
 * already available via FMP fundamentals.
 *
 * No free CDS or company credit rating source exists; this function produces a
 * rough spread estimate using industry-average leverage bands. The result is
 * clearly flagged as a proxy — it is NOT a real market spread.
 *
 * Spread bands (basis points):
 *   D/E < 0 (negative equity):  ~1200 bps — distressed proxy
 *   D/E 0 – 0.30:               ~120  bps — investment-grade proxy
 *   D/E 0.30 – 1.00:            ~200  bps — investment-grade proxy
 *   D/E 1.00 – 2.00:            ~350  bps — sub-investment-grade proxy
 *   D/E 2.00 – 5.00:            ~600  bps — high-yield proxy
 *   D/E > 5.00:                  ~900  bps — distressed-HY proxy
 */
export function getCompanyCreditContext(
  symbol: string,
  debtToEquityRatio: number | null | undefined
): { creditSpreadProxy: number; isProxy: true; derivedFrom: "debt_to_equity_ratio" } | null {
  if (debtToEquityRatio == null || !isFinite(debtToEquityRatio)) return null;

  let spreadBps: number;
  if (debtToEquityRatio < 0) {
    spreadBps = 1200;
  } else if (debtToEquityRatio < 0.3) {
    spreadBps = 120;
  } else if (debtToEquityRatio < 1.0) {
    spreadBps = 200;
  } else if (debtToEquityRatio < 2.0) {
    spreadBps = 350;
  } else if (debtToEquityRatio < 5.0) {
    spreadBps = 600;
  } else {
    spreadBps = 900;
  }

  console.log(`[FREDService] Company credit proxy for ${symbol}: D/E=${debtToEquityRatio.toFixed(2)} → ~${spreadBps} bps (proxy, not a real spread)`);
  return { creditSpreadProxy: spreadBps, isProxy: true, derivedFrom: "debt_to_equity_ratio" };
}

function findNearest(points: MacroDataPoint[], targetDateStr: string): MacroDataPoint | null {
  if (points.length === 0) return null;
  const targetTime = new Date(targetDateStr).getTime();
  let nearestPt = points[0];
  let minDiff = Math.abs(new Date(nearestPt.date).getTime() - targetTime);

  for (const pt of points) {
    const diff = Math.abs(new Date(pt.date).getTime() - targetTime);
    if (diff < minDiff) {
      minDiff = diff;
      nearestPt = pt;
    }
  }
  return nearestPt;
}

// ── F8: FX normalization for high-nominal-currency symbols ──────────────────
//
// International symbols' native-currency prices were treated as GBP
// throughout the pot ledger (position_size_gbp, unrealised_pnl, realised_pnl).
// Percentage-based returns stayed internally consistent, but share counts,
// £ position sizing, and the shares===0 entry-skip floor were all
// economically wrong for high-nominal currencies (a ¥50,000 stock "costs
// more than" a £500 allocation despite being ~£260). Deliberately scoped to
// currencies where the nominal-price mismatch is large (>~80 units per GBP)
// -- USD/EUR/AUD/CAD/CHF/etc. are within tolerance and are NOT converted,
// per the approved F8 scoping decision (see DEEP_DIVE_PROGRESS.md).
//
// General mechanism: any new high-nominal currency is picked up automatically
// the moment a symbol in that currency appears, by adding it to
// HIGH_NOMINAL_CURRENCIES + FRED_SERIES_PER_USD -- no per-symbol code change
// needed, since the suffix→currency table below is already exhaustive.

const SUFFIX_CURRENCY: Array<[RegExp, string]> = [
  [/\.L$/, 'GBP'],
  [/\.NS$|\.BO$/, 'INR'],
  [/\.T$/, 'JPY'],
  [/\.KS$/, 'KRW'],
  [/\.SS$|\.SZ$/, 'CNY'],
  [/\.HK$/, 'HKD'],
  [/\.PA$|\.DE$|\.AS$|\.MI$|\.MC$|\.BR$|\.IR$|\.LS$|\.VI$|\.HE$/, 'EUR'],
  [/\.AX$/, 'AUD'],
  [/\.TO$/, 'CAD'],
  [/\.OL$/, 'NOK'],
  [/\.SW$/, 'CHF'],
  [/\.WA$/, 'PLN'],
  [/\.MX$/, 'MXN'],
  [/\.SA$/, 'BRL'],
  [/\.RO$/, 'RON'],
  [/\.ST$/, 'SEK'],
  [/\.SI$/, 'SGD'],
  [/\.TW$/, 'TWD'],
  [/\.BK$/, 'THB'],
];

function currencyForSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  for (const [re, ccy] of SUFFIX_CURRENCY) if (re.test(upper)) return ccy;
  return 'USD'; // no recognized suffix -- bare US ticker
}

// Currencies where 1 GBP buys roughly >80 units -- an order-of-magnitude
// price-level mismatch, not just a ~20-25% one like USD/EUR. HUF/IDR/VND/CLP
// have no confirmed FRED daily series under standard naming (tested live
// 2026-07-14: DEXHUUS/DEXIDUS/DEXVNUS/DEXCLUS and the CCUSMA02* OECD-style
// alternates all return "series does not exist") -- included in the set so
// they're not silently skipped if a working series ID is found later, but
// FRED_SERIES_PER_USD has no entry for them yet, so they fall through to the
// no-conversion fallback below until one is confirmed.
const HIGH_NOMINAL_CURRENCIES = new Set(['INR', 'JPY', 'KRW', 'HUF', 'IDR', 'VND', 'CLP']);

// FRED daily FX series (H.10 release convention, {CCY} per USD). Verified
// live 2026-07-14 against real observations (INR≈95.33, JPY≈161.31,
// KRW≈1501.06, GBP≈1.3421 USD -- all plausible real-world levels).
const FRED_SERIES_PER_USD: Record<string, string> = {
  INR: 'DEXINUS',
  JPY: 'DEXJPUS',
  KRW: 'DEXKOUS',
};
const FRED_GBP_PER_USD_SERIES = 'DEXUSUK'; // named for FRED's own convention: USD per 1 GBP

/**
 * Converts a native-currency price to GBP for high-nominal currencies only
 * (see HIGH_NOMINAL_CURRENCIES above); returns the price unchanged for every
 * other currency, including GBP itself. Point-in-time correct: fetches the
 * FX rate as of `date` (nearest match within a 5-day window), not today's
 * rate, so historical entries are converted using the rate that actually
 * applied then. Never throws -- any missing series or rate falls through to
 * returning the price unconverted, with a console warning, exactly like
 * getMacroSnapshot's existing fallback behavior.
 */
export async function convertToGBPIfHighNominal(
  symbol: string,
  nativePrice: number,
  date: string
): Promise<number> {
  const ccy = currencyForSymbol(symbol);
  if (!HIGH_NOMINAL_CURRENCIES.has(ccy)) return nativePrice;

  const localSeriesId = FRED_SERIES_PER_USD[ccy];
  if (!localSeriesId) {
    console.warn(`[FX] No FRED series mapped yet for high-nominal currency ${ccy} (${symbol}) -- leaving unconverted.`);
    return nativePrice;
  }

  try {
    const target = new Date(date);
    const fromDate = new Date(target.getTime() - 5 * 86_400_000).toISOString().split('T')[0];
    const toDate = new Date(target.getTime() + 5 * 86_400_000).toISOString().split('T')[0];

    const [localPoints, gbpPoints] = await Promise.all([
      fetchFREDSeries(localSeriesId, fromDate, toDate),
      fetchFREDSeries(FRED_GBP_PER_USD_SERIES, fromDate, toDate),
    ]);

    const localRate = findNearest(localPoints, date); // {CCY} per USD
    const usdPerGbp = findNearest(gbpPoints, date);    // USD per GBP

    if (!localRate || !usdPerGbp || localRate.value <= 0 || usdPerGbp.value <= 0) {
      console.warn(`[FX] Could not resolve FX rate for ${ccy} (${symbol}) on ${date} -- leaving unconverted.`);
      return nativePrice;
    }

    return nativePrice / (localRate.value * usdPerGbp.value);
  } catch (err: any) {
    console.warn(`[FX] Conversion failed for ${ccy} (${symbol}) on ${date}: ${err.message} -- leaving unconverted.`);
    return nativePrice;
  }
}
