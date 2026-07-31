/**
 * buildHkexAnnouncements.ts — free HK listed-company filing events (HKEXnews).
 *
 * WHY THIS AND NOT MORE FUNDAMENTALS. The v10-DROP ablation prices quarterly
 * fundamentals at <=0.014 IC in this system (D5, the rec basis, just -0.004), and
 * structurally they cannot help: they update 4x a year with a ~34-day lag while we
 * trade 2D/2W, so between earnings the value is CONSTANT per name and cannot rank
 * names day to day. Filing EVENTS are the opposite — daily-varying, timestamped,
 * point-in-time exact. `.HK` is 3,351 training rows / 56 symbols with no feed today.
 *
 * SOURCE. HKEXnews `titleSearchServlet.do`: official, JSON, and needs NO API key —
 * the only one of four non-US markets probed (2026-07-31) that is key-less. Japan
 * EDINET and UK Companies House are free but need registered keys; LSE RNS is
 * LSEG-commercial; SEDAR+ exposes no free API.
 *
 * THREE TRAPS, ALL FOUND THE HARD WAY — every one returns HTTP 200 with a
 * plausible-looking body rather than an error:
 *   1. Date params are `fromDate`/`toDate` in YYYYMMDD. Passing `from`/`to` is
 *      SILENTLY IGNORED and you get the most recent ~590 rows for every window —
 *      which looks like real data until you notice each month returns the same set.
 *   2. `t2Gcode` and `t2code` must be `-2` ("all"). With `-1` the servlet returns
 *      recordCnt=0, which reads as "no announcements" rather than "bad query".
 *   3. `stockId` is HKEX's INTERNAL id (Tencent = 7609), not the listing code.
 *      Passing `00700` silently returns a DIFFERENT company's filings (00362).
 *      Hence resolveStockId() below, and the post-fetch code assertion.
 * `t1code` is a category filter, not a requirement: `-1` gives every category
 * (22,239 market-wide in 2026-03), whereas 40000 is Financial Reports only (343).
 *
 * Per-stock querying keeps this to ~2 requests per symbol instead of paging a
 * 22k-row/month market-wide feed.
 *
 * Usage:
 *   npx tsx src/scripts/buildHkexAnnouncements.ts                 # default since 2021-01-01
 *   npx tsx src/scripts/buildHkexAnnouncements.ts --since 20240101 --limit 5
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, 'symbol_hkex_announcements.json');
const UNIVERSE_PATH = join(__dirname, 'symbol_spread_bps.json');
const SEARCH_URL = 'https://www1.hkexnews.hk/search/titleSearchServlet.do';
const PREFIX_URL = 'https://www1.hkexnews.hk/search/prefix.do';
const REQUEST_DELAY_MS = 400;   // public search endpoint, not a metered API — be courteous
const PAGE_ROWS = 2000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; stock-catalyst-historian)',
  Referer: 'https://www1.hkexnews.hk/search/titlesearch.xhtml?lang=EN',
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** `0700.HK` -> `00700`: HKEX pads listing codes to 5 digits. */
function toHkexCode(symbol: string): string {
  return symbol.replace(/\.HK$/i, '').replace(/^0+/, '').padStart(5, '0');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

/** `DD/MM/YYYY HH:mm` in HK local time (UTC+8, no DST) -> ISO instant + local date. */
function parseHkDateTime(s: string): { iso: string; date: string } | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi] = m;
  return { iso: new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:00+08:00`).toISOString(), date: `${yyyy}-${mm}-${dd}` };
}

/** Listing code -> HKEX internal stockId. JSONP: `callback({...});` */
async function resolveStockId(code: string): Promise<number | null> {
  const url = `${PREFIX_URL}?callback=cb&lang=EN&type=A&name=${encodeURIComponent(code)}`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/callback\((.*)\);?\s*$/s);
    if (!m) return null;
    const j = JSON.parse(m[1]);
    const exact = (j.stockInfo ?? []).find((s: any) => String(s.code).padStart(5, '0') === code);
    return exact ? Number(exact.stockId) : null;
  } catch { return null; }
}

interface Row { STOCK_CODE?: string; TITLE?: string; DATE_TIME?: string; FILE_TYPE?: string; NEWS_ID?: string; }

async function fetchForStock(stockId: number, fromDate: string, toDate: string): Promise<{ rows: Row[]; more: boolean; total: number }> {
  const qs = new URLSearchParams({
    sortDir: '0', sortByOptions: 'DateTime', category: '0', market: 'SEHK', lang: 'EN',
    searchType: '1', documentType: '-1', rowRange: String(PAGE_ROWS),
    t1code: '-1', t2Gcode: '-2', t2code: '-2',   // -2 = all; -1 yields recordCnt=0
    stockId: String(stockId), fromDate, toDate,
  });
  const res = await fetch(`${SEARCH_URL}?${qs}`, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j: any = await res.json();
  let result = j.result;
  if (typeof result === 'string') { try { result = JSON.parse(result); } catch { result = []; } }
  return { rows: Array.isArray(result) ? result : [], more: !!j.hasNextRow, total: Number(j.recordCnt ?? 0) };
}

/**
 * Fetch a symbol's whole window, splitting it when the server caps the page.
 *
 * `rowRange` is a page size, and the only overflow signal is `hasNextRow` — there
 * is no offset parameter to page with. So on overflow the window is halved and each
 * half fetched independently, recursively, until every slice fits. Without this the
 * busiest filers silently lose their oldest announcements: HSBC (0005.HK) has 2,435
 * since 2021 against a 2,000-row cap, and the truncation is date-ordered, so it
 * would quietly amputate history rather than fail.
 */
async function collectForStock(stockId: number, from: string, to: string, depth = 0): Promise<{ rows: Row[]; capped: boolean }> {
  const win = await fetchForStock(stockId, from, to);
  await sleep(REQUEST_DELAY_MS);
  if (!win.more || depth >= 6 || from >= to) return { rows: win.rows, capped: win.more };

  const mid = new Date((new Date(`${from.slice(0, 4)}-${from.slice(4, 6)}-${from.slice(6)}`).getTime()
    + new Date(`${to.slice(0, 4)}-${to.slice(4, 6)}-${to.slice(6)}`).getTime()) / 2);
  const midStr = mid.toISOString().slice(0, 10).replace(/-/g, '');
  const dayAfter = new Date(mid.getTime() + 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  if (midStr <= from || dayAfter > to) return { rows: win.rows, capped: true };

  const [a, b] = [await collectForStock(stockId, from, midStr, depth + 1),
                  await collectForStock(stockId, dayAfter, to, depth + 1)];
  const seen = new Set<string>();
  const merged: Row[] = [];
  for (const r of [...a.rows, ...b.rows]) {
    const k = `${r.NEWS_ID ?? ''}|${r.DATE_TIME ?? ''}|${r.TITLE ?? ''}`;
    if (!seen.has(k)) { seen.add(k); merged.push(r); }
  }
  return { rows: merged, capped: a.capped || b.capped };
}

async function main() {
  const args = process.argv.slice(2);
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : '20210101';
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const universe: string[] = Object.keys(JSON.parse(readFileSync(UNIVERSE_PATH, 'utf8')).spreadBps);
  const hk = universe.filter(s => /\.HK$/i.test(s));
  const todo = limit === Infinity ? hk : hk.slice(0, limit);
  console.log(`Universe ${universe.length}; .HK symbols ${hk.length}; fetching ${todo.length} from ${since} to ${today}`);

  const announcements: Record<string, Array<[string, string, string, string]>> = {};
  let unresolved = 0, mismatched = 0, truncated = 0, entries = 0;

  for (const symbol of todo) {
    const code = toHkexCode(symbol);
    const stockId = await resolveStockId(code);
    await sleep(REQUEST_DELAY_MS);
    if (stockId == null) { console.log(`   ${symbol.padEnd(10)} could not resolve stockId for ${code}`); unresolved++; continue; }

    let win;
    try { win = await collectForStock(stockId, since, today); }
    catch (e) { console.log(`   ${symbol.padEnd(10)} search failed: ${e}`); await sleep(REQUEST_DELAY_MS); continue; }
    if (win.capped) truncated++;

    const list: Array<[string, string, string, string]> = [];
    for (const r of win.rows) {
      const dt = parseHkDateTime(String(r.DATE_TIME ?? ''));
      if (!dt) continue;
      // Guard against trap 3: a bad stockId returns another company's filings.
      const codes = String(r.STOCK_CODE ?? '').split(/<br\s*\/?>/i).map(c => c.trim().padStart(5, '0'));
      if (!codes.includes(code)) { mismatched++; continue; }
      list.push([dt.iso, dt.date, decodeEntities(String(r.TITLE ?? '')), String(r.FILE_TYPE ?? '')]);
    }
    list.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (list.length) { announcements[symbol] = list; entries += list.length; }
    console.log(`   ${symbol.padEnd(10)} id=${String(stockId).padStart(6)}  ${String(list.length).padStart(4)} kept of ${String(win.rows.length).padStart(4)} fetched${win.capped ? '  ⚠ STILL CAPPED' : ''}`);
  }

  const covered = Object.keys(announcements).length;
  writeFileSync(OUT_PATH, JSON.stringify({
    _note: 'HK listed-company filing events from HKEXnews titleSearchServlet.do (official, no API key). Each entry is [isoInstantUTC, hkLocalDate, title, fileType]. USE isoInstantUTC when joining to anything UTC-stamped: HKEX publishes DD/MM/YYYY HH:mm in HK local time (UTC+8, no DST), so an evening HK announcement belongs to a different UTC day. Announcements covering several listings are split per symbol. PARAMETER TRAPS (all return HTTP 200): date params are fromDate/toDate in YYYYMMDD — from/to is silently ignored and returns the newest ~590 rows for every window; t2Gcode/t2code must be -2 or recordCnt is 0; stockId is HKEX\'s internal id from prefix.do, NOT the listing code — a listing code silently returns another company. Rebuild via buildHkexAnnouncements.ts.',
    _built: new Date().toISOString().slice(0, 10),
    _source: SEARCH_URL,
    _window: { since, until: today },
    _counts: { hkSymbols: hk.length, attempted: todo.length, symbolsWithAnnouncements: covered, entries, unresolved, mismatchedRowsDropped: mismatched, truncatedSymbols: truncated },
    announcements,
  }));

  console.log(`\nSymbols with announcements: ${covered}/${todo.length}   entries: ${entries}`);
  if (unresolved) console.log(`   ${unresolved} symbol(s) had no stockId`);
  if (mismatched) console.log(`   ${mismatched} row(s) dropped as belonging to another listing`);
  if (truncated) console.log(`⚠ ${truncated} symbol(s) hit the ${PAGE_ROWS}-row page cap — narrow --since or add paging.`);
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch(e => { console.error('[HKEX] FATAL:', e); process.exit(1); });
