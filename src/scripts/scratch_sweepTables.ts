/** Do the synthetic-sweep tables actually hold rows? pg_stat_user_tables says 0 live
 *  tuples, but last_autovacuum is null for all of them — so those are uncollected
 *  STATISTICS, not necessarily empty tables. symbol_snapshots shows 0 there and really
 *  has 1,112 rows, which already proves the stats are stale. READ-ONLY. */
import 'dotenv/config';
const T = ['synthetic_pot_sweep_trades_contaminated','synthetic_pot_sweep_trades',
           'synthetic_pot_sweep_results','synthetic_pot_sweep_results_contaminated',
           'symbol_snapshots','sec_13f_holdings','daily_prices_cache'];
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  for (const t of T){
    const { count, error } = await supabase.from(t).select('*',{count:'exact',head:true});
    if (error) { console.log(`  ${t.padEnd(42)} DENIED/ABSENT (${error.message.slice(0,45)})`); continue; }
    const { data } = await supabase.from(t).select('*').limit(1);
    const cols = data?.[0] ? Object.keys(data[0]).length : 0;
    console.log(`  ${t.padEnd(42)} ${String(count ?? 0).padStart(9)} rows, ${cols} cols`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
