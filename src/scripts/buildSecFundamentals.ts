/**
 * buildSecFundamentals.ts — free, point-in-time-safe US fundamentals from SEC XBRL.
 *
 * WHY. The research report names the SEC Financial Statement Data Sets "the
 * strongest free replacement for the FMP fundamentals you were considering paying
 * for", and FMP premium is deferred indefinitely. Unlike a vendor snapshot, SEC
 * data is genuinely point-in-time: every fact carries the `filed` date of the
 * filing it came from, so "what was known on date T" is a filter, not a guess.
 *
 * SOURCE CHOICE (recon 2026-07-31, measured not assumed). Three routes exist:
 *   - quarterly bulk ZIPs (financial-statement-data-sets): 69 quarters,
 *     2009q1->2026q1, 5.20 GB total. Correct but we need 444 of 10,412 companies.
 *   - companyfacts.zip: one 1.33 GB file, still everything.
 *   - per-company JSON API: ~4 MB and ~650 ms per company.  <= CHOSEN
 * The per-company API moves ~1.8 GB for our universe, is trivially resumable, and
 * needs no ZIP/TSV parsing. SEC caps traffic at 10 req/s and requires a
 * descriptive User-Agent with contact info, so REQUEST_DELAY_MS is set accordingly
 * and the contact comes from SEC_CONTACT (never hard-coded — it is personal data).
 *
 * POINT-IN-TIME HANDLING. A period is commonly re-reported by later filings (46 of
 * 57 AAPL revenue periods came from >1 accession — comparatives and restatements).
 * This keeps the FIRST filing of each (tag, period) as `filed`/`val` — the vintage
 * actually available at the time — and records `restatedVal`/`restatedFiled` when a
 * later filing changed the number. Backtests must read `val`; `restatedVal` exists
 * only so restatement magnitude is auditable rather than silently discarded.
 *
 * COVERAGE IS THE CATCH — READ BEFORE USING AS A FEATURE. This is US filers only:
 * 472 of our 1,397 symbols are US-listed and 444 map to a CIK (94.1%; the 28
 * misses are ETFs and foreign ADRs, which correctly do not file XBRL financials).
 * That is ~34% of training rows. Wiring these in WITHOUT explicit null indicators
 * would hand the model a perfect US-vs-rest proxy — exactly the silent-zero
 * failure already found in the benchmark (`|| 0`) and VIX (55% of rows encoded as
 * a real "low" regime) paths. Any feature built on this must flag absence.
 *
 * Usage:
 *   $env:SEC_CONTACT="name email"; npx tsx src/scripts/buildSecFundamentals.ts
 *   npx tsx src/scripts/buildSecFundamentals.ts --limit 20     # smoke test
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, 'symbol_sec_fundamentals.json');
const UNIVERSE_PATH = join(__dirname, 'symbol_spread_bps.json');
const REQUEST_DELAY_MS = 110; // SEC: <=10 req/s

// us-gaap tags worth carrying. Revenue has two spellings depending on filer era
// (ASC 606 renamed it), so both are collected and merged under `revenue`.
const TAGS: Record<string, string[]> = {
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss'],
  epsDiluted: ['EarningsPerShareDiluted'],
  rAndD: ['ResearchAndDevelopmentExpense'],
  assets: ['Assets'],
  liabilities: ['Liabilities'],
  equity: ['StockholdersEquity'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  sharesOutstanding: ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'],
};

// COMPACT ON-DISK SHAPE. A verbose {end,filed,val,form,fy,fp} record projected to
// ~77 MB across the universe, most of it repeated key names. Facts are stored as
// positional arrays instead: [end, filed, val, periodType] with an optional
// [restatedVal, restatedFiled] appended. Same information, ~4x smaller.
//
// Periods are also filtered to the ones that mean something: INSTANT (balance-sheet
// items), Q (~3 months) and A (~12 months). XBRL additionally carries H1/9M/YTD
// durations for the same tags, which are redundant for features and were a large
// part of the bloat.
type PeriodType = 'I' | 'Q' | 'A';
type CompactFact = [end: string, filed: string, val: number, ptype: PeriodType]
  | [end: string, filed: string, val: number, ptype: PeriodType, restatedVal: number, restatedFiled: string];
type SymbolFacts = Record<string, CompactFact[]>;

function classifyPeriod(start: string | undefined, end: string): PeriodType | null {
  if (!start) return 'I';
  const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
  if (days <= 5) return 'I';
  if (days >= 80 && days <= 100) return 'Q';
  if (days >= 350 && days <= 380) return 'A';
  return null; // H1 / 9M / other YTD spans — redundant here
}

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
    if (res.status === 404) return null;            // company genuinely has no facts
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    if (attempt >= 3) { console.warn(`  ${url.slice(-24)} failed after ${attempt}: ${e}`); return null; }
    await sleep(1000 * attempt);
    return getJson(url, ua, attempt + 1);
  }
}

/** Collapse one us-gaap tag's unit arrays into first-vintage-per-period facts. */
function collectTag(gaap: any, names: string[]): CompactFact[] {
  interface Acc { end: string; filed: string; val: number; ptype: PeriodType; rVal?: number; rFiled?: string; }
  const byPeriod = new Map<string, Acc>();
  for (const name of names) {
    const node = gaap?.[name];
    if (!node?.units) continue;
    for (const unitKey of Object.keys(node.units)) {
      for (const e of node.units[unitKey] as any[]) {
        if (e?.val == null || !e.end || !e.filed) continue;
        const ptype = classifyPeriod(e.start, e.end);
        if (!ptype) continue;
        // key on the reported PERIOD, not the filing — the whole point is that one
        // period is reported by several filings over time.
        const key = `${ptype}|${e.end}`;
        const prev = byPeriod.get(key);
        if (!prev) {
          byPeriod.set(key, { end: e.end, filed: e.filed, val: e.val, ptype });
        } else if (e.filed < prev.filed) {
          // an earlier filing of the same period: that is the true first vintage
          if (prev.val !== e.val) { prev.rVal = prev.val; prev.rFiled = prev.filed; }
          prev.filed = e.filed; prev.val = e.val;
        } else if (e.val !== prev.val && (!prev.rFiled || e.filed > prev.rFiled)) {
          prev.rVal = e.val; prev.rFiled = e.filed;   // later, different => restatement
        }
      }
    }
    if (byPeriod.size) break; // first tag spelling that yields data wins
  }
  return [...byPeriod.values()]
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.ptype < b.ptype ? -1 : 1))
    .map(a => (a.rVal != null && a.rFiled
      ? [a.end, a.filed, a.val, a.ptype, a.rVal, a.rFiled]
      : [a.end, a.filed, a.val, a.ptype]) as CompactFact);
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  const ua = contact();

  const universe: string[] = Object.keys(JSON.parse(readFileSync(UNIVERSE_PATH, 'utf8')).spreadBps);
  const usSymbols = universe.filter(s => !s.includes('.') || s === 'BRK.B');
  console.log(`Universe ${universe.length}; US-listed ${usSymbols.length}`);

  console.log('Fetching SEC ticker->CIK map...');
  const map = await getJson('https://www.sec.gov/files/company_tickers.json', ua);
  if (!map) { console.error('[SEC] could not fetch company_tickers.json'); process.exit(1); }
  const cikByTicker = new Map<string, number>();
  for (const row of Object.values(map) as any[]) cikByTicker.set(String(row.ticker).toUpperCase(), row.cik_str);
  console.log(`  ${cikByTicker.size} SEC tickers`);

  const targets: Array<{ symbol: string; cik: number }> = [];
  const unmatched: string[] = [];
  for (const s of usSymbols) {
    // SEC writes dual-class with a hyphen (BRK.B -> BRK-B)
    const cik = cikByTicker.get(s.toUpperCase()) ?? cikByTicker.get(s.replace('.', '-').toUpperCase());
    if (cik) targets.push({ symbol: s, cik }); else unmatched.push(s);
  }
  console.log(`  matched ${targets.length}/${usSymbols.length}; unmatched ${unmatched.length} (ETFs/ADRs expected): ${unmatched.slice(0, 10).join(', ')}${unmatched.length > 10 ? '…' : ''}`);

  const prev = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')).fundamentals ?? {} : {};
  const out: Record<string, { cik: number; facts: SymbolFacts }> = {};
  const todo = limit === Infinity ? targets : targets.slice(0, limit);
  let done = 0, noData = 0, factCount = 0;

  for (const t of todo) {
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${String(t.cik).padStart(10, '0')}.json`;
    const j = await getJson(url, ua);
    if (!j?.facts?.['us-gaap']) {
      noData++;
      if (prev[t.symbol]) out[t.symbol] = prev[t.symbol];   // keep last good pull
    } else {
      const facts: SymbolFacts = {};
      for (const [field, names] of Object.entries(TAGS)) {
        const f = collectTag(j.facts['us-gaap'], names) ;
        // dei holds the share-count tag for some filers
        const merged = f.length ? f : (field === 'sharesOutstanding' ? collectTag(j.facts['dei'], names) : []);
        if (merged.length) { facts[field] = merged; factCount += merged.length; }
      }
      out[t.symbol] = { cik: t.cik, facts };
    }
    if (++done % 25 === 0) console.log(`  ${done}/${todo.length} (${factCount} facts)`);
    await sleep(REQUEST_DELAY_MS);
  }

  const withData = Object.keys(out).filter(s => Object.keys(out[s].facts).length > 0);
  const coverage: Record<string, number> = {};
  for (const s of withData) for (const f of Object.keys(out[s].facts)) coverage[f] = (coverage[f] ?? 0) + 1;

  // NOT pretty-printed: indentation alone accounted for roughly half the bytes.
  writeFileSync(OUT_PATH, JSON.stringify({
    _note: 'Point-in-time US fundamentals from the SEC XBRL companyfacts API. Each fact is [end, filed, val, periodType] with an optional [restatedVal, restatedFiled] appended; periodType is I(nstant) / Q(uarter ~3mo) / A(nnual ~12mo). `filed` is the date the value became public and `val` is the FIRST-reported vintage for that period, so BACKTESTS MUST FILTER ON filed <= as_of_date; restatedVal exists only so revisions are auditable, never for training. US filers ONLY (~34% of training rows) — any feature built on this MUST carry an explicit null indicator or it becomes a US-vs-rest proxy. Rebuild via buildSecFundamentals.ts (needs SEC_CONTACT).',
    _built: new Date().toISOString().slice(0, 10),
    _source: 'https://data.sec.gov/api/xbrl/companyfacts/',
    _schema: '[end, filed, val, periodType] | [end, filed, val, periodType, restatedVal, restatedFiled]',
    _counts: { targeted: todo.length, withData: withData.length, noData, facts: factCount },
    _fieldCoverage: coverage,
    fundamentals: out,
  }));

  console.log(`\nSymbols with data: ${withData.length}/${todo.length}   total facts: ${factCount}`);
  console.log('Field coverage:');
  for (const [f, n] of Object.entries(coverage).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${f.padEnd(20)} ${n}/${withData.length} (${(n / withData.length * 100).toFixed(1)}%)`);
  }
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch(e => { console.error('[SEC] FATAL:', e); process.exit(1); });
