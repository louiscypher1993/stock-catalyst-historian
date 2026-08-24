/** C1 follow-up: is the live prediction distribution signed such that a 10% SELL tier
 *  is even meaningful? READ-ONLY. */
import 'dotenv/config';
const F = ['model_d3_return_2d','model_d5_return_2w','model_d1_return_3m','model_d2_return_6m','model_b_return_1m'];
const L: Record<string,string> = {model_d3_return_2d:'D3 2D',model_d5_return_2w:'D5 2W',model_d1_return_3m:'D1 3M',model_d2_return_6m:'D2 6M',model_b_return_1m:'B 1M'};
async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('unreliable_reason, ' + F.join(', ')).gte('run_date','2026-08-09').range(f, f+999);
    if (error) throw error;
    rows.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const clean = rows.filter(r => !r.unreliable_reason);
  console.log(`n=${clean.length} post-parity clean\n`);
  console.log('head    min       p01       p10       median    p90       max       %negative');
  for (const f of F) {
    const v = clean.map(r => r[f]).filter(x => x != null).map(Number).sort((a,b)=>a-b);
    if (!v.length) { console.log(`${L[f]}  (no values)`); continue; }
    const q = (p:number)=>v[Math.floor(p*(v.length-1))];
    const neg = 100*v.filter(x=>x<0).length/v.length;
    console.log(`${L[f].padEnd(7)} ${q(0).toFixed(5).padStart(9)} ${q(.01).toFixed(5).padStart(9)} ${q(.10).toFixed(5).padStart(9)} ${q(.50).toFixed(5).padStart(9)} ${q(.90).toFixed(5).padStart(9)} ${q(1).toFixed(5).padStart(9)}  ${neg.toFixed(1)}%`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
