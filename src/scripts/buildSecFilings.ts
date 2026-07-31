/**
 * buildSecFilings.ts — US filing EVENTS (SEC submissions API), incl. 8-K item codes.
 *
 * WHY EVENTS, NOT LEVELS. buildSecFundamentals.ts gives point-in-time balance-sheet
 * and income data, but our own v10-DROP ablation prices that class of feature at
 * <=0.014 IC here (D5, the rec basis, just -0.004) — and structurally it cannot do
 * better: fundamentals update 4x a year with a ~34-day lag while we trade 2D/2W, so
 * between earnings the value is CONSTANT per name and cannot rank names day to day.
 * A filing is the opposite: it happens on a date, at a time, and 8-K item codes say
 * WHAT happened. That is the shape a catalyst system can actually use.
 *
 * WHY THIS ENDPOINT. `data.sec.gov/submissions/` is ~0.16 MB per company against
 * ~4 MB for companyfacts — 25x smaller — and carries the field that matters most:
 *   acceptanceDateTime, e.g. 2026-07-30T20:30:28Z, i.e. AFTER the 20:00 UTC close.
 * Filing DATE alone would imply the market knew during that session. Given the
 * async-close bug found the same day (features hedged against a benchmark that had
 * not closed yet), using an exact acceptance instant rather than a date is the
 * difference between a clean feature and another lookahead.
 *
 * 8-K ITEM CODES are a free, structured catalyst taxonomy. The ones worth knowing:
 *   1.01 material agreement · 1.03 bankruptcy · 2.02 results of operations
 *   2.05 exit/disposal costs · 4.01 auditor change · 4.02 NON-RELIANCE on previously
 *   issued financials (a restatement — a genuine negative catalyst) · 5.02 director
 *   or principal-officer departure/appointment · 7.01 Reg-FD · 8.01 other events.
 *
 * HISTORY. `filings.recent` covers roughly the last 1,000 filings; older ones live
 * in `filings.files` shards which this also pulls, so heavy filers keep their
 * history instead of silently losing the oldest rows.
 *
 * Usage:
 *   $env:SEC_CONTACT="name email"; npx tsx src/scripts/buildSecFilings.ts
 *   npx tsx src/scripts/buildSecFilings.ts --limit 10 --since 2019-01-01
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, 'symbol_sec_filings.json');
const UNIVERSE_PATH = join(__dirname, 'symbol_spread_bps.json');
const REQUEST_DELAY_MS = 110; // SEC: <=10 req/s

// Forms that are events worth modelling. Deliberately excludes Form 4 (insider
// transactions): it is 589 of AAPL's 1,002 recent filings and would dominate the
// artifact — worth its own build if we ever want insider flow, not a freebie here.
const FORMS = new Set([
  '8-K', '8-K/A', '10-K', '10-K/A', '10-Q', '10-Q/A', '20-F', '20-F/A', '6-K', '6-K/A',
  'S-1', 'S-3', 'S-4', 'SC 13D', 'SC 13D/A', 'DEF 14A',
]);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function contact(): string {
  const c = process.env.SEC_CONTACT;
  if (!c) {
    console.error('[SEC] SEC_CONTACT is required — SEC policy asks for a descriptive');
    console.error('      User-Agent with contact info. e.g. $env:SEC_CONTACT="jane doe jane@example.com"');
    process.exit(1);
  }
  return `stock-catalyst-historian ${c}`;
}

async function getJson(url: string, ua: string, attempt = 1): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua, 'Accept-Encoding': 'gzip, deflate' }, signal: AbortSignal.timeout(30000) });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    if (attempt >= 3) { console.warn(`  ${url.slice(-28)} failed after ${attempt}: ${e}`); return null; }
    await sleep(1000 * attempt);
    return getJson(url, ua, attempt + 1);
  }
}

// [filingDate, acceptanceInstantUTC, form, items]
type Filing = [string, string, string, string];

/** Flatten one `filings.recent`-shaped block of parallel arrays. */
function flatten(block: any, since: string, out: Map<string, Filing>): void {
  const forms: string[] = block?.form ?? [];
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!FORMS.has(form)) continue;
    const filingDate: string = block.filingDate?.[i] ?? '';
    if (!filingDate || filingDate < since) continue;
    const accn: string = block.accessionNumber?.[i] ?? `${filingDate}|${form}|${i}`;
    // acceptanceDateTime is the instant the filing became public; filingDate alone
    // would imply the market knew during that session, which is often false.
    const acceptance: string = block.acceptanceDateTime?.[i] ?? '';
    const items: string = block.items?.[i] ?? '';
    out.set(accn, [filingDate, acceptance, form, items]);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : '2015-01-01';
  const ua = contact();

  const universe: string[] = Object.keys(JSON.parse(readFileSync(UNIVERSE_PATH, 'utf8')).spreadBps);
  const usSymbols = universe.filter(s => !s.includes('.') || s === 'BRK.B');
  console.log(`Universe ${universe.length}; US-listed ${usSymbols.length}; since ${since}`);

  const map = await getJson('https://www.sec.gov/files/company_tickers.json', ua);
  if (!map) { console.error('[SEC] could not fetch company_tickers.json'); process.exit(1); }
  const cikByTicker = new Map<string, number>();
  for (const row of Object.values(map) as any[]) cikByTicker.set(String(row.ticker).toUpperCase(), row.cik_str);

  const targets: Array<{ symbol: string; cik: number }> = [];
  for (const s of usSymbols) {
    const cik = cikByTicker.get(s.toUpperCase()) ?? cikByTicker.get(s.replace('.', '-').toUpperCase());
    if (cik) targets.push({ symbol: s, cik });
  }
  console.log(`  matched ${targets.length}/${usSymbols.length} to a CIK (misses are ETFs/ADRs, which file no XBRL)`);

  const todo = limit === Infinity ? targets : targets.slice(0, limit);
  const filings: Record<string, Filing[]> = {};
  const formCounts: Record<string, number> = {};
  const itemCounts: Record<string, number> = {};
  let done = 0, shards = 0, total = 0, withEightK = 0;

  for (const t of todo) {
    const padded = String(t.cik).padStart(10, '0');
    const j = await getJson(`https://data.sec.gov/submissions/CIK${padded}.json`, ua);
    await sleep(REQUEST_DELAY_MS);
    if (!j?.filings) { done++; continue; }

    const acc = new Map<string, Filing>();
    flatten(j.filings.recent, since, acc);
    // older history lives in separate shards
    for (const f of j.filings.files ?? []) {
      if (f.filingTo && f.filingTo < since) continue;   // shard entirely predates the window
      const s = await getJson(`https://data.sec.gov/submissions/${f.name}`, ua);
      shards++;
      await sleep(REQUEST_DELAY_MS);
      if (s) flatten(s, since, acc);
    }

    const list = [...acc.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (list.length) {
      filings[t.symbol] = list;
      total += list.length;
      let has8k = false;
      for (const [, , form, items] of list) {
        formCounts[form] = (formCounts[form] ?? 0) + 1;
        if (form.startsWith('8-K')) {
          has8k = true;
          for (const it of items.split(',').map(x => x.trim()).filter(Boolean)) itemCounts[it] = (itemCounts[it] ?? 0) + 1;
        }
      }
      if (has8k) withEightK++;
    }
    if (++done % 25 === 0) console.log(`  ${done}/${todo.length}  (${total} filings, ${shards} history shards)`);
  }

  const covered = Object.keys(filings).length;
  writeFileSync(OUT_PATH, JSON.stringify({
    _note: 'US filing EVENTS from the SEC submissions API. Each entry is [filingDate, acceptanceDateTimeUTC, form, items]. USE acceptanceDateTime, not filingDate: filings are frequently accepted after the 20:00 UTC close, so treating the filing date as knowable intraday is lookahead. `items` holds 8-K item codes (2.02 results, 4.02 non-reliance/restatement, 5.02 officer change, 1.03 bankruptcy, ...). Form 4 insider transactions are deliberately excluded — they are ~60% of filing volume and deserve their own build. Rebuild via buildSecFilings.ts (needs SEC_CONTACT).',
    _built: new Date().toISOString().slice(0, 10),
    _source: 'https://data.sec.gov/submissions/',
    _window: { since },
    _counts: { targeted: todo.length, symbolsWithFilings: covered, filings: total, symbolsWith8K: withEightK, historyShards: shards },
    _formCounts: formCounts,
    _eightKItemCounts: itemCounts,
    filings,
  }));

  console.log(`\nSymbols with filings: ${covered}/${todo.length}   filings: ${total}   with 8-K: ${withEightK}`);
  console.log('Top forms:', Object.entries(formCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log('Top 8-K items:', Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch(e => { console.error('[SEC] FATAL:', e); process.exit(1); });
