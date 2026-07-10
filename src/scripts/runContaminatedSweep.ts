#!/usr/bin/env npx tsx
/**
 * runContaminatedSweep.ts — second, EXPLICITLY LEAKAGE-CONTAMINATED sweep run.
 *
 * Same 40,000 synthetic pots, same decidePot() harness as the clean test-fold
 * sweep, but walked chronologically across the FULL train+val+test catalogue
 * (66,003 rows across 2,645 dates, train+val predictions freshly batch-
 * inferred against features.csv in this recon, test rows reused byte-
 * identical from synthetic_pots/fold_rows.json). train/val rows reflect the
 * models' own predictions on data they were fit/tuned on -- this is NOT a
 * real performance estimate. Writes ONLY to the _contaminated tables, never
 * to synthetic_pot_sweep_results/trades.
 *
 * Each trade log entry gets a source_fold ('train'|'val'|'test') derived from
 * its OWN date -- a position opened in the train era can close in the val or
 * test era for long-patience pots, so open/close provenance is tracked
 * per-event, not per-pot.
 *
 * WRITE-SAFETY REDESIGN (2026-07-10): the first attempt at this sweep pushed
 * the Supabase project into full resource exhaustion (database stopped
 * accepting connections project-wide, not just on these tables) -- chunk 0
 * alone wrote ~4.6M trade rows in ~670s with zero pacing, and chunks 1-2 kept
 * firing before the instance had any chance to recover, so by chunk 2 both
 * results AND trades were failing wholesale (0/10000, 0/3.7M) while error
 * counts climbed each chunk (164 -> 282 -> 747). This version fixes the
 * write PATTERN, not just retries harder:
 *   - CHUNK_SIZE cut 10,000 -> 1,000 pots: each burst is ~10x smaller.
 *   - Insert batch sizes cut ~4-5x (results 2000->500, trades 5000->1000).
 *   - INSERT_DELAY_MS: a fixed pause between every single insert call, so
 *     writes are paced rather than fired as fast as the loop can go.
 *   - INTER_CHUNK_DELAY_MS: a longer pause between chunks, giving Postgres
 *     room to flush WAL / run autovacuum between bursts.
 *   - insertInChunks now retries each failed batch with exponential backoff
 *     (up to MAX_RETRIES) instead of logging and barreling into the next
 *     batch while the DB is still unhealthy.
 *   - checkDbHealthy() runs before every chunk; if the DB isn't responding,
 *     the run waits (backing off) rather than adding more load to a
 *     database that's already struggling -- this is the direct fix for what
 *     happened last time, where chunks 1-2 fired straight into an overloaded
 *     instance with no health gate at all.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { decidePot } from '../PotService';
import type { PotDecisionInput, PotAction } from '../PotService';
import { supabase } from '../db/supabaseClient';

const SCRATCH = 'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/193bf814-3002-4d0c-aa2e-09544ef1043c/scratchpad';
const DATA_DIR = path.join(process.cwd(), 'synthetic_pots');
const CHUNK_SIZE = 1000;
const RESULTS_INSERT_BATCH = 500;
const TRADES_INSERT_BATCH = 2000;
const RESULTS_TABLE = 'synthetic_pot_sweep_results_contaminated';
const TRADES_TABLE = 'synthetic_pot_sweep_trades_contaminated';

const INSERT_DELAY_MS = 100;          // pause between every insert call
const INTER_CHUNK_DELAY_MS = 5000;    // pause between chunks
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 2000;     // doubles each retry: 2s,4s,8s,16s,32s
const HEALTH_CHECK_MAX_WAIT_MS = 10 * 60 * 1000; // give up waiting for DB after 10 min

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function checkDbHealthy(): Promise<boolean> {
  const { error } = await supabase.from(RESULTS_TABLE).select('id').limit(1);
  return !error;
}

async function waitForHealthyDb(label: string): Promise<void> {
  const start = performance.now();
  let waitMs = 5000;
  while (!(await checkDbHealthy())) {
    if (performance.now() - start > HEALTH_CHECK_MAX_WAIT_MS) {
      throw new Error(`${label}: database still unhealthy after ${HEALTH_CHECK_MAX_WAIT_MS / 1000}s of waiting -- aborting rather than continuing to hammer it.`);
    }
    console.log(`  [health] DB not responding cleanly before ${label} -- waiting ${(waitMs / 1000).toFixed(0)}s before retrying...`);
    await sleep(waitMs);
    waitMs = Math.min(waitMs * 1.5, 60000);
  }
}

let priceIndex: Record<string, Array<[string, number]>>;

function resolvePrice(symbol: string, date: string): number | null {
  const series = priceIndex[symbol];
  if (!series || series.length === 0) return null;
  let lo = 0, hi = series.length - 1, exactIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] === date) { exactIdx = mid; break; }
    if (series[mid][0] < date) lo = mid + 1; else hi = mid - 1;
  }
  if (exactIdx !== -1) return series[exactIdx][1];
  const idx = lo - 1;
  if (idx < 0) return null;
  const targetMs = Date.parse(date + 'T00:00:00Z');
  const gapDays = (targetMs - Date.parse(series[idx][0] + 'T00:00:00Z')) / 86_400_000;
  if (gapDays > 10) return null;
  return series[idx][1];
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

interface SyntheticPot {
  synthetic_pot_id: number; batch_id: string;
  boldness: number; ambition: number; patience: number;
  conviction: number; focus: number; reactivity: number;
  starting_balance: number;
}

interface TradeLogEntry {
  date: string; symbol: string; kind: 'open' | 'close';
  direction: string; reason: string; price: number;
  realisedPnl?: number; holdingDays?: number;
}

interface Ledger {
  openPositions: any[];
  nextPositionId: number;
  realisedPnlCumulative: number;
  portfolioValueSeries: number[];
  tradeLog: TradeLogEntry[];
  skippedForNoPrice: number;
}

function toResult(row: any) {
  return {
    symbol: row.symbol, companyName: row.symbol, recommendation: row.recommendation,
    model_a_confidence: row.model_a_confidence, model_b_return_1m: row.model_b_return_1m,
    model_c_max_drawdown: row.model_c_max_drawdown, model_d1_return_3m: row.model_d1_return_3m,
    model_d2_return_6m: row.model_d2_return_6m, model_d3_return_2d: row.model_d3_return_2d,
    model_d5_return_2w: row.model_d5_return_2w, risk_score: 0, risk_reward_ratio: 0,
    current_price: 0,
  };
}

let byDate: Record<string, any[]>;
let dates: string[];
let dateToFold: Record<string, string>;

function runPotThroughFold(pot: SyntheticPot): Ledger {
  const ledger: Ledger = {
    openPositions: [], nextPositionId: 1, realisedPnlCumulative: 0,
    portfolioValueSeries: [], tradeLog: [], skippedForNoPrice: 0,
  };

  for (const date of dates) {
    const dayRows = byDate[date];
    const results: any[] = [];
    const priceMap: Record<string, number> = {};

    for (const row of dayRows) {
      const price = resolvePrice(row.symbol, date);
      if (price == null) { ledger.skippedForNoPrice++; continue; }
      const r = toResult(row);
      r.current_price = price;
      results.push(r);
      priceMap[row.symbol] = price;
    }
    for (const pos of ledger.openPositions) {
      if (!(pos.symbol in priceMap)) {
        const p = resolvePrice(pos.symbol, date);
        if (p != null) priceMap[pos.symbol] = p;
      }
    }

    const input: PotDecisionInput = {
      pot: pot as any, results, openPositions: ledger.openPositions, priceMap,
      prevRealisedPnl: ledger.realisedPnlCumulative,
      runDateStr: `${date}T00:00:00.000Z`, todayStr: date,
    };
    const actions: PotAction[] = decidePot(input);

    for (const action of actions) {
      if (action.kind === 'close') {
        const closedPos = ledger.openPositions.find(p => p.id === action.positionId);
        ledger.openPositions = ledger.openPositions.filter(p => p.id !== action.positionId);
        ledger.realisedPnlCumulative += action.realisedPnl;
        ledger.tradeLog.push({
          date, symbol: action.symbol, kind: 'close', direction: action.tradeAction,
          reason: action.reason, price: action.exitPrice, realisedPnl: action.realisedPnl,
          holdingDays: closedPos ? daysBetween(closedPos.entry_date, date) : undefined,
        });
      } else if (action.kind === 'open') {
        ledger.openPositions.push({
          id: ledger.nextPositionId++, pot_id: pot.synthetic_pot_id, symbol: action.symbol,
          direction: action.direction, entry_date: action.entryDate, entry_price: action.entryPrice,
          shares: action.shares, position_size_gbp: action.positionSizeGbp,
          expected_return_at_entry: action.expectedReturnAtEntry, patience_horizon: action.patienceHorizonLabel,
          exit_deadline: action.exitDeadline, status: 'open',
        });
        ledger.tradeLog.push({ date, symbol: action.symbol, kind: 'open', direction: action.direction, reason: action.tradeReason, price: action.entryPrice });
      } else if (action.kind === 'snapshot') {
        ledger.portfolioValueSeries.push(action.portfolioValue);
      } else if (action.kind === 'positionUpdate') {
        const pos = ledger.openPositions.find(p => p.id === action.positionId);
        if (pos) pos.current_price = action.currentPrice;
      }
    }
  }

  return ledger;
}

function computeMetrics(pot: SyntheticPot, ledger: Ledger, seed: number) {
  const series = ledger.portfolioValueSeries;
  const endingValue = series.length > 0 ? series[series.length - 1] : pot.starting_balance;
  const totalReturnPct = ((endingValue - pot.starting_balance) / pot.starting_balance) * 100;

  const periodReturns: number[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] > 0) periodReturns.push((series[i] - series[i - 1]) / series[i - 1]);
  }
  let sharpe = 0;
  if (periodReturns.length > 1) {
    const mean = periodReturns.reduce((a, b) => a + b, 0) / periodReturns.length;
    const variance = periodReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / periodReturns.length;
    const std = Math.sqrt(variance);
    sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  let peak = series.length > 0 ? series[0] : pot.starting_balance;
  let maxDrawdownPct = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? ((peak - v) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }

  const closes = ledger.tradeLog.filter(t => t.kind === 'close');
  const wins = closes.filter(t => (t.realisedPnl ?? 0) > 0).length;
  const winRatePct = closes.length > 0 ? (wins / closes.length) * 100 : null;
  const avgHoldingDays = closes.length > 0
    ? closes.reduce((a, t) => a + (t.holdingDays ?? 0), 0) / closes.length
    : null;

  return {
    batch_id: pot.batch_id,
    synthetic_pot_id: pot.synthetic_pot_id,
    boldness: pot.boldness, ambition: pot.ambition, patience: pot.patience,
    conviction: pot.conviction, focus: pot.focus, reactivity: pot.reactivity,
    starting_balance: pot.starting_balance,
    seed,
    ending_value: Math.round(endingValue * 100) / 100,
    total_return_pct: Math.round(totalReturnPct * 10000) / 10000,
    sharpe: Math.round(sharpe * 10000) / 10000,
    max_drawdown_pct: Math.round(maxDrawdownPct * 10000) / 10000,
    win_rate_pct: winRatePct != null ? Math.round(winRatePct * 100) / 100 : null,
    trade_count: closes.length,
    avg_holding_days: avgHoldingDays != null ? Math.round(avgHoldingDays * 100) / 100 : null,
    events_skipped_no_price: ledger.skippedForNoPrice,
    source_fold: null as string | null,
  };
}

async function insertInChunks(table: string, rows: any[], chunkSize: number): Promise<{ inserted: number; errors: string[] }> {
  let inserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let attempt = 0;
    let lastError: string | null = null;
    let succeeded = false;

    while (attempt <= MAX_RETRIES) {
      const { error } = await supabase.from(table).insert(chunk);
      if (!error) { succeeded = true; break; }
      lastError = error.message;
      attempt++;
      if (attempt <= MAX_RETRIES) {
        const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        console.log(`  [retry] ${table} rows ${i}-${i + chunk.length} failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message} -- backing off ${(backoff / 1000).toFixed(0)}s`);
        await sleep(backoff);
      }
    }

    if (succeeded) {
      inserted += chunk.length;
    } else {
      errors.push(`rows ${i}-${i + chunk.length}: ${lastError} (gave up after ${MAX_RETRIES} retries)`);
    }
    await sleep(INSERT_DELAY_MS);
  }
  return { inserted, errors };
}

async function main() {
  const t0 = performance.now();

  console.log('Loading inputs...');
  let pots: SyntheticPot[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'pots_seed_20260709.json'), 'utf8'));
  const limit = process.env.SWEEP_LIMIT ? parseInt(process.env.SWEEP_LIMIT, 10) : null;
  if (limit) { pots = pots.slice(0, limit); console.log(`SWEEP_LIMIT=${limit} -- dry-run mode.`); }
  const foldRows: any[] = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'full_catalogue_rows.json'), 'utf8'));
  priceIndex = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'full_price_index.json'), 'utf8'));
  const SEED = 20260709;

  byDate = {};
  for (const row of foldRows) (byDate[row.date] = byDate[row.date] || []).push(row);
  dates = Object.keys(byDate).sort();
  dateToFold = {};
  for (const d of dates) dateToFold[d] = byDate[d][0].source_fold;

  console.log(`Loaded ${pots.length} pots, ${foldRows.length} fold rows across ${dates.length} dates, ${Object.keys(priceIndex).length} priced symbols.`);

  let totalResultsInserted = 0, totalTradesInserted = 0;
  const chunkErrors: Array<{ chunk: number; errors: string[] }> = [];

  const totalChunks = Math.ceil(pots.length / CHUNK_SIZE);
  for (let chunkStart = 0; chunkStart < pots.length; chunkStart += CHUNK_SIZE) {
    const chunkIdx = chunkStart / CHUNK_SIZE;
    const chunkPots = pots.slice(chunkStart, chunkStart + CHUNK_SIZE);

    await waitForHealthyDb(`chunk ${chunkIdx}/${totalChunks}`);

    const tChunk0 = performance.now();

    const resultsBuffer: any[] = [];
    const tradesBuffer: any[] = [];

    for (const pot of chunkPots) {
      const ledger = runPotThroughFold(pot);
      resultsBuffer.push(computeMetrics(pot, ledger, SEED));
      for (const t of ledger.tradeLog) {
        tradesBuffer.push({
          batch_id: pot.batch_id, synthetic_pot_id: pot.synthetic_pot_id,
          trade_date: t.date, symbol: t.symbol, kind: t.kind,
          direction: t.direction, reason: t.reason, price: t.price,
          source_fold: dateToFold[t.date],
        });
      }
    }

    const tCompute = performance.now();
    const { inserted: rInserted, errors: rErrors } = await insertInChunks(RESULTS_TABLE, resultsBuffer, RESULTS_INSERT_BATCH);
    const { inserted: tInserted, errors: tErrors } = await insertInChunks(TRADES_TABLE, tradesBuffer, TRADES_INSERT_BATCH);
    const tWrite = performance.now();

    totalResultsInserted += rInserted;
    totalTradesInserted += tInserted;
    const allErrors = [...rErrors, ...tErrors];
    if (allErrors.length > 0) chunkErrors.push({ chunk: chunkIdx, errors: allErrors });

    console.log(`Chunk ${chunkIdx}/${totalChunks} (${chunkPots.length} pots): compute=${((tCompute - tChunk0) / 1000).toFixed(1)}s write=${((tWrite - tCompute) / 1000).toFixed(1)}s results=${rInserted}/${resultsBuffer.length} trades=${tInserted}/${tradesBuffer.length}${allErrors.length ? ` ERRORS=${allErrors.length}` : ''}`);

    if (chunkStart + CHUNK_SIZE < pots.length) await sleep(INTER_CHUNK_DELAY_MS);
  }

  const t1 = performance.now();
  console.log(`\n=== CONTAMINATED SWEEP COMPLETE ===`);
  console.log(`Total wall-clock: ${((t1 - t0) / 1000 / 60).toFixed(2)} minutes`);
  console.log(`Total results rows inserted: ${totalResultsInserted} / ${pots.length}`);
  console.log(`Total trade rows inserted: ${totalTradesInserted}`);
  if (chunkErrors.length > 0) {
    console.log(`Chunks with errors: ${chunkErrors.length}`);
    console.log(JSON.stringify(chunkErrors, null, 2));
  } else {
    console.log('No errors encountered.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
