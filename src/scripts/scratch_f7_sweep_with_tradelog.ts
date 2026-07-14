#!/usr/bin/env npx tsx
/**
 * scratch_f7_sweep_with_tradelog.ts — F7 before/after verification sweep.
 *
 * Minimal, additive variant of analyzeSyntheticPotSweep.ts: identical
 * deterministic walk (same seed inputs, same decidePot(), same price
 * resolution). Two modes:
 *   - lean (default): hash + metrics only per pot, matching
 *     analyzeSyntheticPotSweep.ts's existing output shape exactly -- for
 *     the full 40,000-pot pass (affected-rate + metric-delta detection).
 *   - detail (pot-id-filter file given): restricts to a small pot-id
 *     subset and retains each pot's FULL trade log (including
 *     expectedReturnAtEntry on 'open' entries) -- for classifying *why*
 *     the affected subset diverged, not just *whether* it did.
 * Read-only against Supabase (writes nothing); writes one local JSON file.
 *
 * Usage:
 *   npx tsx src/scripts/scratch_f7_sweep_with_tradelog.ts <output-name> [pot-id-filter-file] [limit]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decidePot } from '../PotService';
import type { PotDecisionInput, PotAction } from '../PotService';

const DATA_DIR = path.join(process.cwd(), 'synthetic_pots');

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
  expectedReturnAtEntry?: number;
}

interface Ledger {
  openPositions: any[]; nextPositionId: number; realisedPnlCumulative: number;
  portfolioValueSeries: number[]; tradeLog: TradeLogEntry[]; skippedForNoPrice: number;
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
        ledger.tradeLog.push({
          date, symbol: action.symbol, kind: 'open', direction: action.direction,
          reason: action.tradeReason, price: action.entryPrice,
          expectedReturnAtEntry: action.expectedReturnAtEntry,
        });
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

function computeMetrics(pot: SyntheticPot, ledger: Ledger) {
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

function tradeLogHash(tradeLog: TradeLogEntry[]): string {
  const canon = tradeLog.map(t => `${t.date}|${t.symbol}|${t.kind}|${t.direction}|${t.price}`).join(';');
  return crypto.createHash('sha256').update(canon).digest('hex');
}

async function main() {
  const outName = process.argv[2];
  const filterFile = process.argv[3] || null;
  const limit = process.argv[4] ? parseInt(process.argv[4], 10) : null;
  if (!outName) { console.error('Usage: scratch_f7_sweep_with_tradelog.ts <output-name> [pot-id-filter-file] [limit]'); process.exit(1); }

  const detailMode = !!filterFile;

  const t0 = performance.now();
  console.log('Loading inputs...');
  let pots: SyntheticPot[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'pots_seed_20260709.json'), 'utf8'));
  const foldRows: any[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fold_rows.json'), 'utf8'));
  priceIndex = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'price_index.json'), 'utf8'));

  if (detailMode) {
    const filterIds: number[] = JSON.parse(fs.readFileSync(filterFile, 'utf8'));
    const filterSet = new Set(filterIds);
    pots = pots.filter(p => filterSet.has(p.synthetic_pot_id));
    console.log(`detail mode -- restricted to ${pots.length}/${filterIds.length} requested pot IDs (full trade log retained).`);
  } else if (limit) {
    pots = pots.slice(0, limit);
    console.log(`lean mode, limit=${limit} -- dry-run, only processing first ${limit} pots.`);
  } else {
    console.log(`lean mode -- processing all ${pots.length} pots (hash + metrics only).`);
  }

  byDate = {};
  for (const row of foldRows) (byDate[row.date] = byDate[row.date] || []).push(row);
  dates = Object.keys(byDate).sort();

  console.log(`Loaded ${pots.length} pots. Re-running deterministically (no Supabase writes)...`);

  const signatures: any[] = [];
  let processed = 0;
  for (const pot of pots) {
    const ledger = runPotThroughFold(pot);
    const metrics = computeMetrics(pot, ledger);
    const record: any = {
      synthetic_pot_id: pot.synthetic_pot_id,
      batch_id: pot.batch_id,
      trade_log_hash: tradeLogHash(ledger.tradeLog),
      ...metrics,
    };
    if (detailMode) record.trade_log = ledger.tradeLog;
    signatures.push(record);
    processed++;
    if (processed % 5000 === 0) console.log(`  ${processed}/${pots.length} done (${((performance.now() - t0) / 1000).toFixed(0)}s elapsed)`);
  }

  const outPath = path.join(DATA_DIR, `${outName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(signatures));
  const t1 = performance.now();
  console.log(`Done. Wrote ${outPath} (${signatures.length} rows) in ${((t1 - t0) / 1000 / 60).toFixed(2)} minutes.`);
  process.exit(0);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
