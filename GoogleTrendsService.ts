import googleTrends from 'google-trends-api';
import { TrendsDataPoint, TrendsSummary } from "./src/types";
import { logFetch, googleTrendsThrottler } from "./DataSourceRegistry";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let rateLimitedUntil = 0;

export function isGoogleTrendsRateLimited(): boolean {
  return Date.now() < rateLimitedUntil;
}

export async function getSearchTrends(
  symbol: string,
  companyName: string,
  fromDate: string,
  toDate: string
): Promise<TrendsDataPoint[]> {
  const start = Date.now();
  const symbolUpper = symbol.toUpperCase().trim();

  if (isGoogleTrendsRateLimited()) {
    return [];
  }

  try {
    // Random 2-5 second delay before each Trends call to reduce CAPTCHA-blocking
    // on bulk historical queries
    await delay(2000 + Math.random() * 3000);

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('<html> timeout — Google Trends hung')), 10000)
    );
    const rawResultStr = await googleTrendsThrottler.enqueue<string>(
      () => Promise.race([
        googleTrends.interestOverTime({ keyword: companyName, startTime: new Date(fromDate), endTime: new Date(toDate), geo: "US" }),
        timeout
      ]) as Promise<string>,
      2500
    );

    if (!rawResultStr) {
      return [];
    }

    const parsed = JSON.parse(rawResultStr);
    const timeline = parsed?.default?.timelineData || [];

    const points: TrendsDataPoint[] = timeline.map((item: any) => {
      let val = 0;
      if (Array.isArray(item.value)) {
        val = Number(item.value[0] ?? 0);
      } else if (item.value !== undefined) {
        val = Number(item.value);
      }

      let timestamp = Number(item.time) * 1000;
      let dateStr = "";
      if (!isNaN(timestamp) && timestamp > 0) {
        dateStr = new Date(timestamp).toISOString().split('T')[0];
      } else {
        const possibleDate = new Date(item.formattedAxisTime || item.formattedTime || "");
        if (!isNaN(possibleDate.getTime())) {
          dateStr = possibleDate.toISOString().split('T')[0];
        }
      }

      return {
        date: dateStr,
        value: isNaN(val) ? 0 : val,
        keyword: companyName
      };
    }).filter((p: any) => p.date !== "");

    logFetch({
      sourceId: "google_trends",
      sourceName: "Google Trends API",
      dataType: "google_trends",
      symbol: symbolUpper,
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      recordCount: points.length,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    return points;
  } catch (err: any) {
    if (err?.requestBody?.includes('429') || String(err).includes('429') || err?.requestBody?.includes('<html') || String(err?.message).includes('<html')) {
      rateLimitedUntil = Date.now() + 4 * 60 * 60 * 1000;
      console.warn(`[GoogleTrendsService] Blocked by Google (rate limit/CAPTCHA) — skipping Google Trends for 4 hours.`);
    }
    console.error(`[GoogleTrendsService] Error fetching trends for ${companyName}:`, err);
    logFetch({
      sourceId: "google_trends",
      sourceName: "Google Trends API",
      dataType: "google_trends",
      symbol: symbolUpper,
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      recordCount: 0,
      success: false,
      latencyMs: Date.now() - start,
      isFallback: false,
      errorMessage: err.message || String(err)
    });
    return [];
  }
}

export async function getTrendsSummary(
  symbol: string,
  companyName: string,
  anomalyDate: string
): Promise<TrendsSummary | null> {
  // Google Trends has no reliable data before 2004, and CAPTCHA-blocks
  // bulk historical queries on pre-2010 dates
  const eventDateObj = new Date(anomalyDate);
  if (eventDateObj.getFullYear() < 2010) {
    return null; // Write null sentinel in backfill, don't waste API call
  }

  const symbolUpper = symbol.toUpperCase().trim();

  // 60-day window centered on anomalyDate (30 days before to 30 days after)
  const d = new Date(anomalyDate + "T00:00:00Z");
  const startTime = new Date(d.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endTime = new Date(d.getTime() + 30 * 24 * 60 * 60 * 1000);
  const fromDate = startTime.toISOString().split('T')[0];
  const toDate = endTime.toISOString().split('T')[0];

  const points = await getSearchTrends(symbolUpper, companyName, fromDate, toDate);

  if (!points || points.length < 5) {
    return null;
  }

  let peakSearchValue = -1;
  let peakSearchDate = "";
  for (const p of points) {
    if (p.value > peakSearchValue) {
      peakSearchValue = p.value;
      peakSearchDate = p.date;
    }
  }

  const averageSearchValue = points.reduce((s, p) => s + p.value, 0) / points.length;

  const anomalyPoint = points.find(p => p.date === anomalyDate);
  const searchValueAtAnomaly = anomalyPoint ? anomalyPoint.value : 0;

  // Find value day before
  const prevObj = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  const dayBeforeDateStr = prevObj.toISOString().split('T')[0];
  
  const sortedPoints = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const anomalyIndex = sortedPoints.findIndex(p => p.date === anomalyDate);
  let searchValueDayBefore = 0;
  if (anomalyIndex > 0) {
    searchValueDayBefore = sortedPoints[anomalyIndex - 1].value;
  } else {
    const dayBeforePoint = points.find(p => p.date === dayBeforeDateStr);
    searchValueDayBefore = dayBeforePoint ? dayBeforePoint.value : 0;
  }

  // Baseline is search volume in the 30 days BEFORE the anomaly date
  const baselinePoints = points.filter(p => p.date < anomalyDate);
  const baselineAverage = baselinePoints.length > 0
    ? baselinePoints.reduce((s, p) => s + p.value, 0) / baselinePoints.length
    : averageSearchValue;

  const isAboveBaseline = searchValueAtAnomaly > baselineAverage;
  
  let percentAboveBaseline = 0;
  let google_trends_shock_ratio = 1;

  if (baselineAverage > 0) {
    percentAboveBaseline = ((searchValueAtAnomaly - baselineAverage) / baselineAverage) * 100;
    google_trends_shock_ratio = searchValueAtAnomaly / baselineAverage;
  } else if (searchValueAtAnomaly > 0) {
    percentAboveBaseline = 100;
    google_trends_shock_ratio = Infinity; // Or some max cap like 100
  }

  return {
    symbol: symbolUpper,
    companyName,
    fromDate,
    toDate,
    peakSearchDate,
    peakSearchValue,
    averageSearchValue,
    searchValueAtAnomaly,
    searchValueDayBefore,
    isAboveBaseline,
    percentAboveBaseline,
    google_trends_shock_ratio,
    source: "google_trends"
  };
}
