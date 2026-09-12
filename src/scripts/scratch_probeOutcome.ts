import 'dotenv/config';
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('outcome_results').select('*').eq('horizon','2W').limit(2);
  if (error) { console.error(error.message); process.exit(1); }
  console.log(Object.keys(data?.[0] ?? {}).join('\n'));
  console.log('\nsample:', JSON.stringify(data?.[0], null, 1).slice(0, 700));
  process.exit(0);
}
main();
