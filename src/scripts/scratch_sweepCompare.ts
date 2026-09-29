/** Is the LOCAL contaminated sweep really a superset of the Supabase copy? READ-ONLY.
 *  A destructive drop needs more than matching row counts. */
import 'dotenv/config';
import Database from 'better-sqlite3';
async function main(){
  const db = new Database('synthetic_pots/contaminated_sweep.db',{readonly:true,fileMustExist:true});
  const lc = db.prepare(`SELECT * FROM trades_contaminated LIMIT 2`).all() as any[];
  const lr = db.prepare(`SELECT * FROM results_contaminated LIMIT 2`).all() as any[];
  console.log('LOCAL trades_contaminated cols :', Object.keys(lc[0]??{}).join(', '));
  console.log('LOCAL results_contaminated cols:', Object.keys(lr[0]??{}).join(', '));
  const lp = db.prepare(`SELECT MIN(synthetic_pot_id) a, MAX(synthetic_pot_id) b, COUNT(DISTINCT synthetic_pot_id) n FROM trades_contaminated`).get() as any;
  console.log(`LOCAL trades synthetic_pot_id range ${lp.a}..${lp.b}, ${lp.n} distinct pots`);

  const { supabase } = await import('../db/supabaseClient');
  const { data: sc } = await supabase.from('synthetic_pot_sweep_trades_contaminated').select('*').limit(2);
  const { data: sr } = await supabase.from('synthetic_pot_sweep_results_contaminated').select('*').limit(2);
  console.log('\nSUPA  trades_contaminated cols :', Object.keys(sc?.[0]??{}).join(', '));
  console.log('SUPA  results_contaminated cols:', Object.keys(sr?.[0]??{}).join(', '));

  // Spot-check: do Supabase synthetic_pot_ids exist locally, with >= as many trades?
  const { data: pots } = await supabase.from('synthetic_pot_sweep_trades_contaminated')
    .select('synthetic_pot_id').limit(500);
  const ids = [...new Set((pots??[]).map((r:any)=>r.synthetic_pot_id))].slice(0,5);
  console.log('\nspot-check 5 synthetic_pot_ids seen in Supabase:');
  for (const id of ids){
    const { count } = await supabase.from('synthetic_pot_sweep_trades_contaminated')
      .select('*',{count:'exact',head:true}).eq('synthetic_pot_id',id);
    const loc = db.prepare(`SELECT COUNT(*) n FROM trades_contaminated WHERE synthetic_pot_id=?`).get(id) as {n:number};
    const ok = loc.n >= (count??0);
    console.log(`  synthetic_pot_id ${String(id).padStart(6)}  supabase ${String(count).padStart(5)}  local ${String(loc.n).padStart(6)}  ${ok?'local >= supabase ✓':'*** LOCAL HAS FEWER ***'}`);
  }
  db.close(); process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
