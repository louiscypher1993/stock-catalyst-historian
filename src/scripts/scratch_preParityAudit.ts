/** Why did the pre-parity null_enrichment cohort shrink 580 -> 189? READ-ONLY. */
import 'dotenv/config';
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f=0;;f+=1000){
    const { data, error } = await supabase.from('inference_results')
      .select('run_date, unreliable_reason, created_at')
      .gte('run_date','2026-07-22').lt('run_date','2026-09-13').range(f,f+999);
    if (error) throw error;
    rows.push(...(data??[])); if ((data??[]).length<1000) break;
  }
  const pre = rows.filter(r => String(r.run_date).slice(0,10) < '2026-08-09');
  const post = rows.filter(r => String(r.run_date).slice(0,10) >= '2026-08-09');
  console.log(`rows 07-22..09-12 : ${rows.length}`);
  console.log(`  pre-parity  (07-22..08-08) : ${pre.length}`);
  console.log(`  post-parity (08-09..)      : ${post.length}\n`);

  const tally = (a:any[]) => {
    const m = new Map<string,number>();
    for (const r of a) m.set(r.unreliable_reason ?? '(clean)', (m.get(r.unreliable_reason ?? '(clean)')??0)+1);
    return [...m.entries()].sort((x,y)=>y[1]-x[1]);
  };
  console.log('pre-parity unreliable_reason breakdown:');
  for (const [k,v] of tally(pre)) console.log(`  ${String(k).padEnd(24)} ${v}`);
  console.log('\npre-parity rows per run_date:');
  const byDay = new Map<string,number>();
  for (const r of pre) { const d=String(r.run_date).slice(0,10); byDay.set(d,(byDay.get(d)??0)+1); }
  for (const d of [...byDay.keys()].sort()) console.log(`  ${d}  ${byDay.get(d)}`);
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
