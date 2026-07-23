/**
 * scratch_outcome_backfill.ts — one-off: mirror all existing local
 * outcome_tracker.db rows into the durable Supabase outcome_results table.
 *
 * The tracker's idempotency guard is the LOCAL db, so rows already recorded
 * there are skipped on future runs and would never reach Supabase. This backfills
 * them once so the durable store is complete from the start. Idempotent
 * (upsert on PK). Run after applying supabase_outcome_results_migration.sql.
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUTCOME_DB = path.join(ROOT, 'outcome_tracker.db');
const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;
const CHUNK = 300;

async function sb(q: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${URL}/rest/v1/${q}`, {
    ...options,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(options.headers as any) },
  });
  if (!res.ok) throw new Error(`Supabase ${q} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

async function main() {
  const db = new Database(OUTCOME_DB, { readonly: true, fileMustExist: true });
  const rows = db.prepare(
    'SELECT symbol, run_date, horizon, predicted_return, predicted_tier, actual_return, target_date, matched_price_date, actual_source, checked_at FROM outcome_tracker'
  ).all();
  db.close();
  console.log(`Read ${rows.length} local rows`);

  let written = 0;
  for (const batch of chunk(rows, CHUNK)) {
    await sb('outcome_results?on_conflict=symbol,run_date,horizon', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(batch),
    });
    written += batch.length;
    process.stdout.write(`\r  upserted ${written}/${rows.length}`);
  }
  const count = await sb('outcome_results?select=count');
  console.log(`\nDone. outcome_results now holds ${count?.[0]?.count ?? '?'} rows.`);
}
main().catch(e => { console.error('BACKFILL FAILED:', e); process.exit(1); });
