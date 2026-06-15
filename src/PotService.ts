/**
 * PotService.ts — Core POTS multi-agent system.
 * File: src/PotService.ts
 *
 * Called after each live inference pipeline run via:
 *   await evaluateRun(allPipelineResults, new Date(), determineRunSlot());
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/** Shape of one inference result passed in from LiveInferenceService. */
export interface PipelineResult {
  symbol:               string;
  companyName:          string;
  /** STRONG_BUY | BUY | ADD | HOLD | REDUCE | SELL */
  recommendation:       string;
  model_a_confidence:   number;
  model_b_return_1m:    number;
  model_c_max_drawdown: number;
  model_d1_return_3m:   number;
  model_d2_return_6m:   number;
  model_d3_return_2d:   number;
  model_d5_return_2w:   number;
  risk_score:           number;
  risk_reward_ratio:    number;
  current_price:        number;
}

/** Full set of per-symbol fields LiveInferenceService passes to evaluateRun. */
export interface PotInferenceResult extends PipelineResult {
  model_d4_return_3d:          number;
  model_e_outperform_12m_prob: number;
}

interface Pot {
  pot_id:           number;
  name:             string;
  boldness:         number;
  ambition:         number;
  patience:         number;
  conviction:       number;
  focus:            number;
  reactivity:       number;
  starting_balance: number;
}

interface Position {
  id:                       number;
  pot_id:                   number;
  symbol:                   string;
  direction:                'long' | 'short';
  entry_date:               string;   // YYYY-MM-DD
  entry_price:              number;
  shares:                   number;
  position_size_gbp:        number;
  expected_return_at_entry: number;
  patience_horizon:         string;   // '2D' | '2W' | '1M' | '3M' | '6M'
  exit_deadline:            string;   // YYYY-MM-DD
  status:                   'open' | 'closed';
}

// ── Recommendation tier ordering ───────────────────────────────────────────────

const REC_RANK: Record<string, number> = {
  SELL: -2, REDUCE: -1, HOLD: 0, ADD: 1, BUY: 2, STRONG_BUY: 3,
};

// ── Pure parameter derivations ─────────────────────────────────────────────────

/** Stop loss threshold — always negative. Trigger when returnSoFar <= this value. */
function stopLossPct(conviction: number, boldness: number): number {
  return -(conviction * 0.03 + boldness * 0.02);
}

/** Minimum model_a_confidence for entry */
function minConfidence(boldness: number): number {
  return Math.max(0.5, 0.95 - boldness * 0.045);
}

/** Short-selling composite score */
function shortScore(boldness: number, reactivity: number, ambition: number): number {
  return boldness * 0.4 + reactivity * 0.4 + ambition * 0.2;
}

/** Patience → horizon metadata */
function patienceHorizon(patience: number): {
  label:        string;
  returnField:  keyof PipelineResult;
  calendarDays: number;
} {
  if (patience <= 2.5) return { label: '2D', returnField: 'model_d3_return_2d', calendarDays: 3   };
  if (patience <= 4.5) return { label: '2W', returnField: 'model_d5_return_2w', calendarDays: 14  };
  if (patience <= 6.5) return { label: '1M', returnField: 'model_b_return_1m',  calendarDays: 31  };
  if (patience <= 8.5) return { label: '3M', returnField: 'model_d1_return_3m', calendarDays: 92  };
  return               { label: '6M', returnField: 'model_d2_return_6m', calendarDays: 183 };
}

/** Ambition → minimum recommendation and expected return */
function ambitionTier(ambition: number): { minRec: string; minReturn: number } {
  if (ambition <= 3.0) return { minRec: 'ADD',        minReturn: 0.03 };
  if (ambition <= 6.0) return { minRec: 'BUY',        minReturn: 0.12 };
  if (ambition <= 8.0) return { minRec: 'STRONG_BUY', minReturn: 0.21 };
  return               { minRec: 'STRONG_BUY',         minReturn: 0.27 };
}

/** Expected return from a result for a pot's patience horizon */
function expectedReturnForHorizon(result: PipelineResult, patience: number): number {
  const h = patienceHorizon(patience);
  return (result[h.returnField] as number) ?? 0;
}

