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
import 'dotenv/config';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import Database from 'better-sqlite3';
import { roundTripCost } from '../costModel';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUTCOME_DB = path.join(ROOT, 'outcome_tracker.db');

const V9_4_DEPLOY = '2026-07-22'; // B/D1/D2/D3/D5 row-exclusion retrain went live
const MIN_N = 30;                 // below this a whole-horizon stat is anecdote
const MIN_BUCKET_N = 25;          // below this, skip calibration bucketing
const N_BUCKETS = 5;              // quantile buckets for calibration
const DEFAULT_POSITION_GBP = 50;  // assumed position for cost-netting (Lewis's
                                  // start size 2026-07-24; --position <gbp> overrides).
                                  // Cost is PER-SYMBOL via costModel (US vs UK differ
                                  // hugely at small size). IC is cost-INDEPENDENT (a
                                  // rank metric) so it's unchanged; only calibration-
                                  // net / tier-net / actionable figures move with size.

// v9.4 held-out TEST IC per head — from scratch_v10_drop_ablation.py (FULL arm,
// 2026-07-23), served-path Spearman on the held-out temporal test fold. The bar
// live realized IC should approach if train/serve parity holds.
// Exported (with loadRows + the stat helpers below) so readoutHarness.ts computes
// the identical IC/σ off the identical loader — no divergence between the two tools.
export const TEST_IC: Record<string, number> = {
  '2D': 0.1160, // D3
  '2W': 0.2258, // D5
  '1M': 0.0599, // B (dead-band head; IC low by design)
  '3M': 0.2100, // D1
  '6M': 0.1062, // D2
};

// v9.4 held-out TEST IC per head, measured the way the LIVE side should be
// measured: cross-sectional Spearman WITHIN each test date, then averaged across
// dates (`src/ml/scratch_testfold_ic_by_date.py`, 2026-07-31). `sd`/`days` are
// the across-date spread and the number of contributing dates, which give the
// anchor its own standard error (sd/sqrt(days)) so live-vs-anchor can be a real
// two-sample comparison instead of a bare threshold.
//
// WHY THIS EXISTS ALONGSIDE TEST_IC. Pooling one Spearman over every row of the
// test fold lets BETWEEN-DATE variation count as skill: if predictions run high
// in periods that realized high returns, pooled IC rewards that even though the
// live system uses these numbers to RANK NAMES AGAINST EACH OTHER on a given
// day. The cross-sectional job is the daily number. The gap is large and not
// uniform — 3M falls 0.2100→0.0709 and 2W (the recommendation basis) halves,
// 0.2258→0.1111 — so the pooled anchors were a materially soft bar. The script's
// pooled arm reproduces all five TEST_IC values exactly, which is what proves
// these are the same models on the same fold, measured differently.
//
// NOTE ON `sd`: the test fold carries a median ~21-23 names per date, while the
// live scan carries ~100-200. Fewer names per date = a noisier per-date IC, so
// the anchor's `sd` is an UPPER bound on what live daily spread should look
// like. The MEAN is comparable; the spread is not, so don't read live sd < 0.30
// as an improvement.
export const TEST_IC_DAILY: Record<string, { ic: number; sd: number; days: number }> = {
  '2D': { ic: 0.0826, sd: 0.2968, days: 330 }, // D3   (pooled 0.1160)
  '2W': { ic: 0.1111, sd: 0.3376, days: 331 }, // D5   (pooled 0.2258)
  '1M': { ic: -0.0278, sd: 0.2799, days: 313 }, // B   (pooled 0.0599) — dead-band head, ≈0 by design
  '3M': { ic: 0.0709, sd: 0.3177, days: 275 }, // D1   (pooled 0.2100)
  '6M': { ic: 0.0977, sd: 0.2953, days: 210 }, // D2   (pooled 0.1062)
};

export const HORIZON_ORDER = ['2D', '2W', '1M', '3M', '6M'];
export const HORIZON_HEAD: Record<string, string> = {
  '2D': 'D3', '2W': 'D5 (rec basis)', '1M': 'B (dead band)', '3M': 'D1', '6M': 'D2',
};

export interface Row { symbol: string; run_date: string; horizon: string; predicted_return: number; actual_return: number; predicted_tier: string; dividend_credit: number | null; }

// ── stats helpers ──────────────────────────────────────────────────────────
export function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; }
export function std(a: number[]): number { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length); }

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

