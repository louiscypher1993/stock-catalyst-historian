/**
 * buildDelistings.ts — capture SEC Form 25 delisting notices, forward.
 *
 * WHY. Survivorship bias is the report's "dominant unnamed gap", and it is worse for an
 * anomaly-event system than a generic backtest: the very thing that puts a name in the
 * scan — an anomalous price/volume move — correlates with later delisting (distressed
 * spikes, buyout pops, fraud collapses). The measured gradient on the CURRENT universe
 * came out at only ~10-25bps, but that estimate is structurally blind to fully-dead
 * names: they are not in the universe to be measured. This is what fixes that, slowly.
 *
 * INVERTED URGENCY. Like the point-in-time snapshots, the value comes from WHEN CAPTURE
 * STARTS, not when the data is used. There is no free retroactive delisting history
 * (that is what Norgate/QuantRocket sell), so every week without this is a week that can
 * never be reconstructed. Hence building it now, while nothing consumes it yet.
 *
 * SOURCE. EDGAR full-index `master.idx` per quarter, filtered to:
 *   Form 25      issuer-filed notification of removal from listing
 *   Form 25-NSE  exchange-filed equivalent (the more common one in practice)
 * Both signal a delisting. Pipe-delimited and complete per quarter, so unlike full-text
 * search there is no pagination cap or relevance ranking to worry about.
 *
 * APPEND-ONLY. Unlike the current-state snapshots (which overwrite), these are dated
 * EVENTS, so re-running merges rather than replaces — keyed on accession number. Safe to
 * run repeatedly and safe to run late; a missed week is recovered by re-fetching that
 * quarter, which is exactly why quarter-granular index files were chosen over the daily
 * ones.
 *
 * Usage:
 *   $env:SEC_CONTACT="name email"; npx tsx src/scripts/buildDelistings.ts
 *   npx tsx src/scripts/buildDelistings.ts --from 2025Q1     # backfill from a quarter
 */
// without this SEC_CONTACT resolves only from an exported shell var, not .env — the
// exact omission that silently broke the first run of the other SEC builders
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'symbol_delistings.json');
const DB_PATH = join(__dirname, '..', '..', 'market_cache.db');
const REQUEST_DELAY_MS = 200;   // SEC asks for <=10 req/s; this is far under

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Delisting {
  accession: string;
  form: string;          // '25' | '25-NSE'
  cik: number;
  company: string;
  filed: string;         // YYYY-MM-DD
  ticker: string | null; // resolved via SEC's own ticker map where possible
  security: string | null;   // descriptionClassSecurity from the filing XML
  ruleProvision: string | null;
  // three-way ON PURPOSE. 'unclassified' must not be collapsed into 'other': form 25
  // (issuer-filed, 42 of 383) is free-text HTML with no descriptionClassSecurity, unlike
  // form 25-NSE which is XML. Defaulting those to "not a delisting" would silently drop
  // 11% of filings from a record whose whole job is completeness.
  classification: 'equity' | 'other' | 'unclassified';
  isEquity: boolean;     // convenience: classification === 'equity'
  inUniverse: boolean;   // equity delisting of a name we actually track
}

/**
 * THE TRAP THIS EXISTS FOR. Form 25/25-NSE removes ANY class of listed security, not
 * just common stock. The first run of this script recorded "delistings" for Visa, Eli
 * Lilly, HSBC, Philip Morris and Procter & Gamble — none of which delisted. P&G's filing
 * was for "3.250% Notes due 2026", a matured BOND. Since master.idx carries only the
 * issuer CIK, mapping CIK -> primary ticker turns every retired bond, expired warrant
 * and redeemed preferred into a phantom equity delisting.
 *
 * A survivorship record full of phantom delistings is worse than no record: it would
 * bias the correction it exists to enable. So each filing is opened and classified on
 * its own `descriptionClassSecurity`.
 */
