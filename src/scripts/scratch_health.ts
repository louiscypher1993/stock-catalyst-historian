/** READ-ONLY health + gate readiness snapshot. */
import 'dotenv/config';
async function page(t: string, sel: string, since?: string) {
  const { supabase } = await import('../db/supabaseClient');
  const out: any[] = [];
  for (let f = 0; ; f += 1000) {
    let q = supabase.from(t).select(sel).range(f, f + 999);
    if (since) q = q.gte('run_date', since);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  return out;
}
async function main() {
  const inf = await page('inference_results', 'run_date, unreliable_reason, model_c_max_drawdown', '2026-08-09');
  const days = [...new Set(inf.map(r => String(r.run_date).slice(0, 10)))].sort();
  console.log(`inference_results since parity : ${inf.length} rows over ${days.length} run_dates`);
  console.log(`  first ${days[0]}   LATEST ${days[days.length - 1]}`);
  const last5 = days.slice(-5);
  for (const d of last5) console.log(`    ${d}  ${inf.filter(r => String(r.run_date).slice(0,10) === d).length} rows`);

  const clean = inf.filter(r => !r.unreliable_reason);
  const cleanDays = new Set(clean.map(r => String(r.run_date).slice(0, 10)));
  console.log(`\nPREREG readiness (post-parity, unquarantined):`);
  console.log(`  clean rows      ${clean.length}   (A1 needs >=400: ${clean.length >= 400 ? 'MET' : 'NOT MET'})`);
  console.log(`  clean run_dates ${cleanDays.size}   (C1 needs >=10: ${cleanDays.size >= 10 ? 'MET' : 'NOT MET'})`);

  const out = await page('outcome_results', 'run_date, horizon');
  const byH: Record<string, string[]> = {};
  for (const r of out) (byH[r.horizon] ??= []).push(String(r.run_date).slice(0, 10));
  console.log(`\noutcome_results by horizon (matured):`);
  for (const h of Object.keys(byH).sort()) {
    const ds = byH[h].sort();
    const post = [...new Set(ds.filter(d => d >= '2026-08-09'))];
    console.log(`  ${h.padEnd(4)} total ${String(byH[h].length).padStart(5)}   POST-PARITY ${String(post.length).padStart(2)} run_dates  latest ${ds[ds.length-1]}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
