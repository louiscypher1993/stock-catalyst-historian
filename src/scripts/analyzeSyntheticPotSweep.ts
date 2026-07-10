#!/usr/bin/env npx tsx
/**
 * analyzeSyntheticPotSweep.ts — Post-hoc analysis only. Re-runs the exact
 * same deterministic computation as runSyntheticPotSweep.ts (same seed, same
 * fold, same price index, same decidePot()) purely in-memory to extract a
 * canonical trade-log signature per pot -- this is far cheaper than
 * paginating 1.9M trade rows back out of Supabase, and it doubles as a
 * determinism cross-check against the metrics already stored there.
 *
 * Writes nothing to Supabase. Writes one local analysis file:
 * synthetic_pots/pot_signatures.json ({synthetic_pot_id, batch_id,
 * trade_log_hash, recomputed metrics}) for the analysis script to join
 * against the already-downloaded synthetic_pots/all_results.json.
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
  // Canonical signature of the realized behavior: full ordered sequence of
  // (date, symbol, kind, direction, price) -- reason/realisedPnl/holdingDays
  // are derived from these plus the pot's own thresholds, not independent
  // information, so excluding them keeps the signature focused on "did this
  // pot make the same moves," which is what STEP 2 needs.
  const canon = tradeLog.map(t => `${t.date}|${t.symbol}|${t.kind}|${t.direction}|${t.price}`).join(';');
  return crypto.createHash('sha256').update(canon).digest('hex');
}

async function main() {
  const t0 = performance.now();
  console.log('Loading inputs...');
  const pots: SyntheticPot[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'pots_seed_20260709.json'), 'utf8'));
  const foldRows: any[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fold_rows.json'), 'utf8'));
  priceIndex = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'price_index.json'), 'utf8'));

  byDate = {};
  for (const row of foldRows) (byDate[row.date] = byDate[row.date] || []).push(row);
  dates = Object.keys(byDate).sort();

  console.log(`Loaded ${pots.length} pots. Re-running deterministically (no Supabase writes)...`);

  const signatures: any[] = [];
  let processed = 0;
  for (const pot of pots) {
    const ledger = runPotThroughFold(pot);
    const metrics = computeMetrics(pot, ledger);
    signatures.push({
      synthetic_pot_id: pot.synthetic_pot_id,
      batch_id: pot.batch_id,
      trade_log_hash: tradeLogHash(ledger.tradeLog),
      ...metrics,
    });
    processed++;
    if (processed % 10000 === 0) console.log(`  ${processed}/${pots.length} done (${((performance.now() - t0) / 1000).toFixed(0)}s elapsed)`);
  }

  fs.writeFileSync(path.join(DATA_DIR, 'pot_signatures.json'), JSON.stringify(signatures));
  const t1 = performance.now();
  console.log(`Done. Wrote pot_signatures.json (${signatures.length} rows) in ${((t1 - t0) / 1000 / 60).toFixed(2)} minutes.`);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
