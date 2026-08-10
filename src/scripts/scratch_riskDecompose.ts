/**
 * Decompose live risk_score into its three terms to explain the observed clumping
 * (~37-38 spike, 64-69 cluster, integer granularity). Reads only.
 */
import 'dotenv/config';

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('symbol, run_date, risk_score, model_a_confidence, model_c_max_drawdown, model_d5_return_2w, unreliable_reason')
      .gte('run_date', '2026-07-22')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const clean = rows.filter(r => r.risk_score !== null);
  console.log(`rows since 2026-07-22: ${clean.length}`);

  const q = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  for (const [label, seg] of [
    ['pre-parity ', clean.filter(r => String(r.run_date).slice(0, 10) < '2026-08-09')],
    ['post-parity', clean.filter(r => String(r.run_date).slice(0, 10) >= '2026-08-09')],
  ] as const) {
    const a = seg.map(r => Number(r.model_a_confidence)).filter(Number.isFinite);
    const rs = seg.map(r => Number(r.risk_score));
    const aAt1 = a.filter(v => v >= 0.9999).length;
    console.log(`\n${label} n=${seg.length}`);
    console.log(`  model_a_confidence: ${aAt1}/${a.length} (${(100 * aAt1 / Math.max(1, a.length)).toFixed(1)}%) at >=0.9999 -> confidenceTerm 0`);
    // rank not mirrored to Supabase; infer drawdownTerm for the a≈1, D5>=0 majority:
    // there riskScore == round(40*(1-rank)), so the risk_score histogram IS the term.
    console.log(`  risk_score: p10 ${q(rs, .1)}  p50 ${q(rs, .5)}  p90 ${q(rs, .9)}`);
    const at3738 = rs.filter(v => v === 37 || v === 38).length;
    const hi = seg.filter(r => Number(r.risk_score) >= 60);
    console.log(`  at 37/38: ${at3738} (${(100 * at3738 / Math.max(1, rs.length)).toFixed(1)}%)   >=60: ${hi.length}`);
    if (hi.length) {
      const sellShare = hi.filter(r => Number(r.model_d5_return_2w) < 0).length;
      console.log(`  of >=60 rows, D5 negative (sell-term candidates): ${sellShare}/${hi.length}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
