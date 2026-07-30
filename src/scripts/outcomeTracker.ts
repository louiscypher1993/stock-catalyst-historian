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
 * Three tiers, in order:
 *   a) local SQLite daily_prices (market_cache.db, gitignored -- unavailable
 *      on GH Actions, degrades gracefully there)
 *   b) Supabase daily_prices_cache -- a small rolling cache of bars this
 *      tracker itself has previously fetched from Yahoo. Added 2026-07-20
 *      because GH Actions has no local daily_prices, so almost every row
 *      was hitting Yahoo on every single run (2,154/2,334 in the first
 *      backfill, ~5.5 hrs) -- repeat runs now hit this cache instead.
 *      Distinct from local daily_prices (that one's a one-time historical
 *      backfill feeding the training pipeline, not touched here).
 *   c) fresh Yahoo fetch (same fetch-and-cache-per-symbol pattern as
 *      calculate_forward_returns.ts) -- on use, the matched bar is written
 *      back to daily_prices_cache so future runs get it for free from (b).
 *
 * Entry price is inference_results.current_price (the price the prediction
 * was actually made against at scan time) -- not a separate run_date price
 * lookup.
 *
 * unreliable_reason-flagged rows are excluded entirely (never checked).
 *
 * DURABLE-MIRROR SELF-HEALING (added 2026-07-29 after the mirror-gap audit).
 * Local sqlite is the idempotency ledger, but it cannot distinguish "already
 * mirrored" from "written locally, mirror failed" -- so a failed upsert used to
 * leave a row permanently absent from Supabase (existsStmt saw it locally and
 * counted it `skippedExisting` on every later run). That silently lost ~292
 * rows / two whole settlement days and biased the pre-v9.4 2W baseline. Now:
 *   1. upsertOutcomes isolates + retries each batch (one bad batch no longer
 *      aborts the remaining ones);
 *   2. each run reads the durable store's keys and re-mirrors any local row
 *      missing from it, straight from sqlite -- so any future gap repairs
 *      itself on the next run instead of persisting.
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
const SUPABASE_SYMBOL_CHUNK = 200; // symbols per `in.()` read to keep query URLs bounded
const SUPABASE_WRITE_CHUNK = 300; // rows per batched upsert

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

// ── Supabase daily_prices_cache (raw REST, same helper shape as
// scripts/watchlist-pulse.mjs's `sb()` -- reused here rather than the
// supabase-js client because this file already does one raw `fetch` for
// Yahoo, and the batched-upsert response quirk below is specifically a raw
// PostgREST behaviour) ───────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

async function sb(pathAndQuery: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${pathAndQuery} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  // PostgREST upserts without `Prefer: return=representation` come back 200
  // OK with an EMPTY body, not 204 -- res.json() throws SyntaxError on that.
  // Read as text first and only parse if non-empty (same fix as
  // watchlist-pulse.mjs's `sb()`).
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// One batched read covering every distinct symbol in this run, done once
// upfront -- not a per-symbol or per-row round trip.
async function fetchSupabasePriceCache(symbols: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const uniqueSymbols = [...new Set(symbols)];
  for (const batch of chunk(uniqueSymbols, SUPABASE_SYMBOL_CHUNK)) {
    const inList = batch.map(s => encodeURIComponent(s)).join(',');
    const rows: Array<{ symbol: string; date: string; close: number }> =
      (await sb(`daily_prices_cache?select=symbol,date,close&symbol=in.(${inList})`)) ?? [];
    for (const r of rows) {
      if (!out.has(r.symbol)) out.set(r.symbol, new Map());
      out.get(r.symbol)!.set(r.date, r.close);
    }
  }
  return out;
}

// Batched write-back -- callers accumulate matches and flush in chunks
// rather than upserting one row per Yahoo fetch.
async function upsertPriceCache(rowsToWrite: Array<{ symbol: string; date: string; close: number }>): Promise<void> {
  if (rowsToWrite.length === 0) return;
  const nowIso = new Date().toISOString();
  const payload = rowsToWrite.map(r => ({ symbol: r.symbol, date: r.date, close: r.close, source: 'yahoo', fetched_at: nowIso }));
  for (const batch of chunk(payload, SUPABASE_WRITE_CHUNK)) {
    await sb('daily_prices_cache?on_conflict=symbol,date', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(batch),
    });
  }
}

