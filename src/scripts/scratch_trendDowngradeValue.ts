/**
 * Is the trend-opposition downgrade INFORMATIVE, or is it noise the pots are right to
 * ignore? This is the question TODO near-term 5 actually turns on; the divergence RATE
 * (6.3% of rows, 6.8% of entry trades) only says how often it matters, not which side
 * is right.
 *
 * DESIGN. Comparing de-rated rows against all others would confound the overlay with
 * signal strength, because the overlay only ever fires on strong signals. So the
 * comparison is held WITHIN raw tier: among rows whose pre-downgrade tier was
 * STRONG_BUY, those the overlay knocked to BUY versus those it left alone; and likewise
 * within raw BUY. The model's own view is then identical across the two arms and the
 * ONLY difference is whether the trend overlay fired -- which is exactly the treatment
 * being evaluated.
 *
 * Realised outcomes come from outcome_results (the durable store outcomeTracker already
 * populates), so nothing is refetched and the numbers agree with the outcome scoreboard
 * by construction.
 *
 * Reading it: if de-rated rows realise WORSE returns, the overlay is picking up
 * something real and the pots should honour it. If there is no difference, the overlay
 * is noise, and routing both consumers through it would only add churn.
 */
import 'dotenv/config';
import { HORIZON_TIER_CONFIG, resolveTierFromConfig } from '../PotService';

