import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  const { data, count, error } = await sb.from('inference_results')
    .select('symbol', { count: 'exact', head: false })
    .gte('run_date', '2026-07-19').lte('run_date', '2026-08-09');
  if (error) throw error;
  console.log('exact count in a 21-day window:', count, '| rows returned without .range():', (data as any[]).length);
}
main();