export function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return NaN;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  const den = Math.sqrt(da * db);
  return den === 0 ? NaN : num / den;
}

export function spearman(a: number[], b: number[]): number { return pearson(ranks(a), ranks(b)); }

// ── day-clustered IC ────────────────────────────────────────────────────────
// Rows from one scan date are NOT independent observations: they share that
// day's market move, so a pooled IC's naive SE (1/sqrt(n-3)) badly overstates
// confidence — measured at 2.3x on the 2026-07-31 post-v9.4 2D slice (pooled SE
// 0.0396 vs day-clustered 0.0923). Worse, a pooled IC is dominated by whichever
// dates contributed the most rows: that same slice read pooled IC 0.174 (an
// apparent pass vs the 0.116 anchor) off per-day ICs of -0.108/-0.180/+0.078/
// -0.147/+0.378/+0.227, i.e. mean +0.041 at t=0.45 — no signal at all.
//
// So: IC within each run_date, then summarised across dates. `t` is the standard
// IC t-stat (mean / (sd/sqrt(days))); `ir` is the information ratio (mean/sd).
// Dates with fewer than `minPerDay` names have no meaningful cross-section to
// rank and are dropped rather than contributing a near-random IC.
export interface DailyIC {
  days: number; meanIC: number; sdIC: number; seIC: number; t: number; ir: number;
  pctPos: number; medianPerDay: number; rowsUsed: number;
  perDay: Array<{ date: string; n: number; ic: number }>;
}

export function dailyIC(rows: Row[], minPerDay = 8): DailyIC {
  const byDate = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byDate.has(r.run_date)) byDate.set(r.run_date, []);
    byDate.get(r.run_date)!.push(r);
  }
  const perDay: Array<{ date: string; n: number; ic: number }> = [];
  for (const date of [...byDate.keys()].sort()) {
    const g = byDate.get(date)!;
    if (g.length < minPerDay) continue;
    const ic = spearman(g.map(r => r.predicted_return), g.map(r => r.actual_return));
    if (Number.isFinite(ic)) perDay.push({ date, n: g.length, ic });
  }
  const empty: DailyIC = { days: perDay.length, meanIC: NaN, sdIC: NaN, seIC: NaN, t: NaN, ir: NaN, pctPos: NaN, medianPerDay: NaN, rowsUsed: 0, perDay };
  if (perDay.length < 2) return empty;
  const ics = perDay.map(d => d.ic);
  const m = mean(ics);
  // sample sd (ddof=1) — these dates are a SAMPLE of trading days, not the population
  const sd = Math.sqrt(ics.reduce((s, v) => s + (v - m) * (v - m), 0) / (ics.length - 1));
  const se = sd / Math.sqrt(ics.length);
  const ns = perDay.map(d => d.n).sort((a, b) => a - b);
  return {
    days: perDay.length, meanIC: m, sdIC: sd, seIC: se,
    t: se > 0 ? m / se : NaN, ir: sd > 0 ? m / sd : NaN,
    pctPos: ics.filter(v => v > 0).length / ics.length,
    medianPerDay: ns[Math.floor(ns.length / 2)],
    rowsUsed: perDay.reduce((s, d) => s + d.n, 0),
    perDay,
  };
}

// Two-sided 95% Student-t critical value. With only a handful of run_dates the
// normal approximation (1.96) is far too permissive — at 5 dates the real bar is
// 2.776 — and the whole point of this rework is to stop declaring victory early.
export function tCrit95(df: number): number {
  const table: Record<number, number> = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
    9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.080, 22: 2.074,
    23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
  };
  if (df < 1) return NaN;
  if (df <= 30) return table[df];
  if (df <= 60) return 2.000;
  if (df <= 120) return 1.980;
  return 1.960;
}

function pct(v: number, dp = 2): string {
  if (!Number.isFinite(v)) return '   n/a';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(dp) + '%';
}
function fixed(v: number, dp = 3): string { return Number.isFinite(v) ? v.toFixed(dp) : ' n/a'; }

// ── data loading (local sqlite | durable Supabase outcome_results) ──────────
export async function loadRows(source: string, since: string | null, until: string | null): Promise<Row[]> {
  if (source === 'supabase') return loadFromSupabase(since, until);
  if (source !== 'local') { console.error(`[Scoreboard] unknown --source '${source}' (use local|supabase).`); process.exit(1); }
  return loadFromSqlite(since, until);
}

