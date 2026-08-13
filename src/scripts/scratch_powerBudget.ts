/**
 * "Sample size is what's binding" — so which lever actually buys sample size?
 *
 * The day-clustered t-stat is  t = IC / (sd / sqrt(D))  over D days. Only two things
 * move it: more DAYS, or a smaller sd. And sd is not one thing — it decomposes:
 *
 *     var(daily IC)  =  sampling noise  +  genuine day-to-day variation
 *
 * Sampling noise is how badly one day's IC is estimated from only n symbols; for a
 * Spearman correlation under the null that is ~1/(n-1). Genuine variation is the market
 * actually behaving differently on different days. The distinction decides strategy:
 *
 *   dominated by SAMPLING  -> scanning more symbols per day shrinks sd directly, and the
 *                             universe expansion is a power lever, not just coverage.
 *   dominated by GENUINE   -> breadth buys almost nothing and only elapsed time helps,
 *                             so the October checkpoint cannot be pulled forward.
 *
 * Measured on LIVE data (inference_results predictions vs outcome_results realised
 * returns), because that is the population the go-live decision is actually about.
 * Read-only.
 *
 * TWO THINGS THIS DOES NOT FIX, BOTH OF WHICH MATTER MORE THAN BREADTH.
 *
 * 1. OVERLAPPING WINDOWS. Day-clustering was adopted to handle correlation WITHIN a day,
 *    and it does. It does nothing about correlation ACROSS days: consecutive run_dates'
 *    2W outcomes share 13 of their 14 days, so daily IC observations are heavily
 *    autocorrelated and D days is nowhere near D independent observations. Every
 *    "days for t=3" below is therefore an OPTIMISTIC floor, and more so at longer
 *    horizons (2W worse than 2D). Doing this properly needs Newey-West with lag = horizon,
 *    or sampling non-overlapping windows; 19 days is far too few to estimate the
 *    autocorrelation, so it is flagged rather than applied.
 *
 * 2. IC ENTERS QUADRATICALLY. days ∝ (sd/IC)², so a 20% larger IC is worth about as much
 *    as infinite breadth, and costs one ensemble rather than a bigger universe.
 */
import 'dotenv/config';

const HORIZONS: Array<{ label: string; head: string }> = [
  { label: '2D', head: 'model_d3_return_2d' },
  { label: '2W', head: 'model_d5_return_2w' },
  { label: '3M', head: 'model_d1_return_3m' },
];
const MIN_PER_DAY = 8;

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
function variance(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1);
}

/** Spearman via rank-transform then Pearson; ties get average ranks. */
function spearman(x: number[], y: number[]): number {
  const rank = (v: number[]) => {
    const idx = v.map((val, i) => [val, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(x), ry = rank(y);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');

  const inf = await page<any>((f, t) => supabase.from('inference_results')
    .select('symbol, run_date, unreliable_reason, ' + HORIZONS.map(h => h.head).join(', '))
    .order('run_date', { ascending: true }).range(f, t));
  const out = await page<any>((f, t) => supabase.from('outcome_results')
    .select('symbol, run_date, horizon, actual_return').order('run_date', { ascending: true }).range(f, t));

  const actual = new Map<string, number>();
  for (const o of out)
    if (o.actual_return != null)
      actual.set(`${o.horizon}|${String(o.symbol).toUpperCase()}|${String(o.run_date).slice(0, 10)}`, Number(o.actual_return));

  const horizonsPresent = [...new Set(out.map((o: any) => o.horizon))];
  console.log(`inference rows ${inf.length}   outcome rows ${out.length}`);
  console.log(`horizons in outcome_results: ${horizonsPresent.join(', ')}\n`);

  // LIVE_FEATURE_PARITY landed 2026-08-09 12:07 UTC and rows either side are not
  // comparable -- atr_shock_score was literally a different quantity before it. Mixing
  // the regimes would measure the boundary, not the model.
  const PARITY = '2026-08-09';

  for (const H of HORIZONS) {
   for (const [regime, keep] of [
     ['PRE-parity (known-broken regime)', (d: string) => d < PARITY],
     ['POST-parity (the one that counts)', (d: string) => d >= PARITY],
   ] as const) {
    const byDay = new Map<string, { p: number[]; y: number[] }>();
    for (const r of inf) {
      if (r.unreliable_reason) continue;
      const pred = r[H.head];
      if (pred == null) continue;
      const day = String(r.run_date).slice(0, 10);
      if (!keep(day)) continue;
      const a = actual.get(`${H.label}|${String(r.symbol).toUpperCase()}|${day}`);
      if (a === undefined) continue;
      if (!byDay.has(day)) byDay.set(day, { p: [], y: [] });
      byDay.get(day)!.p.push(Number(pred));
      byDay.get(day)!.y.push(a);
    }

    const ics: number[] = [], ns: number[] = [];
    for (const [, v] of byDay) {
      if (v.p.length < MIN_PER_DAY) continue;
      if (new Set(v.y).size < 2 || new Set(v.p).size < 2) continue;
      const r = spearman(v.p, v.y);
      if (Number.isFinite(r)) { ics.push(r); ns.push(v.p.length); }
    }

    console.log(`=== ${H.label} — ${regime} ===`);
    if (ics.length < 5) { console.log(`  only ${ics.length} usable day(s) — cannot measure yet\n`); continue; }

    const D = ics.length, ic = mean(ics), totalVar = variance(ics);
    const nMed = [...ns].sort((a, b) => a - b)[Math.floor(ns.length / 2)];
    // Sampling variance of a Spearman r under the null is ~1/(n-1), averaged over days.
    const sampVar = mean(ns.map(n => 1 / Math.max(n - 1, 1)));
    const genuineVar = Math.max(totalVar - sampVar, 0);
    const t = ic / (Math.sqrt(totalVar) / Math.sqrt(D));

    console.log(`  days=${D}  median symbols/day=${nMed}  IC=${ic.toFixed(4)}  sd=${Math.sqrt(totalVar).toFixed(4)}  t=${t.toFixed(2)}`);
    console.log(`  variance split:  sampling ${(100 * sampVar / totalVar).toFixed(1)}%   genuine ${(100 * genuineVar / totalVar).toFixed(1)}%`);

    // What each lever buys, holding the observed IC fixed.
    const daysToT = (sd: number) => Math.ceil((3 * sd / ic) ** 2);
    console.log(`  days needed for t=3 at today's breadth: ${daysToT(Math.sqrt(totalVar))}  (have ${D})`);
    for (const mult of [2, 5, 10]) {
      // More symbols/day shrinks ONLY the sampling term; genuine variation is untouched.
      const sd2 = Math.sqrt(genuineVar + sampVar / mult);
      console.log(`    at ${mult}x symbols/day -> sd ${sd2.toFixed(4)}, days for t=3: ${daysToT(sd2)}`);
    }
    const floor = Math.sqrt(genuineVar);
    console.log(`    breadth FLOOR (infinite symbols): sd ${floor.toFixed(4)}, days for t=3: ${ic !== 0 ? Math.ceil((3 * floor / ic) ** 2) : Infinity}`);
    console.log();
   }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
