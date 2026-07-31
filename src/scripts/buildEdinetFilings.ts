/**
 * buildEdinetFilings.ts — Japanese filing EVENTS from EDINET (FSA).
 *
 * WHY. `.T` is our largest non-US block after the UK (82 universe symbols) and had
 * no filing feed at all. EDINET is Japan's EDGAR — the statutory disclosure system
 * itself, not a registry — so unlike UK Companies House it carries the filings that
 * actually move prices. And filing EVENTS are what a 2D/2W catalyst system can use:
 * the v10-DROP ablation prices quarterly fundamentals at <=0.014 IC here, and they
 * are constant between reports so they cannot rank names day to day at all.
 *
 * AUTH TRAP. EDINET answers **HTTP 200 even when the key is rejected** — the real
 * status lives in `metadata.status` (401 with "Access denied due to invalid
 * subscription key"). A normal `res.ok` check therefore passes on an auth failure
 * and yields a silent empty dataset, so every response here is validated on the
 * BODY. Key goes in EDINET_API_KEY; the header form is used (a query-param form
 * also works, but keys do not belong in URLs that end up in logs).
 *
 * DATE-INDEXED, NOT COMPANY-INDEXED. There is no per-company endpoint: you request
 * a day and receive every filing made that day. History is therefore one request per
 * business day (~250/yr). Weekends are skipped; Japanese public holidays simply
 * return zero documents, which is harmless.
 *
 * JOIN. `secCode` is the 4-digit ticker plus a trailing zero — `1803.T` -> `18030`.
 * Exact and authoritative, unlike the fuzzy name matching that made Companies House
 * unusable (there, "BP" resolved to an unrelated company with no error).
 *
 * TIME. `submitDateTime` is `YYYY-MM-DD HH:mm` in JST (UTC+9, no DST) and is stored
 * as a UTC instant. Use the instant, not the date: a Tokyo filing at 16:00 JST is
 * 07:00 UTC the same day, but one at 09:08 JST is 00:08 UTC — and the async-close
 * audit showed how easily local-vs-UTC date slippage becomes lookahead.
 *
 * Usage:
 *   npx tsx src/scripts/buildEdinetFilings.ts                    # default since 2021-01-01
 *   npx tsx src/scripts/buildEdinetFilings.ts --since 2026-06-01 # smoke test
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, 'symbol_edinet_filings.json');
const UNIVERSE_PATH = join(__dirname, 'symbol_spread_bps.json');
const API = 'https://api.edinet-fsa.go.jp/api/v2/documents.json';
const REQUEST_DELAY_MS = 250;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function apiKey(): string {
  const k = process.env.EDINET_API_KEY;
  if (!k) {
    console.error('[EDINET] EDINET_API_KEY missing — register a free subscription key at');
    console.error('         https://api.edinet-fsa.go.jp/ and put it in .env');
    process.exit(1);
  }
  return k;
}

/** `1803.T` -> `18030` (EDINET secCode = 4-digit ticker + trailing zero). */
function toSecCode(symbol: string): string {
  return symbol.replace(/\.T$/i, '').padStart(4, '0') + '0';
}

