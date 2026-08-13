/**
 * Control for the confound: the post-parity window also contains the expansion cohort
 * (null enrichment, quarantined), so a shifted risk distribution could be cohort
 * COMPOSITION rather than the parity fix. Split post-parity into core-only vs cohort and
 * compare core-only against pre-parity -- that is the like-for-like test.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const PARITY = '2026-08-09T12:07:00Z';

function cohortSymbols(): Set<string> {
  const out = new Set<string>();
  for (const f of ['universe_expansion.json', 'autoListings.json']) {
    const p = path.join(process.cwd(), 'src', f);
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const s of j.symbols ?? j.stocks ?? []) if (s?.symbol) out.add(String(s.symbol).toUpperCase());
  }
  return out;
}

function describe(label: string, v: number[]) {
  if (!v.length) { console.log(`${label}: no rows`); return; }
  v = [...v].sort((a, b) => a - b);
  const hist = new Map<number, number>();
  for (const x of v) hist.set(x, (hist.get(x) ?? 0) + 1);
  const q = (p: number) => v[Math.floor(p * (v.length - 1))];
  const spike = v.filter(x => x >= 37 && x <= 38).length;
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`${label.padEnd(24)} n=${String(v.length).padStart(5)}  distinct=${String(hist.size).padStart(3)}  ` +
    `p25=${String(q(.25)).padStart(3)} p50=${String(q(.50)).padStart(3)} p75=${String(q(.75)).padStart(3)}  ` +
    `37-38=${(100 * spike / v.length).toFixed(1)}%  top=${top.map(([s, c]) => `${s}x${c}`).join(',')}`);
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: Array<{ symbol: string; risk_score: number | null; created_at: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('symbol, risk_score, created_at')
      .gte('created_at', '2026-07-22T00:00:00Z')
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    const b = data ?? [];
    rows.push(...b as any);
    if (b.length < 1000) break;
  }
  const coh = cohortSymbols();
  const val = (r: typeof rows[0]) => r.risk_score;
  const pre = rows.filter(r => r.created_at < PARITY);
  const post = rows.filter(r => r.created_at >= PARITY);
  const postCore = post.filter(r => !coh.has(r.symbol.toUpperCase()));
  const postCohort = post.filter(r => coh.has(r.symbol.toUpperCase()));
  const preCore = pre.filter(r => !coh.has(r.symbol.toUpperCase()));

  console.log(`cohort symbols loaded: ${coh.size}\n`);
  describe('PRE-parity  (all)', pre.map(val).filter((x): x is number => x != null));
  describe('PRE-parity  (core only)', preCore.map(val).filter((x): x is number => x != null));
  describe('POST-parity (all)', post.map(val).filter((x): x is number => x != null));
  describe('POST-parity (CORE ONLY)', postCore.map(val).filter((x): x is number => x != null));
  describe('POST-parity (cohort)', postCohort.map(val).filter((x): x is number => x != null));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
