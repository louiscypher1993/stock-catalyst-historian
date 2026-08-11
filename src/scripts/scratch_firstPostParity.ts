import 'dotenv/config';

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('inference_results')
    .select('symbol, run_date, created_at, unreliable_reason')
    .eq('unreliable_reason', 'null_enrichment')
    .gte('run_date', '2026-08-09')
    .order('created_at', { ascending: true })
    .limit(8);
  if (error) throw error;
  console.log('rows found:', (data ?? []).length);
  for (const r of data ?? []) console.log(r.created_at, r.run_date, r.symbol);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
