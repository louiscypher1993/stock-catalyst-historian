/**
 * readoutHarness.ts — the v9.4 pre/post-deploy A/B readout.
 *
 * The outcome scoreboard shows ONE slice at a time. This turns the ~2026-08-05
 * maturity milestone into a single crisp result: for every horizon it puts the
 * PRE-v9.4 baseline and the POST-v9.4 deployed model side by side, diffs them,
 * and scores each against that head's held-out TEST-IC anchor — so "did the fix
 * work live" reads at a glance instead of eyeballing two scoreboard runs.
 *
 * It also carries the Phenomenon-2 verdict (large-cap long-horizon leaf-
 * convergence): the signature is a COMPRESSED σ(pred) while σ(actual) stays wide
 * (high σ-ratio), worst on D2(6M) then D5(2W). Resolution = σ(pred) widening as
 * post-v9.4 data matures. The harness reports σ(pred)/σ-ratio pre→post for those
 * two heads with a directional read.
 *
 * Reuses the scoreboard's EXACT loader + stat helpers (imported, not re-derived)
 * so the two tools can never disagree on a number.
 *
 * DAY-CLUSTERED THROUGHOUT (reworked 2026-07-31). The unit of independence is
 * the RUN_DATE, not the row: every name scanned on one day shares that day's
 * market move. So IC is computed WITHIN each run_date and averaged across dates,
 * significance uses the across-date t-stat with small-sample Student-t critical
 * values, readiness counts run_dates rather than rows, and the comparison target
 * is TEST_IC_DAILY (the anchor re-measured the same way) rather than the pooled
 * TEST_IC. Pooled figures are still printed, labelled "legacy", for continuity
 * with earlier readouts. See icVerdict() for what the day-blind version would
 * have concluded on real data, and dailyIC() in outcomeScoreboard.ts for why.
 *
 * CONSEQUENCE FOR TIMING: 2W needs ~MIN_RUN_DATES scan dates whose 2W windows
 * have closed, so the honest rec-basis verdict lands well after the first 2W row
 * matures (~Aug 5) — plan on early September, and treat anything sooner as
 * directional. This is a real cost of measuring it correctly, not a regression.
 *
 * Usage:
 *   npx tsx src/scripts/readoutHarness.ts                       # supabase, deploy 2026-07-22
 *   npx tsx src/scripts/readoutHarness.ts --source local
 *   npx tsx src/scripts/readoutHarness.ts --deploy 2026-07-22 --position 50 --min-n 30
 */
import 'dotenv/config';
import {
  loadRows, TEST_IC, TEST_IC_DAILY, HORIZON_ORDER, HORIZON_HEAD,
  mean, std, spearman, pearson, dailyIC, tCrit95, type Row, type DailyIC,
} from './outcomeScoreboard';
import { roundTripCost } from '../costModel';

const V9_4_DEPLOY = '2026-07-22';
const HORIZON_DAYS: Record<string, number> = { '2D': 2, '2W': 14, '1M': 30, '3M': 91, '6M': 182 };
// Minimum contributing run_dates before the harness will render a verdict at
// all. Below this the t-stat is too unstable to act on however tempting the
// point estimate looks — at 6 dates the 95% bar is already t≥2.57.
const MIN_RUN_DATES = 10;

interface Stats {
  n: number; ic: number; pear: number; signHit: number;
  meanPred: number; meanAct: number; sigPred: number; sigAct: number; sigRatio: number;
  actGross: number; actNet: number; actN: number; meanDiv: number;
  daily: DailyIC;
}

function computeStats(rows: Row[], positionGBP: number): Stats {
  const n = rows.length;
  const daily = dailyIC(rows);
  const empty: Stats = { n, ic: NaN, pear: NaN, signHit: NaN, meanPred: NaN, meanAct: NaN, sigPred: NaN, sigAct: NaN, sigRatio: NaN, actGross: NaN, actNet: NaN, actN: 0, meanDiv: NaN, daily };
  if (n === 0) return empty;
  const pred = rows.map(r => r.predicted_return);
  const act = rows.map(r => r.actual_return);
  const cost = rows.map(r => roundTripCost(r.symbol, positionGBP).totalBps / 10000);
  const div = rows.map(r => r.dividend_credit ?? 0);
  const net = rows.map((_, i) => act[i] - cost[i] + div[i]);
  const buyIdx = rows.map((r, i) => i).filter(i => rows[i].predicted_tier === 'STRONG_BUY' || rows[i].predicted_tier === 'BUY');
  const sigPred = std(pred), sigAct = std(act);
  return {
    n, ic: spearman(pred, act), pear: pearson(pred, act),
    signHit: mean(rows.map(r => (Math.sign(r.predicted_return) === Math.sign(r.actual_return) ? 1 : 0))),
    meanPred: mean(pred), meanAct: mean(act), sigPred, sigAct, sigRatio: sigAct / sigPred,
    actGross: buyIdx.length ? mean(buyIdx.map(i => act[i])) : NaN,
    actNet: buyIdx.length ? mean(buyIdx.map(i => net[i])) : NaN,
    actN: buyIdx.length, meanDiv: mean(div), daily,
  };
}

