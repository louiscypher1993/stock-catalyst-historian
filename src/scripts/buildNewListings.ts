/**
 * NEW-LISTINGS WATCHER (weekly, pit-snapshot.yml).
 *
 * Diffs the SEC's registered-security ticker feed against everything we already scan
 * and auto-admits genuinely new NYSE/Nasdaq listings that pass liquidity gates. The
 * point is capture timing: a listing admitted the week it appears starts accruing
 * Yahoo bar history in-universe, so by the time it has the ~120 bars detectAnomaly
 * needs, it is already being scanned. New admissions carry no enrichment, so every
 * row they produce is unreliable_reason='null_enrichment' -> quarantined from pots,
 * notifications, rankings and the checkpoint exactly like the 2026-08-10 expansion
 * cohort, and covered by the same expansionReadout.ts validation.
 *
 * Feed: https://www.sec.gov/files/company_tickers_exchange.json
 *   {"fields":["cik","name","ticker","exchange"],"data":[[...],...]}
 *   Needs a User-Agent with contact info (SEC fair-access policy) -- SEC_CONTACT env,
 *   same convention as buildDelistings.ts. The SEC PRUNES delisted names from this
 *   feed, which is why the state file records everything ever seen: a ticker that
 *   disappears and returns is not "new".
 *
 * State: src/scripts/new_listings_state.json (committed -- git history is the record).
 *   First run = baseline init: every current ticker recorded as seen, nothing added.
 *   Later runs: candidates = in feed, never seen, not in universe, NYSE/Nasdaq only
 *   (excludes Arca/BATS = most ETFs). Gates: >=5 Yahoo bars over 3mo, last close >=$3,
 *   median dollar volume >=$2M. Failures are recorded and re-tried after 28 days
 *   (IPOs often start illiquid). More than 50 candidates in one run = feed anomaly,
 *   abort without writing.
 *
 * Output: src/autoListings.json, merged into GLOBAL_MARKETS at load by marketsData.ts.
 * CI edits JSON only -- never a .ts file.
 *
 * Usage: SEC_CONTACT=... npx tsx src/scripts/buildNewListings.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { GLOBAL_MARKETS } from '../marketsData';
import { fetchYahooDailyHistory } from '../LiveInferenceService';

const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, 'src', 'scripts', 'new_listings_state.json');
const AUTO_PATH = path.join(ROOT, 'src', 'autoListings.json');
const FEED_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const EXCHANGES = new Set(['NYSE', 'NASDAQ']);
const MIN_BARS = 5;
const MIN_PRICE = 3;
const MIN_MEDIAN_DOLLAR_VOL = 2_000_000;
const RETRY_REJECT_DAYS = 28;
const MAX_CANDIDATES = 50;

interface State {
  baseline: string;
  seen: Record<string, string>;                                   // ticker -> first seen
  rejected: Record<string, { date: string; reason: string }>;     // retried after 28d
  added: Record<string, string>;                                  // ticker -> added date
}

async function main() {
  const contact = process.env.SEC_CONTACT;
  if (!contact) throw new Error('SEC_CONTACT not set (SEC fair-access policy requires a contact UA)');
  const today = new Date().toISOString().slice(0, 10);

  const res = await fetch(FEED_URL, { headers: { 'User-Agent': contact } });
  if (!res.ok) throw new Error(`SEC feed HTTP ${res.status}`);
  const feed = await res.json() as { fields: string[]; data: Array<Array<string | number>> };
  const fi = Object.fromEntries(feed.fields.map((f, i) => [f, i]));
  const listings = feed.data
    .map(row => ({
      ticker: String(row[fi.ticker] ?? '').toUpperCase().trim(),
      name: String(row[fi.name] ?? '').trim(),
      exchange: String(row[fi.exchange] ?? '').trim(),
    }))
    .filter(l => l.ticker);
  console.log(`SEC feed: ${listings.length} registered tickers`);
  if (listings.length < 5000) throw new Error(`feed suspiciously small (${listings.length}) -- aborting, state untouched`);

  const universe = new Set<string>();
  for (const m of GLOBAL_MARKETS) for (const s of m.stocks) universe.add(s.symbol.toUpperCase());

  let state: State;
  if (fs.existsSync(STATE_PATH)) {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } else {
    // BASELINE INIT: record the present so only the future counts as new.
    state = { baseline: today, seen: {}, rejected: {}, added: {} };
    for (const l of listings) state.seen[l.ticker] = today;
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    console.log(`baseline initialized: ${listings.length} tickers recorded as seen; nothing added.`);
    return;
  }

  const retryBefore = new Date(Date.now() - RETRY_REJECT_DAYS * 86400000).toISOString().slice(0, 10);
  const candidates = listings.filter(l =>
    EXCHANGES.has(l.exchange.toUpperCase()) &&
    !(l.ticker in state.seen || l.ticker in state.added) &&
    !universe.has(l.ticker) &&
    (!(l.ticker in state.rejected) || state.rejected[l.ticker].date < retryBefore));
  // Everything in the feed is now seen regardless of qualification -- EXCEPT liquidity
  // rejects, which stay out of `seen` so the 28-day retry can find them again.
  console.log(`new candidates: ${candidates.length}`);
  if (candidates.length > MAX_CANDIDATES) {
    throw new Error(`${candidates.length} candidates (> ${MAX_CANDIDATES}) -- feed anomaly, aborting without writes`);
  }

  const admitted: Array<{ symbol: string; companyName: string }> = [];
  for (const c of candidates) {
    try {
      const bars = await fetchYahooDailyHistory(c.ticker, '3mo');
      const closes = (bars ?? []).filter(b => b.close > 0);
      const last = closes[closes.length - 1];
      const dollarVols = closes.map(b => b.close * b.volume).sort((a, b) => a - b);
      const medianDv = dollarVols.length ? dollarVols[Math.floor(dollarVols.length / 2)] : 0;
      if (closes.length >= MIN_BARS && last.close >= MIN_PRICE && medianDv >= MIN_MEDIAN_DOLLAR_VOL) {
        admitted.push({ symbol: c.ticker, companyName: c.name });
        state.added[c.ticker] = today;
        delete state.rejected[c.ticker];
        console.log(`  ADMIT  ${c.ticker} (${c.name}) close $${last.close.toFixed(2)} medDV $${(medianDv / 1e6).toFixed(1)}M`);
      } else {
        state.rejected[c.ticker] = { date: today, reason: `bars=${closes.length} close=${last?.close?.toFixed(2) ?? 'n/a'} medDV=${(medianDv / 1e6).toFixed(1)}M` };
        console.log(`  reject ${c.ticker}: ${state.rejected[c.ticker].reason}`);
      }
    } catch (e: any) {
      state.rejected[c.ticker] = { date: today, reason: e.message?.slice(0, 60) ?? 'fetch error' };
      console.log(`  reject ${c.ticker}: ${state.rejected[c.ticker].reason}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  for (const l of listings) {
    if (!(l.ticker in state.seen) && !(l.ticker in state.rejected) && !(l.ticker in state.added)) {
      state.seen[l.ticker] = today;
    }
  }

  if (admitted.length) {
    let auto: { name: string; stocks: Array<{ symbol: string; companyName: string }> } =
      { name: 'Auto-detected new listings', stocks: [] };
    if (fs.existsSync(AUTO_PATH)) auto = JSON.parse(fs.readFileSync(AUTO_PATH, 'utf8'));
    const have = new Set(auto.stocks.map(s => s.symbol));
    for (const a of admitted) if (!have.has(a.symbol)) auto.stocks.push(a);
    fs.writeFileSync(AUTO_PATH, JSON.stringify(auto, null, 2));
    console.log(`admitted ${admitted.length} -> ${AUTO_PATH} (total auto listings: ${auto.stocks.length})`);
  } else {
    console.log('nothing admitted this run');
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
