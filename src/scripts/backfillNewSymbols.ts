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

const _YAHOO_INTL_SUFFIXES = new Set([
  '.L', '.PA', '.AS', '.BR', '.DE', '.F', '.HK', '.SS', '.SZ',
  '.T', '.TO', '.AX', '.NS', '.BO', '.KS', '.TW', '.SW', '.ST',
  '.OL', '.CO', '.HE', '.ME', '.SA', '.BA', '.MX', '.IS', '.NZ',
  '.PS', '.SN', '.CL', '.LM', '.QA', '.KW', '.CA', '.NZ', '.KA',
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

function loadJsonSet(file: string): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set(data.completed ?? []);
  } catch { return new Set(); }
}

function saveProgress(completed: Set<string>): void {
  fs.writeFileSync(NEW_PROGRESS_FILE,
    JSON.stringify({ completed: [...completed], updatedAt: new Date().toISOString() }));
}

// Symbols are "new" if they were never in the original OHLCV run AND have < MIN_ROWS_TO_SKIP rows
function getNewSymbols(): string[] {
  const existingCompleted = loadJsonSet(EXISTING_PROGRESS_FILE);
  const allSymbols = GLOBAL_MARKETS.flatMap(m => m.stocks.map(s => s.symbol));
  const unique = [...new Set(allSymbols)];
  return unique.filter(sym => {
    if (existingCompleted.has(sym)) return false;
    return getSymbolPriceCount(sym) < MIN_ROWS_TO_SKIP;
  });
}

async function tryFMPUrl(url: string): Promise<any[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.historical ?? null;
  } catch { return null; }
}

async function fetchFMPHistory(symbol: string): Promise<any[] | null> {
  const url = `https://financialmodelingprep.com/stable/historical-price-full/${encodeURIComponent(symbol)}?from=${FROM_DATE}&to=${TO_DATE}&apikey=${FMP_KEY}`;
  const primary = await tryFMPUrl(url);
  if (primary) return primary;
  const alt = `https://financialmodelingprep.com/stable/historical-price-full?symbol=${encodeURIComponent(symbol)}&from=${FROM_DATE}&to=${TO_DATE}&apikey=${FMP_KEY}`;
  return tryFMPUrl(alt);
}

async function fetchYahooHistory(symbol: string): Promise<any[] | null> {
  try {
    const yahooSym = normaliseForYahoo(symbol);
    const fromTs = Math.floor(new Date(FROM_DATE).getTime() / 1000);
    const toTs = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?period1=${fromTs}&period2=${toTs}&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const timestamps: number[] = result.timestamp ?? [];
    const quotes = result.indicators?.quote?.[0] ?? {};
    const adjClose: number[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    return timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      open: quotes.open?.[i] ?? null,
      high: quotes.high?.[i] ?? null,
      low: quotes.low?.[i] ?? null,
      close: quotes.close?.[i] ?? null,
      volume: quotes.volume?.[i] ?? null,
      adjClose: adjClose[i] ?? null,
    })).filter(r => r.close != null);
  } catch { return null; }
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

async function main() {
  const newSymbols = getNewSymbols();
  const completed = loadJsonSet(NEW_PROGRESS_FILE);

  console.log(`\n=== OHLCV Backfill — New Symbols Only ===`);
  console.log(`New symbols detected: ${newSymbols.length}`);
  console.log(`Already completed in this run: ${completed.size}`);
  console.log(`Remaining: ${newSymbols.length - completed.size}`);
  console.log(`Date range: ${FROM_DATE} → ${TO_DATE}\n`);

  let fmpCount = 0, yahooCount = 0, skipCount = 0, errorCount = 0;

  for (let i = 0; i < newSymbols.length; i++) {
    const symbol = newSymbols[i];

    if (completed.has(symbol)) { skipCount++; continue; }

    const existing = getSymbolPriceCount(symbol);
    if (existing >= MIN_ROWS_TO_SKIP) {
      console.log(`[${i+1}/${newSymbols.length}] ${symbol}: already has ${existing} rows, skipping`);
      completed.add(symbol);
      if (i % 50 === 0) saveProgress(completed);
      skipCount++;
      continue;
    }

    await sleep(FMP_DELAY_MS);
    const fmpData = await fetchFMPHistory(symbol);

    if (fmpData && fmpData.length > 0) {
      const rows = toDbRows(symbol, fmpData, 'fmp');
      upsertDailyPrices(rows);
      fmpCount++;
      console.log(`[${i+1}/${newSymbols.length}] ${symbol}: ${rows.length} rows via FMP`);
    } else {
      await sleep(YAHOO_DELAY_MS);
      const yahooData = await fetchYahooHistory(symbol);
      if (yahooData && yahooData.length > 0) {
        const rows = toDbRows(symbol, yahooData, 'yahoo');
        upsertDailyPrices(rows);
        yahooCount++;
        console.log(`[${i+1}/${newSymbols.length}] ${symbol}: ${rows.length} rows via Yahoo`);
      } else {
        errorCount++;
        console.log(`[${i+1}/${newSymbols.length}] ${symbol}: NO DATA from FMP or Yahoo`);
      }
    }

    completed.add(symbol);
    if (i % 50 === 0) saveProgress(completed);
  }

  saveProgress(completed);

  const totalRows = (db.prepare('SELECT COUNT(*) as c FROM daily_prices').get() as any).c;

  console.log(`\n=== Complete ===`);
  console.log(`FMP:     ${fmpCount}`);
  console.log(`Yahoo:   ${yahooCount}`);
  console.log(`Skipped: ${skipCount}`);
  console.log(`Failed:  ${errorCount}`);
  console.log(`Total daily_prices rows: ${totalRows.toLocaleString()}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
