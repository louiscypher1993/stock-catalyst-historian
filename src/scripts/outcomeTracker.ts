/**
 * outcomeTracker.ts — predicted-vs-actual outcome tracker.
 *
 * For each (inference_results row × horizon), once enough real-world time
 * has passed, records the model's predicted return/tier alongside what
 * actually happened. Local SQLite only (outcome_tracker.db, new file) --
 * reads Supabase (inference_results, read-only) and market_cache.db
 * (daily_prices, read-only), writes only to the new local file.
 *
 * Horizons and calendar-day offsets (approved 2026-07-20, deliberately NOT
 * the same as patienceHorizon()'s exit-deadline calendarDays, which are a
 * "how long to hold before giving up" buffer, not a measurement point; also
 * NOT matching either existing forward-return convention in the codebase --
 * HistoricalEngine.ts uses trading-day bar-index offsets and
 * calculate_forward_returns.ts uses +10 calendar days for "2w" -- this
 * tracker uses its own single, explicit convention instead of inheriting
 * either quirk):
 *   2D=+2, 2W=+14, 1M=+30, 3M=+91, 6M=+182 calendar days.
 * model_d4_return_3d (3D) is deliberately excluded -- not part of
 * PotService's gate logic, not requested.
 *
 * Actual-price lookup: target_date +/- 3 CALENDAR DAYS nearest-match
 * tolerance (explicit, not the same window used elsewhere in the codebase).
 * Tries daily_prices first; falls back to a fresh Yahoo fetch (same
 * fetch-and-cache-per-symbol pattern as calculate_forward_returns.ts) only
 * when daily_prices doesn't have a bar in that window -- daily_prices is
 * currently stale (max 2026-06-19 as of this build), so the fallback path
 * is the primary path for anything but the oldest, shortest-horizon rows.
 *
 * Entry price is inference_results.current_price (the price the prediction
 * was actually made against at scan time) -- not a separate run_date price
 * lookup.
 *
 * unreliable_reason-flagged rows are excluded entirely (never checked).
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUTCOME_DB = path.join(ROOT, 'outcome_tracker.db');
const MARKET_CACHE_DB = path.join(ROOT, 'market_cache.db');

const TOLERANCE_DAYS = 3; // explicit +/- nearest-match window for actual-price lookup
const YAHOO_REQUEST_DELAY_MS = 75;

// ── Horizon definitions (approved 2026-07-20) ───────────────────────────────

type HorizonLabel = '2D' | '2W' | '1M' | '3M' | '6M';

const HORIZONS: Array<{ label: HorizonLabel; days: number; predField: string }> = [
  { label: '2D', days: 2, predField: 'model_d3_return_2d' },
  { label: '2W', days: 14, predField: 'model_d5_return_2w' },
  { label: '1M', days: 30, predField: 'model_b_return_1m' },
  { label: '3M', days: 91, predField: 'model_d1_return_3m' },
  { label: '6M', days: 182, predField: 'model_d2_return_6m' },
];

// ── Tier resolution, transcribed from PotService.ts's HORIZON_TIER_CONFIG
// (same v9.3-recalibrated thresholds already validated in the v10 sweep) ──

const TIER_CONFIG: Record<string, { strongBuy?: (v: number) => boolean; buy?: (v: number) => boolean; sell?: (v: number) => boolean }> = {
  model_d3_return_2d: { strongBuy: v => v >= 0.010831, sell: v => v <= -0.004385 },
  model_d5_return_2w: { strongBuy: v => v >= 0.031582, buy: v => v >= 0.024743 && v < 0.031582, sell: v => v <= -0.001411 },
  model_d1_return_3m: { strongBuy: v => v >= 0.057568 },
  model_d2_return_6m: { buy: v => v > 0.106656 },
  model_b_return_1m: {}, // deliberately empty -- always HOLD (F4 dead zone)
};

function resolveTier(value: number, predField: string): string {
  const cfg = TIER_CONFIG[predField] ?? {};
  if (cfg.strongBuy?.(value)) return 'STRONG_BUY';
  if (cfg.buy?.(value)) return 'BUY';
  if (cfg.sell?.(value)) return 'SELL';
  return 'HOLD';
}

// ── Yahoo fetch (same pattern as src/ml/calculate_forward_returns.ts) ──────

// Local copy of normaliseForYahoo -- duplicated from LiveInferenceService.ts
// (not exported there) / scripts/watchlist-pulse.mjs, same cross-checked
// suffix allowlist, kept in sync deliberately per that file's own comment.
const YAHOO_INTL_SUFFIXES = new Set([
  '.AE', '.AS', '.AT', '.AX', '.BA', '.BD', '.BK', '.BO', '.BR',
  '.CA', '.CL', '.CO', '.DE', '.F', '.HE', '.HK', '.IR', '.IS',
  '.JK', '.JO', '.KA', '.KL', '.KQ', '.KS', '.KW', '.L', '.LM',
  '.LS', '.MC', '.ME', '.MI', '.MX', '.NS', '.NZ', '.OL', '.PA',
  '.PR', '.QA', '.RO', '.SA', '.SI', '.SN', '.SR', '.SS', '.ST',
  '.SW', '.SZ', '.T', '.TO', '.TW', '.VN', '.WA',
]);
function normaliseForYahoo(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx === -1) return upper;
  const suffix = upper.slice(dotIdx);
  if (YAHOO_INTL_SUFFIXES.has(suffix)) return upper;
  return upper.replace(/\./g, '-');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchYahooHistory(symbol: string): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normaliseForYahoo(symbol))}?interval=1d&range=1y`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
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
  } catch { /* leave priceMap empty -- caller treats as unresolvable */ }
  return priceMap;
}

