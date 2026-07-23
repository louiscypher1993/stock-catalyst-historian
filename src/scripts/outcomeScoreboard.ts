/**
 * outcomeScoreboard.ts — the analysis layer over outcome_tracker.db.
 *
 * outcomeTracker.ts COLLECTS predicted-vs-actual rows; this turns them into a
 * learning signal. Read-only console report. For each matured horizon it shows:
 *
 *   1. Realized IC  — Spearman rank corr(predicted, actual), anchored against
 *      v9.4's held-out TEST IC (from the 2026-07-23 drop-ablation FULL arm), so
 *      live-vs-test degradation is visible at a glance.
 *   2. Calibration — predicted-return quantile buckets vs mean realized: is the
 *      ranking monotonic, is the SCALE right? (Full population, not top-N.)
 *   3. Tier hit-rate — per stored predicted_tier: n, mean realized, % positive.
 *      Validates the v9.3-recalibrated STRONG_BUY/BUY/SELL thresholds live.
 *
 * Guardrails baked in (see the 2026-07-23 design discussion):
 *   - Horizon-matched by construction (each tracker row is scored at its own
 *     horizon) — a 2W call is judged at +14d, never at +2d.
 *   - Full-population — learning signal is the whole distribution, not the
 *     top-3 the eyeball report shows.
 *   - Small-n honesty — every cell prints n; cells below MIN_N are flagged as
 *     anecdote, calibration buckets are skipped below MIN_BUCKET_N.
 *   - Era awareness — IC is a RANK metric (robust to the frictionless scan-time
 *     entry price the tracker uses), so it's meaningful pre-cost-adjustment;
 *     calibration MAGNITUDE is pre-cost/latency and flagged as such. The
 *     test-IC anchor is v9.4's, so the live-vs-test delta is only apples-to-
 *     apples for run_date >= V9_4_DEPLOY; a warning prints otherwise.
 *
 * Usage:
 *   npx tsx src/scripts/outcomeScoreboard.ts                  # all data
 *   npx tsx src/scripts/outcomeScoreboard.ts --since 2026-07-22   # post-v9.4
 *   npx tsx src/scripts/outcomeScoreboard.ts --since 2026-07-22 --until 2026-08-31
 */
import * as path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUTCOME_DB = path.join(ROOT, 'outcome_tracker.db');

const V9_4_DEPLOY = '2026-07-22'; // B/D1/D2/D3/D5 row-exclusion retrain went live
const MIN_N = 30;                 // below this a whole-horizon stat is anecdote
const MIN_BUCKET_N = 25;          // below this, skip calibration bucketing
const N_BUCKETS = 5;              // quantile buckets for calibration
const DEFAULT_COST = 0.0050;      // round-trip cost netted from realized returns
                                  // (flat 50bps, approved 2026-07-23; --cost <bps>
                                  // overrides). IC is shift-invariant so it's
                                  // unaffected; calibration/tier magnitudes shift.
                                  // NOTE: this is the cost haircut only (step 2a);
                                  // the next-open entry-LATENCY re-source is step
                                  // 2b, a tracker-side change not applied here.

// v9.4 held-out TEST IC per head — from scratch_v10_drop_ablation.py (FULL arm,
// 2026-07-23), served-path Spearman on the held-out temporal test fold. The bar
// live realized IC should approach if train/serve parity holds.
const TEST_IC: Record<string, number> = {
  '2D': 0.1160, // D3
  '2W': 0.2258, // D5
  '1M': 0.0599, // B (dead-band head; IC low by design)
  '3M': 0.2100, // D1
  '6M': 0.1062, // D2
};

const HORIZON_ORDER = ['2D', '2W', '1M', '3M', '6M'];
const HORIZON_HEAD: Record<string, string> = {
  '2D': 'D3', '2W': 'D5 (rec basis)', '1M': 'B (dead band)', '3M': 'D1', '6M': 'D2',
};

