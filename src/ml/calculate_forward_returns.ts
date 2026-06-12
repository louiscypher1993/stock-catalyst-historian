import { db } from '../../db';

const YAHOO_REQUEST_DELAY_MS = 75;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch full daily price history for a symbol from Yahoo Finance
async function fetchYahooHistory(symbol: string): Promise<Map<string, number>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=35y`;
  const priceMap = new Map<string, number>();

  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) return priceMap;

  const data: any = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) return priceMap;

  const timestamps: number[] = result.timestamp ?? [];
  const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close === null || close === undefined) continue;
    const dateKey = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    priceMap.set(dateKey, close);
  }

  return priceMap;
}

// Find the closing price on or after a target date (nearest trading day)
function findNearestPrice(priceMap: Map<string, number>, targetDate: Date, maxDaysForward = 10): number | null {
  for (let i = 0; i <= maxDaysForward; i++) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    if (priceMap.has(key)) return priceMap.get(key)!;
  }
  return null;
}

async function calculateForwardReturns() {
  // Get all rows missing any of the 3 new columns
  const rows = db.prepare(`
    SELECT cache_key, symbol, date, features_json
    FROM event_features
    WHERE forward_return_3m IS NULL
       OR forward_return_6m IS NULL
       OR forward_return_12m IS NULL
       OR forward_return_2d IS NULL
       OR forward_return_3d IS NULL
       OR forward_return_2w IS NULL
  `).all() as { cache_key: string; symbol: string; date: string; features_json: string }[];

  console.log(`[ForwardReturns] Processing ${rows.length} rows across symbols...`);

  // Group by symbol to minimise Yahoo fetches
  const bySymbol = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, []);
    bySymbol.get(row.symbol)!.push(row);
  }

  const updateStmt = db.prepare(`
    UPDATE event_features
    SET forward_return_3m = ?, forward_return_6m = ?, forward_return_12m = ?, features_json = ?
    WHERE cache_key = ?
  `);

  const updateShortTermStmt = db.prepare(`
    UPDATE event_features SET
      forward_return_2d = ?, forward_return_3d = ?, forward_return_2w = ?
    WHERE cache_key = ?
      AND forward_return_2d IS NULL
      AND forward_return_3d IS NULL
      AND forward_return_2w IS NULL
  `);

  let processed = 0;
  let errors = 0;
  let symbolsDone = 0;

  for (const [symbol, symbolRows] of bySymbol) {
    try {
      const priceMap = await fetchYahooHistory(symbol);
      if (priceMap.size === 0) {
        errors++;
        continue;
      }

      const updateRows = db.transaction((rowsForSymbol: typeof symbolRows) => {
        for (const row of rowsForSymbol) {
          const features = JSON.parse(row.features_json);
          const eventDate = new Date(row.date);
          const eventPrice = priceMap.get(row.date) ?? findNearestPrice(priceMap, eventDate, 5);
          if (!eventPrice) continue;

          const date3m = new Date(eventDate); date3m.setDate(date3m.getDate() + 91);
          const date6m = new Date(eventDate); date6m.setDate(date6m.getDate() + 182);
          const date12m = new Date(eventDate); date12m.setDate(date12m.getDate() + 365);
          const date2d = new Date(eventDate); date2d.setDate(date2d.getDate() + 2);
          const date3d = new Date(eventDate); date3d.setDate(date3d.getDate() + 3);
          const date2w = new Date(eventDate); date2w.setDate(date2w.getDate() + 10);

          const price3m = findNearestPrice(priceMap, date3m);
          const price6m = findNearestPrice(priceMap, date6m);
          const price12m = findNearestPrice(priceMap, date12m);
          const price2d = findNearestPrice(priceMap, date2d);
          const price3d = findNearestPrice(priceMap, date3d);
          const price2w = findNearestPrice(priceMap, date2w);

          const fr3m = price3m ? (price3m - eventPrice) / eventPrice : null;
          const fr6m = price6m ? (price6m - eventPrice) / eventPrice : null;
          const fr12m = price12m ? (price12m - eventPrice) / eventPrice : null;
          const fr2d = price2d ? (price2d - eventPrice) / eventPrice : null;
          const fr3d = price3d ? (price3d - eventPrice) / eventPrice : null;
          const fr2w = price2w ? (price2w - eventPrice) / eventPrice : null;

          features.forward_return_3m = fr3m;
          features.forward_return_6m = fr6m;
          features.forward_return_12m = fr12m;
          features.forward_return_2d = fr2d;
          features.forward_return_3d = fr3d;
          features.forward_return_2w = fr2w;

          updateStmt.run(fr3m, fr6m, fr12m, JSON.stringify(features), row.cache_key);
          updateShortTermStmt.run(fr2d ?? null, fr3d ?? null, fr2w ?? null, row.cache_key);
          processed++;
        }
      });

      updateRows(symbolRows);

      symbolsDone++;
      if (symbolsDone % 100 === 0) console.log(`[ForwardReturns] ${symbolsDone}/${bySymbol.size} symbols, ${processed}/${rows.length} rows updated`);
    } catch (err: any) {
      console.warn(`[ForwardReturns] Error for ${symbol}: ${err.message}`);
      errors++;
    }

    await sleep(YAHOO_REQUEST_DELAY_MS);
  }

  console.log(`[ForwardReturns] Done. ${processed} rows updated, ${errors} symbol errors.`);

  // Report fill rates
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN forward_return_3m IS NOT NULL THEN 1 ELSE 0 END) as has_3m,
      SUM(CASE WHEN forward_return_6m IS NOT NULL THEN 1 ELSE 0 END) as has_6m,
      SUM(CASE WHEN forward_return_12m IS NOT NULL THEN 1 ELSE 0 END) as has_12m
    FROM event_features
  `).get() as any;
  console.log(`[ForwardReturns] Fill rates — 3m: ${(stats.has_3m/stats.total*100).toFixed(1)}%, 6m: ${(stats.has_6m/stats.total*100).toFixed(1)}%, 12m: ${(stats.has_12m/stats.total*100).toFixed(1)}%`);
}

calculateForwardReturns().catch(console.error);
