import 'dotenv/config';
async function main(){
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('inference_results').select('*').limit(1);
  if (error) { console.error(error.message); process.exit(1); }
  console.log(Object.keys(data?.[0] ?? {}).join('\n'));
  process.exit(0);
}
main();
