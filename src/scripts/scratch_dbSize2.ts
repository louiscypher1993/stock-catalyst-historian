/** Sizes for the FULL table list from migrations + code. READ-ONLY. */
import 'dotenv/config';
const TABLES = ['inference_results','macro_snapshots','outcome_results','pot_positions',
  'pot_snapshots','pot_trades','pots','shadow_benchmark_divergence','symbol_snapshots',
  'watchlist','watchlist_live_state'];
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const rows: Array<{t:string;n:number;mb:number;avg:number}> = [];
  for (const t of TABLES){
    const { count, error: ce } = await supabase.from(t).select('*',{count:'exact',head:true});
    if (ce) { console.log(`  ${t.padEnd(30)} absent/denied`); continue; }
    const { data } = await supabase.from(t).select('*').limit(300);
    const s = data ?? [];
    const avg = s.length ? Buffer.byteLength(JSON.stringify(s),'utf8')/s.length : 0;
    rows.push({t,n:count??0,mb:(avg*(count??0))/1048576,avg});
  }
  rows.sort((a,b)=>b.mb-a.mb);
  const total = rows.reduce((s,r)=>s+r.mb,0);
  for (const r of rows)
    console.log(`  ${r.t.padEnd(30)} ${String(r.n).padStart(8)} rows  ~${r.mb.toFixed(1).padStart(8)} MB  (${(100*r.mb/total).toFixed(0)}%)  avg ${Math.round(r.avg)}B`);
  console.log(`  ${'TOTAL'.padEnd(30)} ${' '.repeat(14)}~${total.toFixed(1)} MB`);
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
