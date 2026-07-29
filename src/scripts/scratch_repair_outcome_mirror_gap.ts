/**
 * scratch_repair_outcome_mirror_gap.ts — one-off repair for the 2026-07-29
 * delisting-audit finding (recon: scratch_delisting_audit{1,2,3,4}.cjs).
 *
 * ROOT CAUSE (confirmed by audit #3/#4, not fixed here — see note at bottom):
 * outcomeTracker.ts's Supabase mirror (`upsertOutcomes`) is fail-soft; if a
 * batch upsert fails, the row still exists in the CI runner's LOCAL sqlite
 * (persisted via actions/cache). On every subsequent run, `existsStmt` checks
 * ONLY that local db, sees the row, marks it `skippedExisting`, and never
 * retries the mirror. Result: ~292 matured 2D/2W rows (target dates
 * 2026-07-21/22/23) are permanently absent from the durable outcome_results
 * store, with no self-healing path. Confirmed NOT delisting: 23/25 sampled
 * symbols (TSLA, BRK.B, SHEL, ...) resolved fine via a live Yahoo replay using
 * the tracker's exact logic (range=1y, +/-3 calendar day nearest match).
 *
 * BIAS THIS CAUSES: the missing 2W rows have mean actual return +1.50% vs
 * +recorded rows' -0.12% -- the pre-v9.4 2W baseline the Aug-5 harness
 * compares the deployed model against is skewed pessimistic without this fix.
 *
 * THIS SCRIPT: independently reconstructs each missing row using the SAME
 * resolution logic as outcomeTracker.ts (TIER_CONFIG transcribed identically,
 * same nearest-match tolerance), then writes to BOTH local outcome_tracker.db
 * and the durable Supabase outcome_results (the source of truth the scoreboard
 * and readoutHarness read). Recomputes the missing set LIVE at run time (not
 * off a stale snapshot) and only targets rows aged >=3 days past their target
 * date, so it never touches rows that are simply awaiting the next normal
 * cron run. Idempotent: safe to re-run (INSERT OR IGNORE locally, upsert
 * on_conflict remotely).
 *
 * Does NOT touch: costModel.ts (frozen per the checkpoint discipline), the
 * live cron path (outcomeTracker.ts is read for reference only, not imported
 * or modified), or dividend_credit (left NULL here -- run
 * `enrichDividendCredit.ts --source supabase` afterward, unchanged, to backfill
 * it for these new rows the same way it does for everything else).
 *
 * Does NOT fix the root cause (the mirror's non-retrying design) -- that is a
 * separate, deliberate follow-up decision, not bundled into this data repair.
 *
 * Usage: npx tsx src/scripts/scratch_repair_outcome_mirror_gap.ts
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUTCOME_DB = path.join(ROOT, 'outcome_tracker.db');
const TOLERANCE_DAYS = 3;
const MIN_AGE_DAYS = 3; // only repair rows whose target date is genuinely stale, not cron-lag

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!;

type HorizonLabel = '2D' | '2W' | '1M' | '3M' | '6M';
const HORIZONS: Array<{ label: HorizonLabel; days: number; predField: string }> = [
  { label: '2D', days: 2, predField: 'model_d3_return_2d' },
  { label: '2W', days: 14, predField: 'model_d5_return_2w' },
  { label: '1M', days: 30, predField: 'model_b_return_1m' },
  { label: '3M', days: 91, predField: 'model_d1_return_3m' },
  { label: '6M', days: 182, predField: 'model_d2_return_6m' },
];

// ── transcribed VERBATIM from outcomeTracker.ts so a repaired row is
// indistinguishable from one the live tracker would have written itself ──
const TIER_CONFIG: Record<string, { strongBuy?: (v: number) => boolean; buy?: (v: number) => boolean; sell?: (v: number) => boolean }> = {
  model_d3_return_2d: { strongBuy: v => v >= 0.010831, sell: v => v <= -0.004385 },
  model_d5_return_2w: { strongBuy: v => v >= 0.031582, buy: v => v >= 0.024743 && v < 0.031582, sell: v => v <= -0.001411 },
  model_d1_return_3m: { strongBuy: v => v >= 0.057568 },
  model_d2_return_6m: { buy: v => v > 0.106656 },
  model_b_return_1m: {},
};
function resolveTier(value: number, predField: string): string {
  const cfg = TIER_CONFIG[predField] ?? {};
  if (cfg.strongBuy?.(value)) return 'STRONG_BUY';
  if (cfg.buy?.(value)) return 'BUY';
  if (cfg.sell?.(value)) return 'SELL';
  return 'HOLD';
}

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
  return YAHOO_INTL_SUFFIXES.has(suffix) ? upper : upper.replace(/\./g, '-');
}
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function fetchYahooHistory(symbol: string): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normaliseForYahoo(symbol))}?interval=1d&range=1y`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return priceMap;
    const data: any = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) return priceMap;
    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null) continue;
      priceMap.set(new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close);
    }
  } catch { /* leave empty -> caller reports unresolvable */ }
  return priceMap;
}
function nearestFromMap(priceMap: Map<string, number>, targetDate: string): { price: number; date: string } | null {
  const base = new Date(targetDate);
  for (let dist = 0; dist <= TOLERANCE_DAYS; dist++) {
    for (const sign of dist === 0 ? [0] : [-1, 1]) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + dist * sign);
      const key = d.toISOString().slice(0, 10);
      if (priceMap.has(key)) return { price: priceMap.get(key)!, date: key };
    }
  }
  return null;
}
function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number { return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000); }
function todayStr(): string { return new Date().toISOString().slice(0, 10); }

