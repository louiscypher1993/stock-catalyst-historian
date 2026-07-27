/**
 * enrichDividendCredit.ts — dividend-credit enrichment for outcome rows.
 *
 * The forward-return labels and the outcome tracker both use Yahoo `quote.close`
 * (split-adjusted, DIVIDEND-EXCLUDED), so realized total return is understated by
 * the horizon dividend yield — material for REITs/telecoms and long horizons.
 * That gap is a RETURN credit, not a cost. This script computes it per outcome
 * row and stores it in a `dividend_credit` column, which outcomeScoreboard folds
 * into net (net = realized_price_return − cost + dividend_credit).
 *
 * WHY A SEPARATE PASS (not inline in outcomeTracker):
 *   - The credit needs Yahoo bars at BOTH the entry (run_date) and target dates.
 *     The tracker only resolves the target price, and often from the SQLite/
 *     Supabase price caches which carry `close` only — no adjclose. Computing the
 *     credit needs one Yahoo fetch per symbol that has the full close+adjclose
 *     series; doing that here keeps the tracker's hot path untouched and lets the
 *     2,334 already-recorded rows be backfilled without re-running collection.
 *   - Idempotent: only rows with dividend_credit IS NULL are (re)computed, so
 *     steady-state it fetches just the few symbols with newly-matured rows.
 *
 * METHOD (basis-mismatch-proof):
 *   dividend_credit = (adjclose_target / adjclose_entry) − (close_target / close_entry)
 *   Both `close` and `adjclose` come from the SAME Yahoo response, so they share
 *   an identical split basis and the two ratios are each reference-invariant. The
 *   close ratio is the pure price return; the adjclose ratio is the total return
 *   (dividends reinvested); the difference is the dividend contribution. A non-
 *   payer yields ~0 (adjclose tracks close). Splits cancel in both ratios.
 *
 * Local outcome_tracker.db is the primary; each computed credit is also mirrored
 * to Supabase outcome_results (fail-soft) so the CI scoreboard (--source supabase)
 * sees it. Requires the dividend_credit column on both — outcome_tracker gets an
 * idempotent ALTER here; outcome_results needs
 * src/db/supabase_dividend_credit_migration.sql applied once (schema-drift hazard:
 * without it the Supabase mirror 404s the column and only the local db is updated).
 *
 * Usage:
 *   npx tsx src/scripts/enrichDividendCredit.ts                 # local db, fill NULLs
 *   npx tsx src/scripts/enrichDividendCredit.ts --source supabase  # durable store directly
 *   npx tsx src/scripts/enrichDividendCredit.ts --recompute     # recompute all rows
 *   npx tsx src/scripts/enrichDividendCredit.ts --limit 20      # first N symbols (test)
 *
 * --source local (default): reads/updates outcome_tracker.db, down-syncs existing
 *   credits from Supabase first (cheap after a cache eviction), mirrors new ones up.
 * --source supabase: reads/writes outcome_results DIRECTLY — cache-independent, and
 *   the only mode that reaches rows present only in the durable store. Preferred on CI.
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUTCOME_DB = path.join(ROOT, 'outcome_tracker.db');

const TOLERANCE_DAYS = 3;         // same ±window the tracker uses for price matches
const YAHOO_REQUEST_DELAY_MS = 75;
const YAHOO_RANGE = '2y';         // covers entry bars up to ~2y old; oldest run_date here is weeks-months
const SUPABASE_WRITE_CHUNK = 300;

// ── Yahoo symbol normalisation (copied from outcomeTracker.ts, kept in sync) ──
const YAHOO_INTL_SUFFIXES = new Set([
  '.AE', '.AS', '.AT', '.AX', '.BA', '.BD', '.BK', '.BO', '.BR',
  '.CA', '.CL', '.CO', '.DE', '.F', '.HE', '.HK', '.IR', '.IS',
  '.JK', '.JO', '.KA', '.KL', '.KQ', '.KS', '.KW', '.L', '.LM',
  '.LS', '.MC', '.ME', '.MI', '.MX', '.NS', '.NZ', '.OL', '.PA',
  '.PR', '.QA', '.RO', '.SA', '.SI', '.SN', '.SR', '.SS', '.ST',
  '.SW', '.SZ', '.T', '.TO', '.TW', '.VN', '.WA',
]);
function normaliseForYahoo(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx === -1) return upper;
  const suffix = upper.slice(dotIdx);
  if (YAHOO_INTL_SUFFIXES.has(suffix)) return upper;
  return upper.replace(/\./g, '-');
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

interface Bar { close: number; adjclose: number }

// Fetch daily close + adjclose for a symbol. adjclose is split+dividend adjusted;
// close is split-only. Missing/nulled points are skipped.
async function fetchCloseAdj(symbol: string): Promise<Map<string, Bar>> {
  const out = new Map<string, Bar>();
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normaliseForYahoo(symbol))}?interval=1d&range=${YAHOO_RANGE}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return out;
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return out;
    const ts: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const adj: number[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      const a = adj[i];
      if (c == null || a == null || !(c > 0) || !(a > 0)) continue;
      out.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), { close: c, adjclose: a });
    }
  } catch { /* leave empty -> caller treats symbol as unresolvable */ }
  return out;
}

