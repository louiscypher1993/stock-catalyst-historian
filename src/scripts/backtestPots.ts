/**
 * backtestPots.ts — Historical POTS simulation scaffold.
 *
 * Simulates all 20 POTS characteristics against historical events as if
 * the pipeline had been running for 10 years.
 *
 * This is a SCAFFOLD. It will be fully runnable once:
 *   1. daily_prices table is populated (Phase 2 — see fetchHistoricalPrices.ts)
 *   2. Historical inference scores are retro-computed (Phase 2 — batch infer.py
 *      against event_features to populate a historical_inference_results table)
 *
 * Until then, getHistoricalEvents() returns [] and the script exits early
 * after reporting the daily_prices row count.
 *
 * Run with: npx tsx src/scripts/backtestPots.ts [--start=2016-01-01]
 */

import 'dotenv/config';
import { db } from '../../db';

// ── Types ──────────────────────────────────────────────────

interface BacktestPot {
  pot_id: number;
  name: string;
  boldness: number;
  ambition: number;
  patience: number;
  conviction: number;
  focus: number;
  reactivity: number;
  starting_balance: number;
}

interface BacktestPosition {
  symbol: string;
  direction: 'long' | 'short';
  entry_date: string;
  entry_price: number;
  shares: number;
  position_size_gbp: number;
  expected_return: number;
  patience_horizon: string;
  exit_deadline: string;
  patience_days: number;
}

interface BacktestResult {
  pot: BacktestPot;
  finalValue: number;
  totalReturn: number;
  totalTrades: number;
  winRate: number;
  maxDrawdown: number;
  sharpe: number;
  dailyValues: Array<{ date: string; value: number }>;
}

// ── Helper functions (mirrors PotService logic) ──────────────

function stopLossPct(conviction: number, boldness: number): number {
  return -(conviction * 0.03 + boldness * 0.02);
}

function patienceHorizon(patience: number): {
  label: string; calendarDays: number; tradingDays: number;
} {
  if (patience <= 2.5) return { label: '2D',  calendarDays: 3,   tradingDays: 2   };
  if (patience <= 4.5) return { label: '2W',  calendarDays: 14,  tradingDays: 10  };
  if (patience <= 6.5) return { label: '1M',  calendarDays: 31,  tradingDays: 21  };
  if (patience <= 8.5) return { label: '3M',  calendarDays: 92,  tradingDays: 63  };
  return               { label: '6M',  calendarDays: 183, tradingDays: 126 };
}

function ambitionTier(ambition: number): {
  minRec: string; minReturn: number
} {
  if (ambition <= 3.0) return { minRec: 'ADD',        minReturn: 0.03 };
  if (ambition <= 6.0) return { minRec: 'BUY',        minReturn: 0.12 };
  if (ambition <= 8.0) return { minRec: 'STRONG_BUY', minReturn: 0.21 };
  return               { minRec: 'STRONG_BUY', minReturn: 0.27 };
}

function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

// ── Price lookup from daily_prices ──────────────────────────

function getClosePrice(
  symbol: string, date: string
): number | null {
  // TODO: Once daily_prices is populated this will work
  const row = db.prepare(`
    SELECT close FROM daily_prices
    WHERE symbol = ? AND date <= ?
    ORDER BY date DESC LIMIT 1
  `).get(symbol, date) as any;
  return row?.close ?? null;
}

function getHistoricalEvents(
  fromDate: string,
  toDate: string
): Array<{
  symbol: string; date: string; sector: string | null;
  recommendation: string; model_a_confidence: number;
  model_b_return_1m: number; model_d1_return_3m: number;
  model_d2_return_6m: number; model_d3_return_2d: number;
  model_d5_return_2w: number; risk_score: number;
  risk_reward_ratio: number;
}> {
  // TODO: Once infer.py has been retro-run against historical
  // event_features to generate model scores, this query will work.
  // For now returns empty — the backtest will run but produce no trades.
  //
  // FUTURE: Replace this with a query against a
  // 'historical_inference_results' table that is populated by
  // running infer.py against all event_features rows.

  console.log('[Backtest] TODO: historical_inference_results table not yet populated.');
  console.log('[Backtest] Run infer.py in batch mode against event_features first.');
  return [];
}