// Durable mirror of the local outcome rows to Supabase outcome_results, so the
// accumulating dataset survives actions/cache eviction. Fail-soft and idempotent
// (PK symbol,run_date,horizon). Requires the outcome_results table --
// src/db/supabase_outcome_results_migration.sql -- else PostgREST 404s the
// missing relation and the caller's try/catch logs a warning (schema-drift
// hazard) without touching the local db.
// Returns the number of rows that FAILED to mirror. Each batch is isolated and
// retried: before the 2026-07-29 fix a single failing batch threw out of the
// whole loop, so every LATER batch was skipped too -- one transient error lost
// ~292 rows (two entire settlement days) permanently. Per-batch try/catch +
// one retry contains the blast radius to a single batch; the reconciliation
// pass in main() then repairs whatever still failed on a later run.
async function upsertOutcomes(rows: Array<Record<string, any>>): Promise<number> {
  if (rows.length === 0) return 0;
  let failed = 0;
  for (const batch of chunk(rows, SUPABASE_WRITE_CHUNK)) {
    for (let attempt = 1; ; attempt++) {
      try {
        await sb('outcome_results?on_conflict=symbol,run_date,horizon', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(batch),
        });
        break;
      } catch (e) {
        if (attempt >= 2) {
          console.warn(`  batch of ${batch.length} failed after ${attempt} attempts (will self-heal next run):`, e);
          failed += batch.length;
          break;
        }
        await sleep(1000);
      }
    }
  }
  return failed;
}

