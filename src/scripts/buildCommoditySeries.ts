/**
 * buildCommoditySeries.ts — daily commodity history for the excess_return term.
 *
 * THE DEFECT THIS FIXES. `excess_return` subtracts `commodityBeta * commodityReturn`
 * for certain sectors (SECTOR_COMMODITY_MAP, HistoricalEngine.ts:132). The cached
 * FRED series only start 2021-06, so for Airlines/Transport/Energy/Utilities the
 * term is ABSENT before June 2021 and ACTIVE after — roughly 36%/64% of rows, split
 * cleanly by date. A feature whose presence encodes WHEN rather than WHAT is a date
 * proxy, the same failure class as the silent-zero benchmark and the VIX
 * geography proxy.
 *
 * OIL — the fix is just more history. FRED `DCOILWTICO` (already the series the code
 * asks for) runs daily back to 1986-01-02, 10,210 observations, covering ~99.9% of
 * training rows. Same series id, so no semantic change: this restores the intended
 * behaviour rather than altering it.
 *
 * COPPER — deliberately NOT activated. `PCOPPUSDM` is MONTHLY (414 obs, ~31-day
 * spacing), and a 60-trading-day beta window contains ~3 monthly points, so
 * HistoricalEngine's `cBenchReturns.length >= 10` guard never passes and
 * `commodityBeta` stays at its 0 initialiser. The copper term has therefore been
 * INERT in every model to date. Switching it to a daily source would ACTIVATE a
 * feature that has never been live — a behaviour change, not a bug fix — so v11
 * keeps it inert for clean attribution. Yahoo `HG=F` (daily from 2000-08-30) is
 * fetched and stored anyway so it is ready as a v12 candidate at no extra cost.
 *
 * Writes to the same `benchmark_prices` table (a generic ticker/date/close store).
 * Touches no existing table, no fmp_* data, no event_features.
 *
 * Usage:
 *   npx tsx src/scripts/buildCommoditySeries.ts
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'market_cache.db');
const PERIOD_START = Math.floor(new Date('1960-01-01T00:00:00Z').getTime() / 1000);

// FRED series used by excess_return today (id kept identical on purpose).
const FRED_SERIES = ['DCOILWTICO'];
// Daily alternatives stored for later evaluation; NOT wired into v11.
const YAHOO_SERIES = ['HG=F', 'CL=F'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function medianGapDays(dates: string[]): number {
  if (dates.length < 10) return 1;
  const g: number[] = [];
  for (let i = 1; i < Math.min(dates.length, 200); i++) {
    g.push((new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000);
  }
  g.sort((a, b) => a - b);
  return g[Math.floor(g.length / 2)];
}

async function fetchFred(seriesId: string): Promise<Array<{ date: string; close: number }> | null> {
  const key = process.env.FRED_API_KEY;
  if (!key) { console.error('[Commodity] FRED_API_KEY missing'); return null; }
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${key}&file_type=json&observation_start=1960-01-01`;
  const res = await fetch(url, { signal: AbortSignal.timeout(40000) });
  if (!res.ok) { console.warn(`  ${seriesId}: HTTP ${res.status}`); return null; }
  const j: any = await res.json();
  const obs = (j.observations ?? []).filter((o: any) => o.value !== '.' && o.value !== '');
  return obs.map((o: any) => ({ date: o.date, close: Number(o.value) })).filter((o: any) => Number.isFinite(o.close));
}

async function fetchYahoo(ticker: string): Promise<Array<{ date: string; close: number }> | null> {
  const p2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${PERIOD_START}&period2=${p2}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.warn(`  ${ticker}: HTTP ${res.status}`); return null; }
  const j: any = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r?.timestamp) return null;
  if (r.meta?.dataGranularity && r.meta.dataGranularity !== '1d') {
    console.warn(`  ${ticker}: REJECTED — granularity ${r.meta.dataGranularity}`);
    return null;
  }
  const cl: Array<number | null> = r.indicators?.quote?.[0]?.close ?? [];
  const out: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (cl[i] == null) continue;
    out.push({ date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), close: cl[i]! });
  }
  return out;
}

async function main() {
  const db = new Database(DB_PATH);
  db.exec(`CREATE TABLE IF NOT EXISTS benchmark_prices (
      ticker TEXT NOT NULL, date TEXT NOT NULL, close REAL NOT NULL,
      source TEXT DEFAULT 'yahoo', PRIMARY KEY (ticker, date));`);

  const insert = db.prepare(`INSERT OR IGNORE INTO benchmark_prices (ticker, date, close, source) VALUES (?, ?, ?, ?)`);
  const insertMany = db.transaction((ticker: string, src: string, rows: Array<{ date: string; close: number }>) => {
    let n = 0;
    for (const r of rows) n += insert.run(ticker, r.date, r.close, src).changes;
    return n;
  });

  console.log('=== FRED (wired into excess_return) ===');
  for (const sid of FRED_SERIES) {
    const rows = await fetchFred(sid);
    await sleep(400);
    if (!rows?.length) { console.log(`   ${sid}: no data`); continue; }
    const gap = medianGapDays(rows.map(r => r.date));
    if (gap > 4) { console.warn(`   ${sid}: REJECTED — median gap ${gap}d, not daily`); continue; }
    const added = insertMany(sid, 'fred', rows);
    console.log(`   ${sid.padEnd(14)} ${String(rows.length).padStart(6)} obs  ${rows[0].date} -> ${rows[rows.length - 1].date}  gap ${gap}d  (+${added} new)`);
  }

  console.log('\n=== Yahoo (stored for evaluation, NOT wired into v11) ===');
  for (const t of YAHOO_SERIES) {
    const rows = await fetchYahoo(t);
    await sleep(300);
    if (!rows?.length) { console.log(`   ${t}: no data`); continue; }
    const gap = medianGapDays(rows.map(r => r.date));
    if (gap > 4) { console.warn(`   ${t}: REJECTED — median gap ${gap}d`); continue; }
    const added = insertMany(t, 'yahoo', rows);
    console.log(`   ${t.padEnd(14)} ${String(rows.length).padStart(6)} bars ${rows[0].date} -> ${rows[rows.length - 1].date}  gap ${gap}d  (+${added} new)`);
  }

  const total = db.prepare('SELECT COUNT(*) c FROM benchmark_prices').get() as { c: number };
  const byTicker = db.prepare(`SELECT ticker, COUNT(*) n, MIN(date) lo FROM benchmark_prices
                               WHERE ticker IN ('DCOILWTICO','HG=F','CL=F') GROUP BY ticker`).all();
  console.log(`\nbenchmark_prices total: ${total.c.toLocaleString()} rows`);
  for (const r of byTicker as any[]) console.log(`   ${r.ticker.padEnd(14)} ${String(r.n).padStart(6)} rows from ${r.lo}`);
  db.close();
}

main().catch(e => { console.error('[Commodity] FATAL:', e); process.exit(1); });
