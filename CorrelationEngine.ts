import { fetchInternationalPriceHistory } from "./EODHDService";
import { normaliseForYahoo } from "./HistoricalEngine";

async function fetchYahooFallback(symbol: string, years: number) {
  const range = `${Math.ceil(years)}y`;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${normaliseForYahoo(symbol)}?range=${range}&interval=1d`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) return [];

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;

    const points = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] !== null && closes[i] !== undefined) {
        const timestamp = timestamps[i] * 1000;
        const date = new Date(timestamp).toISOString().split("T")[0];
        points.push({
          date,
          timestamp,
          close: closes[i],
          open: result.indicators.quote[0].open[i] || closes[i],
          high: result.indicators.quote[0].high[i] || closes[i],
          low: result.indicators.quote[0].low[i] || closes[i],
          volume: result.indicators.quote[0].volume[i] || 0
        });
      }
    }
    return points;
  } catch (err) {
    console.error(`Yahoo fetch failed for ${symbol}:`, err);
    return [];
  }
}

function computePearson(x: number[], y: number[]) {
  const n = x.length;
  if (n === 0 || n !== y.length) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denominator === 0) return 0;
  return numerator / denominator;
}

export async function computeCompetitorImpact(targetSymbol: string, competitorSymbol: string, years: number = 2) {
  const toDate = new Date().toISOString().split("T")[0];
  const fromDate = new Date(Date.now() - years * 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  let targetHistory = await fetchInternationalPriceHistory(targetSymbol, fromDate, toDate);
  if (!targetHistory || !targetHistory.length) {
    targetHistory = await fetchYahooFallback(targetSymbol, years);
  }

  let compHistory = await fetchInternationalPriceHistory(competitorSymbol, fromDate, toDate);
  if (!compHistory || !compHistory.length) {
    compHistory = await fetchYahooFallback(competitorSymbol, years);
  }

  if (!targetHistory.length || !compHistory.length) {
    throw new Error(`Missing historical data for one or both symbols. Found target: ${targetHistory.length}, comp: ${compHistory.length}`);
  }

  // Create maps for quick date lookup
  const targetMap = new Map<string, any>();
  for (const t of targetHistory) targetMap.set(t.date, t);

  const compMap = new Map<string, any>();
  for (const c of compHistory) compMap.set(c.date, c);

  // Align dates
  const alignedDates = [];
  const targetReturns = [];
  const compReturns = [];
  
  const compEvents = [];

  // Assuming sorted descending
  for (let i = 0; i < compHistory.length - 1; i++) {
    const cToday = compHistory[i];
    const cPrev = compHistory[i + 1];
    
    // We need exact dates in targetMap
    const tToday = targetMap.get(cToday.date);
    const tPrev = targetMap.get(cPrev.date);
    
    if (tToday && tPrev && cPrev.close > 0 && tPrev.close > 0) {
      const cRet = (cToday.close - cPrev.close) / cPrev.close;
      const tRet = (tToday.close - tPrev.close) / tPrev.close;

      alignedDates.push(cToday.date);
      targetReturns.push(tRet);
      compReturns.push(cRet);

      compEvents.push({
        date: cToday.date,
        competitorReturn: cRet * 100,
        targetReturn: tRet * 100,
      });
    }
  }

  const correlation = computePearson(compReturns, targetReturns);

  // Find the top 5 days where competitor moved the most
  compEvents.sort((a, b) => Math.abs(b.competitorReturn) - Math.abs(a.competitorReturn));
  const topEvents = compEvents.slice(0, 7);

  // Also calculate beta = Covariance(target, comp) / Variance(comp)
  // Or beta against competitor
  let expectedImpactScale = 0;
  if (compReturns.length > 0) {
    // slope of linear regression
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    const n = compReturns.length;
    for (let i = 0; i < n; i++) {
      sumX += compReturns[i];
      sumY += targetReturns[i];
      sumXY += compReturns[i] * targetReturns[i];
      sumX2 += compReturns[i] * compReturns[i];
    }
    const varianceComp = (n * sumX2 - sumX * sumX) / (n * (n - 1) + 0.0000001);
    const covariance = (n * sumXY - sumX * sumY) / (n * (n - 1) + 0.0000001);
    if (varianceComp !== 0) {
      expectedImpactScale = covariance / varianceComp;
    }
  }

  return {
    correlation,
    alignedDataPoints: alignedDates.length,
    beta: expectedImpactScale,
    topEvents
  };
}
