/**
 * buildUkCompanyStatus.ts — UK company liveness / insolvency from Companies House.
 *
 * SCOPE IS DELIBERATELY NARROW: this feeds SURVIVORSHIP AND LIVENESS work, not the
 * ranking model. Companies House is a registry, not a disclosure service — UK
 * price-sensitive news goes through RNS (LSEG-commercial) — and its dates lag the
 * market badly: accounts may be filed up to 9 months after year-end and officer
 * changes have a 14-day notification window. A catalyst feature keyed on those
 * dates would be systematically LATE, measuring something already priced in. So no
 * filing-history or officer-change features are built here.
 *
 * What DOES survive that objection is company STATE. Knowing a company was
 * dissolved, liquidated or entered administration is valuable at a lag, because it
 * labels outcomes rather than timing entries. That directly strengthens
 * trackSymbolLiveness.ts, which today can only INFER death from a stale price series
 * and explicitly cannot tell delisting from acquisition from a long halt.
 *
 * JOIN. Reads symbol_lei_map.json and takes only entries where `isCompaniesHouse`
 * is true (registration authority RA000585/586/587). Never name search: probing
 * 2026-07-31, "BP" resolved to ASHTEAD TECHNOLOGY MIDCO LIMITED with no error.
 * Coverage is therefore 85 of 117 `.L` symbols — the other ~10% are registered in
 * Jersey / Isle of Man / Bermuda etc. and are genuinely absent from Companies
 * House. That gap is NON-RANDOM (offshore-registered names), so anything consuming
 * this must treat absence as "not UK-registered", never as "no insolvency".
 *
 * STATE IS CUMULATIVE, mirroring trackSymbolLiveness.ts: the file is updated in
 * place and `statusChangedAt` records when a status was FIRST observed to differ,
 * so the artifact accumulates a real event history instead of only showing "now".
 *
 * FIELD CAVEAT: the profile's `has_charges` boolean is unreliable — AVIVA reports
 * `has_charges: false` while /charges returns total_count 3 (it appears to track
 * outstanding rather than total). The endpoint count is used instead.
 *
 * Usage:
 *   npx tsx src/scripts/buildUkCompanyStatus.ts
 *   npx tsx src/scripts/buildUkCompanyStatus.ts --limit 5 --no-charges
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, 'symbol_uk_company_status.json');
const LEI_PATH = join(__dirname, 'symbol_lei_map.json');
const BASE = 'https://api.company-information.service.gov.uk';
const REQUEST_DELAY_MS = 350;   // limit is 600 req / 5 min; this stays well under

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function authHeader(): string {
  const key = process.env.COMPANIES_HOUSE_API_KEY;
  if (!key) {
    console.error('[CH] COMPANIES_HOUSE_API_KEY missing — create a REST key at');
    console.error('     https://developer.company-information.service.gov.uk/ and put it in .env');
    process.exit(1);
  }
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64');
}

async function ch(path: string, auth: string, attempt = 1): Promise<{ status: number; json: any }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: auth, 'User-Agent': 'stock-catalyst-historian' },
      signal: AbortSignal.timeout(25000),
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* 404s can be empty */ }
    return { status: res.status, json };
  } catch (e) {
    if (attempt >= 3) { console.warn(`  ${path} failed after ${attempt}: ${e}`); return { status: 0, json: null }; }
    await sleep(2000 * attempt);
    return ch(path, auth, attempt + 1);
  }
}

interface Record_ {
  companyNumber: string; companyName: string | null; jurisdiction: string | null; type: string | null;
  status: string | null; statusDetail: string | null; dateOfCreation: string | null; dateOfCessation: string | null;
  hasInsolvencyHistory: boolean; hasBeenLiquidated: boolean; insolvencyCases: number; chargesTotal: number | null;
  lastChecked: string; statusChangedAt: string | null; previousStatus: string | null;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  const withCharges = !args.includes('--no-charges');
  const auth = authHeader();
  const today = new Date().toISOString().slice(0, 10);

  if (!existsSync(LEI_PATH)) { console.error('[CH] symbol_lei_map.json missing — run buildLeiMap.ts first.'); process.exit(1); }
  const lei = JSON.parse(readFileSync(LEI_PATH, 'utf8')).lei ?? {};
  const eligible = Object.entries<any>(lei).filter(([, v]) => v.isCompaniesHouse && v.registeredAs);
  const todo = limit === Infinity ? eligible : eligible.slice(0, limit);
  console.log(`Companies House-eligible symbols: ${eligible.length}  (checking ${todo.length})`);

