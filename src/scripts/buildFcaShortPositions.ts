/**
 * buildFcaShortPositions.ts — Stage-3 data item: FCA UK short-position
 * disclosures (anonymised aggregate net short positions, "ANSP").
 *
 * Source: https://www.fca.org.uk/publication/documents/aggregated-current-net-short-positions.csv
 * Free, no auth, no signup -- direct CSV download, verified live before
 * building anything against it (same discipline as buildShortInterest.ts,
 * after a hallucinated FINRA URL surfaced in an earlier search).
 *
 * REGIME CHANGE (2026-07-13): the FCA stopped disclosing individual net short
 * positions and now publishes only ANONYMISED AGGREGATES per company --
 * combining all positions reported at/above the 0.2% threshold into one %
 * figure, no position-holder identity. This is the CURRENT file (not the old
 * individual-position format the original Stage-3 plan was scoped against).
 *
 * THE JOIN PROBLEM: FCA discloses by company name + ISIN, not ticker. Rather
 * than fuzzy-match company names (unreliable) or guess ticker conventions
 * (burned twice already this session -- OpenFIGI's own ticker format varies
 * per market and isn't always the Yahoo form), this joins via FIGI equality:
 *   1. Query OpenFIGI by ISIN (+micCode=XLON to scope to the LSE listing)
 *      for each FCA-disclosed company.
 *   2. Reuse buildOpenFigiMap.ts's ALREADY-BUILT symbol_figi_map.json (every
 *      .L symbol in our universe already has a FIGI from that earlier build)
 *      as a compositeFIGI -> our-Yahoo-symbol reverse index.
 *   3. A match is exact identifier equality, not name/ticker guessing --
 *      this is exactly the "cross-market join key" buildOpenFigiMap.ts was
 *      built to provide, now paying off on a second data source.
 *
 * CSV notes (verified against the real file): UTF-8 BOM present (stripped
 * below); 3+ rows have quoted company names with embedded commas (e.g.
 * "INTERNATIONAL CONSOLIDATED AIRLINES GROUP, S.A.") -- needs a quote-aware
 * parser, not a naive split(','). Some ISINs are non-GB-prefixed (US-format
 * ISINs for UK-LISTED companies like Boku/Somero) -- looked up as-is, since
 * the micCode=XLON filter scopes to the LSE listing regardless of the ISIN's
 * country-of-issue prefix.
 *
 * Usage:
 *   npx tsx src/scripts/buildFcaShortPositions.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FCA_CSV_URL = 'https://www.fca.org.uk/publication/documents/aggregated-current-net-short-positions.csv';
const JOBS_PER_REQUEST = 10; // unauthenticated OpenFIGI limit (confirmed in buildOpenFigiMap.ts)
const REQUEST_DELAY_MS = 2500;

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out;
}

// Minimal quote-aware CSV line splitter -- sufficient for this file's actual
// shape (verified: no escaped internal quotes to worry about, just commas
// inside a quoted field).
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

interface FcaRow { name: string; isin: string; anspPercent: number; positionDate: string }

function parseFcaCsv(text: string): FcaRow[] {
  const clean = text.replace(/^﻿/, ''); // strip UTF-8 BOM
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  const rows: FcaRow[] = [];
  for (let i = 1; i < lines.length; i++) { // skip header
    const f = splitCsvLine(lines[i]);
    if (f.length < 4) continue;
    const [dd, mm, yyyy] = f[3].split('/');
    rows.push({
      name: f[0].trim(), isin: f[1].trim(), anspPercent: Number(f[2]),
      positionDate: yyyy && mm && dd ? `${yyyy}-${mm}-${dd}` : f[3],
    });
  }
  return rows;
}

type JobResult = { data: Array<{ figi: string; compositeFIGI?: string; ticker?: string; exchCode?: string; name?: string }> } | { error: string };
async function mapBatch(jobs: Array<{ idType: string; idValue: string; micCode?: string }>): Promise<JobResult[]> {
  const res = await fetch('https://api.openfigi.com/v3/mapping', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobs),
  });
  if (!res.ok) throw new Error(`OpenFIGI HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return res.json();
}

async function main() {
  console.log('Fetching FCA current ANSP disclosures...');
  const res = await fetch(FCA_CSV_URL);
  if (!res.ok) throw new Error(`FCA fetch failed: HTTP ${res.status}`);
  const rows = parseFcaCsv(await res.text());
  console.log(`Parsed ${rows.length} disclosed companies.`);

  // Reverse index: compositeFIGI (and figi, as a fallback) -> our Yahoo .L symbol.
  const figiMapPath = join(__dirname, 'symbol_figi_map.json');
  const figiMap = JSON.parse(readFileSync(figiMapPath, 'utf8')).figi as Record<string, { figi: string; compositeFigi?: string }>;
  const byComposite = new Map<string, string>();
  const byFigi = new Map<string, string>();
  for (const [sym, e] of Object.entries(figiMap)) {
    if (!sym.endsWith('.L')) continue;
    if (e.compositeFigi) byComposite.set(e.compositeFigi, sym);
    byFigi.set(e.figi, sym);
  }
  console.log(`Reverse index built from symbol_figi_map.json: ${byComposite.size} .L symbols with a compositeFIGI.`);

  const out: Record<string, { anspPercent: number; positionDate: string; isin: string; companyName: string }> = {};
  const noLseMatch: string[] = [];
  const noUniverseMatch: string[] = [];
  let requestsDone = 0;

  const batches = chunk(rows, JOBS_PER_REQUEST);
  for (const batch of batches) {
    const jobs = batch.map(r => ({ idType: 'ID_ISIN', idValue: r.isin, micCode: 'XLON' }));
    const results = await mapBatch(jobs);
    results.forEach((r, i) => {
      const row = batch[i];
      const matches = 'data' in r ? r.data : [];
      const lnMatches = matches.filter(m => m.exchCode === 'LN');
      if (lnMatches.length === 0) { noLseMatch.push(row.name); return; }
      const m = lnMatches[0]; // first LN match (validated stable in buildOpenFigiMap.ts sampling)
      const sym = (m.compositeFIGI && byComposite.get(m.compositeFIGI)) ?? byFigi.get(m.figi);
      if (!sym) { noUniverseMatch.push(row.name); return; }
      out[sym] = { anspPercent: row.anspPercent, positionDate: row.positionDate, isin: row.isin, companyName: row.name };
    });
    requestsDone++;
    if (requestsDone % 10 === 0 || requestsDone === batches.length) {
      console.log(`  ${requestsDone}/${batches.length} requests, ${Object.keys(out).length} matched so far`);
    }
    if (requestsDone < batches.length) await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\nMatched ${Object.keys(out).length}/${rows.length} FCA disclosures to our .L universe.`);
  console.log(`  no LSE (exchCode=LN) listing found for the ISIN: ${noLseMatch.length}`);
  console.log(`  LSE listing found but not in our tracked universe: ${noUniverseMatch.length} (expected -- FCA covers many companies we don't scan)`);

  const outPath = join(__dirname, 'symbol_fca_short_positions.json');
  writeFileSync(outPath, JSON.stringify({
    _note: 'symbol -> FCA anonymised aggregate net short position (UK, .L universe only). Source: fca.org.uk current ANSP CSV, free/no-auth. Joined via ISIN->FIGI (OpenFIGI) against symbol_figi_map.json, not ticker/name guessing. Regime effective 2026-07-13 (aggregated, not individual positions). Rebuild via buildFcaShortPositions.ts.',
    _built: new Date().toISOString().slice(0, 10),
    _sourceUrl: FCA_CSV_URL,
    _totalDisclosures: rows.length,
    fcaShortPositions: out,
  }, null, 2));
  console.log(`\nWrote ${Object.keys(out).length} entries -> ${outPath}`);

  console.log('\nSample matches:');
  const sample = Object.entries(out).slice(0, 8);
  for (const [sym, e] of sample) console.log(`   ${sym.padEnd(10)} ${e.anspPercent}%  (${e.companyName}, ${e.positionDate})`);
}

main().catch(e => { console.error('[FcaShortPositions] FATAL:', e); process.exit(1); });
