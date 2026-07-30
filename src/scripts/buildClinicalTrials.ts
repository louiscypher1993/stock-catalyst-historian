/**
 * buildClinicalTrials.ts — Stage-3 data item: ClinicalTrials.gov v2 catalyst
 * feed for the biotech/pharma slice of the universe.
 *
 * Source: https://clinicaltrials.gov/api/v2/studies -- free, no API key, no
 * signup, verified live before building anything (same discipline as the
 * FINRA/FCA scripts). Confirmed live: query.lead (lead-sponsor search),
 * filter.overallStatus (comma-separated status list), sort=LastUpdatePostDate:desc,
 * countTotal=true, and a fields= projection all compose in a SINGLE request
 * per company -- no pagination needed for this use case.
 *
 * TARGET UNIVERSE: not all 1,397 symbols -- only the genuinely trial-sponsor-
 * shaped slice (Drug Manufacturers, Biotechnology industries from
 * company_profiles), which is 90-ish candidates before insurers/distributors/
 * hospital-operators are excluded (those don't sponsor trials in the
 * catalyst-relevant sense, even though they're nominally "Healthcare").
 *
 * WHY query.lead, ACTIVE-status-filtered, not the raw sponsor/all-time count:
 * a query.spons search on a big pharma name returns 1,000+ historical studies
 * (noise, mostly decades-old and irrelevant); filtering to the 4 currently-
 * active statuses (RECRUITING / ACTIVE_NOT_RECRUITING / ENROLLING_BY_INVITATION
 * / NOT_YET_RECRUITING) gives "what's live right now" -- the catalyst-relevant
 * signal. query.lead (not query.spons) was chosen after a live comparison
 * showed spons pulls in noisier collaborator-only mentions.
 *
 * POINT-IN-TIME CAVEAT (same one the original report flagged): this API
 * returns CURRENT status only, not as-of-date history. This script writes a
 * dated SNAPSHOT; catching real status CHANGES (a trial moving from
 * RECRUITING to COMPLETED) requires diffing two snapshots over time -- not
 * built yet, a natural next step once a few snapshots exist to diff.
 *
 * KNOWN LIMITATION, not solved here: multinational pharma often registers US
 * trials under a SUBSIDIARY's name, not the parent's listed name (e.g. Roche's
 * trials are typically sponsored by "Genentech", not "Roche" or "RHHBY") --
 * this will under-match those specific names. Flagged in output via
 * `_lowSignalCandidates`, not silently hidden.
 *
 * Usage:
 *   npx tsx src/scripts/buildClinicalTrials.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const API_BASE = 'https://clinicaltrials.gov/api/v2/studies';
const REQUEST_DELAY_MS = 1500; // conservative vs the ~50/min informal limit
const ACTIVE_STATUSES = 'RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION,NOT_YET_RECRUITING';

// Industries where "clinical trial sponsor" is the actually-relevant framing
// (excludes insurers, distributors, hospital operators -- nominally
// "Healthcare" sector but not trial sponsors in this sense).
const TARGET_INDUSTRIES = new Set([
  'Drug Manufacturers - General',
  'Drug Manufacturers - Specialty & Generic',
  'Biotechnology',
]);

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// Best-effort legal-suffix strip -- reduces noise, validated against every
// name in the actual candidate set before use (not just plausible-looking):
// separator is comma-optionally-followed-by-whitespace OR bare whitespace
// (handles "Co.,Ltd." with zero space, not just "Co., Ltd." with a space);
// an optional "and "/"& " before the suffix word catches "... and Company"
// (a real, common US legal-name pattern -- stripping "Company" alone would
// leave a broken fragment like "Eli Lilly and").
const SUFFIX_RE = /(?:,\s*|\s+)(?:and\s+|&\s+)?(Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?|Company|PLC|plc|AG|SE|S\.A\.?|N\.V\.?|A\/S|ASA|Ltd\.?|Limited|Holdings?|Group|Holding)\.?$/i;
function cleanName(name: string): string {
  let n = name;
  while (SUFFIX_RE.test(n)) n = n.replace(SUFFIX_RE, '').trim();
  return n;
}

// Verified overrides (live-checked, not guessed) for companies whose
// ClinicalTrials.gov-registered sponsor entity differs from their public/
// ticker name. Moderna's public parent is "Moderna, Inc." but its trials are
// sponsored by its subsidiary "ModernaTX" -- plain "Moderna" genuinely
// returns 0 studies (confirmed), "ModernaTX" returns 111 (27 active). Add
// further entries here only after confirming live, same as this one -- not a
// place to guess subsidiary names for the whole long tail (several of the
// remaining zero-signal candidates, e.g. Takeda/Cipla/Samsung Biologics, are
// left as the documented subsidiary-mismatch limitation, not chased further).
const SPONSOR_NAME_OVERRIDES: Record<string, string> = { MRNA: 'ModernaTX' };

interface Candidate { symbol: string; name: string; queryName: string; industry: string }

interface StudySummary { nctId: string; status: string; date: string; title: string; phase: string }
interface CtResult { activeTrialsCount: number; recentTrials: StudySummary[] }

async function queryCompany(name: string): Promise<CtResult | null> {
  const params = new URLSearchParams({
    'query.lead': name,
    'filter.overallStatus': ACTIVE_STATUSES,
    sort: 'LastUpdatePostDate:desc',
    countTotal: 'true',
    pageSize: '5',
    format: 'json',
    fields: 'NCTId,OverallStatus,LastUpdatePostDate,BriefTitle,Phase',
  });
  const res = await fetch(`${API_BASE}?${params.toString()}`);
  if (!res.ok) return null;
  const data: any = await res.json();
  const studies = (data.studies ?? []).map((s: any) => ({
    nctId: s.protocolSection?.identificationModule?.nctId ?? '',
    status: s.protocolSection?.statusModule?.overallStatus ?? '',
    date: s.protocolSection?.statusModule?.lastUpdatePostDateStruct?.date ?? '',
    title: s.protocolSection?.identificationModule?.briefTitle ?? '',
    phase: (s.protocolSection?.designModule?.phases ?? []).join('/'),
  }));
  return { activeTrialsCount: data.totalCount ?? 0, recentTrials: studies };
}

async function main() {
  const db = new Database(join(ROOT, 'market_cache.db'), { readonly: true });
  const spreadPath = join(__dirname, 'symbol_spread_bps.json');
  const universe: Set<string> = new Set(Object.keys(JSON.parse(readFileSync(spreadPath, 'utf8')).spreadBps));

  const rows = db.prepare(`SELECT symbol, name, industry FROM company_profiles WHERE industry IN (${[...TARGET_INDUSTRIES].map(() => '?').join(',')})`).all(...TARGET_INDUSTRIES) as Array<{ symbol: string; name: string; industry: string }>;
  const candidates: Candidate[] = rows.filter(r => universe.has(r.symbol)).map(r => ({ symbol: r.symbol, name: r.name, queryName: SPONSOR_NAME_OVERRIDES[r.symbol] ?? cleanName(r.name), industry: r.industry }));
  db.close();

  console.log(`Target universe: ${candidates.length} pharma/biotech companies (Drug Manufacturers + Biotechnology industries, in our scan universe).`);

  const out: Record<string, { companyName: string; queryUsed: string; activeTrialsCount: number; recentTrials: StudySummary[] }> = {};
  const lowSignal: string[] = []; // 0 active trials found -- likely a subsidiary-name mismatch or genuinely inactive
  let done = 0;

  for (const c of candidates) {
    const result = await queryCompany(c.queryName);
    done++;
    if (!result) { lowSignal.push(c.symbol); continue; }
    if (result.activeTrialsCount === 0) lowSignal.push(c.symbol);
    out[c.symbol] = { companyName: c.name, queryUsed: c.queryName, activeTrialsCount: result.activeTrialsCount, recentTrials: result.recentTrials };
    if (done % 15 === 0 || done === candidates.length) console.log(`  ${done}/${candidates.length} queried`);
    if (done < candidates.length) await sleep(REQUEST_DELAY_MS);
  }

  const withSignal = Object.values(out).filter(e => e.activeTrialsCount > 0).length;
  console.log(`\nQueried ${candidates.length}, ${withSignal} have >=1 active trial, ${lowSignal.length} show zero (name-mismatch or genuinely inactive -- see _lowSignalCandidates).`);

  const outPath = join(__dirname, 'symbol_clinical_trials.json');
  writeFileSync(outPath, JSON.stringify({
    _note: 'symbol -> ClinicalTrials.gov v2 active-trial snapshot (lead-sponsor search, 4 active statuses). Free/no-auth. POINT-IN-TIME SNAPSHOT ONLY -- API has no history endpoint; diff successive snapshots to detect real status changes. Rebuild via buildClinicalTrials.ts.',
    _built: new Date().toISOString().slice(0, 10),
    _activeStatusesQueried: ACTIVE_STATUSES.split(','),
    _lowSignalCandidates: lowSignal,
    clinicalTrials: out,
  }, null, 2));
  console.log(`Wrote ${Object.keys(out).length} entries -> ${outPath}`);

  console.log('\nSample (highest active-trial counts):');
  const sorted = Object.entries(out).sort((a, b) => b[1].activeTrialsCount - a[1].activeTrialsCount).slice(0, 8);
  for (const [sym, e] of sorted) console.log(`   ${sym.padEnd(8)} ${String(e.activeTrialsCount).padStart(3)} active  (${e.companyName})`);
}

main().catch(e => { console.error('[ClinicalTrials] FATAL:', e); process.exit(1); });
