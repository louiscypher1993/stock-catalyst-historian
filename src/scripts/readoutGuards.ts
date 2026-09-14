/**
 * readoutGuards.ts — two guards against the two ways this project's readouts misled it in
 * September 2026. Both failures were silent: nothing errored and no run went red.
 *
 * 1. EFFECTIVE INDEPENDENT WINDOWS. Day-clustering fixes correlation WITHIN a run_date and
 *    does nothing about correlation ACROSS them. Consecutive run_dates' 2W outcomes share 13
 *    of their 14 days, so N run_dates is nowhere near N observations. On 2026-09-12 the 2W
 *    readout had 16 scored run_dates spanning 20 calendar days — ~1.4 independent windows —
 *    and a naive t of −1.28 was an honest t of −0.38, with a 95% CI containing both zero and
 *    the training anchor. Every readout here counted run_dates, so the October checkpoint was
 *    scheduled against a sample size it could never reach.
 *
 *        effective windows  ~=  (calendar span of the scored run_dates) / (horizon days)
 *
 *    Deliberately crude, and a LOWER bound. Newey-West at lag = horizon is the principled
 *    fix but cannot be estimated when the lag approaches the sample length; a transparent
 *    bound beats a sophisticated number resting on an unestimable nuisance parameter.
 *
 * 2. NON-DECREASING ROW COUNTS. Supabase `inference_results` is pruned to a rolling ~40
 *    days by something outside this repo. Readouts just returned fewer rows each run, and on
 *    2026-09-12 expansionReadout's pre-parity 2W arm printed +0.2181 (t=4.93) — computed on
 *    the 189-row remnant of what had been a 580-row cohort. A shrinking denominator
 *    manufactures significance. So each readout records the high-water row count per
 *    run_date in `data/readout_rowcount_ledger.json` and says so, loudly, whenever a
 *    run_date inside its window now holds fewer rows than it once did.
 *
 *    The high-water mark never decreases, so the warning persists for as long as the loss
 *    does. That is deliberate: once rows are gone, EVERY later statistic on that window is
 *    computed on the shrunken sample, and a warning that fired once and then went quiet
 *    would let the second reader miss what the first one saw.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/** Calendar-day horizons, matching outcomeTracker / calculate_forward_returns. */
export const HORIZON_CALENDAR_DAYS: Record<string, number> = {
  '2D': 2, '3D': 3, '1W': 7, '2W': 14, '1M': 30, '3M': 91, '6M': 182,
};

/** Same bar the harness applies to run_dates, now applied to independent windows. */
export const MIN_EFFECTIVE_WINDOWS = 10;

export interface EffectiveWindows {
  spanDays: number;
  horizonDays: number;
  scoredDays: number;
  nEff: number;
}

/**
 * @param scoredRunDates the run_dates that actually produced a daily statistic — not every
 *                       run_date in the query. nEff is capped at their count, since overlap
 *                       can only ever reduce independence below the number of days scored.
 */
export function effectiveWindows(scoredRunDates: string[], horizonDays: number): EffectiveWindows {
  const ds = [...new Set(scoredRunDates.map(d => String(d).slice(0, 10)))].sort();
  if (!ds.length || !(horizonDays > 0)) return { spanDays: 0, horizonDays, scoredDays: 0, nEff: 0 };
  const spanDays = Math.round((Date.parse(ds[ds.length - 1]) - Date.parse(ds[0])) / 86400000) + 1;
  return { spanDays, horizonDays, scoredDays: ds.length, nEff: Math.min(ds.length, Math.max(1, spanDays / horizonDays)) };
}

/** mean / (sd / sqrt(nEff)) over the daily statistics. NaN when undefined. */
export function honestT(daily: number[], nEff: number): number {
  if (daily.length < 2 || !(nEff > 0)) return NaN;
  const m = daily.reduce((s, v) => s + v, 0) / daily.length;
  const sd = Math.sqrt(daily.reduce((s, v) => s + (v - m) ** 2, 0) / (daily.length - 1));
  return sd > 0 ? m / (sd / Math.sqrt(nEff)) : NaN;
}

