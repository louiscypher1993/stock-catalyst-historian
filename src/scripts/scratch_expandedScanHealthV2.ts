/**
 * TODO item 3: first expanded-scan health check.
 *
 * Universe went 1,723 -> 2,906 symbols on 2026-08-10 ~10:29 UTC (088d741). Question is
 * whether the expanded universe is healthy: detection volume, quarantine split, symbol
 * coverage, and whether the expansion cohort behaves like the core cohort or is throwing
 * degenerate output.
 *
 * NOTE ON WHAT THIS CAN AND CANNOT MEASURE. inference_results holds DETECTIONS, not
 * symbols scanned, so row volume is not a scan-completion measure and a Yahoo error rate
 * is not recoverable from it (that lives in workflow logs). Runtime is measured separately
 * from the Actions API. Treat detection volume as a behavioural signal, not coverage.
 *
 * Supabase caps a select at 1000 rows; every query here paginates (see the `ced` fix,
 * which was silently truncated at 1000 of 2,659 rows -- a ~62% undercount).
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const EXPANSION_UTC = '2026-08-10T10:29:00Z';
const SINCE = '2026-08-04T00:00:00Z';

interface Row {
  symbol: string; created_at: string; unreliable_reason: string | null;
  z_score: number | null; sector: string | null; risk_score: number | null;
  model_d5_return_2w: number | null; model_b_return_1m: number | null;
}

function expansionSymbols(): Set<string> {
  const out = new Set<string>();
  for (const f of ['universe_expansion.json', 'autoListings.json']) {
    const p = path.join(process.cwd(), 'src', f);
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      // The two artifacts have DIFFERENT shapes: universe_expansion.json is
      // { symbols: [...] }, autoListings.json is a Market ({ stocks: [...] }).
      for (const s of j.symbols ?? j.stocks ?? []) if (s?.symbol) out.add(String(s.symbol).toUpperCase());
    } catch { /* absent or unreadable is fine -- classification degrades, nothing breaks */ }
  }
  return out;
}

/** Cluster rows into runs: a gap > 25 min starts a new run. */
function clusterRuns(rows: Row[]): Row[][] {
  const runs: Row[][] = [];
  let cur: Row[] = [];
  let last = 0;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (cur.length && t - last > 25 * 60 * 1000) { runs.push(cur); cur = []; }
    cur.push(r); last = t;
  }
  if (cur.length) runs.push(cur);
  return runs;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');

  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('inference_results')
      .select('symbol, created_at, unreliable_reason, z_score, sector, risk_score, model_d5_return_2w, model_b_return_1m')
      .gte('created_at', SINCE)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  console.log(`total rows since ${SINCE}: ${rows.length}  (paginated, not truncated)`);

  const exp = expansionSymbols();
  console.log(`expansion-cohort symbols known: ${exp.size}`);

  const runs = clusterRuns(rows);
  console.log(`\nruns detected: ${runs.length}\n`);
  console.log('start (UTC)        span   rows  clean  quar  distinct  expCohort  medRisk');
  console.log('-'.repeat(78));

  for (const run of runs) {
    const t0 = new Date(run[0].created_at);
    const t1 = new Date(run[run.length - 1].created_at);
    const spanMin = Math.round((t1.getTime() - t0.getTime()) / 60000);
    const quar = run.filter(r => r.unreliable_reason).length;
    const distinct = new Set(run.map(r => r.symbol.toUpperCase())).size;
    const inExp = run.filter(r => exp.has(r.symbol.toUpperCase())).length;
    const risks = run.map(r => r.risk_score).filter((v): v is number => v != null).sort((a, b) => a - b);
    const medRisk = risks.length ? risks[Math.floor(risks.length / 2)] : NaN;
    const post = t0.toISOString() >= EXPANSION_UTC ? '*' : ' ';
    console.log(
      `${post}${t0.toISOString().slice(0, 16).replace('T', ' ')}  ${String(spanMin).padStart(4)}m  ` +
      `${String(run.length).padStart(5)}  ${String(run.length - quar).padStart(5)}  ${String(quar).padStart(4)}  ` +
      `${String(distinct).padStart(8)}  ${String(inExp).padStart(9)}  ${String(medRisk).padStart(7)}`
    );
  }
  console.log('\n(* = post-expansion run)');

  // Does the expansion cohort behave like the core cohort, or is it degenerate?
  const post = rows.filter(r => r.created_at >= EXPANSION_UTC);
  const core = post.filter(r => !exp.has(r.symbol.toUpperCase()));
  const cohort = post.filter(r => exp.has(r.symbol.toUpperCase()));
  console.log(`\n--- post-expansion rows: ${post.length}  (core ${core.length} / cohort ${cohort.length}) ---`);

  for (const [label, set] of [['core', core], ['cohort', cohort]] as const) {
    if (!set.length) { console.log(`${label}: no rows`); continue; }
    const d5 = set.map(r => r.model_d5_return_2w).filter((v): v is number => v != null);
    const uniqD5 = new Set(d5.map(v => v.toFixed(6))).size;
    const quar = set.filter(r => r.unreliable_reason).length;
    const sectors = new Set(set.map(r => r.sector ?? 'null'));
    const mean = d5.reduce((a, b) => a + b, 0) / (d5.length || 1);
    console.log(
      `${label.padEnd(7)} rows=${String(set.length).padStart(5)}  quarantined=${String(quar).padStart(5)}  ` +
      `distinctD5=${String(uniqD5).padStart(5)}/${String(d5.length).padStart(5)}  meanD5=${mean.toFixed(5)}  ` +
      `sectors=${sectors.size}`
    );
  }

  // Quarantine reasons -- the expansion cohort should be null_enrichment and nothing else.
  const reasons = new Map<string, number>();
  for (const r of post) if (r.unreliable_reason) reasons.set(r.unreliable_reason, (reasons.get(r.unreliable_reason) ?? 0) + 1);
  console.log('\n--- quarantine reasons (post-expansion) ---');
  if (!reasons.size) console.log('  none');
  for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