  const prev: Record<string, Record_> = existsSync(OUT_PATH)
    ? (JSON.parse(readFileSync(OUT_PATH, 'utf8')).companies ?? {}) : {};
  if (Object.keys(prev).length) console.log(`  loaded previous state for ${Object.keys(prev).length} symbol(s)`);

  const out: Record<string, Record_> = {};
  const transitions: Array<{ symbol: string; from: string | null; to: string | null }> = [];
  const statusCounts: Record<string, number> = {};
  let notFound = 0, distressed = 0;

  for (const [symbol, meta] of todo) {
    const num = String(meta.registeredAs);
    const p = await ch(`/company/${num}`, auth);
    await sleep(REQUEST_DELAY_MS);
    if (p.status !== 200 || !p.json) {
      notFound++;
      console.log(`   ${symbol.padEnd(10)} ${num.padEnd(10)} profile HTTP ${p.status}`);
      if (prev[symbol]) out[symbol] = prev[symbol];      // keep last good observation
      continue;
    }
    const j = p.json;
    const status: string | null = j.company_status ?? null;
    statusCounts[status ?? 'unknown'] = (statusCounts[status ?? 'unknown'] ?? 0) + 1;

    // /insolvency 404s when there is no history — that is the normal case, not an error
    let insolvencyCases = 0;
    if (j.has_insolvency_history) {
      const ins = await ch(`/company/${num}/insolvency`, auth);
      await sleep(REQUEST_DELAY_MS);
      insolvencyCases = ins.json?.cases?.length ?? 0;
    }

    // `has_charges` on the profile is unreliable (see header) — use the endpoint
    let chargesTotal: number | null = null;
    if (withCharges) {
      const c = await ch(`/company/${num}/charges?items_per_page=1`, auth);
      await sleep(REQUEST_DELAY_MS);
      chargesTotal = c.status === 200 ? (c.json?.total_count ?? 0) : null;
    }

    const before = prev[symbol];
    const changed = before && before.status !== status;
    if (changed) transitions.push({ symbol, from: before.status, to: status });

    out[symbol] = {
      companyNumber: num, companyName: j.company_name ?? null,
      jurisdiction: j.jurisdiction ?? null, type: j.type ?? null,
      status, statusDetail: j.company_status_detail ?? null,
      dateOfCreation: j.date_of_creation ?? null, dateOfCessation: j.date_of_cessation ?? null,
      hasInsolvencyHistory: !!j.has_insolvency_history, hasBeenLiquidated: !!j.has_been_liquidated,
      insolvencyCases, chargesTotal, lastChecked: today,
      // first run records nothing; later runs pin the date a change was first seen
      statusChangedAt: changed ? today : (before?.statusChangedAt ?? null),
      previousStatus: changed ? before!.status : (before?.previousStatus ?? null),
    };
    if (status !== 'active' || j.has_insolvency_history || j.has_been_liquidated) distressed++;
  }

  writeFileSync(OUT_PATH, JSON.stringify({
    _note: 'UK company STATE from Companies House, for survivorship/liveness work — NOT a catalyst feed. Companies House is a registry, not a disclosure service (UK price-sensitive news goes via RNS, which is commercial), and its dates lag the market by days-to-months, so filing dates must NOT be used to time entries. Only company state (status, cessation, insolvency, liquidation) is kept, because that labels outcomes rather than timing them. Coverage is the 85 Companies House-eligible symbols from symbol_lei_map.json; the other ~10% of .L names are registered offshore (Jersey/IoM/Bermuda) and are genuinely absent — treat absence as "not UK-registered", NEVER as "no insolvency", and note the gap is non-random. `chargesTotal` comes from the /charges endpoint because the profile\'s has_charges boolean is unreliable (AVIVA: has_charges false, total_count 3). State is cumulative: statusChangedAt pins when a status was first observed to change. Rebuild via buildUkCompanyStatus.ts (needs COMPANIES_HOUSE_API_KEY).',
    _built: today,
    _source: BASE,
    _counts: { eligible: eligible.length, checked: todo.length, resolved: Object.keys(out).length, notFound, nonActiveOrDistressed: distressed },
    _statusCounts: statusCounts,
    companies: out,
  }, null, 2));

  console.log(`\nResolved ${Object.keys(out).length}/${todo.length}   not found: ${notFound}`);
  console.log('Status:', Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log(`Non-active / insolvency history / liquidated: ${distressed}`);
  if (transitions.length) {
    console.log(`\n⚠  ${transitions.length} STATUS TRANSITION(S) since the last run:`);
    for (const t of transitions) console.log(`   ${t.symbol.padEnd(10)} ${t.from} -> ${t.to}`);
  } else if (Object.keys(prev).length) {
    console.log('\nNo status transitions since the last run.');
  }
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch(e => { console.error('[CH] FATAL:', e); process.exit(1); });