/** `YYYY-MM-DD HH:mm` JST (UTC+9, no DST) -> ISO instant. */
function jstToIso(s: string): string | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:00+09:00`).toISOString();
}

interface Doc {
  docID?: string; secCode?: string | null; edinetCode?: string;
  filerName?: string; docTypeCode?: string; docDescription?: string;
  submitDateTime?: string; periodEnd?: string;
}

async function fetchDay(date: string, key: string, attempt = 1): Promise<Doc[] | null> {
  try {
    const res = await fetch(`${API}?date=${date}&type=2`, {
      headers: { 'Ocp-Apim-Subscription-Key': key, 'User-Agent': 'stock-catalyst-historian' },
      signal: AbortSignal.timeout(30000),
    });
    // HTTP status is NOT the contract here — see header. Validate the body.
    const j: any = await res.json().catch(() => null);
    const status = String(j?.metadata?.status ?? '');
    if (status === '404') return [];                       // no filings that day
    if (status !== '200') {
      if (status === '401') {
        console.error(`[EDINET] key rejected: ${j?.metadata?.message ?? ''}`);
        process.exit(1);                                   // no point continuing 1,400 times
      }
      throw new Error(`body status ${status || res.status}: ${j?.metadata?.message ?? ''}`);
    }
    return (j.results ?? []) as Doc[];
  } catch (e) {
    if (attempt >= 3) { console.warn(`  ${date} failed after ${attempt}: ${e}`); return null; }
    await sleep(1500 * attempt);
    return fetchDay(date, key, attempt + 1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : '2021-01-01';
  const key = apiKey();

  const universe: string[] = Object.keys(JSON.parse(readFileSync(UNIVERSE_PATH, 'utf8')).spreadBps);
  const jp = universe.filter(s => /\.T$/i.test(s));
  const symbolBySecCode = new Map(jp.map(s => [toSecCode(s), s]));
  console.log(`Universe ${universe.length}; .T symbols ${jp.length}; from ${since}`);

  // [isoInstantUTC, jstDate, docTypeCode, docDescription]
  const filings: Record<string, Array<[string, string, string, string]>> = {};
  const seen = new Set<string>();
  const typeCounts: Record<string, number> = {};
  let days = 0, skipped = 0, docsSeen = 0, kept = 0, failed = 0;

  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date();
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) { skipped++; continue; }     // EDINET publishes on business days
    const date = d.toISOString().slice(0, 10);
    const docs = await fetchDay(date, key);
    await sleep(REQUEST_DELAY_MS);
    if (docs === null) { failed++; continue; }
    days++;
    docsSeen += docs.length;

    for (const doc of docs) {
      if (!doc.secCode) continue;                            // funds and non-listed filers
      const symbol = symbolBySecCode.get(String(doc.secCode));
      if (!symbol) continue;
      const iso = jstToIso(String(doc.submitDateTime ?? ''));
      if (!iso) continue;
      const id = `${symbol}|${doc.docID ?? iso}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const code = String(doc.docTypeCode ?? '');
      (filings[symbol] ??= []).push([iso, date, code, String(doc.docDescription ?? '')]);
      typeCounts[code] = (typeCounts[code] ?? 0) + 1;
      kept++;
    }
    if (days % 50 === 0) console.log(`  ${date}  days=${days}  docs seen=${docsSeen}  ours=${kept}`);
  }

  for (const s of Object.keys(filings)) filings[s].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const covered = Object.keys(filings).length;

  writeFileSync(OUT_PATH, JSON.stringify({
    _note: 'Japanese filing events from the EDINET v2 API (FSA). Each entry is [isoInstantUTC, jstDate, docTypeCode, docDescription]. USE isoInstantUTC when joining to anything UTC-stamped — submitDateTime is JST (UTC+9, no DST) and a 09:08 JST filing is 00:08 UTC the SAME day while a 16:00 JST filing is 07:00 UTC. docDescription is Japanese; prefer docTypeCode for anything programmatic (180 = extraordinary report, the catalyst-shaped one). Joined on secCode = 4-digit ticker + trailing zero. API TRAP: EDINET returns HTTP 200 even when the key is invalid — the real status is metadata.status. Rebuild via buildEdinetFilings.ts (needs EDINET_API_KEY).',
    _built: new Date().toISOString().slice(0, 10),
    _source: API,
    _window: { since },
    _counts: { jpSymbols: jp.length, symbolsWithFilings: covered, entries: kept, businessDaysFetched: days, weekendsSkipped: skipped, failedDays: failed, docsScanned: docsSeen },
    _docTypeCounts: typeCounts,
    filings,
  }));

  console.log(`\nSymbols with filings: ${covered}/${jp.length}   entries: ${kept}   business days: ${days}   docs scanned: ${docsSeen}`);
  if (failed) console.log(`   ⚠ ${failed} day(s) failed after retries`);
  console.log('Top docTypeCodes:', Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch(e => { console.error('[EDINET] FATAL:', e); process.exit(1); });