// ── Pot simulation ──────────────────────────────────────────

function simulatePot(
  pot: BacktestPot,
  events: ReturnType<typeof getHistoricalEvents>,
  startDate: string,
  endDate: string
): BacktestResult {
  let cashBalance = pot.starting_balance;
  const openPositions: BacktestPosition[] = [];
  const closedTrades: Array<{
    returnPct: number;
    exitReason: string;
  }> = [];
  const dailyValues: Array<{ date: string; value: number }> = [];
  let peakValue = pot.starting_balance;
  let maxDrawdown = 0;

  const tier     = ambitionTier(pot.ambition);
  const ph       = patienceHorizon(pot.patience);
  const stopPct  = stopLossPct(pot.conviction, pot.boldness);
  const minConf  = Math.max(0.5, 0.95 - pot.boldness * 0.045);

  // Group events by date
  const eventsByDate = new Map<string, typeof events>();
  for (const e of events) {
    if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
    eventsByDate.get(e.date)!.push(e);
  }

  // Get all trading dates in range
  const allDates = db.prepare(`
    SELECT DISTINCT date FROM daily_prices
    WHERE date >= ? AND date <= ?
    ORDER BY date ASC
  `).all(startDate, endDate) as Array<{ date: string }>;

  for (const { date } of allDates) {
    const dayEvents = eventsByDate.get(date) ?? [];
    const heldSymbols = new Set(openPositions.map(p => p.symbol));

    // Process exits
    for (let i = openPositions.length - 1; i >= 0; i--) {
      const pos = openPositions[i];
      const currentPrice = getClosePrice(pos.symbol, date);
      if (!currentPrice) continue;

      const returnSoFar = pos.direction === 'long'
        ? (currentPrice - pos.entry_price) / pos.entry_price
        : (pos.entry_price - currentPrice) / pos.entry_price;

      let exitReason: string | null = null;

      // Stop loss
      if (returnSoFar <= stopPct) exitReason = 'stop_loss';
      // Patience timeout
      else if (date >= pos.exit_deadline) {
        exitReason = pos.direction === 'short' ? 'short_cover' : 'patience';
      }

      if (exitReason) {
        const realisedPnl = returnSoFar * pos.position_size_gbp;
        cashBalance += pos.position_size_gbp + realisedPnl;
        closedTrades.push({ returnPct: returnSoFar, exitReason });
        openPositions.splice(i, 1);
        heldSymbols.delete(pos.symbol);
      }
    }

    // Process entries
    for (const event of dayEvents) {
      if (openPositions.length >= pot.focus) break;
      if (heldSymbols.has(event.symbol)) continue;
      if (event.recommendation !== tier.minRec &&
          !['STRONG_BUY','BUY','ADD'].includes(event.recommendation)) continue;
      if (event.model_a_confidence < minConf) continue;
      if (event.risk_score > pot.boldness * 10) continue;
      if (event.risk_reward_ratio < pot.ambition / 5) continue;

      const entryPrice = getClosePrice(event.symbol, date);
      if (!entryPrice || entryPrice <= 0) continue;

      const portfolioValue = cashBalance +
        openPositions.reduce((s, p) => s + p.position_size_gbp, 0);
      const positionGBP = portfolioValue * (1 / pot.focus);
      const shares = Math.floor(positionGBP / entryPrice);
      if (shares === 0) continue;
      const actualPositionGBP = shares * entryPrice;
      if (cashBalance < actualPositionGBP) continue;

      cashBalance -= actualPositionGBP;
      const deadline = addCalendarDays(date, ph.calendarDays);

      openPositions.push({
        symbol:            event.symbol,
        direction:         'long',
        entry_date:        date,
        entry_price:       entryPrice,
        shares,
        position_size_gbp: actualPositionGBP,
        expected_return:   event.model_b_return_1m,
        patience_horizon:  ph.label,
        exit_deadline:     deadline,
        patience_days:     ph.calendarDays,
      });
      heldSymbols.add(event.symbol);
    }

    // Calculate daily portfolio value
    const openValue = openPositions.reduce((sum, pos) => {
      const cp = getClosePrice(pos.symbol, date) ?? pos.entry_price;
      return sum + (pos.shares * cp);
    }, 0);
    const totalValue = cashBalance + openValue;

    dailyValues.push({ date, value: totalValue });

    if (totalValue > peakValue) peakValue = totalValue;
    const drawdown = (peakValue - totalValue) / peakValue;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const finalValue = dailyValues.at(-1)?.value ?? pot.starting_balance;
  const wins = closedTrades.filter(t => t.returnPct > 0).length;
  const winRate = closedTrades.length > 0
    ? wins / closedTrades.length : 0;

  // Simple Sharpe (annualized, assuming 252 trading days, rf=0)
  const returns = dailyValues.slice(1).map((d, i) =>
    (d.value - dailyValues[i].value) / dailyValues[i].value
  );
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdReturn  = Math.sqrt(
    returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length
  );
  const sharpe = stdReturn > 0
    ? (meanReturn / stdReturn) * Math.sqrt(252) : 0;

  return {
    pot,
    finalValue,
    totalReturn: (finalValue - pot.starting_balance) / pot.starting_balance,
    totalTrades: closedTrades.length,
    winRate,
    maxDrawdown,
    sharpe,
    dailyValues,
  };
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const startDate = args.find(a => a.startsWith('--start='))
    ?.split('=')[1] ?? '2016-01-01';
  const endDate = new Date().toISOString().split('T')[0];

  console.log('\n=== POTS Historical Backtest ===');
  console.log(`Period: ${startDate} → ${endDate}\n`);

  // Load pots from Supabase (same 20 pots as live system)
  const { supabase } = await import('../db/supabaseClient');
  const { data: pots } = await supabase.from('pots').select('*');
  if (!pots?.length) {
    console.error('No pots found in Supabase. Run initPots.ts first.');
    process.exit(1);
  }

  // Check daily_prices is populated
  const priceCount = (db.prepare(
    'SELECT COUNT(*) as c FROM daily_prices'
  ).get() as any)?.c ?? 0;

  if (priceCount < 100000) {
    console.warn(`WARNING: daily_prices only has ${priceCount} rows.`);
    console.warn('Run fetchHistoricalPrices.ts first for meaningful results.');
  }

  // Load historical events with model scores
  const events = getHistoricalEvents(startDate, endDate);
  console.log(`Historical events with scores: ${events.length}`);

  if (events.length === 0) {
    console.log('\nNo historical inference scores available yet.');
    console.log('TODO: Run batch inference against historical event_features.');
    console.log('The backtest framework is ready — data population is the next step.');
    process.exit(0);
  }

  // Run simulation for each pot
  const results: BacktestResult[] = [];
  for (const pot of pots as BacktestPot[]) {
    process.stdout.write(`Simulating ${pot.name}...`);
    const result = simulatePot(pot, events, startDate, endDate);
    results.push(result);
    console.log(` done (${(result.totalReturn * 100).toFixed(1)}%)`);
  }

  // Sort by total return
  results.sort((a, b) => b.totalReturn - a.totalReturn);

  // Print leaderboard
  console.log('\n=== Backtest Leaderboard ===\n');
  console.log(
    'Rank  Name                            Return%  Trades  Win%  MaxDD%  Sharpe'
  );
  console.log('─'.repeat(78));
  results.forEach((r, i) => {
    console.log([
      String(i + 1).padStart(4),
      r.pot.name.padEnd(32),
      `${(r.totalReturn * 100).toFixed(1)}%`.padStart(7),
      String(r.totalTrades).padStart(7),
      `${(r.winRate * 100).toFixed(0)}%`.padStart(5),
      `${(r.maxDrawdown * 100).toFixed(1)}%`.padStart(7),
      r.sharpe.toFixed(2).padStart(7),
    ].join('  '));
  });

  // Save results to JSON for dashboard use
  const outputPath = 'backtest_results.json';
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    startDate,
    endDate,
    results: results.map(r => ({
      pot_id:      r.pot.pot_id,
      name:        r.pot.name,
      finalValue:  r.finalValue,
      totalReturn: r.totalReturn,
      totalTrades: r.totalTrades,
      winRate:     r.winRate,
      maxDrawdown: r.maxDrawdown,
      sharpe:      r.sharpe,
      dailyValues: r.dailyValues, // for charting
    })),
  }, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