// Symmetric +/-TOLERANCE_DAYS nearest-match search, closest offset first.
function nearestFromMap(priceMap: Map<string, number>, targetDate: string): { price: number; date: string } | null {
  const base = new Date(targetDate);
  for (let dist = 0; dist <= TOLERANCE_DAYS; dist++) {
    for (const sign of dist === 0 ? [0] : [-1, 1]) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + dist * sign);
      const key = d.toISOString().slice(0, 10);
      if (priceMap.has(key)) return { price: priceMap.get(key)!, date: key };
    }
  }
  return null;
}

function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Main ─────────────────────────────────────────────────────────────────

interface InferenceRow {
  symbol: string; run_date: string; current_price: number | null; unreliable_reason: string | null;
  model_b_return_1m: number | null; model_d1_return_3m: number | null; model_d2_return_6m: number | null;
  model_d3_return_2d: number | null; model_d5_return_2w: number | null;
}

async function fetchAllInferenceResults(): Promise<InferenceRow[]> {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  let all: InferenceRow[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('inference_results')
      .select('symbol, run_date, current_price, unreliable_reason, model_b_return_1m, model_d1_return_3m, model_d2_return_6m, model_d3_return_2d, model_d5_return_2w')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data as any);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function main() {
  const outDb = new Database(OUTCOME_DB);
  outDb.exec(`
    CREATE TABLE IF NOT EXISTS outcome_tracker (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      run_date TEXT NOT NULL,
      horizon TEXT NOT NULL,
      predicted_return REAL,
      predicted_tier TEXT,
      actual_return REAL,
      target_date TEXT,
      matched_price_date TEXT,
      actual_source TEXT,
      checked_at TEXT,
      UNIQUE(symbol, run_date, horizon)
    );
  `);

  // market_cache.db is gitignored -- not present on a fresh CI checkout, so
  // this degrades to Yahoo-only there. Local/manual runs (this backfill
  // included) get the free daily_prices path when it exists.
  let marketDb: Database.Database | null = null;
  let priceStmt: Database.Statement | null = null;
  try {
    marketDb = new Database(MARKET_CACHE_DB, { readonly: true });
    priceStmt = marketDb.prepare(`
      SELECT date, close FROM daily_prices
      WHERE symbol = ? AND date BETWEEN date(?, '-${TOLERANCE_DAYS} days') AND date(?, '+${TOLERANCE_DAYS} days')
      ORDER BY ABS(julianday(date) - julianday(?)) ASC
      LIMIT 1
    `);
  } catch {
    console.log('market_cache.db not found -- daily_prices lookup unavailable this run, falling back to Yahoo for everything.');
  }

  const existsStmt = outDb.prepare(`SELECT 1 FROM outcome_tracker WHERE symbol=? AND run_date=? AND horizon=?`);
  const insertStmt = outDb.prepare(`
    INSERT INTO outcome_tracker (symbol, run_date, horizon, predicted_return, predicted_tier, actual_return, target_date, matched_price_date, actual_source, checked_at)
    VALUES (@symbol, @run_date, @horizon, @predicted_return, @predicted_tier, @actual_return, @target_date, @matched_price_date, @actual_source, @checked_at)
  `);

  console.log('Fetching inference_results from Supabase...');
  const rows = await fetchAllInferenceResults();
  console.log(`Fetched ${rows.length} rows`);

  const today = todayStr();
  const yahooCache = new Map<string, Map<string, number> | null>();

  let checkedCount = 0, freeCount = 0, fetchedCount = 0, skippedUnmatured = 0, skippedNoPrice = 0, skippedExisting = 0, skippedNoPred = 0;

  for (const row of rows) {
    if (row.unreliable_reason) continue;
    if (row.current_price == null) { skippedNoPred++; continue; }

    for (const h of HORIZONS) {
      const predicted = (row as any)[h.predField] as number | null;
      if (predicted == null) { skippedNoPred++; continue; }

      const targetDate = addCalendarDays(row.run_date, h.days);
      if (targetDate > today) { skippedUnmatured++; continue; }

      if (existsStmt.get(row.symbol, row.run_date, h.label)) { skippedExisting++; continue; }

      // Try daily_prices first.
      let actualPrice: number | null = null;
      let matchedDate: string | null = null;
      let source: string | null = null;

      const cached = priceStmt?.get(row.symbol, targetDate, targetDate, targetDate) as { date: string; close: number } | undefined;
      if (cached) {
        actualPrice = cached.close;
        matchedDate = cached.date;
        source = 'daily_prices';
        freeCount++;
      } else {
        // Fall back to a fresh Yahoo fetch, cached per symbol for this run.
        if (!yahooCache.has(row.symbol)) {
          await sleep(YAHOO_REQUEST_DELAY_MS);
          const map = await fetchYahooHistory(row.symbol);
          yahooCache.set(row.symbol, map.size > 0 ? map : null);
        }
        const map = yahooCache.get(row.symbol);
        if (map) {
          const match = nearestFromMap(map, targetDate);
          if (match) {
            actualPrice = match.price;
            matchedDate = match.date;
            source = 'yahoo_fetch';
            fetchedCount++;
          }
        }
      }

      if (actualPrice == null) { skippedNoPrice++; continue; }

      const actualReturn = (actualPrice - row.current_price) / row.current_price;
      const predictedTier = resolveTier(predicted, h.predField);

      insertStmt.run({
        symbol: row.symbol, run_date: row.run_date, horizon: h.label,
        predicted_return: predicted, predicted_tier: predictedTier,
        actual_return: actualReturn, target_date: targetDate,
        matched_price_date: matchedDate, actual_source: source,
        checked_at: new Date().toISOString(),
      });
      checkedCount++;
    }
  }

  console.log(`\nChecked: ${checkedCount} (free from daily_prices: ${freeCount}, fresh Yahoo fetch: ${fetchedCount})`);
  console.log(`Skipped -- not yet matured: ${skippedUnmatured}, already checked: ${skippedExisting}, no price found (either source): ${skippedNoPrice}, no prediction/entry price: ${skippedNoPred}`);

  marketDb?.close();
  outDb.close();
}

main().catch(e => { console.error(e); process.exit(1); });
