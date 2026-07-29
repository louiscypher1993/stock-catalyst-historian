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
 * so the two tools can never disagree on a number. Runnable any time — today it's
 * a dry run (only 2D has matured post-v9.4); re-run after ~Aug 5 for the 2W (rec-
 * basis) readout, and months later for 3M/6M.
 *
 * Usage:
 *   npx tsx src/scripts/readoutHarness.ts                       # supabase, deploy 2026-07-22
 *   npx tsx src/scripts/readoutHarness.ts --source local
 *   npx tsx src/scripts/readoutHarness.ts --deploy 2026-07-22 --position 50 --min-n 30
 */
import 'dotenv/config';
import { loadRows, TEST_IC, HORIZON_ORDER, HORIZON_HEAD, mean, std, spearman, pearson, type Row } from './outcomeScoreboard';
import { roundTripCost } from '../costModel';

const V9_4_DEPLOY = '2026-07-22';
const HORIZON_DAYS: Record<string, number> = { '2D': 2, '2W': 14, '1M': 30, '3M': 91, '6M': 182 };

interface Stats {
  n: number; ic: number; pear: number; signHit: number;
  meanPred: number; meanAct: number; sigPred: number; sigAct: number; sigRatio: number;
  actGross: number; actNet: number; actN: number; meanDiv: number;
}

function computeStats(rows: Row[], positionGBP: number): Stats {
  const n = rows.length;
  const empty: Stats = { n, ic: NaN, pear: NaN, signHit: NaN, meanPred: NaN, meanAct: NaN, sigPred: NaN, sigAct: NaN, sigRatio: NaN, actGross: NaN, actNet: NaN, actN: 0, meanDiv: NaN };
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
    actN: buyIdx.length, meanDiv: mean(div),
  };
}

// ── formatting ──────────────────────────────────────────────────────────────
function pct(v: number, dp = 2): string { return Number.isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(dp) + '%' : '  n/a'; }
function f3(v: number): string { return Number.isFinite(v) ? (v >= 0 ? ' ' : '') + v.toFixed(3) : '  n/a'; }
function dIC(post: number, pre: number): string { return Number.isFinite(post) && Number.isFinite(pre) ? (post - pre >= 0 ? '+' : '') + (post - pre).toFixed(3) : '   —'; }
function addDays(d: string, days: number): string { const x = new Date(d); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); }
function col(s: string, w = 14): string { return s.padStart(w); }

