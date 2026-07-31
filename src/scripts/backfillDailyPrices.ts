/**
 * backfillDailyPrices.ts — extend local daily_prices history from Yahoo.
 *
 * WHY. Fixing the async-close benchmark bug means re-deriving `excess_return` and
 * `sector_relative_z_score`, and features.csv stores only those OUTPUTS — no
 * daily_return, no beta, no close. So the corrected values have to be rebuilt from
 * price history, and local daily_prices starts at 2016-01-01: 79.0% of training
 * rows are covered, 18.2% predate the store and 2.8% belong to 29 symbols missing
 * entirely. The pre-2016 block is deliberately NOT dropped — it holds 2008-09,
 * the only credit crisis in the dataset (1,979 events), and the held-out fold has
 * no crisis in it, so no A/B could honestly justify discarding that regime.
 *
 * SAFETY — THIS IS THE ONLY SCRIPT IN THE SERIES THAT WRITES TO market_cache.db.
 * Three independent guarantees, because the file also holds ~502,507 rows of
 * EXPIRED-FMP-PREMIUM data that can never be re-fetched on the free tier:
 *   1. INSERT OR IGNORE against `PRIMARY KEY (symbol, date)` — physically cannot
 *      overwrite an existing bar. Where Yahoo now disagrees with a stored bar
 *      (its back-adjustment silently rewrites history on splits/dividends) the
 *      STORED value wins, which is also the point-in-time-correct choice.
 *   2. Rows are tagged with a DISTINCT source stamp (`yahoo_backfill_<date>`), so
 *      the backfill is identifiable and reversible without touching prior data.
 *      NOTE: despite the column's `DEFAULT 'fmp'`, every pre-existing row is
 *      already tagged plain `'yahoo'` — so `DELETE WHERE source='yahoo'` would
 *      wipe the entire table. The stamp is what makes rollback actually safe:
 *        DELETE FROM daily_prices WHERE source LIKE 'yahoo_backfill_%';
 *   3. It touches ONE table. No fmp_* table, no event_features, and it never calls
 *      analyzeSymbol/getFullCompanyContext — the recorded landmine that would
 *      re-request premium fields on the free tier and null them out.
 * A verified full-file backup exists at backups/market_cache_<date>.db.
 *
 * Usage:
 *   npx tsx src/scripts/backfillDailyPrices.ts --dry-run
 *   npx tsx src/scripts/backfillDailyPrices.ts --limit 20
 *   npx tsx src/scripts/backfillDailyPrices.ts
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DB_PATH = join(ROOT, 'market_cache.db');
const FEATURES = join(ROOT, 'src', 'ml', 'features.csv');
const REQUEST_DELAY_MS = 200;

// Same allowlist the rest of the codebase uses to decide whether a dotted suffix is
// a real exchange or a dual-class marker (BRK.B -> BRK-B).
const YAHOO_INTL_SUFFIXES = new Set([
  '.AE', '.AS', '.AT', '.AX', '.BA', '.BD', '.BK', '.BO', '.BR',
  '.CA', '.CL', '.CO', '.DE', '.F', '.HE', '.HK', '.IR', '.IS',
  '.JK', '.JO', '.KA', '.KL', '.KQ', '.KS', '.KW', '.L', '.LM',
  '.LS', '.MC', '.ME', '.MI', '.MX', '.NS', '.NZ', '.OL', '.PA',
  '.PR', '.QA', '.RO', '.SA', '.SI', '.SN', '.SR', '.SS', '.ST',
  '.SW', '.SZ', '.T', '.TO', '.TW', '.VN', '.WA',
]);
function normaliseForYahoo(symbol: string): string {
  const u = symbol.toUpperCase().trim();
  const i = u.lastIndexOf('.');
  if (i === -1) return u;
  return YAHOO_INTL_SUFFIXES.has(u.slice(i)) ? u : u.replace(/\./g, '-');
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Bar { date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number | null; adjClose: number | null; }

async function fetchMax(symbol: string, attempt = 1): Promise<Bar[] | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normaliseForYahoo(symbol))}?interval=1d&range=max&events=div%2Csplit`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    const r = data?.chart?.result?.[0];
    if (!r?.timestamp) return null;
    const q = r.indicators?.quote?.[0] ?? {};
    const adj = r.indicators?.adjclose?.[0]?.adjclose ?? [];
    const out: Bar[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const close = q.close?.[i];
      if (close == null) continue;                       // non-trading placeholder
      out.push({
        date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
        open: q.open?.[i] ?? null, high: q.high?.[i] ?? null, low: q.low?.[i] ?? null,
        close, volume: q.volume?.[i] ?? null, adjClose: adj[i] ?? null,
      });
    }
    return out;
  } catch (e) {
    if (attempt >= 3) { console.warn(`  ${symbol} failed after ${attempt}: ${e}`); return null; }
    await sleep(1500 * attempt);
    return fetchMax(symbol, attempt + 1);
  }
}

function trainingSymbols(): string[] {
  const lines = readFileSync(FEATURES, 'utf8').split('\n');
  const header = lines[0].split(',');
  const iSym = header.indexOf('symbol');
  const set = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const s = lines[i]?.split(',')[iSym];
    if (s) set.add(s);
  }
  return [...set].sort();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

  const symbols = trainingSymbols();
  const todo = limit === Infinity ? symbols : symbols.slice(0, limit);
  console.log(`Training symbols: ${symbols.length}  (processing ${todo.length})${dryRun ? '  [DRY RUN — no writes]' : ''}`);

  const db = new Database(DB_PATH);
  const before = db.prepare('SELECT COUNT(*) c FROM daily_prices').get() as { c: number };
  const beforeMin = db.prepare('SELECT MIN(date) d FROM daily_prices').get() as { d: string };
  console.log(`daily_prices before: ${before.c.toLocaleString()} rows, earliest ${beforeMin.d}`);

  // OR IGNORE + PK(symbol,date): an existing bar can never be replaced.
  // Distinct stamp so this run is separable from the pre-existing 'yahoo' rows.
  const SOURCE_TAG = `yahoo_backfill_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  console.log(`writing new rows with source='${SOURCE_TAG}' (rollback: DELETE FROM daily_prices WHERE source LIKE 'yahoo_backfill_%')`);
  const insert = db.prepare(`INSERT OR IGNORE INTO daily_prices
    (symbol, date, open, high, low, close, volume, adj_close, source)
    VALUES (@symbol, @date, @open, @high, @low, @close, @volume, @adj_close, '${SOURCE_TAG}')`);
  const insertMany = db.transaction((rows: any[]) => {
    let added = 0;
    for (const r of rows) added += insert.run(r).changes;
    return added;
  });

  let done = 0, added = 0, noData = 0, extended = 0;
  for (const symbol of todo) {
    const bars = await fetchMax(symbol);
    await sleep(REQUEST_DELAY_MS);
    if (!bars || bars.length === 0) { noData++; done++; continue; }

    if (!dryRun) {
      const n = insertMany(bars.map(b => ({
        symbol, date: b.date, open: b.open, high: b.high, low: b.low,
        close: b.close, volume: b.volume, adj_close: b.adjClose,
      })));
      if (n > 0) extended++;
      added += n;
    } else {
      added += bars.length;
    }
    if (++done % 50 === 0) console.log(`  ${done}/${todo.length}  rows added ${added.toLocaleString()}  symbols extended ${extended}`);
  }

  const after = db.prepare('SELECT COUNT(*) c FROM daily_prices').get() as { c: number };
  const afterMin = db.prepare('SELECT MIN(date) d FROM daily_prices').get() as { d: string };
  const bySource = db.prepare('SELECT source, COUNT(*) c FROM daily_prices GROUP BY source').all() as Array<{ source: string; c: number }>;

  console.log(`\nprocessed ${done}  no data ${noData}  symbols extended ${extended}`);
  console.log(`rows added: ${added.toLocaleString()}`);
  console.log(`daily_prices after: ${after.c.toLocaleString()} rows, earliest ${afterMin.d}`);
  console.log('by source:', bySource.map(s => `${s.source}:${s.c.toLocaleString()}`).join('  '));
  if (!dryRun && after.c - before.c !== added) {
    console.warn(`⚠ delta mismatch: table grew by ${after.c - before.c} but ${added} inserts reported`);
  }
  db.close();
}

main().catch(e => { console.error('[Backfill] FATAL:', e); process.exit(1); });