// Every (symbol,run_date,horizon) key already present in the DURABLE store.
// This is what makes the mirror self-healing: the local sqlite existence check
// alone cannot tell "already mirrored" from "written locally but the mirror
// failed", so a lost row used to be skipped as `skippedExisting` forever.
async function fetchOutcomeKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const rows: Array<{ symbol: string; run_date: string; horizon: string }> =
      (await sb(`outcome_results?select=symbol,run_date,horizon&limit=${pageSize}&offset=${offset}`)) ?? [];
    for (const r of rows) keys.add(`${r.symbol}|${r.run_date}|${r.horizon}`);
    if (rows.length < pageSize) break;
  }
  return keys;
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

  console.log('Fetching daily_prices_cache from Supabase (one batched read)...');
  // Fails soft -- a Supabase blip here shouldn't take down a run that local
  // daily_prices / Yahoo can still complete fine without the cache.
  let supabaseCache = new Map<string, Map<string, number>>();
  try {
    supabaseCache = await fetchSupabasePriceCache(rows.map(r => r.symbol));
    console.log(`Loaded cache rows for ${supabaseCache.size} symbol(s)`);
  } catch (e) {
    console.warn('daily_prices_cache read failed -- continuing without it this run:', e);
  }

  // Durable-store keys, for the reconciliation pass below. Fail-soft: if this
  // read fails we fall back to the old local-only behaviour for this run
  // (an empty set would otherwise look like "nothing is mirrored" and trigger a
  // full re-mirror of every local row -- harmless because the upsert is
  // idempotent, but a pointless amount of traffic).
  console.log('Fetching outcome_results keys from Supabase (mirror reconciliation)...');
  let durableKeys: Set<string> | null = null;
  try {
    durableKeys = await fetchOutcomeKeys();
    console.log(`Durable store currently holds ${durableKeys.size} outcome row(s)`);
  } catch (e) {
    console.warn('outcome_results key read failed -- skipping reconciliation this run:', e);
  }

  const today = todayStr();
  const yahooCache = new Map<string, Map<string, number> | null>();
  const pendingCacheWrites = new Map<string, { symbol: string; date: string; close: number }>();
  const pendingOutcomeWrites: Array<Record<string, any>> = [];

  let checkedCount = 0, freeCount = 0, cacheHitCount = 0, fetchedCount = 0, skippedUnmatured = 0, skippedNoPrice = 0, skippedExisting = 0, skippedNoPred = 0;

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
      const supabaseMatch = !cached ? nearestFromMap(supabaseCache.get(row.symbol) ?? new Map(), targetDate) : null;

      if (cached) {
        actualPrice = cached.close;
        matchedDate = cached.date;
        source = 'daily_prices';
        freeCount++;
      } else if (supabaseMatch) {
        actualPrice = supabaseMatch.price;
        matchedDate = supabaseMatch.date;
        source = 'supabase_cache';
        cacheHitCount++;
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
            pendingCacheWrites.set(`${row.symbol}|${match.date}`, { symbol: row.symbol, date: match.date, close: match.price });
          }
        }
      }

      if (actualPrice == null) { skippedNoPrice++; continue; }

      const actualReturn = (actualPrice - row.current_price) / row.current_price;
      const predictedTier = resolveTier(predicted, h.predField);

      const outcome = {
        symbol: row.symbol, run_date: row.run_date, horizon: h.label,
        predicted_return: predicted, predicted_tier: predictedTier,
        actual_return: actualReturn, target_date: targetDate,
        matched_price_date: matchedDate, actual_source: source,
        checked_at: new Date().toISOString(),
      };
      insertStmt.run(outcome);
      pendingOutcomeWrites.push(outcome);
      checkedCount++;
    }
  }

  console.log(`\nWriting ${pendingCacheWrites.size} newly-fetched bar(s) back to daily_prices_cache...`);
  // Fails soft -- rows already inserted into local outcome_tracker.db above
  // are not lost; worst case is just no cache benefit for the next run.
  try {
    await upsertPriceCache([...pendingCacheWrites.values()]);
  } catch (e) {
    console.warn('daily_prices_cache write-back failed -- this run\'s results are unaffected, just no cache benefit next time:', e);
  }

  // ── Mirror reconciliation (the 2026-07-29 mirror-gap fix) ────────────────
  // Any row that exists LOCALLY but not in the durable store is a previously-
  // failed mirror. Without this, existsStmt sees the local row on every later
  // run, counts it `skippedExisting`, and the durable store can never self-heal
  // -- exactly how ~292 rows (target dates 2026-07-21/22) went permanently
  // missing and biased the pre-v9.4 2W baseline. Re-mirrored straight from the
  // local db: no Yahoo re-fetch, no recomputation.
  let reconciled: Array<Record<string, any>> = [];
  if (durableKeys) {
    const pendingKeys = new Set(pendingOutcomeWrites.map(o => `${o.symbol}|${o.run_date}|${o.horizon}`));
    const localRows = outDb.prepare(
      `SELECT symbol, run_date, horizon, predicted_return, predicted_tier, actual_return, target_date, matched_price_date, actual_source, checked_at
       FROM outcome_tracker WHERE actual_return IS NOT NULL`
    ).all() as Array<Record<string, any>>;
    reconciled = localRows.filter(r => {
      const k = `${r.symbol}|${r.run_date}|${r.horizon}`;
      return !durableKeys!.has(k) && !pendingKeys.has(k);
    });
    if (reconciled.length > 0) {
      console.log(`\nRECONCILIATION: ${reconciled.length} local row(s) missing from the durable store (previously-failed mirrors) -- re-mirroring.`);
    }
  }

  const toMirror = [...pendingOutcomeWrites, ...reconciled];
  console.log(`Mirroring ${toMirror.length} outcome row(s) to Supabase outcome_results (${pendingOutcomeWrites.length} new, ${reconciled.length} reconciled)...`);
  // Fail-soft -- local outcome_tracker.db already has these rows; a missing
  // table (migration not yet applied) or Supabase blip just means no durable
  // mirror this run, not lost data. Per-batch isolation + retry lives inside
  // upsertOutcomes; whatever still fails is picked up by the next run's
  // reconciliation pass rather than being lost forever.
  try {
    const failedCount = await upsertOutcomes(toMirror);
    if (failedCount > 0) console.warn(`  ${failedCount} row(s) did not mirror this run -- next run's reconciliation will retry them.`);
    else if (toMirror.length > 0) console.log('  mirror ok.');
  } catch (e) {
    console.warn('outcome_results upsert failed -- local db unaffected; apply src/db/supabase_outcome_results_migration.sql if the table is missing:', e);
  }

  console.log(`\nChecked: ${checkedCount} (free from daily_prices: ${freeCount}, from daily_prices_cache: ${cacheHitCount}, fresh Yahoo fetch: ${fetchedCount})`);
  console.log(`Skipped -- not yet matured: ${skippedUnmatured}, already checked: ${skippedExisting}, no price found (either source): ${skippedNoPrice}, no prediction/entry price: ${skippedNoPred}`);

  marketDb?.close();
  outDb.close();
}

main().catch(e => { console.error(e); process.exit(1); });
