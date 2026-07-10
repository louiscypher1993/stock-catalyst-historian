#!/usr/bin/env npx tsx
/**
 * runContaminatedSweepLocal.ts — second, EXPLICITLY LEAKAGE-CONTAMINATED sweep
 * run, writing to a LOCAL SQLite file instead of Supabase.
 *
 * Same 40,000 synthetic pots, same decidePot() harness, same full train+val+
 * test catalogue (66,003 rows, 2,609 dates) as runContaminatedSweep.ts. The
 * first attempt at this sweep (targeting Supabase) pushed the project into
 * full resource exhaustion from write volume (~24.5M projected trade rows);
 * a redesign with paced/retried writes was built but not yet re-run. Rather
 * than re-risk the live Supabase project for a disposable, one-off analysis
 * dataset, this version writes to synthetic_pots/contaminated_sweep.db (a
 * new, separate local SQLite file via better-sqlite3 -- NOT market_cache.db,
 * which is the live price cache and stays untouched) -- no network round-
 * trips, no capacity risk to production, and full local DDL rights.
 *
 * train/val rows reflect the models' own predictions on data they were fit/
 * tuned on -- this is NOT a real performance estimate. Written only to this
 * local file, never blended with the clean synthetic_pot_sweep_results/trades
 * tables in Supabase.
 *
 * Each trade log entry gets a source_fold ('train'|'val'|'test') derived from
 * its own date -- a position opened in the train era can close in the val or
 * test era for long-patience pots, so provenance is tracked per-event.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { decidePot } from '../PotService';
import type { PotDecisionInput, PotAction } from '../PotService';

const SCRATCH = 'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/193bf814-3002-4d0c-aa2e-09544ef1043c/scratchpad';
const DATA_DIR = path.join(process.cwd(), 'synthetic_pots');
const DB_PATH = path.join(DATA_DIR, 'contaminated_sweep.db');
const CHUNK_SIZE = 5000; // memory-management only now, not a write-safety concern

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
  };
}

function main() {
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

  // Fresh DB each run -- this is a disposable analysis artifact, not a
  // system of record; re-running should not require manual cleanup.
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE results_contaminated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      synthetic_pot_id INTEGER NOT NULL,
      boldness REAL NOT NULL, ambition REAL NOT NULL, patience REAL NOT NULL,
      conviction REAL NOT NULL, focus REAL NOT NULL, reactivity REAL NOT NULL,
      starting_balance REAL NOT NULL,
      seed INTEGER NOT NULL,
      ending_value REAL NOT NULL,
      total_return_pct REAL NOT NULL,
      sharpe REAL NOT NULL,
      max_drawdown_pct REAL NOT NULL,
      win_rate_pct REAL,
      trade_count INTEGER NOT NULL,
      avg_holding_days REAL,
      events_skipped_no_price INTEGER NOT NULL,
      UNIQUE(batch_id, synthetic_pot_id)
    );
    CREATE TABLE trades_contaminated (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      synthetic_pot_id INTEGER NOT NULL,
      trade_date TEXT NOT NULL,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      direction TEXT NOT NULL,
      reason TEXT,
      price REAL NOT NULL,
      source_fold TEXT NOT NULL
    );
    CREATE INDEX idx_trades_contaminated_pot ON trades_contaminated (batch_id, synthetic_pot_id);
    CREATE INDEX idx_trades_contaminated_fold ON trades_contaminated (source_fold);
  `);

  const insertResult = db.prepare(`
    INSERT INTO results_contaminated
      (batch_id, synthetic_pot_id, boldness, ambition, patience, conviction, focus, reactivity,
       starting_balance, seed, ending_value, total_return_pct, sharpe, max_drawdown_pct,
       win_rate_pct, trade_count, avg_holding_days, events_skipped_no_price)
    VALUES (@batch_id, @synthetic_pot_id, @boldness, @ambition, @patience, @conviction, @focus, @reactivity,
       @starting_balance, @seed, @ending_value, @total_return_pct, @sharpe, @max_drawdown_pct,
       @win_rate_pct, @trade_count, @avg_holding_days, @events_skipped_no_price)
  `);
  const insertTrade = db.prepare(`
    INSERT INTO trades_contaminated
      (batch_id, synthetic_pot_id, trade_date, symbol, kind, direction, reason, price, source_fold)
    VALUES (@batch_id, @synthetic_pot_id, @trade_date, @symbol, @kind, @direction, @reason, @price, @source_fold)
  `);

  let totalResults = 0, totalTrades = 0;

  for (let chunkStart = 0; chunkStart < pots.length; chunkStart += CHUNK_SIZE) {
    const chunkPots = pots.slice(chunkStart, chunkStart + CHUNK_SIZE);
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
          direction: t.direction, reason: t.reason ?? null, price: t.price,
          source_fold: dateToFold[t.date],
        });
      }
    }

    const tCompute = performance.now();

    const writeResults = db.transaction((rows: any[]) => { for (const r of rows) insertResult.run(r); });
    const writeTrades = db.transaction((rows: any[]) => { for (const r of rows) insertTrade.run(r); });
    writeResults(resultsBuffer);
    writeTrades(tradesBuffer);

    const tWrite = performance.now();
    totalResults += resultsBuffer.length;
    totalTrades += tradesBuffer.length;

    console.log(`Chunk [${chunkStart}-${chunkStart + chunkPots.length}) (${chunkPots.length} pots): compute=${((tCompute - tChunk0) / 1000).toFixed(1)}s write=${((tWrite - tCompute) / 1000).toFixed(1)}s results=${resultsBuffer.length} trades=${tradesBuffer.length}`);
  }

  db.close();

  const t1 = performance.now();
  console.log(`\n=== CONTAMINATED SWEEP COMPLETE (local SQLite: ${DB_PATH}) ===`);
  console.log(`Total wall-clock: ${((t1 - t0) / 1000 / 60).toFixed(2)} minutes`);
  console.log(`Total results rows: ${totalResults} / ${pots.length}`);
  console.log(`Total trade rows: ${totalTrades}`);
}

main();
