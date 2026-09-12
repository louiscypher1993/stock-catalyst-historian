/** How far back does inference_results actually go, and is the floor moving? READ-ONLY. */
import 'dotenv/config';
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const oldest = await supabase.from('inference_results')
    .select('run_date, created_at').order('run_date',{ascending:true}).limit(3);
  const newest = await supabase.from('inference_results')
    .select('run_date, created_at').order('run_date',{ascending:false}).limit(1);
  if (oldest.error||newest.error) { console.error(oldest.error?.message||newest.error?.message); process.exit(1); }
  console.log('EARLIEST run_dates present:');
  for (const r of oldest.data??[]) console.log(`  ${String(r.run_date).slice(0,10)}  created ${r.created_at}`);
  console.log(`LATEST run_date: ${String(newest.data?.[0]?.run_date).slice(0,10)}`);

  const { count } = await supabase.from('inference_results').select('*',{count:'exact',head:true});
  console.log(`\ntotal rows in inference_results: ${count}`);

  // Same question for the other durable tables.
  for (const t of ['outcome_results','pot_positions','pot_snapshots','shadow_benchmark_divergence']) {
    try {
      const o = await supabase.from(t).select('*',{count:'exact',head:true});
      const col = t==='outcome_results' ? 'run_date' : (t==='pot_snapshots'?'run_date':(t==='pot_positions'?'entry_date':'run_date'));
      const e = await supabase.from(t).select(col).order(col,{ascending:true}).limit(1);
      console.log(`  ${t.padEnd(30)} rows ${String(o.count).padStart(6)}   earliest ${col}=${String((e.data as any)?.[0]?.[col] ?? '—').slice(0,10)}`);
    } catch(err:any){ console.log(`  ${t.padEnd(30)} ${err.message}`); }
  }
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
