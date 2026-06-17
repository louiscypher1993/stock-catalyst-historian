import 'dotenv/config';
import { db } from '../../db';
import * as fs from 'fs';

const FMP_KEY = process.env.FMP_API_KEY!;
const FMP_BASE = 'https://financialmodelingprep.com';
const PROGRESS_FILE = 'fmp_premium_progress.json';
const CALL_DELAY_MS = 150;

// ── checkpoint ──────────────────────────────────────────────────────────────

function loadProgress(): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    return new Set(data.completed ?? []);
  } catch { return new Set(); }
}

function saveProgress(completed: Set<string>): void {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    completed: [...completed],
    updatedAt: new Date().toISOString(),
  }));
}

// ── schema ───────────────────────────────────────────────────────────────────

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fmp_income_statements (
      symbol TEXT NOT NULL, period TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, period)
    );
    CREATE TABLE IF NOT EXISTS fmp_balance_sheets (
      symbol TEXT NOT NULL, period TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, period)
    );
    CREATE TABLE IF NOT EXISTS fmp_cash_flows (
      symbol TEXT NOT NULL, period TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, period)
    );
    CREATE TABLE IF NOT EXISTS fmp_key_metrics (
      symbol TEXT NOT NULL, period TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, period)
    );
    CREATE TABLE IF NOT EXISTS fmp_key_metrics_annual (
      symbol TEXT NOT NULL, period TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, period)
    );
    CREATE TABLE IF NOT EXISTS fmp_analyst_estimates (
      symbol TEXT NOT NULL, period TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, period)
    );
    CREATE TABLE IF NOT EXISTS fmp_institutional_ownership (
      symbol TEXT NOT NULL, date TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, date)
    );
    CREATE TABLE IF NOT EXISTS fmp_insider_trades (
      symbol TEXT NOT NULL, filing_date TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, filing_date)
    );
    CREATE TABLE IF NOT EXISTS fmp_earnings_history (
      symbol TEXT NOT NULL, date TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, date)
    );
    CREATE TABLE IF NOT EXISTS fmp_dividends (
      symbol TEXT NOT NULL, date TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, date)
    );
    CREATE TABLE IF NOT EXISTS fmp_rating_history (
      symbol TEXT NOT NULL, date TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, date)
    );
  `);
}

// ── http ─────────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

interface FmpResult {
  ok: boolean;
  status: number | null;
  data: any;
}

async function fmpGet(path: string): Promise<FmpResult> {
  await sleep(CALL_DELAY_MS);
  try {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${FMP_BASE}${path}${sep}apikey=${FMP_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    return { ok: true, status: res.status, data: await res.json() };
  } catch {
    return { ok: false, status: null, data: null };
  }
}

function toArray(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.historical)) return data.historical;
  return [];
}

// ── upserts ───────────────────────────────────────────────────────────────────

function upsertPeriod(
  table: string,
  symbol: string,
  rows: any[],
  getKey: (r: any) => string | undefined | null,
): number {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (symbol, period, data_json) VALUES (?, ?, ?)`);
  return db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      const key = getKey(r);
      if (!key) continue;
      stmt.run(symbol, key, JSON.stringify(r));
      n++;
    }
    return n;
  })();
}

function upsertDate(
  table: string,
  symbol: string,
  rows: any[],
  getKey: (r: any) => string | undefined | null,
): number {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (symbol, date, data_json) VALUES (?, ?, ?)`);
  return db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      const key = getKey(r);
      if (!key) continue;
      stmt.run(symbol, key, JSON.stringify(r));
      n++;
    }
    return n;
  })();
}

function upsertFilingDate(
  table: string,
  symbol: string,
  rows: any[],
  getKey: (r: any) => string | undefined | null,
): number {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (symbol, filing_date, data_json) VALUES (?, ?, ?)`);
  return db.transaction(() => {
    let n = 0;
    for (const r of rows) {
      const key = getKey(r);
      if (!key) continue;
      stmt.run(symbol, key, JSON.stringify(r));
      n++;
    }
    return n;
  })();
}

// ── per-symbol logic ──────────────────────────────────────────────────────────

