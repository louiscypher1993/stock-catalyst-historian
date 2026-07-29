/**
 * buildOpenFigiMap.ts — cross-market security identifier backbone (Stage-3
 * data item #1, run first because the others need this as their join key).
 *
 * Maps every symbol in the scan universe to its FIGI (Financial Instrument
 * Global Identifier, openfigi.com) via OpenFIGI API v3. This is INFRASTRUCTURE,
 * not alpha: a stable identifier to join Yahoo/FMP/EDGAR/exchange feeds across
 * a 40-market universe where the same company can appear under different
 * ticker conventions per source. v2 sunsets 2026-07-01 -- this targets v3.
 *
 * Universe: reused from symbol_spread_bps.json (the same 1,397-symbol set
 * already used for the cost model) rather than the full GLOBAL_MARKETS list,
 * so the FIGI map covers exactly the symbols with real price data (not the
 * ~577 Phenomenon-1 unscanned symbols with no data to join against yet).
 *
 * Exchange disambiguation: OpenFIGI needs a TICKER + exchange hint (a bare
 * ticker is ambiguous across venues). Uses ISO 10383 MIC codes for suffixes
 * this script is CONFIDENT about (~30 markets covering ~97% of the universe);
 * remaining suffixes get a ticker-only query and are flagged `confidence:'low'`
 * rather than guessing a MIC code that could silently mismap a security --
 * same "don't fake precision" discipline as the spread-tier table.
 *
 * KNOWN LANDMINE HIT: BRK.B ended up in the universe with a bare ".B" -- that
 * is NOT an exchange suffix, it's a US dual-class share (Berkshire Hathaway
 * Class B). This is a live instance of the documented is_us_listed dual-class
 * issue (previously assessed "zero blast radius, no dotted US tickers") --
 * special-cased here (query as a US ticker, not an unmapped exchange), and
 * worth revisiting the broader suffixOf() logic in costModel.ts since this
 * proves at least one instance now exists.
 *
 * Usage:
 *   npx tsx src/scripts/buildOpenFigiMap.ts --limit 25   # validate first
 *   npx tsx src/scripts/buildOpenFigiMap.ts              # full universe
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.OPENFIGI_API_KEY || '';
const ENDPOINT = 'https://api.openfigi.com/v3/mapping';
const JOBS_PER_REQUEST = API_KEY ? 100 : 10;
const REQUEST_DELAY_MS = API_KEY ? 250 : 2500; // 25/6s with key; 25/min without

// Known dual-class US tickers whose Yahoo symbol has a share-class dot that
// suffixOf()-style logic would misread as an exchange suffix (BRK.B is the
// one CONFIRMED instance in the current universe; add others here if found).
const DUAL_CLASS_US_TICKERS = new Set(['BRK.B']);

// ISO 10383 MIC codes for suffixes this script is CONFIDENT about. Anything
// NOT in this table falls back to a ticker-only query (lower precision,
// flagged, not guessed).
const MIC_MAP: Record<string, string> = {
  '.L': 'XLON', '.T': 'XTKS', '.TO': 'XTSE', '.HK': 'XHKG', '.AX': 'XASX',
  '.NS': 'XNSE', '.SS': 'XSHG', '.KS': 'XKRX', '.SZ': 'XSHE', '.PA': 'XPAR',
  '.SA': 'BVMF', '.DE': 'XETR', '.TW': 'XTAI', '.AS': 'XAMS', '.MX': 'XMEX',
  '.IS': 'XIST', '.BR': 'XBRU', '.ST': 'XSTO', '.SN': 'XSGO', '.BO': 'XBOM',
  '.NZ': 'XNZE', '.CO': 'XCSE', '.AT': 'XATH', '.SW': 'XSWX', '.OL': 'XOSL',
  '.HE': 'XHEL', '.BA': 'XBUE', '.CA': 'XCAI', '.KA': 'XKAR',
  // moderate confidence, included with a lower internal bar but still a real MIC:
  '.RO': 'XBSE', '.LM': 'XLIM', '.KW': 'XKUW', '.BD': 'XBUD', '.PR': 'XPRA',
};
// Suffixes present in the universe with NO confident mapping -- ticker-only,
// flagged low-confidence rather than guessed (per symbol_spread_bps.json's
// suffix census: .QA appeared but Qatar Exchange's MIC (DSMD) isn't certain
// enough here to assert; .CL's actual market is not confidently identified).
const LOW_CONFIDENCE_SUFFIXES = new Set(['.QA', '.CL']);
// Empirically validated exceptions to the MIC_MAP defaults (found via live-API
// testing, not guessed): OpenFIGI wants Stockholm queried with exchCode "SS",
// not micCode "XSTO" -- micCode consistently returns no match for real, liquid
// Stockholm names (confirmed against Ericsson B). Handled as an exchCode
// override rather than a MIC_MAP entry since it's a different parameter.
const EXCHCODE_OVERRIDE: Record<string, string> = { '.ST': 'SS' };

interface Job { idType: string; idValue: string; exchCode?: string; micCode?: string }
interface FigiMatch {
  figi: string; compositeFIGI?: string; name?: string; ticker?: string;
  exchCode?: string; securityType?: string; marketSector?: string;
}
interface MapEntry {
  figi: string; compositeFigi?: string; name?: string; ticker?: string;
  exchCode?: string; securityType?: string; marketSector?: string;
  micCode: string | null; confidence: 'high' | 'low'; ambiguous?: number;
}

function suffixOf(symbol: string): string {
  const dot = symbol.lastIndexOf('.');
  return dot === -1 ? 'US' : symbol.slice(dot).toUpperCase();
}

// Validated empirically against the live API (see commit message / session notes):
//   - dual-class US tickers: OpenFIGI stores these with a SLASH, not a dot
//     (BRK.B -> ticker "BRK/B"; confirmed via live lookup).
//   - HK: leading zeros must be stripped (0700 -> "700"; confirmed against
//     Tencent, else no match at all despite being one of the most liquid HK names).
//   - Sweden: hyphenated share-class tickers need the hyphen stripped
//     (ERIC-B -> "ERICB"; confirmed against Ericsson, else no match).
//   - BSE numeric scrip codes (.BO) do NOT resolve via TICKER mapping at all,
//     under any exchange code -- confirmed against Reliance's own BSE code
//     (500325), one of the most liquid Indian equities. Structural coverage
//     gap in OpenFIGI's free ticker index, not a format issue; left unmapped
//     rather than guessing further (would need ISIN-based mapping instead,
//     and we don't have ISINs from Yahoo to feed that path).
function buildJob(symbol: string): { job: Job; micCode: string | null; confidence: 'high' | 'low' } {
  if (DUAL_CLASS_US_TICKERS.has(symbol)) {
    return { job: { idType: 'TICKER', idValue: symbol.replace('.', '/'), exchCode: 'US' }, micCode: null, confidence: 'high' };
  }
  const suf = suffixOf(symbol);
  if (suf === 'US') return { job: { idType: 'TICKER', idValue: symbol, exchCode: 'US' }, micCode: null, confidence: 'high' };
  let local = symbol.slice(0, symbol.length - suf.length);
  if (suf === '.HK') local = String(Number(local)); // strip leading zeros
  if (suf === '.ST') local = local.replace(/-/g, ''); // ERIC-B -> ERICB
  const exchOverride = EXCHCODE_OVERRIDE[suf];
  if (exchOverride) return { job: { idType: 'TICKER', idValue: local, exchCode: exchOverride }, micCode: null, confidence: 'high' };
  const mic = MIC_MAP[suf];
  if (mic && !LOW_CONFIDENCE_SUFFIXES.has(suf)) {
    return { job: { idType: 'TICKER', idValue: local, micCode: mic }, micCode: mic, confidence: 'high' };
  }
  // no confident MIC -- ticker-only, best effort, explicitly flagged
  return { job: { idType: 'TICKER', idValue: local }, micCode: null, confidence: 'low' };
}

// Some exchanges (confirmed on LSE, e.g. BP -> "BP/") store short base tickers
// with a trailing slash placeholder (a Bloomberg-identifier convention). Rather
// than guess which tickers need it, retry once with a trailing "/" appended for
// any job that comes back with no match on the first pass.
function retryJobWithSlash(job: Job): Job { return { ...job, idValue: job.idValue + '/' }; }

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out;
}

// Real response shape (verified against the live API, NOT the bare-array shape
// a first read of the docs suggests): one object per job, each either
// { data: FigiMatch[] } on a match or { error: string } on no match/bad job.
type JobResult = { data: FigiMatch[] } | { error: string };
async function mapBatch(jobs: Job[]): Promise<JobResult[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['X-OPENFIGI-APIKEY'] = API_KEY;
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(jobs) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenFIGI HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}
function matchesOf(r: JobResult | undefined): FigiMatch[] { return r && 'data' in r ? r.data : []; }

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

  const spreadPath = join(__dirname, 'symbol_spread_bps.json');
  const universe: string[] = Object.keys(JSON.parse(readFileSync(spreadPath, 'utf8')).spreadBps);
  const symbols = universe.slice(0, limit === Infinity ? undefined : limit);

  console.log(`OpenFIGI mapping: ${symbols.length} symbol(s)${limit !== Infinity ? ` (limited from ${universe.length})` : ''}`);
  console.log(`  auth: ${API_KEY ? 'keyed (25 req/6s, 100 jobs/req)' : 'unauthenticated (25 req/min, 10 jobs/req)'}`);
  if (!API_KEY) console.log('  (no OPENFIGI_API_KEY set -- free to add one at openfigi.com/api for a much faster run)');

  const built = symbols.map(s => ({ symbol: s, ...buildJob(s) }));
  const lowConfCount = built.filter(b => b.confidence === 'low').length;
  console.log(`  high-confidence exchange match: ${symbols.length - lowConfCount}   low-confidence (ticker-only): ${lowConfCount}`);

  const out: Record<string, MapEntry> = {};
  const unmatched: string[] = [];
  const ambiguous: Array<{ symbol: string; count: number }> = [];
  const recoveredBySlash: string[] = [];
  let requestsDone = 0;

  function record(b: { symbol: string; micCode: string | null; confidence: 'high' | 'low' }, matches: FigiMatch[]): void {
    const m = matches[0];
    if (matches.length > 1) ambiguous.push({ symbol: b.symbol, count: matches.length });
    out[b.symbol] = {
      figi: m.figi, compositeFigi: m.compositeFIGI, name: m.name, ticker: m.ticker,
      exchCode: m.exchCode, securityType: m.securityType, marketSector: m.marketSector,
      micCode: b.micCode, confidence: b.confidence, ...(matches.length > 1 ? { ambiguous: matches.length } : {}),
    };
  }

  const batches = chunk(built, JOBS_PER_REQUEST);
  const needsRetry: typeof built = [];
  for (const batch of batches) {
    const results = await mapBatch(batch.map(b => b.job));
    batch.forEach((b, i) => {
      const matches = matchesOf(results[i]);
      if (matches.length === 0) { needsRetry.push(b); return; }
      record(b, matches);
    });
    requestsDone++;
    if (requestsDone % 10 === 0 || requestsDone === batches.length) {
      console.log(`  ${requestsDone}/${batches.length} requests, ${Object.keys(out).length} mapped so far`);
    }
    if (requestsDone < batches.length) await sleep(REQUEST_DELAY_MS);
  }

  // Retry pass: trailing-slash convention (confirmed on LSE, e.g. BP -> "BP/").
  if (needsRetry.length) {
    console.log(`\nRetrying ${needsRetry.length} unmatched with a trailing "/" (LSE-style base-ticker convention)...`);
    const retryBatches = chunk(needsRetry, JOBS_PER_REQUEST);
    let retryDone = 0;
    for (const batch of retryBatches) {
      const results = await mapBatch(batch.map(b => retryJobWithSlash(b.job)));
      batch.forEach((b, i) => {
        const matches = matchesOf(results[i]);
        if (matches.length === 0) { unmatched.push(b.symbol); return; }
        record(b, matches);
        recoveredBySlash.push(b.symbol);
      });
      retryDone++;
      if (retryDone < retryBatches.length) await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(`\nMapped ${Object.keys(out).length}/${symbols.length} (${(Object.keys(out).length / symbols.length * 100).toFixed(1)}%)`);
  console.log(`  recovered via trailing-slash retry: ${recoveredBySlash.length}`);
  console.log(`Unmatched: ${unmatched.length}`);
  if (unmatched.length) console.log(`  sample: ${unmatched.slice(0, 15).join(', ')}`);
  console.log(`Ambiguous (>1 FIGI candidate, took first): ${ambiguous.length}`);
  if (ambiguous.length) console.log(`  sample: ${ambiguous.slice(0, 10).map(a => `${a.symbol}(${a.count})`).join(', ')}`);

  const outPath = join(__dirname, 'symbol_figi_map.json');
  writeFileSync(outPath, JSON.stringify({
    _note: 'symbol -> FIGI + identifying metadata via OpenFIGI v3 (openfigi.com). Cross-market join key for short-interest/registers/ClinicalTrials/etc. Rebuild via buildOpenFigiMap.ts.',
    _built: new Date().toISOString().slice(0, 10),
    _universe_source: 'symbol_spread_bps.json',
    _unmatched: unmatched,
    figi: out,
  }, null, 2));
  console.log(`\nWrote ${Object.keys(out).length} entries -> ${outPath}`);

  console.log('\nSanity check (known symbols):');
  for (const s of ['AAPL', 'BP.L', 'BRK.B', '7203.T', '0700.HK', 'VOD.L']) {
    const e = out[s];
    console.log(`   ${s.padEnd(10)} ${e ? `FIGI=${e.figi}  name="${e.name}"  conf=${e.confidence}${e.ambiguous ? ` AMBIGUOUS(${e.ambiguous})` : ''}` : 'NOT MAPPED'}`);
  }
}

main().catch(e => { console.error('[OpenFIGI] FATAL:', e); process.exit(1); });
