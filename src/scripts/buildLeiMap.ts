/**
 * buildLeiMap.ts — authoritative entity identity via GLEIF (ISIN -> LEI -> registry).
 *
 * WHY. Companies House is keyed on company NUMBER; we only have tickers. Its only
 * bridge is fuzzy full-text name search, which returns confident wrong answers with
 * no error: probing 2026-07-31, "BP" resolved to ASHTEAD TECHNOLOGY MIDCO LIMITED
 * and "GLENCORE" to a dissolved subsidiary (Glencore plc is Jersey-registered, so it
 * is genuinely absent from Companies House). On 117 UK symbols that is ~25-30 silent
 * mismatches — worse than having no UK feed, because the errors are invisible.
 *
 * GLEIF fixes it exactly rather than approximately. An LEI record carries:
 *   - `entity.registeredAs`   the business-registry number (SSE -> SC117119)
 *   - `entity.registeredAt.id` WHICH registry (RA000585 Companies House E&W,
 *                              RA000587 Companies House Scotland, ...)
 *   - `entity.jurisdiction`   so a non-GB registration is identified, not guessed at
 * Verified live: Coca-Cola HBC resolves to a Swiss register id and Entain to an Isle
 * of Man one — precisely the cases name search silently got wrong.
 *
 * WORTH BUILDING EVEN IF COMPANIES HOUSE IS NEVER USED. LEI is the universal entity
 * key. The FCA, AMF and any future ESMA/EU register are ISIN- or LEI-keyed, so this
 * is a far more robust join than FIGI for anything entity-level, and the record also
 * hands back BIC/MIC/OCID/S&P cross-reference ids for free.
 *
 * INPUT IS ISIN-GATED, DELIBERATELY. We only resolve symbols for which some artifact
 * already carries an authoritative ISIN (the FCA and AMF short-position builds).
 * GLEIF also supports name search — deliberately NOT used, because that would
 * reintroduce exactly the fuzzy-matching failure this script exists to remove.
 *
 * Usage:
 *   npx tsx src/scripts/buildLeiMap.ts
 *   npx tsx src/scripts/buildLeiMap.ts --limit 10
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, 'symbol_lei_map.json');
const API = 'https://api.gleif.org/api/v1/lei-records';
const REQUEST_DELAY_MS = 400;   // GLEIF is free and unauthenticated — be courteous

// Registration authorities that ARE Companies House (so a downstream UK build knows
// the number is usable rather than having to guess from its prefix).
const COMPANIES_HOUSE_RA = new Set(['RA000585', 'RA000586', 'RA000587']); // E&W, NI, Scotland

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Pull symbol -> ISIN from every artifact that carries an authoritative one. */
function gatherIsins(): Map<string, { isin: string; source: string; name?: string }> {
  const out = new Map<string, { isin: string; source: string; name?: string }>();
  const sources: Array<[string, string]> = [
    ['symbol_fca_short_positions.json', 'fcaShortPositions'],
    ['symbol_amf_short_positions.json', 'amfShortPositions'],
  ];
  for (const [file, key] of sources) {
    const path = join(__dirname, file);
    if (!existsSync(path)) continue;
    const body = JSON.parse(readFileSync(path, 'utf8'))[key] ?? {};
    for (const [symbol, v] of Object.entries<any>(body)) {
      if (!v?.isin || out.has(symbol)) continue;
      out.set(symbol, { isin: String(v.isin), source: file.replace('symbol_', '').replace('.json', ''), name: v.companyName });
    }
  }
  return out;
}

interface LeiRecord {
  lei: string; legalName: string | null; jurisdiction: string | null;
  registeredAs: string | null; registrationAuthority: string | null;
  isCompaniesHouse: boolean; entityStatus: string | null; registrationStatus: string | null;
  bic: string[] | null; isin: string; isinSource: string;
}

async function lookup(isin: string, attempt = 1): Promise<any | null> {
  try {
    const res = await fetch(`${API}?filter[isin]=${encodeURIComponent(isin)}&page[size]=1`, {
      headers: { 'User-Agent': 'stock-catalyst-historian', Accept: 'application/vnd.api+json' },
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) return null;
    const j: any = await res.json();
    return j.data?.[0] ?? null;
  } catch (e) {
    if (attempt >= 3) { console.warn(`  ${isin} failed after ${attempt}: ${e}`); return null; }
    await sleep(1500 * attempt);
    return lookup(isin, attempt + 1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

  const isins = gatherIsins();
  const entries = [...isins.entries()];
  const todo = limit === Infinity ? entries : entries.slice(0, limit);
  console.log(`Symbols with an authoritative ISIN: ${entries.length}  (resolving ${todo.length})`);

  const map: Record<string, LeiRecord> = {};
  const jurisdictions: Record<string, number> = {};
  const authorities: Record<string, number> = {};
  let resolved = 0, missing = 0, chEligible = 0;

  for (const [symbol, meta] of todo) {
    const d = await lookup(meta.isin);
    await sleep(REQUEST_DELAY_MS);
    if (!d) { missing++; console.log(`   ${symbol.padEnd(10)} ${meta.isin}  no LEI record`); continue; }

    const a = d.attributes ?? {};
    const e = a.entity ?? {};
    const ra: string | null = e.registeredAt?.id ?? null;
    const isCH = !!ra && COMPANIES_HOUSE_RA.has(ra);
    if (isCH) chEligible++;

    map[symbol] = {
      lei: a.lei, legalName: e.legalName?.name ?? null,
      jurisdiction: e.jurisdiction ?? null,
      registeredAs: e.registeredAs ?? null, registrationAuthority: ra,
      isCompaniesHouse: isCH,
      entityStatus: e.status ?? null, registrationStatus: a.registration?.status ?? null,
      bic: a.bic ?? null, isin: meta.isin, isinSource: meta.source,
    };
    resolved++;
    jurisdictions[e.jurisdiction ?? 'UNKNOWN'] = (jurisdictions[e.jurisdiction ?? 'UNKNOWN'] ?? 0) + 1;
    authorities[ra ?? 'NONE'] = (authorities[ra ?? 'NONE'] ?? 0) + 1;
    if (resolved % 20 === 0) console.log(`   ${resolved}/${todo.length} resolved`);
  }

  writeFileSync(OUT_PATH, JSON.stringify({
    _note: 'Authoritative entity identity from GLEIF, keyed by ISIN (never by name — name search returns confident wrong answers, e.g. "BP" -> ASHTEAD TECHNOLOGY MIDCO). `registeredAs` is the business-registry number and `registrationAuthority` says WHICH registry issued it; `isCompaniesHouse` is true only for RA000585/586/587, so a UK build can tell a usable Companies House number from a Jersey/Swiss/IoM one rather than mis-matching. Only symbols carrying an authoritative ISIN from another artifact are present — coverage is the ISIN set, not the universe. Rebuild via buildLeiMap.ts.',
    _built: new Date().toISOString().slice(0, 10),
    _source: API,
    _counts: { candidates: entries.length, attempted: todo.length, resolved, missing, companiesHouseEligible: chEligible },
    _jurisdictions: jurisdictions,
    _registrationAuthorities: authorities,
    lei: map,
  }, null, 2));

  console.log(`\nResolved ${resolved}/${todo.length}  (no record: ${missing})`);
  console.log(`Companies House-eligible: ${chEligible}/${resolved}  — the rest are registered elsewhere and are NOT in Companies House`);
  console.log('Jurisdictions:', Object.entries(jurisdictions).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log('Authorities:  ', Object.entries(authorities).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch(e => { console.error('[GLEIF] FATAL:', e); process.exit(1); });
