/**
 * SEC Form 4 insider-transaction capture (weekly, pit-snapshot.yml).
 *
 * Why: `insider_net_shares_30d` is a live model feature currently served STALE-frozen
 * from the last FMP-premium snapshot (2026-06-13, premium expired 07-06). This builds
 * the free replacement from the primary source so the next retrain has a live-
 * refreshable, provider-independent version. NOT wired as a feature yet (TODO.md).
 *
 * Mechanics:
 *   - EDGAR daily form index (form.YYYYMMDD.idx) filtered to types 4 / 4/A, prefiltered
 *     to CIKs in cik_ticker_map.json that map into GLOBAL_MARKETS.
 *   - The index lists a filing under EVERY filer CIK (issuer + reporting persons), so
 *     the issuer is CONFIRMED from the XML's <issuerCik>, not trusted from the index.
 *   - Each new accession's .txt is fetched (SEC fair-access: UA + 120ms spacing) and its
 *     nonDerivativeTransaction blocks parsed: date, transactionCode, A/D, shares.
 *   - Ledger keeps 45 days of transactions (30d feature window + slack). EDGAR is
 *     permanent, so anything older is re-derivable at backfill time — the artifact
 *     stays compact instead of accumulating history.
 *   - Aggregates per symbol: net_shares_30d (all codes, A minus D) and
 *     open_market_net_30d (P purchases minus S sales — the classic insider signal,
 *     excluding option-exercise noise).
 *
 * Usage: SEC_CONTACT=... npx tsx src/scripts/buildInsiderForm4.ts [--days 10]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { GLOBAL_MARKETS } from '../marketsData';

const OUT = path.join(process.cwd(), 'src', 'scripts', 'symbol_insider_form4.json');
const CIK_MAP = path.join(process.cwd(), 'src', 'scripts', 'cik_ticker_map.json');
const daysIdx = process.argv.indexOf('--days');
const LOOKBACK_CAL_DAYS = daysIdx > -1 ? Number(process.argv[daysIdx + 1]) : 10;
const LEDGER_DAYS = 45;
const MAX_NEW_FILINGS = 3000;
const DELAY_MS = 120;

// [accession, symbol, txnDate, code, adFlag, shares]
type Txn = [string, string, string, string, string, number];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchText(url: string, ua: string): Promise<string | null> {
  const res = await fetch(url, { headers: { 'User-Agent': ua } });
  // SEC serves not-yet-published daily-index files as 403, not 404 (seen live on the
  // current day's form.idx before publication) -- treat both as "absent".
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function qtr(d: Date): string {
  return `QTR${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

async function main() {
  const ua = process.env.SEC_CONTACT;
  if (!ua) throw new Error('SEC_CONTACT not set');
  const today = new Date().toISOString().slice(0, 10);

  const universe = new Set<string>();
  for (const m of GLOBAL_MARKETS) for (const s of m.stocks) universe.add(s.symbol.toUpperCase());
  const cikMap: Record<string, string> = JSON.parse(fs.readFileSync(CIK_MAP, 'utf8'));
  const cikToSymbol = new Map<string, string>();
  for (const [cik, ticker] of Object.entries(cikMap)) {
    const t = String(ticker).toUpperCase();
    if (universe.has(t)) cikToSymbol.set(String(Number(cik)), t);
  }
  console.log(`universe CIKs: ${cikToSymbol.size}`);

  let ledger: Txn[] = [];
  if (fs.existsSync(OUT)) {
    try { ledger = JSON.parse(fs.readFileSync(OUT, 'utf8')).transactions ?? []; } catch { ledger = []; }
  }
  const seen = new Set(ledger.map(t => t[0]));

  // Collect candidate filings from the daily form indexes.
  const candidates = new Map<string, { cik: string; file: string }>();
  for (let back = 0; back < LOOKBACK_CAL_DAYS; back++) {
    const d = new Date(Date.now() - back * 86400000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    // One day's index failing (SEC WAF gives 403 OR 503 for the current day's
    // not-yet-published file) must not kill the whole capture -- skip and continue.
    let idx: string | null = null;
    try {
      idx = await fetchText(
        `https://www.sec.gov/Archives/edgar/daily-index/${d.getUTCFullYear()}/${qtr(d)}/form.${ymd}.idx`, ua);
    } catch (e: any) {
      console.warn(`${ymd}: index fetch failed (${e.message}) -- skipping day`);
      continue;
    }
    if (idx === null) { console.log(`${ymd}: no index (holiday or not yet published)`); continue; }
    let day = 0;
    for (const raw of idx.split('\n')) {
      const m = raw.trimEnd().match(/^(4|4\/A)\s+(.+?)\s+(\d+)\s+(\d{8})\s+(edgar\/\S+)$/);
      if (!m) continue;
      const cik = String(Number(m[3]));
      if (!cikToSymbol.has(cik)) continue;
      const accession = m[5].split('/').pop()!.replace('.txt', '');
      if (seen.has(accession) || candidates.has(accession)) continue;
      candidates.set(accession, { cik, file: m[5] });
      day++;
    }
    console.log(`${ymd}: ${day} new universe Form 4 filings`);
    await sleep(DELAY_MS);
  }
  console.log(`new filings to fetch: ${candidates.size}`);
  if (candidates.size > MAX_NEW_FILINGS) {
    throw new Error(`${candidates.size} new filings (> ${MAX_NEW_FILINGS}) -- anomaly, aborting`);
  }

  let fetched = 0, txnCount = 0;
  for (const [accession, c] of candidates) {
    try {
      const doc = await fetchText(`https://www.sec.gov/Archives/${c.file}`, ua);
      if (doc === null) continue;
      fetched++;
      // Confirm the ISSUER from the document -- the index row's CIK may be a
      // reporting person whose CIK collides with something in the map.
      const issuer = doc.match(/<issuerCik>0*(\d+)<\/issuerCik>/);
      const symbol = issuer ? cikToSymbol.get(String(Number(issuer[1]))) : undefined;
      if (!symbol) continue;
      for (const block of doc.matchAll(/<nonDerivativeTransaction>(.*?)<\/nonDerivativeTransaction>/gs)) {
        const t = block[1];
        const date = t.match(/<transactionDate>\s*<value>([\d-]+)<\/value>/)?.[1];
        const code = t.match(/<transactionCode>([A-Z])<\/transactionCode>/)?.[1];
        const ad = t.match(/<transactionAcquiredDisposedCode>\s*<value>([AD])<\/value>/)?.[1];
        const shares = Number(t.match(/<transactionShares>\s*<value>([\d.]+)<\/value>/)?.[1]);
        if (!date || !code || !ad || !Number.isFinite(shares)) continue;
        ledger.push([accession, symbol, date, code, ad, shares]);
        txnCount++;
      }
    } catch (e: any) {
      console.warn(`${accession}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`fetched ${fetched} filings, ${txnCount} new transactions`);

  const cutoff = new Date(Date.now() - LEDGER_DAYS * 86400000).toISOString().slice(0, 10);
  ledger = ledger.filter(t => t[2] >= cutoff);

  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const agg: Record<string, { net_shares_30d: number; open_market_net_30d: number; buys_30d: number; sells_30d: number }> = {};
  for (const [, symbol, date, code, ad, shares] of ledger) {
    if (date < cutoff30) continue;
    if (!agg[symbol]) agg[symbol] = { net_shares_30d: 0, open_market_net_30d: 0, buys_30d: 0, sells_30d: 0 };
    const signed = ad === 'A' ? shares : -shares;
    agg[symbol].net_shares_30d += signed;
    if (code === 'P') { agg[symbol].open_market_net_30d += shares; agg[symbol].buys_30d++; }
    if (code === 'S') { agg[symbol].open_market_net_30d -= shares; agg[symbol].sells_30d++; }
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generated: today,
    ledger_days: LEDGER_DAYS,
    note: 'SEC Form 4 non-derivative transactions, universe issuers only. EDGAR is ' +
      'permanent so older history is backfillable; ledger keeps 45d. Aggregates: ' +
      'net_shares_30d = A-D all codes; open_market_net_30d = P minus S only. Not a feature yet.',
    aggregates: agg,
    transactions: ledger,
  }, null, 1));
  console.log(`wrote ${OUT}: ${ledger.length} txns in ledger, ${Object.keys(agg).length} symbols aggregated`);
}

main().catch(e => { console.error(e); process.exit(1); });
