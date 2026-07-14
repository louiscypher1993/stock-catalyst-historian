import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

async function main() {
  const { data: rows, error } = await supabase
    .from('inference_results')
    .select('*')
    .gte('created_at', '2026-07-14T09:05:00Z')
    .lte('created_at', '2026-07-14T09:25:00Z')
    .order('created_at', { ascending: true });
  console.log(`inference_results rows in test-run window: ${rows?.length ?? 0}`);
  console.log(error);
  console.log(JSON.stringify(rows, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
