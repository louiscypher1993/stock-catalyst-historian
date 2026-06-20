import 'dotenv/config';
import { db, upsertDailyPrices, getSymbolPriceCount, type DailyPriceRow } from '../../db';
import { GLOBAL_MARKETS } from '../marketsData';
import * as fs from 'fs';

const FMP_KEY = process.env.FMP_API_KEY!;
const EXISTING_PROGRESS_FILE = 'ohlcv_progress.json';
const NEW_PROGRESS_FILE = 'ohlcv_new_symbols_progress.json';
const FROM_DATE = '2016-01-01';
const TO_DATE = new Date().toISOString().split('T')[0];
const MIN_ROWS_TO_SKIP = 2000;
const FMP_DELAY_MS = 200;
const YAHOO_DELAY_MS = 500;

// ── types ─────────────────────────────────────────────────────────────────────

interface SuccessEntry { symbol: string; rows: number; source: string; at: string; }
interface FailureEntry { symbol: string; reason: string; at: string; }

interface Progress {
  succeeded: SuccessEntry[];
  failed: FailureEntry[];
  updatedAt: string;
}

// ── checkpoint ────────────────────────────────────────────────────────────────

function loadProgress(): { succeeded: Set<string>; failed: Set<string>; raw: Progress } {
  const empty: Progress = { succeeded: [], failed: [], updatedAt: new Date().toISOString() };

  let raw: any;
  try { raw = JSON.parse(fs.readFileSync(NEW_PROGRESS_FILE, 'utf8')); }
  catch { return { succeeded: new Set(), failed: new Set(), raw: empty }; }

  // Migrate old format: had a flat `completed` array, no `succeeded`/`failed`
  if (Array.isArray(raw.completed) && !Array.isArray(raw.succeeded)) {
    console.log('[checkpoint] Detected old format — migrating via daily_prices row counts...');
    const migrated: Progress = { succeeded: [], failed: [], updatedAt: new Date().toISOString() };
    for (const sym of raw.completed as string[]) {
      const rows = getSymbolPriceCount(sym);
      if (rows >= MIN_ROWS_TO_SKIP) {
        migrated.succeeded.push({ symbol: sym, rows, source: 'migrated', at: raw.updatedAt ?? new Date().toISOString() });
      }
      // Symbols with < MIN_ROWS_TO_SKIP are NOT added to failed — they become "neither"
      // so the re-run will attempt them again.
    }
    const migratedSucceeded = migrated.succeeded.length;
    const migratedNeither = (raw.completed as string[]).length - migratedSucceeded;
    console.log(`[checkpoint] Migration: ${migratedSucceeded} confirmed succeeded, ${migratedNeither} re-queued (will retry)\n`);
    saveProgress(migrated);
    return {
      succeeded: new Set(migrated.succeeded.map(e => e.symbol)),
      failed: new Set(),
      raw: migrated,
    };
  }

  const progress = raw as Progress;
  return {
    succeeded: new Set((progress.succeeded ?? []).map(e => e.symbol)),
    failed: new Set((progress.failed ?? []).map(e => e.symbol)),
    raw: progress,
  };
}

function saveProgress(progress: Progress): void {
  fs.writeFileSync(NEW_PROGRESS_FILE, JSON.stringify({
    ...progress,
    updatedAt: new Date().toISOString(),
  }, null, 2));
}

// ── symbol selection ──────────────────────────────────────────────────────────

function loadJsonSet(file: string): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set(data.completed ?? []);
  } catch { return new Set(); }
}

function getNewSymbols(): string[] {
  const existingCompleted = loadJsonSet(EXISTING_PROGRESS_FILE);
  const allSymbols = GLOBAL_MARKETS.flatMap(m => m.stocks.map(s => s.symbol));
  const unique = [...new Set(allSymbols)];
  return unique.filter(sym => {
    if (existingCompleted.has(sym)) return false;
    return getSymbolPriceCount(sym) < MIN_ROWS_TO_SKIP;
  });
}

// ── Yahoo normalisation ───────────────────────────────────────────────────────

