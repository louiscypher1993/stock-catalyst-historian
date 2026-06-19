import 'dotenv/config';
import { db, getSymbolPriceCount } from '../../db';
import { GLOBAL_MARKETS } from '../marketsData';
import { BatchScanner } from '../../BatchScannerService';
import * as fs from 'fs';

const EXISTING_PROGRESS_FILE = 'ohlcv_progress.json';
const MIN_ROWS_THRESHOLD = 2000;

function loadJsonSet(file: string): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set(data.completed ?? []);
  } catch { return new Set(); }
}

// Same definition as backfillNewSymbols.ts: not in original OHLCV run,
// or has < MIN_ROWS_THRESHOLD daily_prices rows.
function getNewSymbols(): string[] {
  const existingCompleted = loadJsonSet(EXISTING_PROGRESS_FILE);
  const allSymbols = GLOBAL_MARKETS.flatMap(m => m.stocks.map(s => s.symbol));
  const unique = [...new Set(allSymbols)];
  return unique.filter(sym => {
    if (existingCompleted.has(sym)) return false;
    return getSymbolPriceCount(sym) < MIN_ROWS_THRESHOLD;
  });
}

function countEventFeaturesForSymbols(symbols: string[]): number {
  if (symbols.length === 0) return 0;
  const placeholders = symbols.map(() => '?').join(',');
  const upper = symbols.map(s => s.toUpperCase());
  const row = db.prepare(
    `SELECT COUNT(*) as c FROM event_features WHERE symbol IN (${placeholders})`
  ).get(...upper) as { c: number };
  return row.c;
}

async function main() {
  const newSymbols = getNewSymbols();

  console.log(`\n=== Historical Anomaly Scan — New Symbols Only ===`);
  console.log(`Symbols to scan: ${newSymbols.length}`);

  if (newSymbols.length === 0) {
    console.log('No new symbols found — nothing to scan.');
    process.exit(0);
  }

  const rowsBefore = countEventFeaturesForSymbols(newSymbols);
  console.log(`event_features rows before (these symbols): ${rowsBefore}`);
  console.log(`Starting BatchScanner with skipGemini=true, 5y lookback...\n`);

  const scanner = new BatchScanner(newSymbols, 5);
  await scanner.start();

  const rowsAfter = countEventFeaturesForSymbols(newSymbols);
  const newRows = rowsAfter - rowsBefore;

  const status = scanner.getStatus();

  console.log(`\n=== Scan Complete ===`);
  console.log(`Symbols scanned:      ${status.scanned}`);
  console.log(`Anomalies collected:  ${status.eventsCollected}`);
  console.log(`event_features before: ${rowsBefore}`);
  console.log(`event_features after:  ${rowsAfter}`);
  console.log(`New rows created:      ${newRows}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