// Nearest bar within ±TOLERANCE_DAYS, closest offset first (same convention as
// outcomeTracker's nearestFromMap).
function nearestBar(map: Map<string, Bar>, targetDate: string): Bar | null {
  const base = new Date(targetDate);
  for (let dist = 0; dist <= TOLERANCE_DAYS; dist++) {
    for (const sign of dist === 0 ? [0] : [-1, 1]) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + dist * sign);
      const bar = map.get(d.toISOString().slice(0, 10));
      if (bar) return bar;
    }
  }
  return null;
}

// ── Supabase mirror (raw REST, same shape as outcomeTracker's sb()) ──────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function sb(pathAndQuery: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY!}`,
      'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${pathAndQuery} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mirrorToSupabase(rows: Array<{ symbol: string; run_date: string; horizon: string; dividend_credit: number }>): Promise<void> {
  if (rows.length === 0 || !SUPABASE_URL || !SUPABASE_KEY) return;
  for (const batch of chunk(rows, SUPABASE_WRITE_CHUNK)) {
    await sb('outcome_results?on_conflict=symbol,run_date,horizon', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(batch),
    });
  }
}

// Down-sync: pull already-computed credits FROM the durable Supabase store into
// the local db (fills only NULLs — never overwrites). This is what makes the cron
// step cheap after an actions/cache eviction: the durable store (not the evictable
// local cache) is the source of truth for credits, so a rebuilt local db gets its
// credits back here instead of re-crawling every symbol from Yahoo. Fail-soft.
async function pullExistingCredits(db: Database.Database): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return 0;
  const update = db.prepare(
    `UPDATE outcome_tracker SET dividend_credit = ? WHERE symbol = ? AND run_date = ? AND horizon = ? AND dividend_credit IS NULL`
  );
  let synced = 0;
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const rows: Array<{ symbol: string; run_date: string; horizon: string; dividend_credit: number }> =
      (await sb(`outcome_results?select=symbol,run_date,horizon,dividend_credit&dividend_credit=not.is.null&limit=${pageSize}&offset=${offset}`)) ?? [];
    if (rows.length === 0) break;
    const tx = db.transaction((rs: typeof rows) => { for (const r of rs) synced += update.run(r.dividend_credit, r.symbol, r.run_date, r.horizon).changes; });
    tx(rows);
    if (rows.length < pageSize) break;
  }
  return synced;
}

// ── shared enrichment core ─────────────────────────────────────────────────
interface OutRow { symbol: string; run_date: string; horizon: string; target_date: string }
type MirrorRow = { symbol: string; run_date: string; horizon: string; dividend_credit: number };
interface EnrichStats { computed: number; noBars: number; noEndpoint: number; sumCredit: number; maxCredit: number; maxCreditSym: string }