function loadFromSqlite(since: string | null, until: string | null): Row[] {
  let db: Database.Database;
  try {
    db = new Database(OUTCOME_DB, { readonly: true, fileMustExist: true });
  } catch {
    console.error(`[Scoreboard] ${OUTCOME_DB} not found or unreadable. Run outcomeTracker.ts first, or use --source supabase.`);
    process.exit(1);
  }
  // dividend_credit is added by enrichDividendCredit.ts, which may not have run
  // against this db yet — select it only if the column exists (else default null),
  // so the scoreboard never breaks on an un-enriched db.
  const hasDiv = (db.prepare(`PRAGMA table_info(outcome_tracker)`).all() as Array<{ name: string }>)
    .some(c => c.name === 'dividend_credit');
  const where = ['actual_return IS NOT NULL', 'predicted_return IS NOT NULL'];
  const params: any[] = [];
  if (since) { where.push('run_date >= ?'); params.push(since); }
  if (until) { where.push('run_date <= ?'); params.push(until); }
  const rows = db.prepare(
    `SELECT symbol, run_date, horizon, predicted_return, actual_return, predicted_tier` +
    `${hasDiv ? ', dividend_credit' : ''} FROM outcome_tracker WHERE ${where.join(' AND ')}`
  ).all(...params) as Row[];
  db.close();
  return hasDiv ? rows : rows.map(r => ({ ...r, dividend_credit: null }));
}

