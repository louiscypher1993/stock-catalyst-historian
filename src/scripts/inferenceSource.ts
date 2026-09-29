/**
 * inferenceSource.ts — read `inference_results` as ARCHIVE ∪ LIVE, not live alone.
 *
 * WHY THIS IS NOT OPTIONAL. Supabase prunes `inference_results` on a rolling ~40-day
 * window (mechanism outside this repo; see TODO.md). Two consequences, both silent:
 *
 *  1. ANALYSIS TRUNCATION. Parity landed 2026-08-09, so from ~2026-09-18 the earliest
 *     post-parity rows began disappearing. By 2026-09-29 the live floor was 2026-08-20 and
 *     2,329 rows over 15 run_dates — 11 of them post-parity — existed only in the archive.
 *     Any readout querying live alone silently loses the start of its own window.
 *
 *  2. LONG HORIZONS COULD NEVER MATURE. outcomeTracker resolves a prediction by reading its
 *     source row back, so the row must outlive the horizon. At a 40-day floor, 3M (91d) rows
 *     die 50 days early and 6M (182d) 141 days early. Measured 2026-09-29: outcome_results
 *     holds 2D, 2W and 1M and contains ZERO 3M, 6M or 12M rows — not "not yet matured", as
 *     TODO.md had recorded, but structurally impossible. 1M survives on ~11 days of margin
 *     and dies too if the window ever tightens.
 *
 * Callers keep their own Supabase query (auth and column lists differ — outcomeTracker uses
 * the service-role key) and pass the result through `mergeWithArchive`. Live wins on overlap,
 * since a row may have been updated after it was archived; archive-only rows are added back.
 */
import { existsSync, readFileSync } from 'fs';

export const ARCHIVE_PATH = 'data/inference_results_archive.ndjson';

export interface MergeResult<T> {
  rows: T[];
  liveRows: number;
  archiveRows: number;
  addedFromArchive: number;
  liveFloor: string | null;
  mergedFloor: string | null;
  note: string;
}

const key = (r: any) => `${String(r.run_date).slice(0, 10)}|${r.symbol}`;
const floorOf = (rows: any[]) =>
  rows.length ? rows.map(r => String(r.run_date).slice(0, 10)).sort()[0] : null;

/**
 * @param live   rows already fetched from Supabase by the caller.
 * @param opts.since  drop archive rows before this run_date, so a caller that queried a
 *                    narrow window does not silently widen it.
 */
export function mergeWithArchive<T extends { run_date: any; symbol: string }>(
  live: T[],
  opts: { since?: string | null; archivePath?: string } = {},
): MergeResult<T> {
  const path = opts.archivePath ?? ARCHIVE_PATH;
  const liveFloor = floorOf(live);
  if (!existsSync(path)) {
    return {
      rows: live, liveRows: live.length, archiveRows: 0, addedFromArchive: 0,
      liveFloor, mergedFloor: liveFloor,
      note: `⚠ archive ${path} NOT FOUND — reading live only; rows pruned from Supabase are absent`,
    };
  }
  const archive: T[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const r = JSON.parse(t) as T;
      if (opts.since && String(r.run_date).slice(0, 10) < opts.since) continue;
      archive.push(r);
    } catch { /* a truncated line must not take down the caller */ }
  }
  const merged = new Map<string, T>();
  for (const r of archive) merged.set(key(r), r);
  let added = 0;
  const liveKeys = new Set(live.map(key));
  for (const r of archive) if (!liveKeys.has(key(r))) added++;
  for (const r of live) merged.set(key(r), r);   // live wins on overlap

  const rows = [...merged.values()];
  return {
    rows, liveRows: live.length, archiveRows: archive.length, addedFromArchive: added,
    liveFloor, mergedFloor: floorOf(rows),
    note: added > 0
      ? `archive ∪ live: +${added} rows Supabase no longer holds (live floor ${liveFloor} → merged floor ${floorOf(rows)})`
      : `archive ∪ live: live is complete, nothing to restore (floor ${liveFloor})`,
  };
}