interface Row { predicted_return: number; actual_return: number; predicted_tier: string; }

// ── stats helpers ──────────────────────────────────────────────────────────
function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; }

function ranks(a: number[]): number[] {
  // average-rank for ties
  const idx = a.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
  const r = new Array<number>(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // 1-based average rank over the tie block
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}

function spearman(a: number[], b: number[]): number { return pearson(ranks(a), ranks(b)); }

function pct(v: number, dp = 2): string {
  if (!Number.isFinite(v)) return '   n/a';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(dp) + '%';
}
function fixed(v: number, dp = 3): string { return Number.isFinite(v) ? v.toFixed(dp) : ' n/a'; }

// ── main ───────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
  const until = args.includes('--until') ? args[args.indexOf('--until') + 1] : null;
  const cost = args.includes('--cost') ? Number(args[args.indexOf('--cost') + 1]) / 10000 : DEFAULT_COST;

  let db: Database.Database;
  try {
    db = new Database(OUTCOME_DB, { readonly: true, fileMustExist: true });
  } catch {
    console.error(`[Scoreboard] ${OUTCOME_DB} not found or unreadable. Run outcomeTracker.ts first.`);
    process.exit(1);
  }

  const where: string[] = ['actual_return IS NOT NULL', 'predicted_return IS NOT NULL'];
  const params: any[] = [];
  if (since) { where.push('run_date >= ?'); params.push(since); }
  if (until) { where.push('run_date <= ?'); params.push(until); }
  const whereSql = 'WHERE ' + where.join(' AND ');

  const meta = db.prepare(`SELECT COUNT(*) n, MIN(run_date) lo, MAX(run_date) hi FROM outcome_tracker ${whereSql}`).get(...params) as any;
  const line = '='.repeat(78);
  console.log(`\n${line}`);
  console.log(` OUTCOME SCOREBOARD — realized IC · calibration · tier hit-rate`);
  console.log(` ${meta.n} matured rows · run_date ${meta.lo ?? '—'} → ${meta.hi ?? '—'}` +
    (since || until ? `  (filter: since=${since ?? '—'} until=${until ?? '—'})` : ''));
  console.log(` cost model: ${(cost * 10000).toFixed(0)}bps round-trip netted from realized returns (step 2a)`);
  console.log(line);

  if (!meta.n) { console.log('\n No matured rows in range.\n'); db.close(); return; }

  // Era warning: the test-IC anchor is v9.4's.
  if ((meta.hi ?? '') < V9_4_DEPLOY) {
    console.log(`\n ⚠  ALL rows in range predate v9.4 (${V9_4_DEPLOY}). This is a PRE-FIX baseline —`);
    console.log(`    the live-vs-test-IC delta is informational only, NOT a readout of the`);
    console.log(`    deployed model. Re-run with --since ${V9_4_DEPLOY} once post-v9.4 rows mature.`);
  } else if ((meta.lo ?? '') < V9_4_DEPLOY) {
    console.log(`\n ⚠  Range spans the v9.4 deploy (${V9_4_DEPLOY}) — mixes pre/post-fix eras.`);
    console.log(`    Use --since ${V9_4_DEPLOY} to isolate the deployed model.`);
  }

  for (const h of HORIZON_ORDER) {
    const rows = db.prepare(
      `SELECT predicted_return, actual_return, predicted_tier FROM outcome_tracker ${whereSql} AND horizon = ?`
    ).all(...params, h) as Row[];
    if (rows.length === 0) continue;

    const pred = rows.map(r => r.predicted_return);
    const act = rows.map(r => r.actual_return);
    const n = rows.length;
    const ic = spearman(pred, act);
    const pear = pearson(pred, act);
    const hit = mean(rows.map(r => (Math.sign(r.predicted_return) === Math.sign(r.actual_return) ? 1 : 0)));
    const testIc = TEST_IC[h];
    const dIc = Number.isFinite(ic) ? ic - testIc : NaN;
    const anecdote = n < MIN_N ? '  ⚠ low-n (anecdote)' : '';

    console.log(`\n▸ ${h}  [${HORIZON_HEAD[h]}]   n=${n}${anecdote}`);
    console.log(`    realized IC ${fixed(ic)}   vs v9.4 test IC ${fixed(testIc)}   Δ ${Number.isFinite(dIc) ? (dIc >= 0 ? '+' : '') + dIc.toFixed(3) : 'n/a'}`);
    console.log(`    Pearson ${fixed(pear)}   sign hit-rate ${pct(hit, 1)}   mean pred ${pct(mean(pred))}   mean actual ${pct(mean(act))}`);

    // Calibration buckets (quantile bins by predicted_return).
    if (n >= MIN_BUCKET_N) {
      const order = rows.map((_, i) => i).sort((x, y) => pred[x] - pred[y]);
      const per = Math.floor(n / N_BUCKETS);
      console.log(`    calibration (pred quantile → realized gross / net of ${(cost * 10000).toFixed(0)}bps):`);
      for (let b = 0; b < N_BUCKETS; b++) {
        const start = b * per;
        const end = b === N_BUCKETS - 1 ? n : (b + 1) * per;
        const seg = order.slice(start, end);
        const mp = mean(seg.map(i => pred[i]));
        const ma = mean(seg.map(i => act[i]));
        const posPct = mean(seg.map(i => (act[i] - cost > 0 ? 1 : 0)));
        const bar = ma - cost >= 0 ? '+' : '-';
        console.log(`       Q${b + 1}  n=${String(seg.length).padStart(4)}   pred ${pct(mp).padStart(8)} → ${pct(ma).padStart(8)} / net ${pct(ma - cost).padStart(8)}  ${bar}   net-pos ${pct(posPct, 0).padStart(5)}`);
      }
    }

    // Tier hit-rate.
    const tiers = new Map<string, number[]>();
    for (const r of rows) { if (!tiers.has(r.predicted_tier)) tiers.set(r.predicted_tier, []); tiers.get(r.predicted_tier)!.push(r.actual_return); }
    const TIER_ORDER = ['STRONG_BUY', 'BUY', 'HOLD', 'SELL'];
    const present = TIER_ORDER.filter(t => tiers.has(t));
    if (present.length) {
      console.log(`    tier hit-rate (predicted_tier → realized gross / net of ${(cost * 10000).toFixed(0)}bps):`);
      for (const t of present) {
        const a = tiers.get(t)!;
        const netPos = mean(a.map(x => (x - cost > 0 ? 1 : 0)));
        console.log(`       ${t.padEnd(11)} n=${String(a.length).padStart(4)}   mean ${pct(mean(a)).padStart(8)} / net ${pct(mean(a) - cost).padStart(8)}   net-pos ${pct(netPos, 0).padStart(5)}`);
      }
      // Actionable bottom line: the tiers you'd actually put capital on.
      const buys = [...(tiers.get('STRONG_BUY') ?? []), ...(tiers.get('BUY') ?? [])];
      if (buys.length) {
        const netMean = mean(buys) - cost;
        const verdict = netMean > 0 ? 'clears cost ✓' : 'loses to cost ✗';
        console.log(`    ▪ actionable (STRONG_BUY+BUY) n=${buys.length}: mean net ${pct(netMean)}  → ${verdict}`);
      }
    }
  }

  console.log(`\n${line}`);
  console.log(` IC = Spearman rank corr(predicted, actual); shift-invariant, so the ${(cost * 10000).toFixed(0)}bps cost`);
  console.log(` does NOT change it. 'net' figures = realized − cost (step 2a applied). Still`);
  console.log(` PRE-latency: entry is scan-time price, not next-open (step 2b, tracker-side).`);
  console.log(`${line}\n`);
  db.close();
}

main();