async function loadFromSupabase(since: string | null, until: string | null): Promise<Row[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) { console.error('[Scoreboard] --source supabase needs SUPABASE_URL + SUPABASE_(SERVICE_ROLE|ANON)_KEY.'); process.exit(1); }
  const filters = ['actual_return=not.is.null', 'predicted_return=not.is.null'];
  if (since) filters.push(`run_date=gte.${since}`);
  if (until) filters.push(`run_date=lte.${until}`);
  // Probe for dividend_credit (added by supabase_dividend_credit_migration.sql,
  // which may not be applied yet) — include it in the select only if present, so
  // the read never 400s on an un-migrated table.
  const probe = await fetch(`${url}/rest/v1/outcome_results?select=dividend_credit&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const hasDiv = probe.ok;
  const select = `select=symbol,run_date,horizon,predicted_return,actual_return,predicted_tier${hasDiv ? ',dividend_credit' : ''}`;
  const out: Row[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const q = `${url}/rest/v1/outcome_results?${select}&${filters.join('&')}&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Set exitCode + throw rather than process.exit(): a synchronous exit
      // while the fetch socket is still tearing down trips a libuv assertion on
      // Windows. Throwing lets main().catch report and the loop drain cleanly.
      if (res.status === 404 || /does not exist|outcome_results/i.test(body)) {
        process.exitCode = 1;
        throw new Error('outcome_results not found — apply src/db/supabase_outcome_results_migration.sql, then let one tracker run populate it.');
      }
      process.exitCode = 1;
      throw new Error(`Supabase read failed: HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const page = await res.json() as Row[];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return hasDiv ? out : out.map(r => ({ ...r, dividend_credit: null }));
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
  const until = args.includes('--until') ? args[args.indexOf('--until') + 1] : null;
  const positionGBP = args.includes('--position') ? Number(args[args.indexOf('--position') + 1]) : DEFAULT_POSITION_GBP;
  const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'local';

  const allRows = await loadRows(source, since, until);
  const meanCostBps = allRows.length ? mean(allRows.map(r => roundTripCost(r.symbol, positionGBP).totalBps)) : NaN;

  const runDates = allRows.map(r => r.run_date).sort();
  const metaN = allRows.length;
  const metaLo = runDates[0];
  const metaHi = runDates[runDates.length - 1];
  const line = '='.repeat(78);
  console.log(`\n${line}`);
  console.log(` OUTCOME SCOREBOARD — realized IC · calibration · tier hit-rate`);
  console.log(` source: ${source === 'supabase' ? 'supabase (durable outcome_results)' : 'local (outcome_tracker.db)'}`);
  console.log(` ${metaN} matured rows · run_date ${metaLo ?? '—'} → ${metaHi ?? '—'}` +
    (since || until ? `  (filter: since=${since ?? '—'} until=${until ?? '—'})` : ''));
  console.log(` cost: per-symbol IBKR round-trip @ £${positionGBP} position (mean ${Number.isFinite(meanCostBps) ? meanCostBps.toFixed(0) : '—'}bps across rows; --position to vary)`);
  console.log(line);

  if (!metaN) { console.log('\n No matured rows in range.\n'); return; }

  // Era warning: the test-IC anchor is v9.4's.
  if ((metaHi ?? '') < V9_4_DEPLOY) {
    console.log(`\n ⚠  ALL rows in range predate v9.4 (${V9_4_DEPLOY}). This is a PRE-FIX baseline —`);
    console.log(`    the live-vs-test-IC delta is informational only, NOT a readout of the`);
    console.log(`    deployed model. Re-run with --since ${V9_4_DEPLOY} once post-v9.4 rows mature.`);
  } else if ((metaLo ?? '') < V9_4_DEPLOY) {
    console.log(`\n ⚠  Range spans the v9.4 deploy (${V9_4_DEPLOY}) — mixes pre/post-fix eras.`);
    console.log(`    Use --since ${V9_4_DEPLOY} to isolate the deployed model.`);
  }

  for (const h of HORIZON_ORDER) {
    const rows = allRows.filter(r => r.horizon === h);
    if (rows.length === 0) continue;

    const pred = rows.map(r => r.predicted_return);
    const act = rows.map(r => r.actual_return);
    // Per-row round-trip cost at the assumed position (costModel, per-symbol —
    // US vs UK differ hugely at small size). Dividend credit (enrichDividendCredit,
    // null until enriched → 0) claws back the dividend the price-only actual_return
    // omits. net = realized_price_return − cost + dividend_credit.
    const costArr = rows.map(r => roundTripCost(r.symbol, positionGBP).totalBps / 10000);
    const divArr = rows.map(r => r.dividend_credit ?? 0);
    const net = rows.map((_, i) => act[i] - costArr[i] + divArr[i]);
    const nDiv = rows.filter(r => r.dividend_credit != null).length;
    const n = rows.length;
    const ic = spearman(pred, act);
    const pear = pearson(pred, act);
    const hit = mean(rows.map(r => (Math.sign(r.predicted_return) === Math.sign(r.actual_return) ? 1 : 0)));
    const testIc = TEST_IC[h];
    const dIc = Number.isFinite(ic) ? ic - testIc : NaN;
    const anecdote = n < MIN_N ? '  ⚠ low-n (anecdote)' : '';

    console.log(`\n▸ ${h}  [${HORIZON_HEAD[h]}]   n=${n}${anecdote}`);
    console.log(`    pooled IC   ${fixed(ic)}   vs v9.4 pooled test IC ${fixed(testIc)}   Δ ${Number.isFinite(dIc) ? (dIc >= 0 ? '+' : '') + dIc.toFixed(3) : 'n/a'}`);
    // The number to actually read. Pooled IC above is kept for continuity with
    // the earlier readouts, but it treats one scan date's rows as independent
    // observations and is dominated by the highest-row dates — see dailyIC().
    const d = dailyIC(rows);
    const anchorD = TEST_IC_DAILY[h];
    if (d.days >= 2) {
      const crit = tCrit95(d.days - 1);
      const sig = Math.abs(d.t) >= crit ? '' : `  (not significant at 95%: |t| < ${crit.toFixed(2)} on ${d.days - 1} df)`;
      console.log(`    mean daily IC ${fixed(d.meanIC)} ± ${fixed(d.seIC)}  t=${d.t.toFixed(2)}  over ${d.days} run_date(s), median ${d.medianPerDay} names/day, ${(d.pctPos * 100).toFixed(0)}% days positive${sig}`);
      console.log(`      vs v9.4 DAILY anchor ${fixed(anchorD.ic)}  ⇐ the like-for-like bar (pooled anchor ${fixed(testIc)} counts between-date moves as skill)`);
    } else {
      console.log(`    mean daily IC — only ${d.days} usable run_date(s) (need ≥2, and ≥8 names on a date to count it)`);
    }
    console.log(`    Pearson ${fixed(pear)}   sign hit-rate ${pct(hit, 1)}   mean pred ${pct(mean(pred))}   mean actual ${pct(mean(act))}`);
    // Phenomenon-2 under-resolution check: if the model compresses predictions
    // (small σ) while realized returns spread wide (large σ), it's over-smoothing
    // — the large-cap-clustering signature. Watch the ratio grow as post-v9.4
    // data matures; the per-bucket σ(act) below localizes WHICH prediction band.
    const sp = std(pred), sa = std(act);
    console.log(`    resolution: σ(pred) ${pct(sp)}  σ(actual) ${pct(sa)}  σ-ratio ${Number.isFinite(sa / sp) ? (sa / sp).toFixed(1) + 'x' : 'n/a'}  (high ⇒ predictions under-dispersed vs reality)`);
    // Dividend credit (price-only actual_return omits dividends; this claws them
    // back into net). mean over the horizon + how many rows are enriched.
    const meanDiv = mean(divArr);
    console.log(`    dividend credit: ${nDiv === 0
      ? 'not enriched — net is price-only (run enrichDividendCredit.ts)'
      : `mean ${pct(meanDiv)} folded into net (${nDiv}/${n} rows enriched; realized/pred above are price-only)`}`);

    // Calibration buckets (quantile bins by predicted_return).
    if (n >= MIN_BUCKET_N) {
      const order = rows.map((_, i) => i).sort((x, y) => pred[x] - pred[y]);
      const per = Math.floor(n / N_BUCKETS);
      console.log(`    calibration (pred quantile → realized gross / net of cost+dividends; σ(act)=realized spread in-band):`);
      for (let b = 0; b < N_BUCKETS; b++) {
        const start = b * per;
        const end = b === N_BUCKETS - 1 ? n : (b + 1) * per;
        const seg = order.slice(start, end);
        const mp = mean(seg.map(i => pred[i]));
        const ma = mean(seg.map(i => act[i]));
        const mn = mean(seg.map(i => net[i]));
        const saBand = std(seg.map(i => act[i]));
        const posPct = mean(seg.map(i => (net[i] > 0 ? 1 : 0)));
        const bar = mn >= 0 ? '+' : '-';
        // A tight pred band (small pred spread) whose σ(act) is large = the model
        // called these ~equal but they realized very differently = under-resolution.
        console.log(`       Q${b + 1}  n=${String(seg.length).padStart(4)}   pred ${pct(mp).padStart(8)} → ${pct(ma).padStart(8)} / net ${pct(mn).padStart(8)}  ${bar}   σ(act) ${pct(saBand).padStart(8)}   net-pos ${pct(posPct, 0).padStart(5)}`);
      }
    }

    // Tier hit-rate (index-based so gross and per-symbol net both available).
    const tierIdx = new Map<string, number[]>();
    rows.forEach((r, i) => { if (!tierIdx.has(r.predicted_tier)) tierIdx.set(r.predicted_tier, []); tierIdx.get(r.predicted_tier)!.push(i); });
    const TIER_ORDER = ['STRONG_BUY', 'BUY', 'HOLD', 'SELL'];
    const present = TIER_ORDER.filter(t => tierIdx.has(t));
    if (present.length) {
      console.log(`    tier hit-rate (predicted_tier → realized gross / net of cost+dividends):`);
      for (const t of present) {
        const idx = tierIdx.get(t)!;
        const netPos = mean(idx.map(i => (net[i] > 0 ? 1 : 0)));
        console.log(`       ${t.padEnd(11)} n=${String(idx.length).padStart(4)}   mean ${pct(mean(idx.map(i => act[i]))).padStart(8)} / net ${pct(mean(idx.map(i => net[i]))).padStart(8)}   net-pos ${pct(netPos, 0).padStart(5)}`);
      }
      // Actionable bottom line: the tiers you'd actually put capital on.
      const buyIdx = [...(tierIdx.get('STRONG_BUY') ?? []), ...(tierIdx.get('BUY') ?? [])];
      if (buyIdx.length) {
        const netMean = mean(buyIdx.map(i => net[i]));
        const verdict = netMean > 0 ? 'clears cost ✓' : 'loses to cost ✗';
        console.log(`    ▪ actionable (STRONG_BUY+BUY) n=${buyIdx.length}: mean net ${pct(netMean)}  → ${verdict}`);
      }
    }
  }

  console.log(`\n${line}`);
  console.log(` IC = Spearman rank corr(predicted, actual); cost-INDEPENDENT (rank metric), so`);
  console.log(` position size doesn't change it. 'net' = realized − per-symbol IBKR cost @ £${positionGBP} + dividend credit.`);
  console.log(` Still PRE-latency: entry is scan-time price, not next-open (tracker-side, deferred).`);
  console.log(`${line}\n`);
}

// Run main() only when invoked directly (not when readoutHarness.ts imports the
// loader/stat helpers above) — importing must never trigger a full scoreboard run.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('[Scoreboard] FATAL:', e); process.exit(1); });
}