/** One standard report line (plus a warning line when underpowered by overlap). */
export function effectiveWindowsLines(scoredRunDates: string[], horizonDays: number, daily: number[], indent = '    '): string[] {
  const w = effectiveWindows(scoredRunDates, horizonDays);
  if (w.scoredDays < 2) return [];
  const t = honestT(daily, w.nEff);
  const lines = [
    `${indent}effective independent windows ~${w.nEff.toFixed(1)}  (span ${w.spanDays}d ÷ ${horizonDays}d horizon, ` +
    `from ${w.scoredDays} scored run_dates)  → honest t=${Number.isFinite(t) ? t.toFixed(2) : 'n/a'}`,
  ];
  if (w.nEff < MIN_EFFECTIVE_WINDOWS) {
    lines.push(`${indent}⚠ UNDERPOWERED BY OVERLAP — ~${w.nEff.toFixed(1)} of ${MIN_EFFECTIVE_WINDOWS} independent windows. ` +
      `Consecutive outcomes share most of their window, so the run_date t above is NOT ${w.scoredDays} observations.`);
  }
  return lines;
}

// ── row-count guard ─────────────────────────────────────────────────────────────

const LEDGER = 'data/readout_rowcount_ledger.json';
type Ledger = Record<string, Record<string, number>>;

/**
 * Compare this run's rows-per-run_date against the recorded high-water marks for `series`,
 * then raise the marks. Returns report lines; never throws, since a guard that can crash a
 * readout will get deleted.
 *
 * @param series  identifies WHAT was counted — table, source and any filter that changes the
 *                population (e.g. `outcome_results[supabase]:2W`). Different sources hold
 *                different rows legitimately and must not share a mark.
 * @param window  the query's own run_date bounds. Ledger days outside it are not compared,
 *                so narrowing --since/--until cannot raise a false alarm.
 */
export function checkRowCounts(series: string, runDates: string[], window: { since?: string | null; until?: string | null } = {}): string[] {
  const counts = new Map<string, number>();
  for (const d of runDates) { const k = String(d).slice(0, 10); counts.set(k, (counts.get(k) ?? 0) + 1); }

  let ledger: Ledger = {};
  try { ledger = JSON.parse(readFileSync(LEDGER, 'utf8')); } catch { /* first run, or unreadable */ }
  const prev = ledger[series] ?? {};
  const inWindow = (d: string) => (!window.since || d >= window.since) && (!window.until || d <= window.until);

  const shrunk: Array<{ d: string; was: number; now: number }> = [];
  for (const [d, was] of Object.entries(prev)) {
    if (!inWindow(d)) continue;
    const now = counts.get(d) ?? 0;
    if (now < was) shrunk.push({ d, was, now });
  }
  shrunk.sort((a, b) => (a.d < b.d ? -1 : 1));

  const next = { ...prev };
  for (const [d, n] of counts) next[d] = Math.max(next[d] ?? 0, n);
  ledger[series] = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
  let wrote = true;
  try {
    mkdirSync(dirname(LEDGER), { recursive: true });
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n', 'utf8');
  } catch { wrote = false; }
  const note = wrote ? '' : '  (ledger not writable — marks NOT updated)';

  if (!Object.keys(prev).length) {
    return [` row-count guard [${series}]: no prior record — baseline established over ${counts.size} run_dates${note}`];
  }
  if (!shrunk.length) {
    return [` row-count guard [${series}]: OK — no run_date in the window is below its high-water mark${note}`];
  }
  const lost = shrunk.reduce((s, x) => s + (x.was - x.now), 0);
  const gone = shrunk.filter(x => x.now === 0).length;
  const shown = shrunk.slice(0, 6).map(x => `${x.d} ${x.was}→${x.now}`).join(', ');
  return [
    ` ⚠⚠ ROW-COUNT GUARD [${series}]: ${shrunk.length} run_date(s) now hold FEWER rows than previously seen — ` +
      `${lost} rows missing, ${gone} run_date(s) gone entirely (${shrunk[0].d} .. ${shrunk[shrunk.length - 1].d}).${note}`,
    `    ${shown}${shrunk.length > 6 ? `, … +${shrunk.length - 6} more` : ''}`,
    `    Every statistic below that touches these dates is computed on a SHRUNKEN sample. A shrinking`,
    `    denominator manufactures significance: on 2026-09-12 an arm printed t=4.93 on the 189-row remnant`,
    `    of a 580-row cohort. For inference_results, data/inference_results_archive.ndjson holds the rows.`,
  ];
}