async function processSymbol(symbol: string, prefix: string): Promise<void> {
  const enc = encodeURIComponent(symbol);

  function log(endpoint: string, result: FmpResult, n: number) {
    if (!result.ok) {
      console.warn(`  ${prefix} [${endpoint}] HTTP ${result.status ?? 'error'}`);
    } else if (n === 0) {
      console.warn(`  ${prefix} [${endpoint}] empty`);
    } else {
      console.log(`  ${prefix} [${endpoint}] ${n} rows`);
    }
  }

  // 1. Income statements (quarterly) — date is the unique quarter-end date; period = "Q1"…"FY"
  {
    const r = await fmpGet(`/stable/income-statement?symbol=${enc}&period=quarter&limit=40`);
    const n = upsertPeriod('fmp_income_statements', symbol, toArray(r.data), row => row.date ?? row.period);
    log('income', r, n);
  }

  // 2. Balance sheets (quarterly)
  {
    const r = await fmpGet(`/stable/balance-sheet-statement?symbol=${enc}&period=quarter&limit=40`);
    const n = upsertPeriod('fmp_balance_sheets', symbol, toArray(r.data), row => row.date ?? row.period);
    log('balance', r, n);
  }

  // 3. Cash flow statements (quarterly)
  {
    const r = await fmpGet(`/stable/cash-flow-statement?symbol=${enc}&period=quarter&limit=40`);
    const n = upsertPeriod('fmp_cash_flows', symbol, toArray(r.data), row => row.date ?? row.period);
    log('cashflow', r, n);
  }

  // 4. Key metrics (quarterly)
  {
    const r = await fmpGet(`/stable/key-metrics?symbol=${enc}&period=quarter&limit=40`);
    const n = upsertPeriod('fmp_key_metrics', symbol, toArray(r.data), row => row.date ?? row.period);
    log('key_metrics_q', r, n);
  }

  // 5. Key metrics (annual — longer history)
  {
    const r = await fmpGet(`/stable/key-metrics?symbol=${enc}&period=annual&limit=20`);
    const n = upsertPeriod('fmp_key_metrics_annual', symbol, toArray(r.data), row => row.date ?? row.period);
    log('key_metrics_a', r, n);
  }

  // 6. Analyst estimates (quarterly)
  {
    const r = await fmpGet(`/stable/analyst-estimates?symbol=${enc}&period=quarter&limit=40`);
    const n = upsertPeriod('fmp_analyst_estimates', symbol, toArray(r.data), row => row.date ?? row.period);
    log('analyst_est', r, n);
  }

  // 7. Institutional ownership — with fallback endpoint
  {
    let r = await fmpGet(`/stable/institutional-ownership/institutional-holders/symbol/${enc}`);
    if (!r.ok || toArray(r.data).length === 0) {
      r = await fmpGet(`/stable/institutional-holder?symbol=${enc}`);
    }
    const n = upsertDate('fmp_institutional_ownership', symbol, toArray(r.data), row => row.date ?? row.reportDate);
    log('inst_ownership', r, n);
  }

  // 8. Insider trading
  {
    const r = await fmpGet(`/stable/insider-trading?symbol=${enc}&limit=200`);
    const n = upsertFilingDate('fmp_insider_trades', symbol, toArray(r.data), row => row.filingDate ?? row.transactionDate);
    log('insider', r, n);
  }

  // 9. Earnings history
  {
    const r = await fmpGet(`/stable/historical/earning_calendar?symbol=${enc}`);
    const n = upsertDate('fmp_earnings_history', symbol, toArray(r.data), row => row.date);
    log('earnings', r, n);
  }

  // 10. Dividends — returns { symbol, historical: [...] }
  {
    const r = await fmpGet(`/stable/historical-price-full/stock_dividend?symbol=${enc}`);
    const n = upsertDate('fmp_dividends', symbol, toArray(r.data), row => row.date);
    log('dividends', r, n);
  }

  // 11. Rating history
  {
    const r = await fmpGet(`/stable/historical-rating?symbol=${enc}`);
    const n = upsertDate('fmp_rating_history', symbol, toArray(r.data), row => row.date);
    log('ratings', r, n);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!FMP_KEY) {
    console.error('[ERROR] FMP_API_KEY is not set');
    process.exit(1);
  }

  createTables();

  const symbols: string[] = (
    db.prepare('SELECT DISTINCT symbol FROM event_features ORDER BY symbol').all() as any[]
  ).map(r => r.symbol);

  const completed = loadProgress();
  const remaining = symbols.filter(s => !completed.has(s));

  console.log(`\n=== FMP Premium Data Ingestion ===`);
  console.log(`Total symbols:     ${symbols.length}`);
  console.log(`Already completed: ${completed.size}`);
  console.log(`Remaining:         ${remaining.length}`);
  console.log(`Est. time:         ~${Math.ceil((remaining.length * 11 * CALL_DELAY_MS) / 60000)} min at ${CALL_DELAY_MS}ms/call\n`);

  for (let i = 0; i < remaining.length; i++) {
    const symbol = remaining[i];
    const prefix = `[${completed.size + i + 1}/${symbols.length}] ${symbol}:`;
    console.log(prefix);
    await processSymbol(symbol, prefix);
    completed.add(symbol);
    saveProgress(completed);
  }

  console.log(`\n=== Complete ===`);
  console.log(`Processed: ${remaining.length} symbols`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
