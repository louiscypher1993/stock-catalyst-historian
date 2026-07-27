/**
 * topBuysReport.ts — top-3 buys per horizon, from the latest inference_results.
 *
 * Standalone, read-only console report. For each of the 5 model horizons it
 * ranks the run's symbols by that head's predicted return, shows the top 3,
 * and classifies each against the SAME `HORIZON_TIER_CONFIG` the live pipeline
 * uses (imported, not re-hardcoded, so thresholds can never drift from
 * PotService). `unreliable_reason`-flagged rows are excluded (they'd otherwise
 * dominate the ranking with un-trustworthy extremes — the same rows the
 * outcome tracker excludes).
 *
 * Usage:
 *   npx tsx src/scripts/topBuysReport.ts            # latest run
 *   npx tsx src/scripts/topBuysReport.ts 2026-07-20 # a specific run_date
 */
import 'dotenv/config';
import { supabase } from '../db/supabaseClient';
import { HORIZON_TIER_CONFIG, resolveTierFromConfig } from '../PotService';
import { roundTripCost, minViablePosition } from '../costModel';

const TOP_N = 3;
const DEFAULT_POSITION_GBP = 50; // Lewis's starting size (2026-07-24); --position <gbp> overrides

// Horizon label → inference_results column (== HORIZON_TIER_CONFIG key), plus
// the symmetric clamp ceiling LiveInferenceService applies before storing each
// head (so a prediction sitting exactly at the ceiling can be marked, not
// mistaken for a literal point estimate).
const HORIZONS: Array<{ label: string; field: string; clamp: number; note?: string }> = [
  { label: '2D', field: 'model_d3_return_2d', clamp: 0.20 },
  { label: '2W', field: 'model_d5_return_2w', clamp: 0.35, note: 'recommendation basis' },
  { label: '1M', field: 'model_b_return_1m',  clamp: 0.30, note: 'DEAD BAND — always HOLD by design' },
  { label: '3M', field: 'model_d1_return_3m', clamp: 0.50 },
  { label: '6M', field: 'model_d2_return_6m', clamp: 0.40 },
];

type Row = Record<string, any>;

function pct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '   n/a';
  const s = (v * 100).toFixed(2);
  return (v >= 0 ? '+' : '') + s + '%';
}

// Human-readable summary of a head's buy thresholds. Recovers the display
// cutoffs by scanning for the lowest value that resolves to each tier via the
// real resolveTierFromConfig — robust to range predicates (D5's `buy` is a
// bounded interval, which a monotonic binary search would misread).
function thresholdSummary(field: string): string {
  const cfg = (HORIZON_TIER_CONFIG as Record<string, any>)[field];
  if (!cfg || (!cfg.strongBuy && !cfg.buy)) return 'no buy tier (HOLD ceiling)';
  // Integer-indexed 1e-6 scan over the [0, 0.5] buy region — buys are positive
  // and all cutoffs are exact multiples of 1e-6, so this lands on them exactly
  // (a float-accumulating `v += step` loop drifts ~0.01pp).
  let firstStrongBuy: number | null = null;
  let firstBuy: number | null = null;
  for (let i = 0; i <= 500000; i++) {
    const v = i * 1e-6;
    const tier = resolveTierFromConfig(v, cfg);
    if (firstBuy === null && tier === 'BUY') firstBuy = v;
    if (firstStrongBuy === null && tier === 'STRONG_BUY') { firstStrongBuy = v; break; }
  }
  const parts: string[] = [];
  if (firstBuy != null)        parts.push(`buy ≥ ${pct(firstBuy)}`);
  if (firstStrongBuy != null)  parts.push(`strongBuy ≥ ${pct(firstStrongBuy)}`);
  return parts.length ? parts.join(' · ') : 'no buy tier (HOLD ceiling)';
}

// Cross-horizon buy agreement: how many of the 5 heads independently rate this
// symbol a BUY/STRONG_BUY. A cheap, data-grounded confirmation signal for the
// "why" line — no SHAP/feature vector needed (inference_results stores neither).
function buyAgreement(r: Row): number {
  let c = 0;
  for (const h of HORIZONS) {
    const v = r[h.field];
    if (typeof v !== 'number') continue;
    const cfg = (HORIZON_TIER_CONFIG as Record<string, any>)[h.field];
    const t = cfg ? resolveTierFromConfig(v, cfg) : 'HOLD';
    if (t === 'BUY' || t === 'STRONG_BUY') c++;
  }
  return c;
}

