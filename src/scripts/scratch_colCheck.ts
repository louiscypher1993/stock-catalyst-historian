import 'dotenv/config';
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const a = await supabase.from('outcome_results').select('unreliable_reason').limit(1);
  const b = await supabase.from('pots').select('pot_id, name, universe').limit(3);
  console.log('outcome_results.unreliable_reason :', a.error ? 'MISSING — '+a.error.message.slice(0,50) : 'present ✓');
  console.log('pots.universe                    :', b.error ? 'MISSING — '+b.error.message.slice(0,50) : 'present ✓ e.g. ' + JSON.stringify(b.data?.[0]));
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
