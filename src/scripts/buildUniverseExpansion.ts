/**
 * ONE-TIME universe expansion builder (2026-08-10).
 *
 * Fetches index constituents that are NOT in GLOBAL_MARKETS yet, verifies each on
 * Yahoo, and appends them to marketsData.ts as two dedicated market buckets so the
 * whole expansion is revertible by deleting two blocks (or reverting the data commit).
 *
 * Sources (free, point-in-time-irrelevant -- this is a forward-only scan list):
 *   - Wikipedia "List of S&P 400 companies"  (US mid caps)
 *   - Wikipedia "List of S&P 600 companies"  (US small caps)
 *   - Wikipedia "FTSE 250 Index"             (UK mid caps, .L suffix)
 *
 * Design notes, tied to measured constraints:
 *   - Benchmark mapping keys off the SYMBOL SUFFIX (nativeBenchmarkTicker), and
 *     is_us_listed off "no dot in symbol" -- so US symbols are normalised to Yahoo
 *     dash form (BRK.B -> BRK-B) which keeps BOTH correct, and FTSE tickers get .L.
 *   - Every candidate is verified with a real Yahoo history fetch before inclusion;
 *     dead/renamed tickers never reach the daily CI scan.
 *   - The manifest (universe_expansion.json) records symbol/name/sector/source and is
 *     ALSO the live sector fallback for these names (getSymbolSnapshot last resort)
 *     and the cohort definition for expansionReadout.ts.
 *
 * Usage: npx tsx src/scripts/buildUniverseExpansion.ts [--dry-run]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { GLOBAL_MARKETS } from '../marketsData';
import { fetchYahooDailyHistory } from '../LiveInferenceService';

const DRY = process.argv.includes('--dry-run');
const ROOT = process.cwd();
const MARKETS_PATH = path.join(ROOT, 'src', 'marketsData.ts');
const MANIFEST_PATH = path.join(ROOT, 'src', 'universe_expansion.json');
const DELAY_MS = 150;

interface Candidate { symbol: string; companyName: string; sector: string | null; source: string }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'stock-catalyst-historian/1.0 (research tool)' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\[\d+\]/g, '').trim();
}

/** Parse the first wikitable whose header row contains all `requiredHeaders`. */
function parseWikiTable(html: string, requiredHeaders: string[]): Array<Record<string, string>> {
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/g) ?? [];
  for (const table of tables) {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    if (rows.length < 10) continue;
    const headers = (rows[0].match(/<th[\s\S]*?<\/th>/g) ?? []).map(stripTags).map(h => h.toLowerCase());
    if (!requiredHeaders.every(rh => headers.some(h => h.includes(rh)))) continue;
    const out: Array<Record<string, string>> = [];
    for (const row of rows.slice(1)) {
      const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/g) ?? []).map(stripTags);
      if (cells.length < 2) continue;
      const rec: Record<string, string> = {};
      headers.forEach((h, i) => { rec[h] = cells[i] ?? ''; });
      out.push(rec);
    }
    return out;
  }
  throw new Error(`no wikitable with headers [${requiredHeaders.join(', ')}] found`);
}

function pick(rec: Record<string, string>, names: string[]): string {
  for (const n of names) {
    for (const k of Object.keys(rec)) {
      if (k.includes(n) && rec[k]) return rec[k];
    }
  }
  return '';
}

