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

const TOP_N = 3;

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

async function main() {
  const argDate = process.argv[2];

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
  console.log(line);

  let totalBuySignals = 0;

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
      const tier = cfg ? resolveTierFromConfig(val, cfg) : 'HOLD';
      if (tier === 'BUY' || tier === 'STRONG_BUY') totalBuySignals++;
      const name = String(r.company_name ?? '').slice(0, 22).padEnd(22);
      const mark = (tier === 'BUY' || tier === 'STRONG_BUY') ? '✓' : ' ';
      const clamped = Math.abs(Math.abs(val) - h.clamp) < 1e-9 ? ' (clamp)' : '';
      console.log(
        `   ${i + 1}. ${mark} ${String(r.symbol).padEnd(11)} ${name} ` +
        `${pct(val).padStart(8)}${clamped.padEnd(8)} ${tier.padEnd(10)} risk ${r.risk_score ?? '--'}`
      );
    });
  }

  console.log(`\n${line}`);
  console.log(` ${totalBuySignals} of the ${HORIZONS.length * TOP_N} top slots clear a BUY/STRONG_BUY tier today.`);
  console.log(`${line}\n`);
}

main().catch(err => { console.error('[TopBuys] FATAL:', err); process.exit(1); });