// ── formatting ──────────────────────────────────────────────────────────────
function pct(v: number, dp = 2): string { return Number.isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(dp) + '%' : '  n/a'; }
function f3(v: number): string { return Number.isFinite(v) ? (v >= 0 ? ' ' : '') + v.toFixed(3) : '  n/a'; }
function dIC(post: number, pre: number): string { return Number.isFinite(post) && Number.isFinite(pre) ? (post - pre >= 0 ? '+' : '') + (post - pre).toFixed(3) : '   —'; }
function addDays(d: string, days: number): string { const x = new Date(d); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); }
function col(s: string, w = 14): string { return s.padStart(w); }

// IC-vs-anchor verdict (the "did it work live" call).
//
// REWORKED 2026-07-31 — the previous version was day-blind and would have
// declared success on noise. It scored POOLED live IC against the POOLED anchor
// using SE=1/sqrt(n-3), which treats every row as an independent observation.
// Rows from one scan date share that date's market move, so on the post-v9.4 2D
// slice that SE was 2.3x too small (0.0396 vs 0.0923) AND the pooled IC itself
// read 0.174 — comfortably over the `anchor - 0.03` bar — off per-day ICs of
// -0.108/-0.180/+0.078/-0.147/+0.378/+0.227, mean +0.041 at t=0.45. It would
// have printed "AT/ABOVE the v9.4 anchor ✓ — train/serve parity holding" on a
// sample containing no detectable signal, on the one script whose entire job is
// to be right on checkpoint day.
//
// Now: mean daily (cross-sectional) IC vs the DAILY anchor, with two gates that
// must BOTH pass before any claim about the anchor is made —
//   1. enough run_dates for a t-stat to mean anything (MIN_RUN_DATES);
//   2. live signal distinguishable from zero at 95% (Student-t, small-sample
//      critical values — 1.96 is far too permissive at these date counts).
// Only then is live compared to the anchor, and as a two-sample test that
// carries the ANCHOR's uncertainty too (it is itself an estimate off 210-331
// dates), not as a bare threshold.
function icVerdict(h: string, s: Stats): string {
  const d = s.daily;
  const a = TEST_IC_DAILY[h];
  if (!a || !Number.isFinite(d.meanIC)) return 'n/a';

  const desc = `mean daily IC ${f3(d.meanIC).trim()} ± ${d.seIC.toFixed(3)}, t=${d.t.toFixed(2)}, ${d.days} run_date(s), ${(d.pctPos * 100).toFixed(0)}% positive`;
  if (d.days < MIN_RUN_DATES) {
    return `NO VERDICT — only ${d.days} run_date(s), need ≥${MIN_RUN_DATES} (${desc})`;
  }

  const crit = tCrit95(d.days - 1);
  if (h === '1M') {
    return `dead-band head — its daily anchor is ${f3(a.ic).trim()} (≈0 BY DESIGN, not a target); ${desc}`;
  }
  if (d.t <= -crit) {
    return `ANTI-CORRELATED ⚠⚠ — ${desc}; significantly below zero at 95% (|t|≥${crit.toFixed(2)}). Materially worse than "no signal": the ranking is inverted.`;
  }
  if (Math.abs(d.t) < crit) {
    return `NO SIGNAL YET ⚠ — ${desc}; not distinguishable from zero at 95% (needs |t|≥${crit.toFixed(2)} on ${d.days - 1} df). Anchor comparison withheld — a point estimate near ${f3(a.ic).trim()} means nothing at this t.`;
  }

  // Live signal is real. Only now is it worth asking how it compares to the
  // anchor — as a two-sample z carrying both estimates' standard errors.
  const seAnchor = a.sd / Math.sqrt(a.days);
  const z = (d.meanIC - a.ic) / Math.sqrt(d.seIC * d.seIC + seAnchor * seAnchor);
  const vs = `${desc}; vs daily anchor ${f3(a.ic).trim()} z=${z.toFixed(2)}`;
  if (z >= -1) return `AT/ABOVE the v9.4 daily anchor ✓ — train/serve parity holding (${vs})`;
  if (z <= -2) return `REAL signal but SIGNIFICANTLY BELOW the daily anchor ⚠ — ${vs}. Live ranking works, just weaker than held-out test.`;
  return `real signal, below the daily anchor but inside noise — ${vs}`;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const source = arg('--source', 'supabase');
  const deploy = arg('--deploy', V9_4_DEPLOY);
  const positionGBP = Number(arg('--position', '50'));
  const minN = Number(arg('--min-n', '30'));

  const all = await loadRows(source, null, null);
  const pre = all.filter(r => r.run_date < deploy);
  const post = all.filter(r => r.run_date >= deploy);
  const preDates = pre.map(r => r.run_date).sort();
  const postDates = post.map(r => r.run_date).sort();
  const earliestPost = postDates[0] ?? deploy;

  const line = '='.repeat(80);
  const rule = '─'.repeat(80);
  console.log(`\n${line}`);
  console.log(` v9.4 READOUT HARNESS — pre/post-deploy A/B   ·   deploy ${deploy}`);
  console.log(` source: ${source === 'supabase' ? 'supabase (durable outcome_results)' : source}   ·   cost @ £${positionGBP}   ·   verdict needs ≥${MIN_RUN_DATES} run_dates (σ-watch n≥${minN})`);
  console.log(` PRE-v9.4:  ${pre.length} rows  (${preDates[0] ?? '—'} → ${preDates[preDates.length - 1] ?? '—'})`);
  console.log(` POST-v9.4: ${post.length} rows  (${postDates[0] ?? '—'} → ${postDates[postDates.length - 1] ?? '—'})`);
  console.log(line);

  // ── readiness matrix ──
  // Readiness is governed by RUN_DATES, not rows: 600 rows from 3 scan dates
  // still cannot support a verdict, because the day is the unit of independence.
  console.log(`\n READINESS   (unit of independence = run_date, not row)`);
  for (const h of HORIZON_ORDER) {
    const hp = post.filter(r => r.horizon === h);
    const pn = hp.length;
    const days = dailyIC(hp).days;
    const matures = addDays(earliestPost, HORIZON_DAYS[h]);
    const state = days >= MIN_RUN_DATES ? `✅ ready        (${days} run_dates, n=${pn})`
      : pn > 0 ? `◐ thin          (${days}/${MIN_RUN_DATES} run_dates, n=${pn} — directional only)`
      : `⏳ pending       (n=0; first matures ~${matures})`;
    console.log(`   ${h.padEnd(3)} ${HORIZON_HEAD[h].padEnd(16)} ${state}`);
  }

  // ── per-horizon A/B ──
  for (const h of HORIZON_ORDER) {
    const preS = computeStats(pre.filter(r => r.horizon === h), positionGBP);
    const postS = computeStats(post.filter(r => r.horizon === h), positionGBP);
    const anchor = TEST_IC[h];
    const anchorD = TEST_IC_DAILY[h];
    console.log(`\n${rule}`);
    console.log(`▸ ${h}  [${HORIZON_HEAD[h]}]   v9.4 DAILY anchor ${f3(anchorD.ic).trim()} (pooled ${f3(anchor).trim()})${h === '2W' ? '   ← recommendation basis' : ''}`);

    if (postS.n === 0) {
      const matures = addDays(earliestPost, HORIZON_DAYS[h]);
      console.log(`   ⏳ post-v9.4 not yet mature (n=0) — first matures ~${matures}.`);
      console.log(`      pre-v9.4 baseline for reference:  IC ${f3(preS.ic).trim()}   σ-ratio ${Number.isFinite(preS.sigRatio) ? preS.sigRatio.toFixed(1) + 'x' : 'n/a'}   n=${preS.n}`);
      continue;
    }

    console.log(`   ${'metric'.padEnd(20)} ${col('pre-v9.4')} ${col('post-v9.4')} ${col('Δ')}`);
    console.log(`   ${'n (rows)'.padEnd(20)} ${col(String(preS.n))} ${col(String(postS.n))} ${col('')}`);
    console.log(`   ${'run_dates'.padEnd(20)} ${col(String(preS.daily.days))} ${col(String(postS.daily.days))} ${col('')}`);
    console.log(`   ${'MEAN DAILY IC'.padEnd(20)} ${col(f3(preS.daily.meanIC))} ${col(f3(postS.daily.meanIC))} ${col(dIC(postS.daily.meanIC, preS.daily.meanIC))}`);
    console.log(`   ${'  ± SE (clustered)'.padEnd(20)} ${col(f3(preS.daily.seIC))} ${col(f3(postS.daily.seIC))} ${col('')}`);
    const tf = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : ' n/a');
    console.log(`   ${'  t-stat'.padEnd(20)} ${col(tf(preS.daily.t))} ${col(tf(postS.daily.t))} ${col('')}`);
    console.log(`   ${'  % days positive'.padEnd(20)} ${col(pct(preS.daily.pctPos, 0))} ${col(pct(postS.daily.pctPos, 0))} ${col('')}`);
    console.log(`   ${'pooled IC (legacy)'.padEnd(20)} ${col(f3(preS.ic))} ${col(f3(postS.ic))} ${col(dIC(postS.ic, preS.ic))}`);
    console.log(`   ${'sign hit-rate'.padEnd(20)} ${col(pct(preS.signHit, 1))} ${col(pct(postS.signHit, 1))} ${col('')}`);
    console.log(`   ${'σ(pred)'.padEnd(20)} ${col(pct(preS.sigPred))} ${col(pct(postS.sigPred))} ${col('')}`);
    console.log(`   ${'σ(actual)'.padEnd(20)} ${col(pct(preS.sigAct))} ${col(pct(postS.sigAct))} ${col('')}`);
    console.log(`   ${'σ-ratio act/pred'.padEnd(20)} ${col(preS.sigRatio.toFixed(1) + 'x')} ${col(postS.sigRatio.toFixed(1) + 'x')} ${col('')}`);
    console.log(`   ${`buy-tier gross (n=${postS.actN})`.padEnd(20)} ${col(pct(preS.actGross))} ${col(pct(postS.actGross))} ${col('')}`);
    console.log(`   ${`buy-tier net @£${positionGBP}`.padEnd(20)} ${col(pct(preS.actNet))} ${col(pct(postS.actNet))} ${col('')}`);
    // icVerdict now gates on run_dates itself, so it is always called — the old
    // row-count gate could hide a "NO VERDICT" behind a vaguer "thin" message.
    console.log(`   VERDICT: ${icVerdict(h, postS)}`);
  }

  // ── Phenomenon-2 watch (D2 6M primary, D5 2W secondary) ──
  console.log(`\n${line}`);
  console.log(` PHENOMENON-2 WATCH — large-cap long-horizon leaf-convergence`);
  console.log(` signature: σ(pred) compressed while σ(actual) stays wide (high σ-ratio).`);
  console.log(` resolution = σ(pred) WIDENING post-v9.4 (predictions differentiating).`);
  for (const h of ['6M', '2W']) {
    const preS = computeStats(pre.filter(r => r.horizon === h), positionGBP);
    const postS = computeStats(post.filter(r => r.horizon === h), positionGBP);
    const head = HORIZON_HEAD[h];
    if (postS.n < minN) {
      const matures = addDays(earliestPost, HORIZON_DAYS[h]);
      console.log(`   ${h} [${head}]: ⏳ pending (post n=${postS.n}) — matures ~${matures}. pre σ(pred) ${pct(preS.sigPred)}, σ-ratio ${Number.isFinite(preS.sigRatio) ? preS.sigRatio.toFixed(1) + 'x' : 'n/a'}.`);
      continue;
    }
    const widening = postS.sigPred > preS.sigPred * 1.1;
    const ratioDown = postS.sigRatio < preS.sigRatio;
    const read = widening && ratioDown ? 'RESOLVING — predictions differentiating (benign-leaning)'
      : !widening ? 'CONVERGENCE PERSISTS — σ(pred) still compressed (defect-leaning → v11 size-stratified heads)'
      : 'mixed — watch as n grows';
    console.log(`   ${h} [${head}]: σ(pred) ${pct(preS.sigPred)} → ${pct(postS.sigPred)}   σ-ratio ${preS.sigRatio.toFixed(1)}x → ${postS.sigRatio.toFixed(1)}x   ⇒ ${read}`);
  }
  console.log(line);

  // ── how to read ──
  console.log(`\n HOW TO READ`);
  console.log(`   • MEAN DAILY IC is the number. Pooled IC is kept only for continuity with earlier`);
  console.log(`     readouts — it treats one scan date's rows as independent and flatters the result.`);
  console.log(`   • Two gates before any anchor claim: ≥${MIN_RUN_DATES} run_dates, AND |t|≥ the 95% Student-t`);
  console.log(`     critical value. A tempting point estimate at t<2 is noise, not an early win.`);
  console.log(`   • Mean daily IC approaching the DAILY anchor = train/serve parity held → works live.`);
  console.log(`   • σ(pred) widening on D2/D5 = Phenomenon-2 resolving (benign); staying compressed = a real`);
  console.log(`     resolution defect (would motivate v11 size-stratified heads).`);
  console.log(`   • buy-tier GROSS = is the signal real; NET @£${positionGBP} = does it clear cost at this size`);
  console.log(`     (£50 won't — that's the known cost story; the paper-portfolio sim tests viability at size).`);
  console.log(`   • Re-run after ~${addDays(earliestPost, 14)} for the 2W (rec-basis) readout; months later for 3M/6M.\n`);
}

main().catch(e => { console.error('[ReadoutHarness] FATAL:', e); process.exit(1); });
