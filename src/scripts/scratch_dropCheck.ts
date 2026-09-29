/** Did the contaminated sweep tables get dropped, and where is the DB now? READ-ONLY. */
import 'dotenv/config';
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  for (const t of ['synthetic_pot_sweep_trades_contaminated','synthetic_pot_sweep_results_contaminated',
                   'synthetic_pot_sweep_trades','synthetic_pot_sweep_results']){
    const { count, error } = await supabase.from(t).select('*',{count:'exact',head:true});
    console.log(`  ${t.padEnd(44)} ${error ? 'GONE / inaccessible ✓' : String(count ?? 0).padStart(9) + ' rows (still present)'}`);
  }
  const { count: inf } = await supabase.from('inference_results').select('*',{count:'exact',head:true});
  const { data: oldest } = await supabase.from('inference_results').select('run_date').order('run_date',{ascending:true}).limit(1);
  const floor = String((oldest as any)?.[0]?.run_date).slice(0,10);
  console.log(`\n  inference_results: ${inf} rows, floor ${floor} (${Math.round((Date.now()-Date.parse(floor))/86400000)}d)`);
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
