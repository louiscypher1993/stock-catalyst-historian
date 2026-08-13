/**
 * D5 (the recommendation basis) and D3 fell from ~59% distinct pre-expansion to ~36%
 * post. Two very different causes, and only one is a problem:
 *
 *   BENIGN  the expansion cohort is 100% null_enrichment-quarantined, so those rows
 *           carry defaulted features, land in identical leaves, and dilute the pooled
 *           distinctness -- while the CORE universe is untouched. Quarantine already
 *           stops them reaching pots/notifications, so nothing live is affected.
 *   SERIOUS the core universe itself degraded, i.e. the expansion changed live output
 *           for symbols we actually trade.
 *
 * Comparing pre-expansion (all core) against post-expansion CORE ONLY separates them.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const EXPANSION = '2026-08-10T10:29:00Z';
const HEADS = ['model_b_return_1m', 'model_d1_return_3m', 'model_d2_return_6m',
               'model_d3_return_2d', 'model_d5_return_2w', 'model_c_max_drawdown'];

function expansionSymbols(): Set<string> {
  const out = new Set<string>();
  for (const f of ['universe_expansion.json', 'autoListings.json']) {
    const p = path.join(process.cwd(), 'src', f);
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const s of j.symbols ?? j.stocks ?? []) if (s?.symbol) out.add(String(s.symbol).toUpperCase());
    } catch { /* degrade gracefully */ }
  }
  return out;
}

async function fetchWindow(gte: string, lt: string) {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select(['symbol', 'unreliable_reason', ...HEADS].join(','))
      .gte('created_at', gte).lt('created_at', lt)
      .order('created_at', { ascending: true }).range(f, f + 999);
    if (error) throw error;
    const b = data ?? []; rows.push(...b); if (b.length < 1000) break;
  }
  return rows;
}

function pct(rows: any[], h: string): string {
  const vals = rows.map(r => r[h]).filter((v: any) => v != null) as number[];
  if (!vals.length) return '   n/a';
  const d = new Set(vals.map(v => v.toFixed(6)));
  return `${(100 * d.size / vals.length).toFixed(1).padStart(5)}%`;
}

async function main() {
  const exp = expansionSymbols();
  const pre  = await fetchWindow('2026-08-04T00:00:00Z', EXPANSION);
  const post = await fetchWindow(EXPANSION, '2099-01-01T00:00:00Z');
  const core   = post.filter(r => !exp.has(String(r.symbol).toUpperCase()));
  const cohort = post.filter(r =>  exp.has(String(r.symbol).toUpperCase()));

  console.log(`pre ${pre.length} rows | post core ${core.length} | post cohort ${cohort.length}\n`);
  console.log(`${'head'.padEnd(24)}${'PRE(core)'.padStart(10)}${'POST core'.padStart(11)}${'POST cohort'.padStart(13)}`);
  console.log('-'.repeat(58));
  for (const h of HEADS)
    console.log(`${h.padEnd(24)}${pct(pre, h).padStart(10)}${pct(core, h).padStart(11)}${pct(cohort, h).padStart(13)}`);

  console.log('\nIf PRE(core) ~= POST core, the expansion did not touch live output for the');
  console.log('symbols we trade, and the pooled drop is cohort dilution -- already quarantined.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
