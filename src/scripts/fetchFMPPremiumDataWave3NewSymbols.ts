import 'dotenv/config';
import { db } from '../../db';
import * as fs from 'fs';

const FMP_KEY = process.env.FMP_API_KEY!;
const FMP_BASE = 'https://financialmodelingprep.com';
const PROGRESS_FILE = 'fmp_premium_progress_newsymbols_wave3.json';
const ORIGINAL_CHECKPOINTS = [
  'fmp_premium_progress.json',
  'fmp_premium_progress_wave2.json',
  'fmp_premium_progress_wave3.json',
];
const CALL_DELAY_MS = 150;

// ── symbol selection ──────────────────────────────────────────────────────────

function getNewSymbols(): string[] {
  const completedUnion = new Set<string>();
  for (const f of ORIGINAL_CHECKPOINTS) {
    try {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const s of data.completed ?? []) completedUnion.add(String(s).toUpperCase());
    } catch { /* missing checkpoint treated as empty */ }
  }

  const rows: { symbol: string }[] = db.prepare('SELECT DISTINCT symbol FROM event_features ORDER BY symbol').all() as any[];
  return rows.map(r => r.symbol).filter(s => !completedUnion.has(s.toUpperCase()));
}

// ── checkpoint (new-symbols-only, never touches the original checkpoints) ────

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
    CREATE TABLE IF NOT EXISTS fmp_ratios (
      symbol TEXT NOT NULL, date TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, date)
    );
    CREATE TABLE IF NOT EXISTS fmp_financial_growth (
      symbol TEXT NOT NULL, date TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, date)
    );
    CREATE TABLE IF NOT EXISTS fmp_enterprise_values (
      symbol TEXT NOT NULL, date TEXT NOT NULL, data_json TEXT NOT NULL,
      PRIMARY KEY (symbol, date)
    );
    CREATE TABLE IF NOT EXISTS fmp_dcf (
      symbol TEXT NOT NULL PRIMARY KEY,
      data_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fmp_employee_count (
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

function upsertSymbolKeyed(table: string, symbol: string, record: any): void {
  db.prepare(`INSERT OR REPLACE INTO ${table} (symbol, data_json) VALUES (?, ?)`)
    .run(symbol, JSON.stringify(record));
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

// ── per-symbol logic ──────────────────────────────────────────────────────────

async function processSymbol(symbol: string, prefix: string): Promise<void> {
  const enc = encodeURIComponent(symbol);

  function log(endpoint: string, result: FmpResult, n: number | null) {
    if (!result.ok) {
      console.warn(`  ${prefix} [${endpoint}] HTTP ${result.status ?? 'error'}`);
    } else if (n === 0 || n === null) {
      console.warn(`  ${prefix} [${endpoint}] empty`);
    } else {
      console.log(`  ${prefix} [${endpoint}] ${n} rows`);
    }
  }

  // 1. Financial ratios (quarterly)
  {
    const r = await fmpGet(`/stable/ratios?symbol=${enc}&period=quarter&limit=40`);
    const n = upsertDate('fmp_ratios', symbol, toArray(r.data), row => row.date);
    log('ratios', r, n);
  }

  // 2. Financial growth (quarterly)
  {
    const r = await fmpGet(`/stable/financial-growth?symbol=${enc}&period=quarter&limit=40`);
    const n = upsertDate('fmp_financial_growth', symbol, toArray(r.data), row => row.date);
    log('financial_growth', r, n);
  }

  // 3. Enterprise values (quarterly)
  {
    const r = await fmpGet(`/stable/enterprise-values?symbol=${enc}&period=quarter&limit=40`);
    const n = upsertDate('fmp_enterprise_values', symbol, toArray(r.data), row => row.date);
    log('enterprise_values', r, n);
  }

  // 4. Discounted cash flow — single current snapshot keyed by symbol
  {
    const r = await fmpGet(`/stable/discounted-cash-flow?symbol=${enc}`);
    const record = toArray(r.data)[0] ?? null;
    if (r.ok && record) {
      upsertSymbolKeyed('fmp_dcf', symbol, record);
      console.log(`  ${prefix} [dcf] 1 row`);
    } else {
      log('dcf', r, record ? 1 : 0);
    }
  }

  // 5. Historical employee count — keyed by periodOfReport
  {
    const r = await fmpGet(`/stable/historical-employee-count?symbol=${enc}&limit=40`);
    const n = upsertDate('fmp_employee_count', symbol, toArray(r.data), row => row.periodOfReport ?? row.date);
    log('employee_count', r, n);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!FMP_KEY) {
    console.error('[ERROR] FMP_API_KEY is not set');
    process.exit(1);
  }

  createTables();

  const symbols = getNewSymbols();
  const completed = loadProgress();
  const remaining = symbols.filter(s => !completed.has(s));

  console.log(`\n=== FMP Premium Data Ingestion — New Symbols Wave 3 ===`);
  console.log(`New eligible symbols: ${symbols.length}`);
  console.log(`Already completed:    ${completed.size}`);
  console.log(`Remaining:             ${remaining.length}`);
  console.log(`Est. time:             ~${Math.ceil((remaining.length * 5 * CALL_DELAY_MS) / 60000)} min at ${CALL_DELAY_MS}ms/call\n`);

  const startSize = completed.size;
  for (let i = 0; i < remaining.length; i++) {
    const symbol = remaining[i];
    const prefix = `[${startSize + i + 1}/${symbols.length}] ${symbol}:`;
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
