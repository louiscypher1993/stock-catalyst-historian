/**
 * buildAmfShortPositions.ts — Stage-3 data item: French (AMF) net short
 * positions, the EU half of the short-disclosure work.
 *
 * Source: the AMF's official open-data export on data.gouv.fr ("Historique des
 * positions courtes nettes sur actions rendues publiques depuis le 1er
 * Novembre 2012"), free, no auth, daily-updated. Verified live before building.
 *
 * URL IS NOT HARDCODED — the CSV resource carries a generation timestamp in its
 * filename (export_od_vad_<from>_<to>.csv), so it changes on every refresh.
 * The script resolves the current resource URL via the data.gouv.fr dataset
 * API each run; hardcoding it would silently rot within hours.
 *
 * INDIVIDUAL -> AGGREGATE. Unlike the FCA (which since 2026-07-13 publishes
 * pre-aggregated anonymised positions), the AMF still publishes INDIVIDUAL
 * holder positions, and the file is a full history of every position change
 * since 2012. Current aggregate exposure per issuer is derived here:
 *   1. keep only OPEN positions (empty "Date de fin de publication position");
 *   2. within those, keep the LATEST row per (holder, ISIN) -- the file
 *      contains each holder's whole trajectory as separate rows (e.g. one
 *      holder's Remy Cointreau position stepping 1.18 -> 0.58 over months),
 *      so summing raw rows would massively double-count;
 *   3. sum those per-holder latest ratios per ISIN.
 * That reconstructs the same quantity the FCA now publishes directly, so the
 * two countries' outputs are comparable.
 *
 * JOIN: same ISIN -> FIGI -> our-symbol path proven in buildFcaShortPositions.ts
 * (query OpenFIGI by ISIN + micCode=XPAR, filter to exchCode 'FP', match
 * compositeFIGI against symbol_figi_map.json) -- exact identifier equality, no
 * company-name or ticker guessing.
 *
 * SCOPE / HONEST COVERAGE: our French universe is 32 CAC40-style large caps
 * while French short disclosure skews mid-cap, so expect ~10 matches, not ~30.
 * That is a real limit of the overlap, not a bug in the join.
 *
 * WHY FRANCE ONLY (not the rest of the EU): the other large EU registers were
 * checked and are NOT cleanly machine-readable --
 *   - Germany (Bundesanzeiger): session-gated, HTTP 302, CSV export is a
 *     session-bound UI action with no stable URL;
 *   - Sweden (Finansinspektionen): file links are JS-rendered, no stable URL;
 * both would need brittle scraping with session handling. ESMA itself only
 * hosts the exempted-shares register plus links out to ~27 national sites --
 * there is no consolidated EU short-position feed. France is the one national
 * register publishing proper open data, so it is the one built here.
 *
 * Usage:
 *   npx tsx src/scripts/buildAmfShortPositions.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_SLUG = 'historique-des-positions-courtes-nettes-sur-actions-rendues-publiques-depuis-le-1er-novembre-2012';
const DATASET_API = `https://www.data.gouv.fr/api/1/datasets/${DATASET_SLUG}/`;
const JOBS_PER_REQUEST = 10;   // unauthenticated OpenFIGI limit
const REQUEST_DELAY_MS = 2600;

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

/** Resolve the current (timestamped) CSV resource URL from the dataset API. */
async function resolveCsvUrl(): Promise<string> {
  const res = await fetch(DATASET_API, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`data.gouv.fr dataset API HTTP ${res.status}`);
  const j: any = await res.json();
  const csv = (j.resources ?? []).find((r: any) => String(r.format).toLowerCase() === 'csv');
  if (!csv?.url) throw new Error('No CSV resource found on the AMF dataset — the dataset layout may have changed.');
  return csv.url;
}

interface Aggregate { issuer: string; totalPercent: number; holders: number; latestStart: string }

/** Semicolon-delimited, every field quoted; no embedded semicolons observed. */
function aggregateOpenPositions(text: string): Map<string, Aggregate> {
  const lines = text.split('\n');
  // latest row per (holder, ISIN) among OPEN positions
  const latest = new Map<string, { ratio: number; start: string; issuer: string; isin: string }>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const f = line.split(';').map(x => x.replace(/^"|"$/g, ''));
    if (f.length < 8) continue;
    const [holder, , issuer, ratioRaw, isin, start, , end] = f;
    if (end && end.trim() !== '') continue;           // position closed
    const ratio = parseFloat(ratioRaw);
    if (!Number.isFinite(ratio) || !isin) continue;
    const key = `${holder}|${isin}`;
    const prev = latest.get(key);
    if (!prev || start > prev.start) latest.set(key, { ratio, start, issuer, isin });
  }
  const byIsin = new Map<string, Aggregate>();
  for (const v of latest.values()) {
    const e = byIsin.get(v.isin) ?? { issuer: v.issuer, totalPercent: 0, holders: 0, latestStart: '' };
    e.totalPercent += v.ratio;
    e.holders += 1;
    if (v.start > e.latestStart) e.latestStart = v.start;
    byIsin.set(v.isin, e);
  }
  return byIsin;
}