// The credit itself: total-return ratio (adjclose) minus price-return ratio
// (close) over the [run_date, target_date] window, both endpoints from the same
// Yahoo series so splits cancel. null when either endpoint bar is missing.
function computeCredit(map: Map<string, Bar>, runDate: string, targetDate: string): number | null {
  const entry = nearestBar(map, runDate);
  const target = nearestBar(map, targetDate);
  if (!entry || !target) return null;
  return (target.adjclose / entry.adjclose) - (target.close / entry.close);
}

function groupAndLimit(rows: OutRow[], limit: number): { bySym: Map<string, OutRow[]>; symbols: string[] } {
  const bySym = new Map<string, OutRow[]>();
  for (const r of rows) { if (!bySym.has(r.symbol)) bySym.set(r.symbol, []); bySym.get(r.symbol)!.push(r); }
  const symbols = [...bySym.keys()].slice(0, limit === Infinity ? undefined : limit);
  return { bySym, symbols };
}

// One Yahoo fetch (full close+adjclose series) per symbol serves all its rows;
// onCredit receives each computed value for the caller to persist (local UPDATE
// and/or Supabase mirror). Identical logic for both source modes.
async function enrichSymbols(bySym: Map<string, OutRow[]>, symbols: string[], onCredit: (r: OutRow, credit: number) => void): Promise<EnrichStats> {
  const st: EnrichStats = { computed: 0, noBars: 0, noEndpoint: 0, sumCredit: 0, maxCredit: -Infinity, maxCreditSym: '' };
  let symbolsDone = 0;
  for (const symbol of symbols) {
    await sleep(YAHOO_REQUEST_DELAY_MS);
    const map = await fetchCloseAdj(symbol);
    symbolsDone++;
    const symRows = bySym.get(symbol)!;
    if (map.size === 0) { st.noBars += symRows.length; continue; }
    for (const r of symRows) {
      const credit = computeCredit(map, r.run_date, r.target_date);
      if (credit === null) { st.noEndpoint++; continue; }
      onCredit(r, credit);
      st.computed++; st.sumCredit += credit;
      if (credit > st.maxCredit) { st.maxCredit = credit; st.maxCreditSym = `${r.symbol} ${r.horizon}`; }
    }
    if (symbolsDone % 100 === 0) console.log(`  ${symbolsDone}/${symbols.length} symbols, ${st.computed} credits computed`);
  }
  return st;
}

function printStats(st: EnrichStats): void {
  console.log(`\nComputed ${st.computed} dividend credits (${st.noBars} rows no Yahoo bars, ${st.noEndpoint} rows missing an endpoint bar).`);
  if (st.computed) console.log(`  mean credit ${(st.sumCredit / st.computed * 100).toFixed(3)}%   max ${(st.maxCredit * 100).toFixed(2)}% (${st.maxCreditSym})`);
}

// ── local-db source (primary for local dev; on CI the cache-restored db) ────
function ensureColumn(db: Database.Database): void {
  const cols = (db.prepare(`PRAGMA table_info(outcome_tracker)`).all() as Array<{ name: string }>).map(c => c.name);
  if (!cols.includes('dividend_credit')) {
    db.exec(`ALTER TABLE outcome_tracker ADD COLUMN dividend_credit REAL`);
    console.log('Added dividend_credit column to outcome_tracker.');
  }
}