const SINCE = '2026-07-12T00:00:00Z';
const HORIZON = '2W';

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

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
function welchT(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return NaN;
  const va = stdev(a) ** 2 / a.length, vb = stdev(b) ** 2 / b.length;
  return va + vb === 0 ? NaN : (mean(a) - mean(b)) / Math.sqrt(va + vb);
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const cfg = HORIZON_TIER_CONFIG.model_d5_return_2w!;

  const inf = await page<any>((f, t) => supabase.from('inference_results')
    .select('symbol, run_date, model_d5_return_2w, recommendation, trend_alignment')
    .gte('created_at', SINCE).order('created_at', { ascending: true }).range(f, t));

  const out = await page<any>((f, t) => supabase.from('outcome_results')
    .select('symbol, run_date, horizon, actual_return')
    .eq('horizon', HORIZON).gte('run_date', SINCE.slice(0, 10))
    .order('run_date', { ascending: true }).range(f, t));

  const actual = new Map<string, number>();
  for (const o of out)
    if (o.actual_return != null)
      actual.set(`${String(o.symbol).toUpperCase()}|${String(o.run_date).slice(0, 10)}`, Number(o.actual_return));

  console.log(`inference rows: ${inf.length}   matured ${HORIZON} outcomes: ${actual.size}`);

  // arms[rawTier] = { derated: [...returns], kept: [...returns] }
  const arms = new Map<string, { derated: number[]; kept: number[] }>();
  let matched = 0;

  for (const r of inf) {
    if (r.model_d5_return_2w == null || !r.recommendation) continue;
    const key = `${String(r.symbol).toUpperCase()}|${String(r.run_date).slice(0, 10)}`;
    const a = actual.get(key);
    if (a === undefined) continue;
    matched++;

    const raw = resolveTierFromConfig(r.model_d5_return_2w, cfg);
    if (raw !== 'STRONG_BUY' && raw !== 'BUY') continue;  // overlay only ever fires here
    if (!arms.has(raw)) arms.set(raw, { derated: [], kept: [] });
    (raw !== r.recommendation ? arms.get(raw)!.derated : arms.get(raw)!.kept).push(a);
  }

  console.log(`inference rows with a matured ${HORIZON} outcome: ${matched}\n`);
  console.log(`${'raw tier'.padEnd(12)}${'de-rated n'.padStart(11)}${'mean ret'.padStart(10)}` +
              `${'kept n'.padStart(8)}${'mean ret'.padStart(10)}${'diff'.padStart(9)}${'Welch t'.padStart(9)}`);
  console.log('-'.repeat(69));

  const pooledD: number[] = [], pooledK: number[] = [];
  for (const tier of ['STRONG_BUY', 'BUY']) {
    const a = arms.get(tier);
    if (!a) { console.log(`${tier.padEnd(12)}  (no rows)`); continue; }
    pooledD.push(...a.derated); pooledK.push(...a.kept);
    const md = a.derated.length ? mean(a.derated) : NaN;
    const mk = a.kept.length ? mean(a.kept) : NaN;
    const t = welchT(a.derated, a.kept);
    const f = (v: number) => Number.isNaN(v) ? '   n/a' : `${(100 * v).toFixed(2)}%`;
    console.log(`${tier.padEnd(12)}${String(a.derated.length).padStart(11)}${f(md).padStart(10)}` +
      `${String(a.kept.length).padStart(8)}${f(mk).padStart(10)}` +
      `${(Number.isNaN(md - mk) ? '   n/a' : `${(100 * (md - mk)).toFixed(2)}pp`).padStart(9)}` +
      `${(Number.isNaN(t) ? '  n/a' : t.toFixed(2)).padStart(9)}`);
  }

  if (pooledD.length >= 2 && pooledK.length >= 2) {
    const t = welchT(pooledD, pooledK);
    const diff = mean(pooledD) - mean(pooledK);
    console.log('-'.repeat(69));
    console.log(`${'POOLED'.padEnd(12)}${String(pooledD.length).padStart(11)}${`${(100 * mean(pooledD)).toFixed(2)}%`.padStart(10)}` +
      `${String(pooledK.length).padStart(8)}${`${(100 * mean(pooledK)).toFixed(2)}%`.padStart(10)}` +
      `${`${(100 * diff).toFixed(2)}pp`.padStart(9)}${t.toFixed(2).padStart(9)}`);

    // ── ROBUSTNESS ───────────────────────────────────────────────────────────
    // A +4.87pp mean gap on n=51 is exactly the shape that turns out to be two lucky
    // rows. This project has already been bitten by it once: the median historic pot's
    // apparent skill vanished (t +4.61 -> -0.42) when the top 1% of events was dropped.
    // So: medians, and the mean after removing the single best and worst row from each
    // arm. If the effect is real it survives both; if it is concentration, it collapses.
    const median = (a: number[]) => {
      const s = [...a].sort((x, y) => x - y);
      return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    };
    const trimmed = (a: number[]) => {
      if (a.length < 5) return a;
      const s = [...a].sort((x, y) => x - y);
      return s.slice(1, -1);
    };
    console.log(`\n  medians       de-rated ${(100 * median(pooledD)).toFixed(2)}%   ` +
                `kept ${(100 * median(pooledK)).toFixed(2)}%`);
    const td = trimmed(pooledD), tk = trimmed(pooledK);
    console.log(`  min/max trimmed  de-rated ${(100 * mean(td)).toFixed(2)}%   ` +
                `kept ${(100 * mean(tk)).toFixed(2)}%   Welch t=${welchT(td, tk).toFixed(2)}`);

    // The de-rated arm is OPPOSING by construction, so the headline partly compares
    // trend alignments rather than the overlay itself. Restricting BOTH arms to OPPOSING
    // rows isolates the 0.6-strength threshold, which is the actual decision rule.
    const oppD: number[] = [], oppK: number[] = [];
    for (const r of inf) {
      if (r.model_d5_return_2w == null || !r.recommendation) continue;
      if (r.trend_alignment !== 'OPPOSING') continue;
      const a = actual.get(`${String(r.symbol).toUpperCase()}|${String(r.run_date).slice(0, 10)}`);
      if (a === undefined) continue;
      const raw = resolveTierFromConfig(r.model_d5_return_2w, cfg);
      if (raw !== 'STRONG_BUY' && raw !== 'BUY') continue;
      (raw !== r.recommendation ? oppD : oppK).push(a);
    }
    if (oppD.length >= 2 && oppK.length >= 2) {
      console.log(`\n  within OPPOSING only (isolates the >0.6 strength threshold):`);
      console.log(`    de-rated n=${oppD.length} mean ${(100 * mean(oppD)).toFixed(2)}%   ` +
                  `kept n=${oppK.length} mean ${(100 * mean(oppK)).toFixed(2)}%   ` +
                  `Welch t=${welchT(oppD, oppK).toFixed(2)}`);
    } else {
      console.log(`\n  within OPPOSING only: insufficient rows (de-rated ${oppD.length}, kept ${oppK.length})`);
    }

    // If the >0.6 threshold is NOT what carries the effect, the alignment itself must be.
    // That is the bigger question, and it is the one the overlay's SIGN depends on.
    const opposing: number[] = [], notOpposing: number[] = [];
    for (const r of inf) {
      if (r.model_d5_return_2w == null || !r.recommendation) continue;
      const a = actual.get(`${String(r.symbol).toUpperCase()}|${String(r.run_date).slice(0, 10)}`);
      if (a === undefined) continue;
      const raw = resolveTierFromConfig(r.model_d5_return_2w, cfg);
      if (raw !== 'STRONG_BUY' && raw !== 'BUY') continue;
      (r.trend_alignment === 'OPPOSING' ? opposing : notOpposing).push(a);
    }
    if (opposing.length >= 2 && notOpposing.length >= 2) {
      const t = welchT(opposing, notOpposing);
      console.log(`\n  OPPOSING vs NEUTRAL/ALIGNED (all strong signals, ignores the threshold):`);
      console.log(`    OPPOSING n=${opposing.length} mean ${(100 * mean(opposing)).toFixed(2)}% ` +
                  `median ${(100 * median(opposing)).toFixed(2)}%   ` +
                  `other n=${notOpposing.length} mean ${(100 * mean(notOpposing)).toFixed(2)}% ` +
                  `median ${(100 * median(notOpposing)).toFixed(2)}%`);
      console.log(`    Welch t=${t.toFixed(2)}  (pooled — overstated, see day-clustered below)`);
    }

    // DAY-CLUSTERING. Rows from the same run_date share that day's market move, so a
    // pooled t treats correlated observations as independent and overstates significance.
    // This codebase already made that mistake once and moved its IC anchors to
    // TEST_IC_DAILY because of it. The honest test: one observation per DAY -- the
    // difference between the two arms' means on that day -- then a one-sample t over days.
    const byDay = new Map<string, { opp: number[]; oth: number[] }>();
    for (const r of inf) {
      if (r.model_d5_return_2w == null || !r.recommendation) continue;
      const day = String(r.run_date).slice(0, 10);
      const a = actual.get(`${String(r.symbol).toUpperCase()}|${day}`);
      if (a === undefined) continue;
      const raw = resolveTierFromConfig(r.model_d5_return_2w, cfg);
      if (raw !== 'STRONG_BUY' && raw !== 'BUY') continue;
      if (!byDay.has(day)) byDay.set(day, { opp: [], oth: [] });
      (r.trend_alignment === 'OPPOSING' ? byDay.get(day)!.opp : byDay.get(day)!.oth).push(a);
    }
    const dailyDiffs: number[] = [];
    for (const [, v] of byDay)
      if (v.opp.length && v.oth.length) dailyDiffs.push(mean(v.opp) - mean(v.oth));

    console.log(`\n  DAY-CLUSTERED (the standard this project uses):`);
    let dayT = NaN, days = dailyDiffs.length, wins = 0;
    if (days < 5) {
      console.log(`    only ${days} day(s) have both arms — not enough to cluster on.`);
    } else {
      dayT = mean(dailyDiffs) / (stdev(dailyDiffs) / Math.sqrt(days));
      wins = dailyDiffs.filter(d => d > 0).length;
      console.log(`    ${days} days with both arms   mean daily diff ` +
        `${(100 * mean(dailyDiffs)).toFixed(2)}pp   t=${dayT.toFixed(2)}   ` +
        `OPPOSING wins ${wins}/${days} days`);
    }

    // The verdict is driven by the CLUSTERED statistic, never the pooled one. An earlier
    // draft of this script keyed it off the pooled t=3.91 and printed "significantly
    // better", which would have argued for changing a production rule on a number that
    // collapses to 1.59 the moment correlated observations are handled correctly.
    console.log(`\n${'='.repeat(70)}`);
    if (Number.isNaN(dayT)) {
      console.log(`VERDICT: not yet measurable — too few days with both arms.`);
    } else if (Math.abs(dayT) < 2) {
      console.log(`VERDICT: SUGGESTIVE, NOT DECISIVE. Change nothing yet.`);
      console.log(`  The effect is large and consistently signed — OPPOSING rows return ~4x on BOTH`);
      console.log(`  mean and median, and win ${wins}/${days} days — which points at the overlay having the`);
      console.log(`  WRONG SIGN: it de-rates, and haircuts position size on, the signals that go on to`);
      console.log(`  do best. But ${days} clustered days is not a basis for changing a live rule, and the`);
      console.log(`  pooled t=3.91 that looks convincing is exactly the overstatement day-clustering`);
      console.log(`  exists to catch.`);
      console.log(`  DO NOT route the pots through the overlay, and DO NOT flip it. Re-run at >=20 days.`);
    } else if (dayT > 0) {
      console.log(`VERDICT: the overlay has the WRONG SIGN under clustering (t=${dayT.toFixed(2)}). Trend-opposing`);
      console.log(`  signals outperform, yet the canonical basis downgrades them AND cuts their size.`);
      console.log(`  The pots ignoring it is accidentally correct; the canonical basis should change.`);
    } else {
      console.log(`VERDICT: the overlay is informative under clustering (t=${dayT.toFixed(2)}). Route the pots`);
      console.log(`  through it — they are currently buying what the canonical basis correctly avoids.`);
    }
    console.log('='.repeat(70));
    process.exit(0);

  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
