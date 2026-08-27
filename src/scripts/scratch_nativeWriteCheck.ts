/** Did the LIVE path write the rank itself, or did the backfill do all of it? */
import 'dotenv/config';
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('inference_results')
    .select('symbol, run_date, created_at, model_c_percentile_rank, model_c_version')
    .not('model_c_percentile_rank','is',null)
    .order('created_at',{ascending:false}).limit(8);
  if (error) { console.error(error.message); process.exit(1); }
  console.log('most recently CREATED rows carrying a rank:');
  for (const r of data ?? [])
    console.log(`  ${String(r.symbol).padEnd(12)} run ${String(r.run_date).slice(0,10)}  created ${r.created_at}  rank ${Number(r.model_c_percentile_rank).toFixed(4)}  v${r.model_c_version}`);
  console.log('\nRows created AFTER the migration was applied can only have been written by');
  console.log('live inference — the backfill never inserts, it only updates existing rows.');
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