async function sb(pathAndQuery: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...options,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...(options.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) throw new Error(`Supabase ${pathAndQuery} -> HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface InferenceRow {
  symbol: string; run_date: string; current_price: number | null; unreliable_reason: string | null;
  model_b_return_1m: number | null; model_d1_return_3m: number | null; model_d2_return_6m: number | null;
  model_d3_return_2d: number | null; model_d5_return_2w: number | null;
}
async function fetchAllInferenceResults(): Promise<InferenceRow[]> {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  let all: InferenceRow[] = [], from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase.from('inference_results')
      .select('symbol, run_date, current_price, unreliable_reason, model_b_return_1m, model_d1_return_3m, model_d2_return_6m, model_d3_return_2d, model_d5_return_2w')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all = all.concat(data as any);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
async function fetchAllOutcomeKeys(): Promise<Set<string>> {
  const have = new Set<string>();
  let offset = 0; const pageSize = 1000;
  for (;;) {
    const rows: Array<{ symbol: string; run_date: string; horizon: string }> =
      (await sb(`outcome_results?select=symbol,run_date,horizon&limit=${pageSize}&offset=${offset}`)) ?? [];
    for (const r of rows) have.add(`${r.symbol}|${r.run_date}|${r.horizon}`);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return have;
}

async function main() {
  const today = todayStr();
  console.log('Fetching inference_results + outcome_results from Supabase...');
  const [infRows, haveKeys] = await Promise.all([fetchAllInferenceResults(), fetchAllOutcomeKeys()]);
  console.log(`  inference_results: ${infRows.length}   outcome_results keys: ${haveKeys.size}`);

  interface Candidate { symbol: string; run_date: string; horizon: HorizonLabel; predField: string; predicted: number; entry: number; target: string }
  const candidates: Candidate[] = [];
  for (const r of infRows) {
    if (r.unreliable_reason || r.current_price == null) continue;
    for (const h of HORIZONS) {
      const predicted = (r as any)[h.predField] as number | null;
      if (predicted == null) continue;
      const target = addCalendarDays(r.run_date, h.days);
      if (target > today) continue; // not yet matured -- leave for the normal cron
      if (daysBetween(target, today) < MIN_AGE_DAYS) continue; // could just be cron-lag
      if (haveKeys.has(`${r.symbol}|${r.run_date}|${h.label}`)) continue; // already present
      candidates.push({ symbol: r.symbol, run_date: r.run_date, horizon: h.label, predField: h.predField, predicted, entry: r.current_price!, target });
    }
  }
  console.log(`\nCandidates to repair (aged >=${MIN_AGE_DAYS}d, not present): ${candidates.length}`);
  if (candidates.length === 0) { console.log('Nothing to repair.'); return; }

  const bySym = new Map<string, Candidate[]>();
  for (const c of candidates) { if (!bySym.has(c.symbol)) bySym.set(c.symbol, []); bySym.get(c.symbol)!.push(c); }

  const db = new Database(OUTCOME_DB);
  const localCols = (db.prepare(`PRAGMA table_info(outcome_tracker)`).all() as Array<{ name: string }>).map(c => c.name);
  const hasDivCol = localCols.includes('dividend_credit');
  const insertLocal = db.prepare(`
    INSERT OR IGNORE INTO outcome_tracker
      (symbol, run_date, horizon, predicted_return, predicted_tier, actual_return, target_date, matched_price_date, actual_source, checked_at${hasDivCol ? ', dividend_credit' : ''})
    VALUES (@symbol, @run_date, @horizon, @predicted_return, @predicted_tier, @actual_return, @target_date, @matched_price_date, @actual_source, @checked_at${hasDivCol ? ', @dividend_credit' : ''})
  `);

  let repaired = 0, unresolvable = 0, symbolsDone = 0;
  const unresolvableRows: Candidate[] = [];
  const supabaseRows: Array<Record<string, any>> = [];
  const localRows: Array<Record<string, any>> = [];

  for (const [symbol, rows] of bySym) {
    await sleep(75);
    const priceMap = await fetchYahooHistory(symbol);
    symbolsDone++;
    if (priceMap.size === 0) { unresolvable += rows.length; unresolvableRows.push(...rows); continue; }
    for (const c of rows) {
      const match = nearestFromMap(priceMap, c.target);
      if (!match) { unresolvable++; unresolvableRows.push(c); continue; }
      const actualReturn = (match.price - c.entry) / c.entry;
      const row = {
        symbol: c.symbol, run_date: c.run_date, horizon: c.horizon,
        predicted_return: c.predicted, predicted_tier: resolveTier(c.predicted, c.predField),
        actual_return: actualReturn, target_date: c.target, matched_price_date: match.date,
        actual_source: 'yahoo_fetch', checked_at: new Date().toISOString(), dividend_credit: null,
      };
      localRows.push(row);
      supabaseRows.push(row);
      repaired++;
    }
    if (symbolsDone % 50 === 0) console.log(`  ${symbolsDone}/${bySym.size} symbols, ${repaired} repaired so far`);
  }

  console.log(`\nResolved ${repaired}/${candidates.length}; unresolvable ${unresolvable}.`);

  const writeLocal = db.transaction((rs: typeof localRows) => { for (const r of rs) insertLocal.run(r); });
  writeLocal(localRows);
  console.log(`Wrote ${localRows.length} row(s) to local outcome_tracker.db.`);
  db.close();

  console.log(`Mirroring ${supabaseRows.length} row(s) to Supabase outcome_results...`);
  for (const batch of chunk(supabaseRows, 300)) {
    await sb('outcome_results?on_conflict=symbol,run_date,horizon', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(batch),
    });
  }
  console.log('  mirror ok.');

  if (unresolvableRows.length) {
    console.log(`\n${unresolvableRows.length} row(s) remain unresolvable (no Yahoo bar within +/-${TOLERANCE_DAYS}d of target):`);
    for (const c of unresolvableRows) console.log(`   ${c.symbol.padEnd(14)} run ${c.run_date}  ${c.horizon}  target ${c.target}`);
  }

  console.log('\nNOTE: dividend_credit left NULL for repaired rows by design.');
  console.log('Run: npx tsx src/scripts/enrichDividendCredit.ts --source supabase   (unchanged, existing tool)');
  console.log('\nNOTE: this repairs the DATA gap only. The root cause (outcomeTracker.ts\'s');
  console.log('mirror never retries a failed batch) is UNCHANGED -- flag separately if you want that fixed too.');
}

main().catch(e => { console.error('[Repair] FATAL:', e); process.exit(1); });
