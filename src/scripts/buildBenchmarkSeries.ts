/**
 * buildBenchmarkSeries.ts — daily local-index history for the async-close fix.
 *
 * WHY. `excess_return` is `dailyReturn - beta*benchmarkReturn(SAME DATE)`, and for
 * 24.4% of training rows that same-date benchmark had not closed yet when the
 * symbol did — up to 15.5h of future information (Taiwan/Japan/Korea/China vs
 * ^GSPC). Rebuilding those features point-in-time-correctly needs a benchmark that
 * closes AT OR BEFORE each symbol, per market, as a daily series.
 *
 * ALL 31 MARKETS HAVE A LIVE LOCAL INDEX (probed 2026-07-31), so the primary path
 * is same-session: a Tokyo name hedged against ^N225 has no timing gap at all. That
 * is strictly better than lagging a foreign index, because it keeps the same-day
 * market co-movement that the feature is meant to remove.
 *
 * SIXTEEN INDICES START AFTER 1995, so rows older than their local index still need
 * the fallback: ^GSPC LAGGED one trading day, which is always point-in-time safe
 * (yesterday's US close is known before any market opens today). Coverage per index
 * is reported so the re-derivation can pick per row rather than per market.
 *
 * WRITES TO A NEW TABLE ONLY (`benchmark_prices`). It does not touch daily_prices,
 * any fmp_* table, or event_features — market_cache.db holds ~502,507 rows of
 * expired-FMP-premium data that cannot be re-fetched, so new data goes in new
 * tables.
 *
 * GRANULARITY GUARD, learned the hard way: `range=max` silently ignores
 * `interval=1d` and returns 3mo/weekly bars that look entirely plausible. This uses
 * period1/period2 and additionally measures the median gap between bars, rejecting
 * anything that is not daily rather than storing convincing garbage.
 *
 * Usage:
 *   npx tsx src/scripts/buildBenchmarkSeries.ts
 *   npx tsx src/scripts/buildBenchmarkSeries.ts --limit 5
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'market_cache.db');
const REQUEST_DELAY_MS = 250;
const PERIOD_START = Math.floor(new Date('1960-01-01T00:00:00Z').getTime() / 1000);

/**
 * Market suffix -> same-session benchmark. Every entry was probed live on
 * 2026-07-31; `since` is where Yahoo's daily history actually begins, which is what
 * decides when a row must fall back to lagged ^GSPC.
 */
export const BENCHMARK_REGISTRY: Record<string, { ticker: string; since: string }> = {
  'US': { ticker: '^GSPC', since: '1984-12-01' },
  '.L': { ticker: '^FTSE', since: '1985-01-01' },
  '.TO': { ticker: '^GSPTSE', since: '1984-12-01' },
  '.AX': { ticker: '^AXJO', since: '1992-11-30' },
  '.HK': { ticker: '^HSI', since: '1986-11-30' },
  '.NS': { ticker: '^NSEI', since: '2007-09-30' },
  '.BO': { ticker: '^BSESN', since: '1997-06-30' },
  '.PA': { ticker: '^FCHI', since: '1990-02-28' },
  '.DE': { ticker: '^GDAXI', since: '1987-11-30' },
  '.SI': { ticker: '^STI', since: '1987-11-30' },
  '.SW': { ticker: '^SSMI', since: '1990-11-30' },
  '.ST': { ticker: '^OMX', since: '2008-11-30' },
  '.T': { ticker: '^N225', since: '1984-12-31' },
  '.SS': { ticker: '000001.SS', since: '1997-07-31' },
  '.SZ': { ticker: '399001.SZ', since: '1997-08-31' },
  '.KS': { ticker: '^KS11', since: '1996-12-31' },
  '.KQ': { ticker: '^KQ11', since: '2000-10-31' },
  '.TW': { ticker: '^TWII', since: '1997-07-31' },
  '.SA': { ticker: '^BVSP', since: '1993-05-01' },
  '.MX': { ticker: '^MXX', since: '1991-12-01' },
  '.AS': { ticker: '^AEX', since: '1992-10-31' },
  '.BR': { ticker: '^BFX', since: '1991-04-30' },
  '.LS': { ticker: 'PSI20.LS', since: '2013-04-30' },
  '.MC': { ticker: '^IBEX', since: '1993-07-31' },
  '.IR': { ticker: '^ISEQ', since: '1997-07-31' },
  '.MI': { ticker: 'FTSEMIB.MI', since: '1997-12-31' },
  '.SR': { ticker: '^TASI.SR', since: '1998-10-31' },
  '.IS': { ticker: 'XU100.IS', since: '1997-06-30' },
  '.CO': { ticker: '^OMXC25', since: '2017-01-01' },
  '.OL': { ticker: '^OSEAX', since: '2013-03-31' },
  '.HE': { ticker: '^OMXH25', since: '2013-03-31' },
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Never trust meta.dataGranularity — measure the actual spacing. */
function isDaily(ts: number[], granularity: string | undefined): boolean {
  if (granularity && granularity !== '1d') return false;
  if (ts.length < 10) return true;
  const gaps: number[] = [];
  for (let i = 1; i < Math.min(ts.length, 200); i++) gaps.push((ts[i] - ts[i - 1]) / 86400);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] <= 4;
}

