/**
 * Did the parity fix swing position sizing? Model C's breakpoints were never recalibrated.
 *
 * MODEL_C_PERCENTILE_BREAKPOINTS (v9.5) were fitted to C's HELD-OUT FOLD distribution.
 * Pre-parity, live C sat around -0.27 — the riskiest end of that scale, so the drawdown
 * term was pinned near 40/40. Post-parity live C is around -0.03, which is the SAFE end.
 * Same stale mapping, opposite extreme. riskScore feeds position size directly, so this is
 * a real-money question, not a cosmetic one.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  // PAGINATE. Supabase caps a select at 1000 rows; the first version of this script
  // ordered ascending and silently got the OLDEST thousand, so the post-parity cohort --
  // the entire point -- came back empty. Same defect class as 4958876.
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('inference_results')
      .select('symbol, created_at, model_c_max_drawdown, model_a_confidence, risk_score, position_size_pct, recommendation')
      .gte('run_date', '2026-07-27').order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as any[]));
    if (!data || data.length < 1000) break;
  }
  console.log(`fetched ${rows.length} rows (paginated)
`);
  const PARITY = '2026-08-09T12:07';
  const med = (a: number[]) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

  for (const [label, sel] of [['PRE-parity ', (r: any) => String(r.created_at) < PARITY],
                              ['POST-parity', (r: any) => String(r.created_at) >= PARITY]] as [string, (r: any) => boolean][]) {
    const g = rows.filter(sel);
    if (!g.length) { console.log(`${label}: no rows`); continue; }
    console.log(`${label}  n=${String(g.length).padStart(4)}  ` +
      `C med ${med(g.map(r => Number(r.model_c_max_drawdown))).toFixed(4).padStart(8)}  ` +
      `riskScore med ${String(med(g.map(r => Number(r.risk_score)))).padStart(3)}  ` +
      `position_size_pct med ${med(g.map(r => Number(r.position_size_pct))).toFixed(2).padStart(6)}  ` +
      `at 10% cap ${(100 * g.filter(r => Number(r.position_size_pct) >= 9.99).length / g.length).toFixed(0).padStart(3)}%`);
  }
  const post = rows.filter(r => String(r.created_at) >= PARITY);
  console.log(`\npost-parity recommendations: ` +
    JSON.stringify(post.reduce((m: any, r) => { m[r.recommendation] = (m[r.recommendation] ?? 0) + 1; return m; }, {})));
}
main();
