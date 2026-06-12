import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'market_cache.db');
const db = new Database(DB_PATH);
const DELAY_MS = 300;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Bar { date: string; close: number; volume: number; }

async function fetchYahooHistory(symbol: string): Promise<Bar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return [];
  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().split('T')[0],
    close: quote.close?.[i],
    volume: quote.volume?.[i],
  })).filter((b: any) => b.close != null && b.volume != null);
}

function computePreReturns(bars: Bar[], eventDate: string) {
  const idx = bars.findIndex(b => b.date >= eventDate);
  if (idx < 22) return null; // not enough pre-anomaly history
  const dayBefore = bars[idx - 1].close;
  const ret = (n: number) => {
    const base = bars[idx - 1 - n]?.close;
    return base ? (dayBefore - base) / base : null;
  };
  const vol30 = bars.slice(Math.max(0, idx - 31), idx - 1);
  const vol30Avg = vol30.length > 0 ? vol30.reduce((s, b) => s + b.volume, 0) / vol30.length : null;
  const volRatio = (n: number) => {
    if (!vol30Avg || vol30Avg === 0) return null;
    const w = bars.slice(Math.max(0, idx - 1 - n), idx - 1);
    return w.length > 0 ? (w.reduce((s, b) => s + b.volume, 0) / w.length) / vol30Avg : null;
  };
  return {
    pre_return_3d: ret(3), pre_return_5d: ret(5),
    pre_return_10d: ret(10), pre_return_21d: ret(21),
    pre_vol_ratio_5d: volRatio(5), pre_vol_ratio_10d: volRatio(10),
  };
}

export async function main() {
  // Get all symbols that have at least one event missing backward features
  const symbols: { symbol: string }[] = db.prepare(`
    SELECT DISTINCT symbol FROM event_features
    WHERE pre_return_5d IS NULL AND is_null_sample = 0
    ORDER BY symbol
  `).all() as { symbol: string }[];

  console.log(`[BackfillPreReturns] ${symbols.length} symbols to process`);
  const updateStmt = db.prepare(`
    UPDATE event_features SET
      pre_return_3d=?, pre_return_5d=?, pre_return_10d=?,
      pre_return_21d=?, pre_vol_ratio_5d=?, pre_vol_ratio_10d=?
    WHERE cache_key=? AND pre_return_5d IS NULL
  `);

  for (let i = 0; i < symbols.length; i++) {
    const { symbol } = symbols[i];
    try {
      const bars = await fetchYahooHistory(symbol);
      if (bars.length < 30) { console.log(`[BackfillPreReturns] Skipping ${symbol} — insufficient history`); continue; }

      const events: { cache_key: string; date: string }[] = db.prepare(`
        SELECT cache_key, date FROM event_features
        WHERE symbol = ? AND pre_return_5d IS NULL AND is_null_sample = 0
      `).all(symbol) as { cache_key: string; date: string }[];

      let updated = 0;
      for (const ev of events) {
        const pre = computePreReturns(bars, ev.date);
        if (!pre) continue;
        updateStmt.run(
          pre.pre_return_3d, pre.pre_return_5d, pre.pre_return_10d,
          pre.pre_return_21d, pre.pre_vol_ratio_5d, pre.pre_vol_ratio_10d,
          ev.cache_key
        );
        updated++;
      }
      console.log(`[BackfillPreReturns] ${i + 1}/${symbols.length} ${symbol}: updated ${updated}/${events.length} events`);
      await sleep(DELAY_MS);
    } catch (err: any) {
      console.error(`[BackfillPreReturns] Error for ${symbol}:`, err.message);
      await sleep(DELAY_MS);
    }
  }
  console.log('[BackfillPreReturns] Done.');
}

main().catch(console.error);