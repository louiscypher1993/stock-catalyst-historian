import 'dotenv/config';
import { db, upsertDailyPrices, getSymbolPriceCount, type DailyPriceRow } from '../../db';
import { GLOBAL_MARKETS } from '../marketsData';
import * as fs from 'fs';

const FMP_KEY = process.env.FMP_API_KEY!;
const PROGRESS_FILE = 'ohlcv_progress.json';
const FROM_DATE = '2016-01-01';  // 10 years
const TO_DATE = new Date().toISOString().split('T')[0];
const MIN_ROWS_TO_SKIP = 2000;
const FMP_DELAY_MS = 200;
const YAHOO_DELAY_MS = 500;

// Local copy — cannot import from HistoricalEngine (circular dependency).
const _YAHOO_INTL_SUFFIXES = new Set([
  '.L', '.PA', '.AS', '.BR', '.DE', '.F', '.HK', '.SS', '.SZ',
  '.T', '.TO', '.AX', '.NS', '.BO', '.KS', '.TW', '.SW', '.ST',
  '.OL', '.CO', '.HE', '.ME', '.SA', '.BA', '.MX', '.IS', '.NZ',
]);
function normaliseForYahoo(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx === -1) return upper;
  const suffix = upper.slice(dotIdx);
  if (_YAHOO_INTL_SUFFIXES.has(suffix)) return upper;
  return upper.replace(/\./g, '-');
}

// Load all symbols from the universe
function getAllSymbols(): string[] {
  const symbols: string[] = [];
  for (const market of GLOBAL_MARKETS) {
    for (const s of market.stocks) {
      symbols.push(s.symbol);
    }
  }
  return [...new Set(symbols)];
}

// Load/save progress checkpoint
function loadProgress(): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    return new Set(data.completed ?? []);
  } catch { return new Set(); }
}

function saveProgress(completed: Set<string>): void {
  fs.writeFileSync(PROGRESS_FILE,
    JSON.stringify({ completed: [...completed],
                     updatedAt: new Date().toISOString() }));
}

// FMP fetch
async function fetchFMPHistory(symbol: string): Promise<any[] | null> {
  try {
    const url = `https://financialmodelingprep.com/stable/historical-price-full/${encodeURIComponent(symbol)}?from=${FROM_DATE}&to=${TO_DATE}&apikey=${FMP_KEY}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data?.historical ?? null;
  } catch { return null; }
}

// Yahoo Finance fallback
async function fetchYahooHistory(symbol: string): Promise<any[] | null> {
  try {
    const yahooSym = normaliseForYahoo(symbol);
    const fromTs = Math.floor(new Date(FROM_DATE).getTime() / 1000);
    const toTs   = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?period1=${fromTs}&period2=${toTs}&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000)
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
      open:      quotes.open?.[i]   ?? null,
      high:      quotes.high?.[i]   ?? null,
      low:       quotes.low?.[i]    ?? null,
      close:     quotes.close?.[i]  ?? null,
      volume:    quotes.volume?.[i] ?? null,
      adjClose:  adjClose[i]        ?? null,
    })).filter(r => r.close != null);
  } catch { return null; }
}

// Normalize to DB row format
function toDbRows(symbol: string, raw: any[], source: string): DailyPriceRow[] {
  return raw
    .filter(r => r.date && r.close)
    .map(r => ({
      symbol,
      date:      r.date,
      open:      r.open      ?? r.Open      ?? null,
      high:      r.high      ?? r.High      ?? null,
      low:       r.low       ?? r.Low       ?? null,
      close:     r.close     ?? r.Close,
      volume:    r.volume    ?? r.Volume    ?? null,
      adj_close: r.adjClose  ?? r.close,
      source,
    }));
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const symbols = getAllSymbols();
  const completed = loadProgress();

  console.log(`\n=== OHLCV Historical Ingestion ===`);
  console.log(`Total symbols: ${symbols.length}`);
  console.log(`Already completed: ${completed.size}`);
  console.log(`Remaining: ${symbols.length - completed.size}`);
  console.log(`Date range: ${FROM_DATE} → ${TO_DATE}\n`);

  let fmpCount = 0, yahooCount = 0, skipCount = 0, errorCount = 0;

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];

    if (completed.has(symbol)) { skipCount++; continue; }

    // Skip if already has sufficient data
    const existing = getSymbolPriceCount(symbol);
    if (existing >= MIN_ROWS_TO_SKIP) {
      console.log(`[${i+1}/${symbols.length}] ${symbol}: already has ${existing} rows, skipping`);
      completed.add(symbol);
      if (i % 50 === 0) saveProgress(completed);
      skipCount++;
      continue;
    }

    // Try FMP first
    await sleep(FMP_DELAY_MS);
    const fmpData = await fetchFMPHistory(symbol);

    if (fmpData && fmpData.length > 0) {
      const rows = toDbRows(symbol, fmpData, 'fmp');
      upsertDailyPrices(rows);
      fmpCount++;
      console.log(`[${i+1}/${symbols.length}] ${symbol}: ${rows.length} rows via FMP`);
    } else {
      // Yahoo fallback
      await sleep(YAHOO_DELAY_MS);
      const yahooData = await fetchYahooHistory(symbol);

      if (yahooData && yahooData.length > 0) {
        const rows = toDbRows(symbol, yahooData, 'yahoo');
        upsertDailyPrices(rows);
        yahooCount++;
        console.log(`[${i+1}/${symbols.length}] ${symbol}: ${rows.length} rows via Yahoo`);
      } else {
        errorCount++;
        console.log(`[${i+1}/${symbols.length}] ${symbol}: NO DATA from FMP or Yahoo`);
      }
    }

    completed.add(symbol);

    // Save progress every 50 symbols
    if (i % 50 === 0) saveProgress(completed);
  }

  saveProgress(completed);

  console.log(`\n=== Complete ===`);
  console.log(`FMP:     ${fmpCount} symbols`);
  console.log(`Yahoo:   ${yahooCount} symbols`);
  console.log(`Skipped: ${skipCount} symbols`);
  console.log(`Failed:  ${errorCount} symbols`);

  const total = (db.prepare(
    'SELECT COUNT(*) as c FROM daily_prices'
  ).get() as any).c;
  console.log(`Total rows in daily_prices: ${total.toLocaleString()}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