type JobResult = { data: Array<{ figi: string; compositeFIGI?: string; exchCode?: string }> } | { error: string };
async function mapBatch(jobs: Array<Record<string, string>>): Promise<JobResult[]> {
  const res = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobs),
  });
  if (!res.ok) throw new Error(`OpenFIGI HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

async function main() {
  console.log('Resolving current AMF CSV resource URL (timestamped -- never hardcode)...');
  const csvUrl = await resolveCsvUrl();
  console.log(`  ${csvUrl}`);

  const res = await fetch(csvUrl);
  if (!res.ok) throw new Error(`AMF CSV fetch failed: HTTP ${res.status}`);
  const byIsin = aggregateOpenPositions(await res.text());
  console.log(`Open positions aggregated into ${byIsin.size} French issuers.`);

  // Reverse index of our French universe: compositeFIGI/figi -> Yahoo symbol.
  const figiMap = JSON.parse(readFileSync(join(__dirname, 'symbol_figi_map.json'), 'utf8')).figi as Record<string, { figi: string; compositeFigi?: string }>;
  const byComposite = new Map<string, string>(), byFigi = new Map<string, string>();
  for (const [sym, e] of Object.entries(figiMap)) {
    if (!sym.endsWith('.PA')) continue;
    if (e.compositeFigi) byComposite.set(e.compositeFigi, sym);
    byFigi.set(e.figi, sym);
  }
  console.log(`Reverse index: ${byComposite.size} .PA symbols with a compositeFIGI.`);

  const isins = [...byIsin.keys()];
  const out: Record<string, { aggregateShortPercent: number; holders: number; latestPositionDate: string; isin: string; issuer: string }> = {};
  let requests = 0;

  for (const batch of chunk(isins, JOBS_PER_REQUEST)) {
    const results = await mapBatch(batch.map(isin => ({ idType: 'ID_ISIN', idValue: isin, micCode: 'XPAR' })));
    results.forEach((r, i) => {
      const isin = batch[i];
      const matches = ('data' in r ? r.data : []).filter(m => m.exchCode === 'FP'); // FP = Euronext Paris
      if (!matches.length) return;
      const m = matches[0];
      const sym = (m.compositeFIGI && byComposite.get(m.compositeFIGI)) ?? byFigi.get(m.figi);
      if (!sym) return; // real French issuer, just not in our tracked universe
      const agg = byIsin.get(isin)!;
      out[sym] = {
        aggregateShortPercent: Math.round(agg.totalPercent * 100) / 100,
        holders: agg.holders, latestPositionDate: agg.latestStart, isin, issuer: agg.issuer,
      };
    });
    requests++;
    if (requests % 4 === 0) console.log(`  ${requests}/${Math.ceil(isins.length / JOBS_PER_REQUEST)} requests, ${Object.keys(out).length} matched`);
    await sleep(REQUEST_DELAY_MS);
  }

  const ourFrench = Object.keys(figiMap).filter(s => s.endsWith('.PA')).length;
  console.log(`\nMatched ${Object.keys(out).length}/${ourFrench} of our French symbols (of ${isins.length} French issuers with open positions).`);

  const outPath = join(__dirname, 'symbol_amf_short_positions.json');
  writeFileSync(outPath, JSON.stringify({
    _note: 'symbol -> AMF aggregate net short position (France, .PA only). Individual holder disclosures aggregated here (latest row per holder+ISIN among OPEN positions, summed) to match the FCA ANSP shape. Source: AMF open data via data.gouv.fr, free/no-auth, URL resolved dynamically (timestamped filename). Joined via ISIN->FIGI, not name matching. Rebuild via buildAmfShortPositions.ts.',
    _built: new Date().toISOString().slice(0, 10),
    _sourceUrl: csvUrl,
    _frenchIssuersWithOpenPositions: isins.length,
    amfShortPositions: out,
  }, null, 2));
  console.log(`Wrote ${Object.keys(out).length} entries -> ${outPath}`);

  console.log('\nMatches (by aggregate short %):');
  for (const [sym, e] of Object.entries(out).sort((a, b) => b[1].aggregateShortPercent - a[1].aggregateShortPercent)) {
    console.log(`   ${sym.padEnd(10)} ${String(e.aggregateShortPercent).padStart(6)}%  ${String(e.holders).padStart(2)} holders  ${e.issuer}`);
  }
}

main().catch(e => { console.error('[AmfShortPositions] FATAL:', e); process.exit(1); });
