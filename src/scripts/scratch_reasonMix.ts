import 'dotenv/config';
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const rows:any[]=[];
  for(let f=0;;f+=1000){
    const {data,error}=await supabase.from('inference_results').select('unreliable_reason').gte('run_date','2026-08-20').range(f,f+999);
    if(error)throw error; rows.push(...(data??[])); if((data??[]).length<1000)break;
  }
  const m=new Map<string,number>();
  for(const r of rows) m.set(r.unreliable_reason ?? '(clean)',(m.get(r.unreliable_reason ?? '(clean)')??0)+1);
  for(const [k,v] of [...m.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(k).padEnd(26)} ${v}`);
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