async function fetchIndex(ticker: string, attempt = 1): Promise<Array<{ date: string; close: number }> | null> {
  try {
    const p2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${PERIOD_START}&period2=${p2}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) return null;
    const j: any = await res.json();
    const r = j?.chart?.result?.[0];
    if (!r?.timestamp) return null;
    if (!isDaily(r.timestamp, r.meta?.dataGranularity)) {
      console.warn(`  ${ticker}: REJECTED — not daily (granularity=${r.meta?.dataGranularity})`);
      return null;
    }
    const closes: Array<number | null> = r.indicators?.quote?.[0]?.close ?? [];
    const out: Array<{ date: string; close: number }> = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      out.push({ date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), close: c });
    }
    return out;
  } catch (e) {
    if (attempt >= 3) { console.warn(`  ${ticker} failed after ${attempt}: ${e}`); return null; }
    await sleep(1500 * attempt);
    return fetchIndex(ticker, attempt + 1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

  const db = new Database(DB_PATH);
  // NEW table — nothing existing is touched.
  db.exec(`CREATE TABLE IF NOT EXISTS benchmark_prices (
      ticker TEXT NOT NULL,
      date   TEXT NOT NULL,
      close  REAL NOT NULL,
      source TEXT DEFAULT 'yahoo',
      PRIMARY KEY (ticker, date)
    );
    CREATE INDEX IF NOT EXISTS idx_benchmark_prices_ticker ON benchmark_prices(ticker);`);

  const insert = db.prepare(`INSERT OR IGNORE INTO benchmark_prices (ticker, date, close, source)
                             VALUES (?, ?, ?, 'yahoo')`);
  const insertMany = db.transaction((ticker: string, rows: Array<{ date: string; close: number }>) => {
    let n = 0;
    for (const r of rows) n += insert.run(ticker, r.date, r.close).changes;
    return n;
  });

  // dedupe: several markets share an index (.NS/.BO, and ^GSPC is also the fallback)
  const tickers = [...new Set(Object.values(BENCHMARK_REGISTRY).map(v => v.ticker))];
  const todo = limit === Infinity ? tickers : tickers.slice(0, limit);
  console.log(`Benchmark indices: ${tickers.length} distinct across ${Object.keys(BENCHMARK_REGISTRY).length} markets (fetching ${todo.length})`);

  let added = 0, failed = 0;
  const summary: Array<{ ticker: string; bars: number; from: string; to: string }> = [];
  for (const t of todo) {
    const bars = await fetchIndex(t);
    await sleep(REQUEST_DELAY_MS);
    if (!bars || !bars.length) { failed++; console.log(`   ${t.padEnd(12)} no data`); continue; }
    const n = insertMany(t, bars);
    added += n;
    summary.push({ ticker: t, bars: bars.length, from: bars[0].date, to: bars[bars.length - 1].date });
    console.log(`   ${t.padEnd(12)} ${String(bars.length).padStart(6)} bars  ${bars[0].date} -> ${bars[bars.length - 1].date}  (+${n} new)`);
  }

  const total = db.prepare('SELECT COUNT(*) c FROM benchmark_prices').get() as { c: number };
  console.log(`\nrows inserted: ${added.toLocaleString()}   failed indices: ${failed}`);
  console.log(`benchmark_prices now holds ${total.c.toLocaleString()} rows across ${summary.length} indices`);

  // Which markets cannot use their local index for the oldest rows?
  console.log('\nmarkets whose local index starts after 1995 (older rows need lagged ^GSPC):');
  for (const [mkt, v] of Object.entries(BENCHMARK_REGISTRY)) {
    const s = summary.find(x => x.ticker === v.ticker);
    if (s && s.from > '1995-01-01') console.log(`   ${mkt.padEnd(6)} ${v.ticker.padEnd(12)} from ${s.from}`);
  }
  db.close();
}

main().catch(e => { console.error('[Benchmarks] FATAL:', e); process.exit(1); });