function classifyEquity(desc: string | null): boolean {
  if (!desc) return false;
  const d = desc.toLowerCase();
  // instruments that are NOT the common equity line — checked first, since some
  // descriptions mention both (e.g. "warrants to purchase common stock")
  if (/note|bond|debenture|due \d{4}|%|warrant|right|unit|preferred|depositary|subordinat|trust preferred|capital securit/.test(d)) {
    return false;
  }
  return /common stock|ordinary share|common share|class [a-z] common|american depositary share/.test(d);
}

function ua(): string {
  const c = process.env.SEC_CONTACT;
  if (!c || !c.trim()) {
    console.error('[Delistings] SEC_CONTACT is required — SEC policy asks for a descriptive');
    console.error('             User-Agent with contact info. e.g. $env:SEC_CONTACT="jane doe jane@example.com"');
    process.exit(1);
  }
  return `stock-catalyst-historian ${c.trim()}`;
}

/** SEC returns 503 under load. A failed fetch here silently defaults a filing to
 *  "not equity", which is a false NEGATIVE in a survivorship record — so retry with
 *  backoff rather than accept it. 46 filings were lost to un-retried 503s on the first
 *  full run. */
async function getText(url: string, agent: string, attempts = 4): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': agent, 'Accept-Encoding': 'gzip, deflate' },
        signal: AbortSignal.timeout(45000),
      });
      if (res.ok) return await res.text();
      if (res.status !== 503 && res.status !== 429) {
        console.warn(`  ${url} -> HTTP ${res.status}`); return null;
      }
    } catch { /* timeout — treat like a retryable failure */ }
    if (i < attempts - 1) await sleep(800 * (i + 1));   // 0.8s, 1.6s, 2.4s
  }
  console.warn(`  ${url} -> gave up after ${attempts} attempts`);
  return null;
}

/** quarters from `from` (inclusive) to now, as [year, quarter] pairs */
function quartersSince(from: string): Array<[number, number]> {
  const m = /^(\d{4})Q([1-4])$/.exec(from);
  if (!m) { console.error(`[Delistings] --from must look like 2025Q1, got "${from}"`); process.exit(1); }
  let y = Number(m[1]), q = Number(m[2]);
  const now = new Date();
  const ny = now.getUTCFullYear(), nq = Math.floor(now.getUTCMonth() / 3) + 1;
  const out: Array<[number, number]> = [];
  while (y < ny || (y === ny && q <= nq)) {
    out.push([y, q]);
    if (++q > 4) { q = 1; y++; }
  }
  return out;
}

