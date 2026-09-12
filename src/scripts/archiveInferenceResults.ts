/**
 * Durable, APPEND-ONLY archive of Supabase `inference_results`.
 *
 * WHY. As of 2026-09-12 that table only retains ~40 days: its earliest run_date is
 * 2026-08-03, while a backfill on 2026-08-27 saw rows from 2026-07-19. ~15 run_dates
 * vanished in between. No repo code deletes them (the only .delete() is a test probe in
 * verifyShadowTable.ts) and the other durable tables are intact back to June, so this is
 * a table-level policy or platform behaviour configured outside the repo. Mechanism
 * unknown; the loss is verified.
 *
 * Parity landed 2026-08-09. On a rolling 40-day window, post-parity rows — the exact data
 * the October checkpoint, Part B and C2 read — begin aging out around 2026-09-18.
 *
 * THE MERGE IS THE POINT. Rows are DISAPPEARING from source, so this must never be a
 * straight dump: a later run would then overwrite the archive with a smaller snapshot and
 * complete the data loss it exists to prevent. Every run UNIONS source with the existing
 * archive, keyed on (run_date, symbol) — the same key inference_results upserts on. Rows
 * present only in the archive are KEPT and counted as "rescued". Rows present in both take
 * the SOURCE copy, since it may carry later updates (e.g. the model_c rank backfill).
 *
 * Committed to git deliberately: git history is already this project's point-in-time
 * record (see pit-snapshot.yml), and an archive that lives only on one laptop is not an
 * archive.
 *
 * Usage: npx tsx src/scripts/archiveInferenceResults.ts          (dry run — reports only)
 *        npx tsx src/scripts/archiveInferenceResults.ts --write  (updates the archive)
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { dirname } from 'path';

const WRITE = process.argv.includes('--write');
const ARCHIVE = 'data/inference_results_archive.ndjson';
const key = (r: any) => `${String(r.run_date).slice(0, 10)}|${r.symbol}`;

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const src: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results').select('*').range(f, f + 999);
    if (error) throw error;
    src.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }

  const existing: any[] = [];
  if (existsSync(ARCHIVE)) {
    for (const line of readFileSync(ARCHIVE, 'utf8').split('\n')) {
      const t = line.trim(); if (t) existing.push(JSON.parse(t));
    }
  }

  const merged = new Map<string, any>();
  for (const r of existing) merged.set(key(r), r);       // archive first...
  let fresh = 0, updated = 0;
  for (const r of src) {                                  // ...then source wins on overlap
    const k = key(r);
    if (!merged.has(k)) fresh++; else updated++;
    merged.set(k, r);
  }
  const srcKeys = new Set(src.map(key));
  const rescued = existing.filter(r => !srcKeys.has(key(r)));

  const all = [...merged.values()].sort((a, b) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  const dates = [...new Set(all.map(r => String(r.run_date).slice(0, 10)))].sort();
  const srcDates = [...new Set(src.map(r => String(r.run_date).slice(0, 10)))].sort();

  console.log(`source (Supabase)  : ${src.length} rows, ${srcDates.length} run_dates  ${srcDates[0]} .. ${srcDates[srcDates.length-1]}`);
  console.log(`archive (on disk)  : ${existing.length} rows`);
  console.log(`merged             : ${all.length} rows, ${dates.length} run_dates  ${dates[0]} .. ${dates[dates.length-1]}`);
  console.log(`  new from source  : ${fresh}`);
  console.log(`  refreshed        : ${updated}`);
  console.log(`  RESCUED (in archive, ALREADY GONE from Supabase): ${rescued.length}`);
  if (rescued.length) {
    const rd = [...new Set(rescued.map(r => String(r.run_date).slice(0, 10)))].sort();
    console.log(`     covering run_dates ${rd[0]} .. ${rd[rd.length-1]} (${rd.length} days)`);
  }

  if (!WRITE) { console.log('\n--- DRY RUN — archive not written. Re-run with --write. ---'); process.exit(0); }

  mkdirSync(dirname(ARCHIVE), { recursive: true });
  writeFileSync(ARCHIVE, all.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  console.log(`\nwrote ${ARCHIVE}  (${(statSync(ARCHIVE).size / 1048576).toFixed(1)} MB)`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
