/**
 * How often do the pots trade on a signal the canonical basis has de-rated?
 *
 * getRecommendation applies a trend-opposition downgrade (LiveInferenceService.ts:997)
 * -- OPPOSING && trendStrength > 0.6 => STRONG_BUY->BUY, BUY->HOLD -- that PotService's
 * resolveHorizonSignal does not. I first quantified this as "1 of 18 BUY trades", which
 * is far too thin a base to decide anything on. It does not need new data though: every
 * inference_results row stores BOTH the post-downgrade `recommendation` AND the
 * `model_d5_return_2w` the pre-downgrade tier is derived from, so the whole history can
 * be measured now.
 *
 * Method: recompute the raw tier with the REAL production resolver and config imported
 * from PotService (not a copy -- a reimplementation here could drift from the thing it
 * claims to measure), then compare against the stored recommendation. Any difference is
 * the downgrade having fired.
 *
 * WINDOW. Restricted to >= 2026-07-12, when HORIZON_TIER_CONFIG's cutoffs were
 * recalibrated for v9.3. Rows before that were scored against different cutoffs, so
 * recomputing them with today's config would manufacture divergences that never happened.
 */
import 'dotenv/config';
import { HORIZON_TIER_CONFIG, resolveTierFromConfig } from '../PotService';

const SINCE = '2026-07-12T00:00:00Z';

async function page<T>(q: (f: number, t: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw error;
    const b = (data ?? []) as T[];
    out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const cfg = HORIZON_TIER_CONFIG.model_d5_return_2w!;

  const rows = await page<any>((f, t) => supabase.from('inference_results')
    .select('symbol, run_date, created_at, model_d5_return_2w, recommendation, trend_alignment, unreliable_reason')
    .gte('created_at', SINCE)
    .order('created_at', { ascending: true }).range(f, t));

  const usable = rows.filter(r => r.model_d5_return_2w != null && r.recommendation);
  console.log(`inference rows since ${SINCE.slice(0, 10)}: ${rows.length}  (usable ${usable.length})`);

  let diverged = 0;
  const pairs = new Map<string, number>();
  const byAlign = new Map<string, { n: number; div: number }>();
  const divKeys = new Set<string>();

  for (const r of usable) {
    const raw = resolveTierFromConfig(r.model_d5_return_2w, cfg);
    const canon = r.recommendation;
    const al = r.trend_alignment ?? '(null)';
    if (!byAlign.has(al)) byAlign.set(al, { n: 0, div: 0 });
    byAlign.get(al)!.n++;
    if (raw !== canon) {
      diverged++;
      byAlign.get(al)!.div++;
      pairs.set(`${raw} -> ${canon}`, (pairs.get(`${raw} -> ${canon}`) ?? 0) + 1);
      divKeys.add(`${String(r.symbol).toUpperCase()}|${r.run_date}`);
    }
  }

  console.log(`\ndowngrade fired on ${diverged}/${usable.length} rows (${(100 * diverged / usable.length).toFixed(1)}%)`);
  console.log('\nraw tier -> canonical recommendation:');
  for (const [k, v] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${v}`);

  console.log('\nby trend_alignment (sanity: divergence should concentrate in OPPOSING):');
  for (const [k, v] of [...byAlign.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${k.padEnd(12)} rows=${String(v.n).padStart(5)}  diverged=${String(v.div).padStart(5)}  ` +
      `(${(100 * v.div / v.n).toFixed(1)}%)`);

  // The number that actually matters: not how often the downgrade fires, but how often
  // a pot TRADED a row the canonical basis had de-rated. Everything else is a row the
  // pots never acted on either way.
  const trades = await page<any>((f, t) => supabase.from('pot_trades')
    .select('pot_id, symbol, action, reason, run_date')
    .gte('run_date', SINCE)
    .in('action', ['BUY', 'SHORT'])
    .order('run_date', { ascending: true }).range(f, t));

  let tradedDiverged = 0;
  const affected = new Map<number, number>();
  for (const t of trades) {
    const k = `${String(t.symbol).toUpperCase()}|${String(t.run_date).slice(0, 10)}`;
    if (divKeys.has(k)) {
      tradedDiverged++;
      affected.set(t.pot_id, (affected.get(t.pot_id) ?? 0) + 1);
    }
  }

  console.log(`\nentry trades since ${SINCE.slice(0, 10)}: ${trades.length}`);
  console.log(`  of which on a DE-RATED row: ${tradedDiverged} ` +
    `(${trades.length ? (100 * tradedDiverged / trades.length).toFixed(1) : '0.0'}%)`);
  if (affected.size) {
    console.log('  by pot:');
    for (const [p, n] of [...affected.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`    pot ${String(p).padStart(2)}: ${n}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