async function main() {
  const agent = ua();
  const fromArg = process.argv.indexOf('--from');
  // default: current quarter plus the previous one — late filings and index rebuilds
  // mean the boundary is not clean, so the overlap is deliberate (merge is idempotent)
  const now = new Date();
  const nq = Math.floor(now.getUTCMonth() / 3) + 1, ny = now.getUTCFullYear();
  const prev = nq === 1 ? `${ny - 1}Q4` : `${ny}Q${nq - 1}`;
  const from = fromArg >= 0 ? process.argv[fromArg + 1] : prev;

  // existing records — this file ACCUMULATES
  let existing: Record<string, Delisting> = {};
  let meta: Record<string, unknown> = {};
  if (existsSync(OUT)) {
    const parsed = JSON.parse(readFileSync(OUT, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith('_')) meta[k] = v; else existing[k] = v as Delisting;
    }
    console.log(`[Delistings] existing records: ${Object.keys(existing).length}`);
  }

  // our tracked universe, so a delisting can be flagged as relevant
  const universe = new Set<string>();
  try {
    const db = new Database(DB_PATH, { readonly: true });
    for (const r of db.prepare('SELECT DISTINCT symbol FROM daily_prices').all() as any[]) {
      universe.add(String(r.symbol).toUpperCase());
    }
    db.close();
  } catch { console.warn('[Delistings] no local DB — inUniverse will be false for all'); }
  console.log(`[Delistings] tracked universe: ${universe.size} symbols`);

  // CIK -> ticker. THE CATCH: company_tickers.json is CURRENT STATE — the SEC removes a
  // company from it once it delists, so the lookup fails exactly when a delisting needs
  // resolving. On the first full run only 21 of 117 equity delistings resolved to a
  // ticker for precisely this reason.
  //
  // So the map is ACCUMULATED locally: each run merges the current file into a stored
  // copy that is never pruned. A name delisting next month is still resolvable because
  // this month's snapshot retained it. Same inverted-urgency logic as the delistings
  // themselves — the map has to be captured BEFORE it is needed.
  const MAP_OUT = join(__dirname, 'cik_ticker_map.json');
  const tickerByCik = new Map<number, string>();
  if (existsSync(MAP_OUT)) {
    const prior = JSON.parse(readFileSync(MAP_OUT, 'utf8'));
    for (const [cik, t] of Object.entries(prior)) {
      if (!cik.startsWith('_')) tickerByCik.set(Number(cik), String(t));
    }
    console.log(`[Delistings] retained CIK->ticker entries: ${tickerByCik.size}`);
  }
  const tickJson = await getText('https://www.sec.gov/files/company_tickers.json', agent);
  let fresh = 0, newlyAbsent = 0;
  if (tickJson) {
    const seen = new Set<number>();
    for (const row of Object.values(JSON.parse(tickJson)) as any[]) {
      seen.add(row.cik_str); fresh++;
      if (!tickerByCik.has(row.cik_str)) tickerByCik.set(row.cik_str, String(row.ticker).toUpperCase());
    }
    // CIKs we retained that SEC no longer lists — candidates for having delisted
    for (const cik of tickerByCik.keys()) if (!seen.has(cik)) newlyAbsent++;
    const out: Record<string, unknown> = {
      _note: 'Accumulated CIK->ticker map. SEC prunes delisted companies from ' +
             'company_tickers.json, so this copy is merge-only and never pruned — that is ' +
             'what keeps a delisted name resolvable after the fact.',
      _built: new Date().toISOString(),
      _counts: { retained: tickerByCik.size, inCurrentSecFile: fresh, absentFromSecNow: newlyAbsent },
    };
    for (const [cik, t] of [...tickerByCik].sort((a, b) => a[0] - b[0])) out[cik] = t;
    writeFileSync(MAP_OUT, JSON.stringify(out, null, 2));
  }
  console.log(`[Delistings] CIK->ticker: ${tickerByCik.size} retained, ${fresh} in SEC's current file, ` +
              `${newlyAbsent} retained-but-no-longer-listed`);
  await sleep(REQUEST_DELAY_MS);

  const quarters = quartersSince(from);
  console.log(`[Delistings] scanning ${quarters.length} quarter(s) from ${from}\n`);

  let added = 0, scanned = 0;
  const pending: Array<{ acc: string; form: string; cik: number; company: string; filed: string; ticker: string | null }> = [];
  for (const [y, q] of quarters) {
    const url = `https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/master.idx`;
    const txt = await getText(url, agent);
    await sleep(REQUEST_DELAY_MS);
    if (!txt) continue;
    let qAdded = 0, qHits = 0;
    for (const line of txt.split('\n')) {
      // CIK|Company Name|Form Type|Date Filed|Filename  (header lines have no pipes/are dashes)
      const parts = line.split('|');
      if (parts.length !== 5) continue;
      const [cikStr, company, form, filed, file] = parts.map(s => s.trim());
      if (form !== '25' && form !== '25-NSE') continue;
      qHits++; scanned++;
      // accession is the filename stem, e.g. edgar/data/320193/0000320193-26-000123.txt
      const acc = (file.split('/').pop() ?? file).replace(/\.txt$/, '');
      if (existing[acc]) continue;
      const cik = Number(cikStr);
      const ticker = tickerByCik.get(cik) ?? null;
      pending.push({ acc, form, cik, company, filed, ticker });
      qAdded++;
    }
    console.log(`  ${y}Q${q}: ${qHits} Form 25/25-NSE filings, ${qAdded} new`);
  }

  // Second pass: open each new filing to read descriptionClassSecurity. master.idx does
  // not carry it, and without it every retired bond looks like an equity delisting.
  if (pending.length) {
    console.log(`\nclassifying ${pending.length} new filings (1 fetch each, ~${Math.round(pending.length * REQUEST_DELAY_MS / 1000)}s)...`);
    let done = 0;
    for (const p of pending) {
      const noDash = p.acc.replace(/-/g, '');
      const url = `https://www.sec.gov/Archives/edgar/data/${p.cik}/${noDash}/${p.acc}.txt`;
      const body = await getText(url, agent);
      await sleep(REQUEST_DELAY_MS);
      const security = body ? (/<descriptionClassSecurity>([\s\S]*?)<\/descriptionClassSecurity>/.exec(body)?.[1] ?? '').trim() || null : null;
      const rule = body ? (/<ruleProvision>([\s\S]*?)<\/ruleProvision>/.exec(body)?.[1] ?? '').trim() || null : null;
      const classification: 'equity' | 'other' | 'unclassified' =
        security === null ? 'unclassified' : (classifyEquity(security) ? 'equity' : 'other');
      const isEquity = classification === 'equity';
      // master.idx lists a 25-NSE under BOTH the exchange CIK and the issuer CIK, and
      // whichever row is seen first wins — 162 of 383 records ended up naming
      // "NEW YORK STOCK EXCHANGE LLC" as the delisted company. The filing XML states
      // them separately, so take the issuer from there and only fall back to the index.
      const issuerCik = body ? Number(/<issuer>[\s\S]*?<cik>(\d+)<\/cik>/.exec(body)?.[1] ?? 0) : 0;
      const issuerName = body
        ? (/<issuer>[\s\S]*?<entityName>([\s\S]*?)<\/entityName>/.exec(body)?.[1] ?? '').trim()
        : '';
      const cik = issuerCik || p.cik;
      const company = issuerName || p.company;
      const ticker = tickerByCik.get(cik) ?? p.ticker ?? null;
      existing[p.acc] = {
        accession: p.acc, form: p.form, cik, company, filed: p.filed,
        ticker,
        security, ruleProvision: rule, classification, isEquity,
        // only an EQUITY removal of a name we track counts as a survivorship event
        inUniverse: isEquity && !!ticker && universe.has(ticker),
      };
      added++;
      if (++done % 100 === 0) console.log(`   ${done}/${pending.length}`);
    }
  }

  const all = Object.values(existing);
  const equity = all.filter(d => d.isEquity);
  const inUni = all.filter(d => d.inUniverse);
  const unclass = all.filter(d => d.classification === 'unclassified');
  console.log(`\nof ${all.length} filings: ${equity.length} EQUITY, ` +
              `${all.length - equity.length - unclass.length} other instruments ` +
              `(notes/warrants/preferred/units), ${unclass.length} UNCLASSIFIED — ` +
              `form 25 is free-text HTML with no security field, so these are NOT ` +
              `asserted to be non-delistings`);
  meta._note = 'SEC Form 25 / 25-NSE delisting notices. APPEND-ONLY: dated events, merged on ' +
               'accession number, so re-running adds rather than replaces. Captured forward to ' +
               'build a survivorship-free record — there is no free retroactive source.';
  meta._source = 'https://www.sec.gov/Archives/edgar/full-index/<year>/QTR<n>/master.idx';
  meta._built = new Date().toISOString();
  meta._counts = { total: all.length, equityDelistings: equity.length, unclassified: unclass.length, inUniverse: inUni.length, addedThisRun: added };

  const ordered: Record<string, unknown> = { ...meta };
  for (const d of all.sort((a, b) => a.filed.localeCompare(b.filed))) ordered[d.accession] = d;
  writeFileSync(OUT, JSON.stringify(ordered, null, 2));

  console.log(`\nscanned ${scanned} Form 25/25-NSE filings; ${added} new`);
  console.log(`total recorded: ${all.length}   of which in our tracked universe: ${inUni.length}`);
  if (inUni.length) {
    console.log('\nmost recent delistings affecting names we track:');
    for (const d of inUni.slice(-8)) {
      console.log(`   ${d.filed}  ${(d.ticker ?? '?').padEnd(8)} ${d.form.padEnd(7)} ${d.company.slice(0, 44)}`);
    }
  }
  console.log(`\nwrote ${OUT}`);
}

main().catch(e => { console.error('[Delistings] FATAL:', e); process.exit(1); });
