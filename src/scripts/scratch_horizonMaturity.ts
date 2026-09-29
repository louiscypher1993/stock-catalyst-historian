/** Can 3M/6M outcomes ever mature under a 40-day source retention? READ-ONLY. */
import 'dotenv/config';
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const rows:any[]=[];
  for(let f=0;;f+=1000){
    const {data,error}=await supabase.from('outcome_results').select('horizon, run_date').range(f,f+999);
    if(error)throw error; rows.push(...(data??[])); if((data??[]).length<1000)break;
  }
  const by=new Map<string,{n:number;min:string;max:string}>();
  for(const r of rows){
    const d=String(r.run_date).slice(0,10);
    const e=by.get(r.horizon)??{n:0,min:d,max:d};
    e.n++; if(d<e.min)e.min=d; if(d>e.max)e.max=d; by.set(r.horizon,e);
  }
  console.log('outcome_results horizons present:');
  for(const [h,e] of [...by.entries()].sort()) console.log(`  ${h.padEnd(4)} n=${String(e.n).padStart(6)}  run_dates ${e.min} .. ${e.max}`);
  for(const h of ['3M','6M','12M']) if(!by.has(h)) console.log(`  ${h.padEnd(4)} ABSENT`);
  const { count } = await supabase.from('inference_results').select('*',{count:'exact',head:true});
  const oldest = await supabase.from('inference_results').select('run_date').order('run_date',{ascending:true}).limit(1);
  const floor = String((oldest.data as any)?.[0]?.run_date).slice(0,10);
  const ageDays = Math.round((Date.now()-Date.parse(floor))/86400000);
  console.log(`\ninference_results: ${count} rows, oldest run_date ${floor} (${ageDays} days old)`);
  console.log(`  horizon needs source row to survive: 2D=2d 2W=14d 1M=30d 3M=91d 6M=182d`);
  console.log(`  => at a ${ageDays}-day floor, 3M and 6M source rows are deleted ${91-ageDays}d and ${182-ageDays}d before maturity.`);
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