async function enrichFromLocal(recompute: boolean, limit: number): Promise<void> {
  const db = new Database(OUTCOME_DB);
  ensureColumn(db);

  // Fill local NULLs from the durable store first, so Yahoo is only hit for rows
  // genuinely missing everywhere (skipped under --recompute, which forces refetch).
  if (!recompute) {
    try {
      const synced = await pullExistingCredits(db);
      if (synced) console.log(`Down-synced ${synced} credit(s) from Supabase outcome_results (no Yahoo fetch needed for those).`);
    } catch (e) {
      console.warn('Supabase down-sync failed — continuing to Yahoo for all NULLs:', e);
    }
  }

  const where = ['actual_return IS NOT NULL', 'target_date IS NOT NULL', 'run_date IS NOT NULL'];
  if (!recompute) where.push('dividend_credit IS NULL');
  const rows = db.prepare(`SELECT symbol, run_date, horizon, target_date FROM outcome_tracker WHERE ${where.join(' AND ')}`).all() as OutRow[];
  if (rows.length === 0) { console.log('No local rows need a dividend credit. Nothing to do.'); db.close(); return; }

  const { bySym, symbols } = groupAndLimit(rows, limit);
  console.log(`[local] Enriching ${rows.length} row(s) across ${bySym.size} symbol(s)${limit !== Infinity ? ` (limited to ${symbols.length})` : ''}...`);

  const update = db.prepare(`UPDATE outcome_tracker SET dividend_credit = ? WHERE symbol = ? AND run_date = ? AND horizon = ?`);
  const localWrites: Array<{ r: OutRow; credit: number }> = [];
  const mirrorRows: MirrorRow[] = [];
  const stats = await enrichSymbols(bySym, symbols, (r, credit) => {
    localWrites.push({ r, credit });
    mirrorRows.push({ symbol: r.symbol, run_date: r.run_date, horizon: r.horizon, dividend_credit: credit });
  });
  db.transaction(() => { for (const w of localWrites) update.run(w.credit, w.r.symbol, w.r.run_date, w.r.horizon); })();
  printStats(stats);

  console.log(`\nMirroring ${mirrorRows.length} credit(s) to Supabase outcome_results...`);
  try {
    await mirrorToSupabase(mirrorRows);
    console.log('  mirror ok.');
  } catch (e) {
    console.warn('  mirror failed (local db is still updated) — apply src/db/supabase_dividend_credit_migration.sql if the column is missing:', e);
  }
  db.close();
}

// ── Supabase source (the durable store directly — cache-independent; use on CI
// and to enrich rows that exist only in Supabase, not in a local snapshot) ──
async function readSupabaseRowsNeedingCredit(recompute: boolean): Promise<OutRow[]> {
  const filt = ['actual_return=not.is.null', 'target_date=not.is.null', 'run_date=not.is.null'];
  if (!recompute) filt.push('dividend_credit=is.null');
  const out: OutRow[] = [];
  const pageSize = 1000;
  for (let off = 0; ; off += pageSize) {
    const rows: OutRow[] = (await sb(`outcome_results?select=symbol,run_date,horizon,target_date&${filt.join('&')}&limit=${pageSize}&offset=${off}`)) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

async function enrichFromSupabase(recompute: boolean, limit: number): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('[supabase] needs SUPABASE_URL + SUPABASE_(SERVICE_ROLE|ANON)_KEY.'); process.exitCode = 1; return; }
  const rows = await readSupabaseRowsNeedingCredit(recompute);
  if (rows.length === 0) { console.log('No Supabase rows need a dividend credit. Nothing to do.'); return; }

  const { bySym, symbols } = groupAndLimit(rows, limit);
  console.log(`[supabase] Enriching ${rows.length} row(s) across ${bySym.size} symbol(s)${limit !== Infinity ? ` (limited to ${symbols.length})` : ''}...`);

  const mirrorRows: MirrorRow[] = [];
  const stats = await enrichSymbols(bySym, symbols, (r, credit) => {
    mirrorRows.push({ symbol: r.symbol, run_date: r.run_date, horizon: r.horizon, dividend_credit: credit });
  });
  printStats(stats);

  console.log(`\nWriting ${mirrorRows.length} credit(s) to Supabase outcome_results...`);
  await mirrorToSupabase(mirrorRows);
  console.log('  write ok.');
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const recompute = args.includes('--recompute');
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'local';

  if (source === 'supabase') return enrichFromSupabase(recompute, limit);
  if (source !== 'local') { console.error(`Unknown --source '${source}' (use local|supabase).`); process.exitCode = 1; return; }
  return enrichFromLocal(recompute, limit);
}

main().catch(e => { console.error('[DividendCredit] FATAL:', e); process.exit(1); });