/** True if rec meets or exceeds the minimum tier */
function meetsMinRec(rec: string, minRec: string): boolean {
  return (REC_RANK[rec] ?? -99) >= (REC_RANK[minRec] ?? 99);
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function calendarDaysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

// ── Run-slot determination ─────────────────────────────────────────────────────

/** Whether a pot with this reactivity evaluates on this run slot */
function isEligibleForSlot(reactivity: number, slot: 'morning' | 'afternoon' | 'evening'): boolean {
  if (slot === 'morning')   return true;           // R >= 1 — all pots
  if (slot === 'afternoon') return reactivity >= 4.0;
  if (slot === 'evening')   return reactivity >= 7.0;
  return false;
}

/** Determine the run slot from UTC hour. Call at pipeline start. */
export function determineRunSlot(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getUTCHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

// ── Yahoo Finance price fetch ──────────────────────────────────────────────────

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const last = closes.filter((c): c is number => c != null).pop();
    return last ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Entry conditions check ─────────────────────────────────────────────────────

function meetsEntryConditions(
  result:    PipelineResult,
  pot:       Pot,
  openCount: number,
  heldSyms:  Set<string>
): boolean {
  const tier    = ambitionTier(pot.ambition);
  const minConf = minConfidence(pot.boldness);

  if (!meetsMinRec(result.recommendation, tier.minRec))                    return false;
  if (result.risk_score > pot.boldness * 10)                               return false;
  if (expectedReturnForHorizon(result, pot.patience) < tier.minReturn)     return false;
  if (result.model_a_confidence < minConf)                                 return false;
  if (result.risk_reward_ratio < pot.ambition / 5)                         return false;
  if (openCount >= pot.focus)                                              return false;
  if (heldSyms.has(result.symbol))                                         return false;
  return true;
}

// ── Position close helper ──────────────────────────────────────────────────────

async function closePosition(
  pos:              Position,
  exitPrice:        number,
  returnSoFar:      number,
  reason:           string,
  todayStr:         string,
  runDateStr:       string,
  supabase:         any,
  realisedPnlOut:   number[]
): Promise<void> {
  const realisedPnl = returnSoFar * pos.position_size_gbp;
  realisedPnlOut.push(realisedPnl);

  const action = pos.direction === 'long' ? 'SELL' : 'COVER';

  await supabase
    .from('pot_positions')
    .update({
      status:              'closed',
      exit_date:           todayStr,
      exit_price:          exitPrice,
      realised_pnl:        parseFloat(realisedPnl.toFixed(4)),
      realised_return_pct: parseFloat(returnSoFar.toFixed(6)),
      exit_reason:         reason,
    })
    .eq('id', pos.id);

  await supabase.from('pot_trades').insert({
    pot_id:            pos.pot_id,
    symbol:            pos.symbol,
    action,
    price:             exitPrice,
    shares:            pos.shares,
    position_size_gbp: pos.position_size_gbp,
    reason,
    run_date:          runDateStr,
  });
}

// ── Per-pot processor ──────────────────────────────────────────────────────────

async function processPot(
  pot:              Pot,
  results:          PipelineResult[],
  openPositions:    Position[],
  priceMap:         Record<string, number>,
  prevRealisedPnl:  number,
  runDateStr:       string,
  todayStr:         string,
  supabase:         any
): Promise<void> {
  const { boldness: B, ambition: A, patience: P, conviction: C, focus: F, reactivity: R } = pot;
  const ph      = patienceHorizon(P);
  const tier    = ambitionTier(A);
  const minConf = minConfidence(B);
  const stopPct = stopLossPct(C, B);
  const ss      = shortScore(B, R, A);
  const rMinusB = R - B;

  const closedIds          = new Set<number>();
  const realisedPnlThisRun: number[] = [];

  // ── PHASE 1: EXITS (priority order) ─────────────────────────────────────────

  for (const pos of openPositions) {
    if (closedIds.has(pos.id)) continue;
    const cp = priceMap[pos.symbol];
    if (!cp) continue;

    const returnSoFar = pos.direction === 'long'
      ? (cp - pos.entry_price) / pos.entry_price
      : (pos.entry_price - cp) / pos.entry_price;

    // P1: Stop loss
    if (returnSoFar <= stopPct) {
      const reason = pos.direction === 'short' ? 'stop_loss' : 'stop_loss';
      await closePosition(pos, cp, returnSoFar, reason, todayStr, runDateStr, supabase, realisedPnlThisRun);
      closedIds.add(pos.id);
      console.log(`[PotService] ${pot.name}: STOP_LOSS ${pos.direction.toUpperCase()} ${pos.symbol} @ ${cp.toFixed(2)} (${(returnSoFar * 100).toFixed(1)}%)`);
      continue;
    }

    // P2: Reactivity exit — new SELL/REDUCE AND R-B >= 2 (longs only)
    if (pos.direction === 'long' && rMinusB >= 2) {
      const signal = results.find(r => r.symbol === pos.symbol);
      if (signal && (signal.recommendation === 'SELL' || signal.recommendation === 'REDUCE')) {
        await closePosition(pos, cp, returnSoFar, 'reactivity', todayStr, runDateStr, supabase, realisedPnlThisRun);
        closedIds.add(pos.id);
        console.log(`[PotService] ${pot.name}: REACTIVITY_EXIT ${pos.symbol} (new ${signal.recommendation})`);
        continue;
      }
    }

    // P3/P4: Patience timeout (covers 'short_cover' for shorts)
    if (todayStr >= pos.exit_deadline) {
      const reason = pos.direction === 'short' ? 'short_cover' : 'patience';
      await closePosition(pos, cp, returnSoFar, reason, todayStr, runDateStr, supabase, realisedPnlThisRun);
      closedIds.add(pos.id);
      console.log(`[PotService] ${pot.name}: ${reason.toUpperCase()} ${pos.symbol} @ ${cp.toFixed(2)}`);
    }
  }

  // Remaining open positions after primary exits
  let remaining = openPositions.filter(p => !closedIds.has(p.id));

  // ── PHASE 2: REPLACEMENT (P5) ───────────────────────────────────────────────

  if (remaining.length >= F && A >= 5) {
    const beatThreshold = (11 - A) * 0.015;

    // Only long positions are candidates for replacement
    const replacementCandidates = remaining
      .filter(p => p.direction === 'long')
      .map(pos => {
        const cp = priceMap[pos.symbol] ?? pos.entry_price;
        const returnSoFar = (cp - pos.entry_price) / pos.entry_price;
        const totalCal    = calendarDaysBetween(pos.entry_date, pos.exit_deadline);
        const elapsedCal  = calendarDaysBetween(pos.entry_date, todayStr);
        const horizonPct  = totalCal > 0 ? elapsedCal / totalCal : 0;
        return { pos, returnSoFar, horizonPct };
      })
      .filter(x => x.horizonPct > 0.20)
      .sort((a, b) => a.returnSoFar - b.returnSoFar); // worst first

    if (replacementCandidates.length > 0) {
      const worst = replacementCandidates[0];
      const remainingWithoutWorst = remaining.filter(p => p.id !== worst.pos.id);
      const heldWithoutWorst = new Set(remainingWithoutWorst.map(p => p.symbol));

      // Find a qualifying long signal that beats worst's expected return
      const replacementSignal = results.find(r => {
        if (!['STRONG_BUY', 'BUY', 'ADD'].includes(r.recommendation)) return false;
        // One slot freed (remaining.length - 1 open after closing worst)
        if (!meetsEntryConditions(r, pot, remaining.length - 1, heldWithoutWorst)) return false;
        const newExpected = expectedReturnForHorizon(r, P);
        return newExpected - (worst.pos.expected_return_at_entry ?? 0) > beatThreshold;
      });

      if (replacementSignal) {
        const cp = priceMap[worst.pos.symbol] ?? worst.pos.entry_price;
        const ret = (cp - worst.pos.entry_price) / worst.pos.entry_price;
        await closePosition(worst.pos, cp, ret, 'replacement', todayStr, runDateStr, supabase, realisedPnlThisRun);
        closedIds.add(worst.pos.id);
        remaining = remaining.filter(p => p.id !== worst.pos.id);
        console.log(`[PotService] ${pot.name}: REPLACEMENT — closing ${worst.pos.symbol}, opening slot for ${replacementSignal.symbol}`);
      }
    }
  }

  // ── PHASE 3: ENTRIES ────────────────────────────────────────────────────────

  const totalRealisedPnl = prevRealisedPnl + realisedPnlThisRun.reduce((a, b) => a + b, 0);
  const openPositionGBP  = remaining.reduce((s, p) => s + p.position_size_gbp, 0);
  const cashBalance      = pot.starting_balance + totalRealisedPnl - openPositionGBP;
  const portfolioValue   = pot.starting_balance + totalRealisedPnl; // mark-to-cost for sizing

  let openCount  = remaining.length;
  const heldSyms = new Set(remaining.map(p => p.symbol));

  // Long entries — STRONG_BUY / BUY / ADD signals
  for (const result of results) {
    if (openCount >= F) break;
    if (!['STRONG_BUY', 'BUY', 'ADD'].includes(result.recommendation)) continue;
    if (!meetsEntryConditions(result, pot, openCount, heldSyms)) continue;

    const positionGBP = portfolioValue * (1 / F);
    if (cashBalance - (openCount - remaining.length + 1) * positionGBP < positionGBP * 0.5) continue;

    const entryPrice = result.current_price;
    if (!entryPrice || entryPrice <= 0) continue;

    const shares = Math.floor(positionGBP / entryPrice);
    if (shares === 0) {
      console.log(`[PotService] ${pot.name}: skipping ${result.symbol} — price £${entryPrice} exceeds allocation £${positionGBP.toFixed(2)}`);
      continue;
    }
    const actualPositionGBP = shares * entryPrice;

    const expReturn  = expectedReturnForHorizon(result, P);
    const deadline   = addCalendarDays(todayStr, ph.calendarDays);

    const { error } = await supabase.from('pot_positions').insert({
      pot_id:                   pot.pot_id,
      symbol:                   result.symbol,
      direction:                'long',
      entry_date:               todayStr,
      entry_price:              entryPrice,
      shares:                   shares,
      position_size_gbp:        parseFloat(actualPositionGBP.toFixed(2)),
      expected_return_at_entry: parseFloat(expReturn.toFixed(6)),
      patience_horizon:         ph.label,
      exit_deadline:            deadline,
      status:                   'open',
    });

    if (!error) {
      await supabase.from('pot_trades').insert({
        pot_id:            pot.pot_id,
        symbol:            result.symbol,
        action:            'BUY',
        price:             entryPrice,
        shares:            shares,
        position_size_gbp: parseFloat(actualPositionGBP.toFixed(2)),
        reason:            result.recommendation,
        run_date:          runDateStr,
      });
      heldSyms.add(result.symbol);
      openCount++;
      console.log(`[PotService] ${pot.name}: BUY ${result.symbol} @ ${entryPrice.toFixed(2)} — expected ${(expReturn * 100).toFixed(1)}% over ${ph.label}`);
    } else {
      console.error(`[PotService] ${pot.name}: BUY insert error for ${result.symbol}:`, error.message);
    }
  }

  // Short entries — SELL / REDUCE signals (if short_score qualifies)
  for (const result of results) {
    if (openCount >= F) break;
    if (heldSyms.has(result.symbol)) continue;

    const canShort = (result.recommendation === 'SELL'   && ss >= 7.0) ||
                     (result.recommendation === 'REDUCE' && ss >= 8.5);
    if (!canShort) continue;

    // For shorts, check confidence and risk score (recommendation tier check skipped)
    if (result.model_a_confidence < minConf) continue;
    if (result.risk_score > B * 10) continue;
    // Ensure model predicts meaningful downside
    const downside = Math.abs(expectedReturnForHorizon(result, P));
    if (downside < tier.minReturn) continue;

    const positionGBP = portfolioValue * (1 / F);
    if (cashBalance - (openCount - remaining.length + 1) * positionGBP < positionGBP * 0.5) continue;

    const entryPrice = result.current_price;
    if (!entryPrice || entryPrice <= 0) continue;

    const shares = Math.floor(positionGBP / entryPrice);
    if (shares === 0) {
      console.log(`[PotService] ${pot.name}: skipping ${result.symbol} — price £${entryPrice} exceeds allocation £${positionGBP.toFixed(2)}`);
      continue;
    }
    const actualPositionGBP = shares * entryPrice;

    // For shorts: expected_return_at_entry is our anticipated profit (price fall → positive for us)
    const expReturn = downside;
    const deadline  = addCalendarDays(todayStr, ph.calendarDays);

    const { error } = await supabase.from('pot_positions').insert({
      pot_id:                   pot.pot_id,
      symbol:                   result.symbol,
      direction:                'short',
      entry_date:               todayStr,
      entry_price:              entryPrice,
      shares:                   shares,
      position_size_gbp:        parseFloat(actualPositionGBP.toFixed(2)),
      expected_return_at_entry: parseFloat(expReturn.toFixed(6)),
      patience_horizon:         ph.label,
      exit_deadline:            deadline,
      status:                   'open',
    });

    if (!error) {
      await supabase.from('pot_trades').insert({
        pot_id:            pot.pot_id,
        symbol:            result.symbol,
        action:            'SHORT',
        price:             entryPrice,
        shares:            shares,
        position_size_gbp: parseFloat(actualPositionGBP.toFixed(2)),
        reason:            result.recommendation,
        run_date:          runDateStr,
      });
      heldSyms.add(result.symbol);
      openCount++;
      console.log(`[PotService] ${pot.name}: SHORT ${result.symbol} @ ${entryPrice.toFixed(2)} (score=${ss.toFixed(1)})`);
    }
  }

  // ── PHASE 4: SNAPSHOT ────────────────────────────────────────────────────────

  // Reload fresh open positions so snapshot is accurate
  const { data: freshData } = await supabase
    .from('pot_positions')
    .select('id, position_size_gbp, entry_price, shares, direction, symbol')
    .eq('pot_id', pot.pot_id)
    .eq('status', 'open');

  const freshOpen: Array<{
    id: number; position_size_gbp: number; entry_price: number;
    shares: number; direction: string; symbol: string;
  }> = freshData ?? [];

  const freshOpenGBP = freshOpen.reduce((s, p) => s + p.position_size_gbp, 0);
  const freshCash    = pot.starting_balance + totalRealisedPnl - freshOpenGBP;

  const unrealisedPnl = freshOpen.reduce((sum, pos) => {
    const cp = priceMap[pos.symbol];
    if (!cp) return sum;
    const ret = pos.direction === 'long'
      ? (cp - pos.entry_price) / pos.entry_price
      : (pos.entry_price - cp) / pos.entry_price;
    return sum + ret * pos.position_size_gbp;
  }, 0);

  const portfolioValueFinal = freshCash + freshOpenGBP + unrealisedPnl;

  const { error: snapErr } = await supabase.from('pot_snapshots').upsert({
    pot_id:                  pot.pot_id,
    run_date:                runDateStr,
    portfolio_value:         parseFloat(portfolioValueFinal.toFixed(2)),
    cash_balance:            parseFloat(freshCash.toFixed(2)),
    open_positions_count:    freshOpen.length,
    unrealised_pnl:          parseFloat(unrealisedPnl.toFixed(2)),
    realised_pnl_cumulative: parseFloat(totalRealisedPnl.toFixed(2)),
  }, { onConflict: 'pot_id,run_date' });

  if (snapErr) {
    console.error(`[PotService] ${pot.name}: snapshot write error:`, snapErr.message);
  }

  // ── PHASE 5: Update current price/value on all open positions ──────────────────
  for (const pos of freshOpen) {
    const cp = priceMap[pos.symbol];
    if (!cp) continue;

    const unrealisedReturn = pos.direction === 'long'
      ? (cp - pos.entry_price) / pos.entry_price
      : (pos.entry_price - cp) / pos.entry_price;

    const currentValue = pos.position_size_gbp * (1 + unrealisedReturn);

    await supabase
      .from('pot_positions')
      .update({
        current_price:        cp,
        current_value_gbp:    parseFloat(currentValue.toFixed(2)),
        unrealised_pnl:       parseFloat((currentValue - pos.position_size_gbp).toFixed(2)),
        unrealised_return_pct: parseFloat(unrealisedReturn.toFixed(6)),
      })
      .eq('id', pos.id);
  }
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Called after each live inference pipeline run.
 *
 * @param results   All inference results from this run (all detected anomalies)
 * @param runDate   The date/time of this run (usually new Date())
 * @param runSlot   'morning' | 'afternoon' | 'evening' — which cron slot fired
 */
export async function evaluateRun(
  results:  PipelineResult[],
  runDate:  Date,
  runSlot:  'morning' | 'afternoon' | 'evening'
): Promise<void> {
  const runDateStr = runDate.toISOString();
  const todayStr   = runDate.toISOString().split('T')[0];

  console.log(`\n[PotService] === evaluateRun slot='${runSlot}' results=${results.length} ===`);

  const { supabase } = await import('./db/supabaseClient');

  // 1. Load all pots
  const { data: potsData, error: potsErr } = await supabase.from('pots').select('*');
  if (potsErr || !potsData?.length) {
    console.warn('[PotService] No pots found or load failed:', potsErr?.message ?? 'empty');
    return;
  }
  const allPots: Pot[] = potsData;

  // 2. Filter eligible pots for this run slot
  const eligiblePots = allPots.filter(p => isEligibleForSlot(p.reactivity, runSlot));
  console.log(`[PotService] ${eligiblePots.length}/${allPots.length} pots eligible for slot '${runSlot}'`);
  if (!eligiblePots.length) return;

  const eligiblePotIds = eligiblePots.map(p => p.pot_id);

  // 3. Load all open positions for eligible pots in one query
  const { data: posData } = await supabase
    .from('pot_positions')
    .select('*')
    .in('pot_id', eligiblePotIds)
    .eq('status', 'open');
  const allOpenPositions: Position[] = posData ?? [];

  // 4. Build price map — prefer results (already fetched this run), then Yahoo
  const uniqueSymbols = [...new Set(allOpenPositions.map(p => p.symbol))];
  const priceMap: Record<string, number> = {};

  for (const sym of uniqueSymbols) {
    const fromResult = results.find(r => r.symbol === sym);
    if (fromResult?.current_price && fromResult.current_price > 0) {
      priceMap[sym] = fromResult.current_price;
    }
  }

  const needsFetch = uniqueSymbols.filter(s => !priceMap[s]);
  if (needsFetch.length > 0) {
    console.log(`[PotService] Fetching Yahoo prices for ${needsFetch.length} held symbols not in today's results`);
    for (const sym of needsFetch) {
      await sleep(75);
      const price = await fetchCurrentPrice(sym);
      if (price) {
        priceMap[sym] = price;
      } else {
        console.warn(`[PotService] No price available for ${sym} — exits/unrealised PnL will use entry price`);
      }
    }
  }

  // 5. Load latest realised_pnl_cumulative for each eligible pot
  const { data: prevSnapshots } = await supabase
    .from('pot_snapshots')
    .select('pot_id, realised_pnl_cumulative, run_date')
    .in('pot_id', eligiblePotIds)
    .order('run_date', { ascending: false });

  const prevPnlMap: Record<number, number> = {};
  for (const snap of (prevSnapshots ?? [])) {
    if (prevPnlMap[snap.pot_id] === undefined) {
      prevPnlMap[snap.pot_id] = snap.realised_pnl_cumulative ?? 0;
    }
  }

  // 6. Process each eligible pot
  for (const pot of eligiblePots) {
    try {
      const potPositions = allOpenPositions.filter(p => p.pot_id === pot.pot_id);
      const prevPnl      = prevPnlMap[pot.pot_id] ?? 0;
      await processPot(pot, results, potPositions, priceMap, prevPnl, runDateStr, todayStr, supabase);
    } catch (err: any) {
      console.error(`[PotService] Error processing pot ${pot.name} (id=${pot.pot_id}):`, err.message);
    }
  }

  console.log('[PotService] === evaluateRun complete ===\n');
}