// IC-vs-anchor verdict (the "did it work live" call). Uses the actual n (not a
// hardcoded threshold string) via the standard Spearman SE approximation
// (1/sqrt(n-3)) so the read scales honestly as the sample grows, and treats a
// clearly NEGATIVE IC as its own case — anti-correlated ranking is a materially
// different (and more concerning) result than "no signal yet" (IC≈0).
function icVerdict(h: string, s: Stats): string {
  const anchor = TEST_IC[h];
  if (!Number.isFinite(s.ic)) return 'n/a';
  if (h === '1M') return 'dead-band head — low IC is by design';
  const se = s.n > 3 ? 1 / Math.sqrt(s.n - 3) : NaN;
  const seNote = Number.isFinite(se) ? ` (n=${s.n}, IC SE≈${se.toFixed(3)})` : '';
  if (s.ic >= anchor - 0.03) return `AT/ABOVE the v9.4 anchor ✓ — train/serve parity holding${seNote}`;
  if (s.ic >= anchor * 0.5) return `partway to anchor (${f3(anchor).trim()})${seNote} — watch as n grows`;
  if (s.ic > 0.02) return `well short of anchor ${f3(anchor).trim()}${seNote} ⚠ — live IC << held-out test`;
  if (s.ic < -0.02 && Number.isFinite(se) && Math.abs(s.ic) > se) {
    return `NEGATIVE and outside noise band${seNote} ⚠⚠ — anti-correlated, not just weak; keep watching, do not act on it yet (single early horizon, still n<~500)`;
  }
  return `no live signal yet (IC≈0)${seNote} ⚠ — consistent with noise at this n; re-check as n grows`;
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
  console.log(` source: ${source === 'supabase' ? 'supabase (durable outcome_results)' : source}   ·   cost @ £${positionGBP}   ·   ready threshold n≥${minN}`);
  console.log(` PRE-v9.4:  ${pre.length} rows  (${preDates[0] ?? '—'} → ${preDates[preDates.length - 1] ?? '—'})`);
  console.log(` POST-v9.4: ${post.length} rows  (${postDates[0] ?? '—'} → ${postDates[postDates.length - 1] ?? '—'})`);
  console.log(line);

  // ── readiness matrix ──
  console.log(`\n READINESS`);
  for (const h of HORIZON_ORDER) {
    const pn = post.filter(r => r.horizon === h).length;
    const matures = addDays(earliestPost, HORIZON_DAYS[h]);
    const state = pn >= minN ? `✅ ready       (post n=${pn})`
      : pn > 0 ? `◐ thin         (post n=${pn} < ${minN} — anecdote)`
      : `⏳ pending      (post n=0; first matures ~${matures})`;
    console.log(`   ${h.padEnd(3)} ${HORIZON_HEAD[h].padEnd(16)} ${state}`);
  }

  // ── per-horizon A/B ──
  for (const h of HORIZON_ORDER) {
    const preS = computeStats(pre.filter(r => r.horizon === h), positionGBP);
    const postS = computeStats(post.filter(r => r.horizon === h), positionGBP);
    const anchor = TEST_IC[h];
    console.log(`\n${rule}`);
    console.log(`▸ ${h}  [${HORIZON_HEAD[h]}]   v9.4 test-IC anchor ${f3(anchor).trim()}${h === '2W' ? '   ← recommendation basis' : ''}`);

    if (postS.n === 0) {
      const matures = addDays(earliestPost, HORIZON_DAYS[h]);
      console.log(`   ⏳ post-v9.4 not yet mature (n=0) — first matures ~${matures}.`);
      console.log(`      pre-v9.4 baseline for reference:  IC ${f3(preS.ic).trim()}   σ-ratio ${Number.isFinite(preS.sigRatio) ? preS.sigRatio.toFixed(1) + 'x' : 'n/a'}   n=${preS.n}`);
      continue;
    }

    console.log(`   ${'metric'.padEnd(20)} ${col('pre-v9.4')} ${col('post-v9.4')} ${col('Δ')}`);
    console.log(`   ${'n'.padEnd(20)} ${col(String(preS.n))} ${col(String(postS.n))} ${col('')}`);
    console.log(`   ${'realized IC'.padEnd(20)} ${col(f3(preS.ic))} ${col(f3(postS.ic))} ${col(dIC(postS.ic, preS.ic))}`);
    console.log(`   ${'sign hit-rate'.padEnd(20)} ${col(pct(preS.signHit, 1))} ${col(pct(postS.signHit, 1))} ${col('')}`);
    console.log(`   ${'σ(pred)'.padEnd(20)} ${col(pct(preS.sigPred))} ${col(pct(postS.sigPred))} ${col('')}`);
    console.log(`   ${'σ(actual)'.padEnd(20)} ${col(pct(preS.sigAct))} ${col(pct(postS.sigAct))} ${col('')}`);
    console.log(`   ${'σ-ratio act/pred'.padEnd(20)} ${col(preS.sigRatio.toFixed(1) + 'x')} ${col(postS.sigRatio.toFixed(1) + 'x')} ${col('')}`);
    console.log(`   ${`buy-tier gross (n=${postS.actN})`.padEnd(20)} ${col(pct(preS.actGross))} ${col(pct(postS.actGross))} ${col('')}`);
    console.log(`   ${`buy-tier net @£${positionGBP}`.padEnd(20)} ${col(pct(preS.actNet))} ${col(pct(postS.actNet))} ${col('')}`);
    const ready = postS.n >= minN;
    console.log(`   VERDICT: ${ready ? icVerdict(h, postS) : `thin (n=${postS.n}) — directional only`}`);
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
  console.log(`   • IC approaching the test anchor = train/serve parity held → the deployed model works live.`);
  console.log(`   • σ(pred) widening on D2/D5 = Phenomenon-2 resolving (benign); staying compressed = a real`);
  console.log(`     resolution defect (would motivate v11 size-stratified heads).`);
  console.log(`   • buy-tier GROSS = is the signal real; NET @£${positionGBP} = does it clear cost at this size`);
  console.log(`     (£50 won't — that's the known cost story; the paper-portfolio sim tests viability at size).`);
  console.log(`   • Re-run after ~${addDays(earliestPost, 14)} for the 2W (rec-basis) readout; months later for 3M/6M.\n`);
}

main().catch(e => { console.error('[ReadoutHarness] FATAL:', e); process.exit(1); });