const _YAHOO_INTL_SUFFIXES = new Set([
  '.L', '.PA', '.AS', '.BR', '.DE', '.F', '.HK', '.SS', '.SZ',
  '.T', '.TO', '.AX', '.NS', '.BO', '.KS', '.TW', '.SW', '.ST',
  '.OL', '.CO', '.HE', '.ME', '.SA', '.BA', '.MX', '.IS', '.NZ',
  '.PS', '.SN', '.CL', '.LM', '.QA', '.KW', '.CA', '.KA',
  '.PR', '.BD', '.RO', '.AT',
]);

function normaliseForYahoo(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx === -1) return upper;
  const suffix = upper.slice(dotIdx);
  if (_YAHOO_INTL_SUFFIXES.has(suffix)) return upper;
  return upper.replace(/\./g, '-');
}

// ── fetchers ──────────────────────────────────────────────────────────────────

interface FetchResult { data: any[] | null; reason: string; }

async function tryFMPUrl(url: string): Promise<{ rows: any[] | null; status: number | null }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { rows: null, status: res.status };
    const data: any = await res.json();
    const rows = data?.historical ?? null;
    return { rows: rows && rows.length > 0 ? rows : null, status: res.status };
  } catch (e: any) {
    return { rows: null, status: null };
  }
}

async function fetchFMPHistory(symbol: string): Promise<FetchResult> {
  const enc = encodeURIComponent(symbol);
  const url1 = `https://financialmodelingprep.com/stable/historical-price-full/${enc}?from=${FROM_DATE}&to=${TO_DATE}&apikey=${FMP_KEY}`;
  const r1 = await tryFMPUrl(url1);
  if (r1.rows) return { data: r1.rows, reason: 'fmp' };

  const url2 = `https://financialmodelingprep.com/stable/historical-price-full?symbol=${enc}&from=${FROM_DATE}&to=${TO_DATE}&apikey=${FMP_KEY}`;
  const r2 = await tryFMPUrl(url2);
  if (r2.rows) return { data: r2.rows, reason: 'fmp' };

  // Report the most informative status: prefer non-null, prefer 4xx/5xx over null
  const status = r2.status ?? r1.status;
  const label = status != null ? `HTTP ${status}` : 'timeout/error';
  return { data: null, reason: `FMP ${label}` };
}

async function fetchYahooHistory(symbol: string): Promise<FetchResult> {
  try {
    const yahooSym = normaliseForYahoo(symbol);
    const fromTs = Math.floor(new Date(FROM_DATE).getTime() / 1000);
    const toTs = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?period1=${fromTs}&period2=${toTs}&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { data: null, reason: `Yahoo HTTP ${res.status}` };

    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      const errCode = data?.chart?.error?.code ?? 'no-result';
      return { data: null, reason: `Yahoo empty (${errCode})` };
    }

    const timestamps: number[] = result.timestamp ?? [];
    const quotes = result.indicators?.quote?.[0] ?? {};
    const adjClose: number[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    const rows = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      open: quotes.open?.[i] ?? null,
      high: quotes.high?.[i] ?? null,
      low: quotes.low?.[i] ?? null,
      close: quotes.close?.[i] ?? null,
      volume: quotes.volume?.[i] ?? null,
      adjClose: adjClose[i] ?? null,
    })).filter(r => r.close != null);

    if (rows.length === 0) return { data: null, reason: 'Yahoo no rows after filter' };
    return { data: rows, reason: 'yahoo' };
  } catch (e: any) {
    return { data: null, reason: `Yahoo exception: ${e?.message ?? 'unknown'}` };
  }
}

