/**
 * trackSymbolLiveness.ts — forward delisting / halt capture.
 *
 * WHY THIS EXISTS. Two findings from the 2026-07-29/30 audits:
 *   1. The survivorship diagnostic showed 1,118 of 1,119 training symbols
 *      (99.9%) still have live prices — i.e. the universe was drawn from a
 *      current listing snapshot and backfilled, so delisted companies were
 *      structurally incapable of entering the dataset.
 *   2. The delisting audit showed outcomeTracker.ts SILENTLY DROPS rows whose
 *      price can't be resolved (`if (actualPrice == null) { continue; }`), so a
 *      symbol that delists mid-window vanishes leaving no trace — and looks
 *      identical to a transient Yahoo failure.
 * Together those mean future survivorship bias would accrue INVISIBLY. Buying
 * historical delisted-name data (Norgate/QuantRocket) is deferred indefinitely
 * with the FMP decision, so this is the free half of the mitigation: start
 * recording deaths as they happen, so the FORWARD dataset is survivorship-aware
 * even though the historical one can't be.
 *
 * METHOD — peer-relative staleness, no holiday calendars needed. Absolute date
 * thresholds are wrong across a 40-market universe (a Tokyo bar is legitimately
 * ~1 day "older" than a New York bar at any given moment, and every market has
 * its own holidays). Instead, for each exchange suffix this computes the MAX
 * last-bar-date across all symbols in that market — the market's own most recent
 * trading day — and measures each symbol's lag against its OWN market. That
 * self-calibrates: it can't be fooled by time zones, holidays, or a market-wide
 * outage (which shifts every peer equally).
 *
 * STATE IS CUMULATIVE. symbol_liveness.json is updated in place, not replaced:
 * `staleSince` records the FIRST run at which a symbol was seen stale, so the
 * file accumulates a real death-date history over time rather than only ever
 * showing "now". Newly-detected transitions are printed each run.
 *
 * HONEST LIMITATION: this detects "the price series stopped", which conflates
 * delisting, acquisition, long trading halts, and Yahoo simply dropping
 * coverage. It does NOT tell you WHICH — for that you'd want exchange delisting
 * notices or SEC Form 25 (US-only, and a much bigger build). The distinction
 * matters for interpretation (an acquisition is usually a GOOD outcome, a
 * bankruptcy a terrible one), so `status` is deliberately named for the
 * observation ('stale'/'dead'), not the inferred cause.
 *
 * Usage:
 *   npx tsx src/scripts/trackSymbolLiveness.ts --limit 40   # quick check
 *   npx tsx src/scripts/trackSymbolLiveness.ts              # full universe
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, 'symbol_liveness.json');
const REQUEST_DELAY_MS = 75;
const STALE_LAG_DAYS = 5;   // behind own-market latest => flag as stale
const DEAD_LAG_DAYS = 20;   // behind own-market latest => almost certainly gone

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
function suffixOf(symbol: string): string {
  const dot = symbol.lastIndexOf('.');
  return dot === -1 ? 'US' : symbol.slice(dot).toUpperCase();
}
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/** Last date with a real close, using a short range (small payload). */
async function lastBarDate(symbol: string): Promise<string | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normaliseForYahoo(symbol))}?interval=1d&range=3mo`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    const ts: number[] = result?.timestamp ?? [];
    const closes: number[] = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = ts.length - 1; i >= 0; i--) {
      if (closes[i] != null) return new Date(ts[i] * 1000).toISOString().slice(0, 10);
    }
    return null;
  } catch { return null; }
}

type Status = 'live' | 'stale' | 'dead' | 'no_data';
interface LivenessRecord {
  lastBarDate: string | null;
  lastChecked: string;
  marketLatest: string | null;   // own-market most recent bar, for context
  lagDays: number | null;        // days behind own market
  status: Status;
  staleSince: string | null;     // FIRST run at which it stopped being 'live'
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  const today = new Date().toISOString().slice(0, 10);

  const universe: string[] = Object.keys(JSON.parse(readFileSync(join(__dirname, 'symbol_spread_bps.json'), 'utf8')).spreadBps);
  const symbols = limit === Infinity ? universe : universe.slice(0, limit);
  console.log(`Checking liveness for ${symbols.length} symbol(s)${limit !== Infinity ? ` (limited from ${universe.length})` : ''}...`);

  const prev: Record<string, LivenessRecord> = existsSync(STATE_PATH)
    ? (JSON.parse(readFileSync(STATE_PATH, 'utf8')).liveness ?? {}) : {};
  if (Object.keys(prev).length) console.log(`  loaded previous state for ${Object.keys(prev).length} symbol(s)`);

  // Pass 1: fetch last bar date for each symbol.
  const lastBars = new Map<string, string | null>();
  let done = 0;
  for (const s of symbols) {
    lastBars.set(s, await lastBarDate(s));
    if (++done % 100 === 0) console.log(`  ${done}/${symbols.length}`);
    await sleep(REQUEST_DELAY_MS);
  }

  // Pass 2: per-market latest bar (the self-calibrating baseline).
  const marketLatest = new Map<string, string>();
  for (const s of symbols) {
    const d = lastBars.get(s);
    if (!d) continue;
    const suf = suffixOf(s);
    if (!marketLatest.has(suf) || d > marketLatest.get(suf)!) marketLatest.set(suf, d);
  }

  // Pass 3: classify, carrying staleSince forward.
  const out: Record<string, LivenessRecord> = {};
  const transitions: Array<{ symbol: string; from: Status; to: Status; lagDays: number | null }> = [];
  const counts: Record<Status, number> = { live: 0, stale: 0, dead: 0, no_data: 0 };

  for (const s of symbols) {
    const d = lastBars.get(s) ?? null;
    const mkt = marketLatest.get(suffixOf(s)) ?? null;
    const lag = d && mkt ? daysBetween(d, mkt) : null;
    let status: Status;
    if (!d) status = 'no_data';
    else if (lag !== null && lag >= DEAD_LAG_DAYS) status = 'dead';
    else if (lag !== null && lag >= STALE_LAG_DAYS) status = 'stale';
    else status = 'live';
    counts[status]++;

    const before = prev[s];
    // keep the ORIGINAL staleSince if it was already non-live; clear when it recovers
    const staleSince = status === 'live' ? null : (before?.staleSince ?? today);
    if (before && before.status !== status) transitions.push({ symbol: s, from: before.status, to: status, lagDays: lag });

    out[s] = { lastBarDate: d, lastChecked: today, marketLatest: mkt, lagDays: lag, status, staleSince };
  }

  console.log(`\nStatus: live ${counts.live} · stale ${counts.stale} · dead ${counts.dead} · no_data ${counts.no_data}`);

  const notLive = Object.entries(out).filter(([, r]) => r.status !== 'live')
    .sort((a, b) => (b[1].lagDays ?? 0) - (a[1].lagDays ?? 0));
  if (notLive.length) {
    console.log(`\nNon-live symbols (lag behind own market):`);
    for (const [sym, r] of notLive.slice(0, 40)) {
      console.log(`   ${sym.padEnd(12)} ${r.status.padEnd(8)} last=${r.lastBarDate ?? 'none'}  market=${r.marketLatest ?? '?'}  lag=${r.lagDays ?? '?'}d  since=${r.staleSince}`);
    }
    if (notLive.length > 40) console.log(`   ... and ${notLive.length - 40} more`);
  }

  if (transitions.length) {
    console.log(`\n⚠  ${transitions.length} STATUS TRANSITION(S) since the last run:`);
    for (const t of transitions) console.log(`   ${t.symbol.padEnd(12)} ${t.from} -> ${t.to}  (lag ${t.lagDays ?? '?'}d)`);
  } else if (Object.keys(prev).length) {
    console.log('\nNo status transitions since the last run.');
  }

  writeFileSync(STATE_PATH, JSON.stringify({
    _note: 'Per-symbol price-series liveness, for FORWARD survivorship tracking. Staleness is measured against each symbol\'s OWN market latest bar (self-calibrating across 40 markets; immune to time zones/holidays). staleSince = first run at which the symbol stopped being live, so this file accumulates a death-date history. Detects "series stopped" — does NOT distinguish delisting vs acquisition vs halt vs Yahoo coverage loss. Rebuild via trackSymbolLiveness.ts.',
    _built: today,
    _thresholds: { staleLagDays: STALE_LAG_DAYS, deadLagDays: DEAD_LAG_DAYS },
    _counts: counts,
    liveness: out,
  }, null, 2));
  console.log(`\nWrote ${Object.keys(out).length} record(s) -> ${STATE_PATH}`);
}

main().catch(e => { console.error('[SymbolLiveness] FATAL:', e); process.exit(1); });
