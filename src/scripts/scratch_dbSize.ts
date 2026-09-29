/** Approximate per-table payload size, to target the size problem. READ-ONLY.
 *  Samples rows and scales by exact count — PostgREST cannot run pg_total_relation_size. */
import 'dotenv/config';
const TABLES = ['inference_results','outcome_results','pot_snapshots','pot_positions',
                'pot_trades','shadow_benchmark_divergence','watchlist_pulse'];
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const rows: Array<{t:string;n:number;mb:number;avg:number}> = [];
  for (const t of TABLES){
    try {
      const { count, error: ce } = await supabase.from(t).select('*',{count:'exact',head:true});
      if (ce) { console.log(`  ${t.padEnd(28)} (absent: ${ce.message.slice(0,40)})`); continue; }
      const { data, error } = await supabase.from(t).select('*').limit(400);
      if (error) { console.log(`  ${t.padEnd(28)} (sample failed)`); continue; }
      const sample = data ?? [];
      const avg = sample.length ? Buffer.byteLength(JSON.stringify(sample),'utf8')/sample.length : 0;
      const mb = (avg*(count??0))/1048576;
      rows.push({t,n:count??0,mb,avg});
    } catch(e:any){ console.log(`  ${t.padEnd(28)} error ${e.message.slice(0,40)}`); }
  }
  rows.sort((a,b)=>b.mb-a.mb);
  const total = rows.reduce((s,r)=>s+r.mb,0);
  console.log('approx JSON payload size (NOT on-disk, but ranks the offenders):');
  for (const r of rows)
    console.log(`  ${r.t.padEnd(28)} ${String(r.n).padStart(7)} rows  ~${r.mb.toFixed(1).padStart(7)} MB  (${(100*r.mb/total).toFixed(0)}%)  avg ${Math.round(r.avg)}B/row`);
  console.log(`  ${'TOTAL'.padEnd(28)} ${' '.repeat(13)}~${total.toFixed(1)} MB`);

  // Is one wide TEXT column dominating inference_results?
  const { data } = await supabase.from('inference_results').select('*').limit(400);
  const s = data ?? [];
  if (s.length){
    const all = Buffer.byteLength(JSON.stringify(s),'utf8');
    const byCol: Array<[string,number]> = Object.keys(s[0]).map(k =>
      [k, s.reduce((acc:number,r:any)=>acc+Buffer.byteLength(JSON.stringify(r[k] ?? null),'utf8'),0)]);
    byCol.sort((a,b)=>b[1]-a[1]);
    console.log('\ninference_results — widest columns (share of row payload):');
    for (const [k,b] of byCol.slice(0,6))
      console.log(`  ${k.padEnd(30)} ${(100*b/all).toFixed(1).padStart(5)}%  avg ${Math.round(b/s.length)}B`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