async function main() {
  const args = process.argv.slice(2);
  const positionGBP = args.includes('--position') ? Number(args[args.indexOf('--position') + 1]) : DEFAULT_POSITION_GBP;
  const argDate = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

  let runDate = argDate;
  if (!runDate) {
    const { data, error } = await supabase
      .from('inference_results').select('run_date')
      .order('run_date', { ascending: false }).limit(1);
    if (error) { console.error('[TopBuys] failed to read latest run_date:', error.message); process.exit(1); }
    runDate = data?.[0]?.run_date;
  }
  if (!runDate) { console.error('[TopBuys] no inference_results rows found.'); process.exit(1); }

  const cols = ['symbol', 'company_name', 'recommendation', 'unreliable_reason', 'risk_score',
    ...HORIZONS.map(h => h.field)].join(',');
  const { data: rows, error } = await supabase.from('inference_results').select(cols).eq('run_date', runDate);
  if (error) { console.error('[TopBuys] fetch failed:', error.message); process.exit(1); }

  const all = (rows ?? []) as Row[];
  const ranked = all.filter(r => !r.unreliable_reason);
  const excluded = all.length - ranked.length;

  const line = '='.repeat(72);
  console.log(`\n${line}`);
  console.log(` TOP-${TOP_N} BUYS PER HORIZON — inference run ${runDate}`);
  console.log(` ${all.length} symbols scored · ${excluded} excluded (unreliable) · ${ranked.length} ranked`);
  console.log(` cost @ £${positionGBP} position (IBKR 0.1%/$1-min/$2-FX) · ✓ = signal clears its own round-trip cost`);
  console.log(line);

  let totalBuySignals = 0;
  let belowCostBuys = 0;

  for (const h of HORIZONS) {
    const cfg = (HORIZON_TIER_CONFIG as Record<string, any>)[h.field];
    const withVal = ranked
      .filter(r => typeof r[h.field] === 'number')
      .sort((a, b) => b[h.field] - a[h.field]);
    const top = withVal.slice(0, TOP_N);

    const noteStr = h.note ? `  [${h.note}]` : '';
    console.log(`\n▸ ${h.label}  (${h.field})  —  ${thresholdSummary(h.field)}${noteStr}`);
    if (top.length === 0) { console.log('    (no scored rows)'); continue; }

    top.forEach((r, i) => {
      const val = r[h.field] as number;
      const sym = String(r.symbol);
      const tier = cfg ? resolveTierFromConfig(val, cfg) : 'HOLD';
      const isBuy = tier === 'BUY' || tier === 'STRONG_BUY';
      // Real per-symbol round-trip cost at the assumed position (costModel is the
      // single source of truth — no reimplemented constant). '✓' = the predicted
      // return clears its own cost at this size; '~' = buy tier that doesn't.
      const costBps = roundTripCost(sym, positionGBP).totalBps;
      const clearsCost = val * 10000 > costBps;
      if (isBuy) { totalBuySignals++; if (!clearsCost) belowCostBuys++; }
      const name = String(r.company_name ?? '').slice(0, 22).padEnd(22);
      const mark = isBuy ? (clearsCost ? '✓' : '~') : ' ';
      const clamped = Math.abs(Math.abs(val) - h.clamp) < 1e-9 ? ' (clamp)' : '';
      console.log(
        `   ${i + 1}. ${mark} ${sym.padEnd(11)} ${name} ` +
        `${pct(val).padStart(8)}${clamped.padEnd(8)} ${tier.padEnd(10)} risk ${r.risk_score ?? '--'}`
      );
      const agree = buyAgreement(r);
      // break-even size: smallest position where round-trip cost < this signal's
      // predicted return — the actionable "how big to make this trade worthwhile".
      const breakEven = minViablePosition(sym, val * 10000);
      const costStr = clearsCost
        ? `cost ${costBps.toFixed(0)}bps @£${positionGBP} ✓`
        : (breakEven
            ? `cost ${costBps.toFixed(0)}bps @£${positionGBP} → nets only ≥ £${breakEven.toFixed(0)}`
            : `cost ${costBps.toFixed(0)}bps @£${positionGBP} → never nets (tax floor > signal)`);
      const bits = [`${agree}/${HORIZONS.length} horizons buy`, costStr];
      if (clamped) bits.push('clamp');
      console.log(`         why: ${bits.join(' · ')}`);
    });
  }

  console.log(`\n${line}`);
  console.log(` ${totalBuySignals} of the ${HORIZONS.length * TOP_N} top slots clear a BUY/STRONG_BUY tier` +
    (belowCostBuys > 0 ? `; ${belowCostBuys} do NOT clear their round-trip cost at £${positionGBP} — see each pick's break-even size.` : `.`));
  console.log(` At £${positionGBP}, fixed IBKR costs (~£4.80 US round-trip) dominate; raise --position to see viability at size.`);
  console.log(`${line}\n`);
}

main().catch(err => { console.error('[TopBuys] FATAL:', err); process.exit(1); });