function toDbRows(symbol: string, raw: any[], source: string): DailyPriceRow[] {
  return raw
    .filter(r => r.date && r.close)
    .map(r => ({
      symbol,
      date: r.date,
      open: r.open ?? null,
      high: r.high ?? null,
      low: r.low ?? null,
      close: r.close,
      volume: r.volume ?? null,
      adj_close: r.adjClose ?? r.close,
      source,
    }));
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── suffix clustering ─────────────────────────────────────────────────────────

function analyseClusters(failures: FailureEntry[]): void {
  if (failures.length === 0) return;

  const suffixCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();

  for (const f of failures) {
    const dot = f.symbol.lastIndexOf('.');
    const suffix = dot !== -1 ? f.symbol.slice(dot) : '(no suffix / US)';
    suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
    reasonCounts.set(f.reason, (reasonCounts.get(f.reason) ?? 0) + 1);
  }

  console.log('\n--- Failure clustering by exchange suffix ---');
  [...suffixCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => console.log(`  ${s.padEnd(12)} ${n}`));

  console.log('\n--- Failure clustering by reason ---');
  [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([r, n]) => console.log(`  ${String(n).padStart(3)}  ${r}`));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const newSymbols = getNewSymbols();
  const { succeeded, failed, raw: progress } = loadProgress();

  // "Neither" = not yet in succeeded or failed → will be attempted
  const toAttempt = newSymbols.filter(s => !succeeded.has(s) && !failed.has(s));

  console.log(`\n=== OHLCV Backfill — New Symbols Only ===`);
  console.log(`Total new symbols in universe: ${newSymbols.length}`);
  console.log(`Already succeeded:             ${succeeded.size}`);
  console.log(`Already failed (this session): ${failed.size}`);
  console.log(`To attempt:                    ${toAttempt.length}`);
  console.log(`Date range: ${FROM_DATE} → ${TO_DATE}\n`);

  let fmpCount = 0, yahooCount = 0, newFailCount = 0;
  const sessionFailed: FailureEntry[] = [];

  for (let i = 0; i < toAttempt.length; i++) {
    const symbol = toAttempt[i];
    const prefix = `[${i + 1}/${toAttempt.length}]`;

    // Double-check DB in case another process wrote rows since we loaded the checkpoint
    const existing = getSymbolPriceCount(symbol);
    if (existing >= MIN_ROWS_TO_SKIP) {
      console.log(`${prefix} ${symbol}: already has ${existing} rows — marking succeeded`);
      progress.succeeded.push({ symbol, rows: existing, source: 'already-present', at: new Date().toISOString() });
      succeeded.add(symbol);
      saveProgress(progress);
      continue;
    }

    await sleep(FMP_DELAY_MS);
    const fmpResult = await fetchFMPHistory(symbol);

    if (fmpResult.data && fmpResult.data.length > 0) {
      const rows = toDbRows(symbol, fmpResult.data, 'fmp');
      upsertDailyPrices(rows);
      fmpCount++;
      console.log(`${prefix} ${symbol}: ${rows.length} rows via FMP`);
      progress.succeeded.push({ symbol, rows: rows.length, source: 'fmp', at: new Date().toISOString() });
      succeeded.add(symbol);
    } else {
      await sleep(YAHOO_DELAY_MS);
      const yahooResult = await fetchYahooHistory(symbol);

      if (yahooResult.data && yahooResult.data.length > 0) {
        const rows = toDbRows(symbol, yahooResult.data, 'yahoo');
        upsertDailyPrices(rows);
        yahooCount++;
        console.log(`${prefix} ${symbol}: ${rows.length} rows via Yahoo`);
        progress.succeeded.push({ symbol, rows: rows.length, source: 'yahoo', at: new Date().toISOString() });
        succeeded.add(symbol);
      } else {
        const reason = `${fmpResult.reason} | ${yahooResult.reason}`;
        newFailCount++;
        console.warn(`${prefix} ${symbol}: NO DATA — ${reason}`);
        const entry: FailureEntry = { symbol, reason, at: new Date().toISOString() };
        progress.failed.push(entry);
        sessionFailed.push(entry);
        failed.add(symbol);
      }
    }

    if (i % 25 === 0) saveProgress(progress);
  }

  saveProgress(progress);

  const totalRows = (db.prepare('SELECT COUNT(*) as c FROM daily_prices').get() as any).c;
  const allFailed = progress.failed;

  console.log(`\n=== Run Complete ===`);
  console.log(`This run  — FMP: ${fmpCount}, Yahoo: ${yahooCount}, Failed: ${newFailCount}`);
  console.log(`Lifetime  — Succeeded: ${progress.succeeded.length}, Failed: ${allFailed.length}`);
  console.log(`Total daily_prices rows: ${totalRows.toLocaleString()}`);

  if (allFailed.length > 0) {
    console.log(`\n--- All failed symbols (${allFailed.length}) ---`);
    allFailed.forEach(f => console.log(`  ${f.symbol.padEnd(20)} ${f.reason}`));
    analyseClusters(allFailed);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