async function main() {
  const existing = new Set<string>();
  for (const m of GLOBAL_MARKETS) for (const s of m.stocks) existing.add(s.symbol.toUpperCase());
  console.log(`existing universe: ${existing.size} symbols`);

  const candidates: Candidate[] = [];

  for (const [url, source, sanity] of [
    ['https://en.wikipedia.org/wiki/List_of_S%26P_400_companies', 'sp400', [380, 420]],
    ['https://en.wikipedia.org/wiki/List_of_S%26P_600_companies', 'sp600', [550, 650]],
  ] as const) {
    const rows = parseWikiTable(await fetchPage(url), ['symbol', 'security']);
    if (rows.length < sanity[0] || rows.length > sanity[1]) {
      throw new Error(`${source}: parsed ${rows.length} rows, outside sanity [${sanity[0]}, ${sanity[1]}] -- aborting`);
    }
    for (const r of rows) {
      const raw = pick(r, ['symbol']);
      const name = pick(r, ['security', 'company']);
      const sector = pick(r, ['gics sector', 'sector']) || null;
      if (!raw || !name) continue;
      // Some cells carry attribute debris after tag-stripping (seen on PRK/TMP: an
      // exchange-quote URL preceding the ticker) -- take the trailing ticker token.
      const m = raw.toUpperCase().match(/([A-Z]{1,6}(?:\.[A-Z]{1,2})?)\s*$/);
      if (!m) continue;
      // Yahoo dash form: keeps is_us_listed (no dot) AND Yahoo resolution correct.
      const symbol = m[1].replace(/\./g, '-');
      candidates.push({ symbol, companyName: name, sector, source });
    }
    console.log(`${source}: ${rows.length} rows parsed`);
    await sleep(500);
  }

  {
    const rows = parseWikiTable(await fetchPage('https://en.wikipedia.org/wiki/FTSE_250_Index'), ['ticker', 'company']);
    if (rows.length < 230 || rows.length > 260) {
      throw new Error(`ftse250: parsed ${rows.length} rows, outside sanity [230, 260] -- aborting`);
    }
    for (const r of rows) {
      const raw = pick(r, ['ticker', 'epic']);
      const name = pick(r, ['company']);
      const sector = pick(r, ['industry', 'sector']) || null;
      if (!raw || !name) continue;
      const symbol = raw.toUpperCase().replace(/\.+$/, '').replace(/\./g, '-') + '.L';
      candidates.push({ symbol, companyName: name, sector, source: 'ftse250' });
    }
    console.log(`ftse250: ${rows.length} rows parsed`);
  }

  // Dedup against the existing universe and within the candidate list.
  const seen = new Set<string>();
  const fresh = candidates.filter(c => {
    const u = c.symbol.toUpperCase();
    if (existing.has(u) || seen.has(u)) return false;
    // Existing US entries use plain form; a dotted original (BRK.B) may exist as such.
    if (existing.has(u.replace(/-/g, '.'))) return false;
    seen.add(u);
    return true;
  });
  console.log(`candidates after dedup: ${fresh.length} (from ${candidates.length})`);

  // Verify each on Yahoo -- a symbol that cannot produce 20 daily bars in 3 months is
  // dead, renamed, or too illiquid to scan; it never reaches marketsData.
  const verified: Candidate[] = [];
  const rejected: Array<{ symbol: string; reason: string }> = [];
  let i = 0;
  for (const c of fresh) {
    i++;
    try {
      const bars = await fetchYahooDailyHistory(c.symbol, '3mo');
      if ((bars?.length ?? 0) >= 20) verified.push(c);
      else rejected.push({ symbol: c.symbol, reason: `only ${bars?.length ?? 0} bars` });
    } catch (e: any) {
      rejected.push({ symbol: c.symbol, reason: e.message?.slice(0, 60) ?? 'fetch error' });
    }
    if (i % 100 === 0) console.log(`  verified ${i}/${fresh.length} (${verified.length} ok)`);
    await sleep(DELAY_MS);
  }
  console.log(`verified: ${verified.length} ok, ${rejected.length} rejected`);
  if (rejected.length) console.log('rejected sample:', rejected.slice(0, 15));

  const us = verified.filter(c => c.source !== 'ftse250');
  const uk = verified.filter(c => c.source === 'ftse250');
  console.log(`US additions: ${us.length}, UK additions: ${uk.length}`);

  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    note: 'Universe expansion cohort. These symbols have NO training-era enrichment: ' +
      'they are scored with null snapshots (measured acceptable for D5/C/D1/D2, B runs ' +
      'optimistic -- see scratch_expansion_ablation.py), excluded from PotService and ' +
      'the checkpoint metrics via unreliable_reason=null_enrichment, and tracked ' +
      'separately by expansionReadout.ts. Sector here is the live sector fallback.',
    symbols: verified.map(c => ({ symbol: c.symbol, companyName: c.companyName, sector: c.sector, source: c.source })),
  };

  if (DRY) {
    console.log('\nDRY RUN -- writing nothing. Would add:');
    console.log(JSON.stringify(manifest.symbols.slice(0, 20), null, 2));
    return;
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`wrote ${MANIFEST_PATH}`);

  const stanza = (name: string, stocks: Candidate[]) =>
    `  {\n    "name": "${name}",\n    "stocks": [\n` +
    stocks.map(s => `      {\n        "symbol": ${JSON.stringify(s.symbol)},\n        "companyName": ${JSON.stringify(s.companyName)}\n      }`).join(',\n') +
    '\n    ]\n  }';

  const src = fs.readFileSync(MARKETS_PATH, 'utf8');
  const closing = src.lastIndexOf('\n];');
  if (closing === -1) throw new Error('could not find GLOBAL_MARKETS closing bracket');
  const insert = ',\n' + stanza('US Expansion (S&P 400/600, added 2026-08-10)', us) +
    ',\n' + stanza('LSE Expansion (FTSE 250, added 2026-08-10)', uk);
  fs.writeFileSync(MARKETS_PATH, src.slice(0, closing) + insert + src.slice(closing));
  console.log(`updated ${MARKETS_PATH} (+${us.length + uk.length} symbols in 2 new market blocks)`);
}

main().catch(e => { console.error(e); process.exit(1); });
