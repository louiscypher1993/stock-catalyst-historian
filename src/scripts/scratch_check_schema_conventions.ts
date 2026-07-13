import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

async function main() {
  const { data: cols, error: colErr } = await supabase
    .from('inference_results')
    .select('*')
    .limit(1);
  console.log('inference_results sample row keys:', cols && cols[0] ? Object.keys(cols[0]) : cols, colErr);
}
main().catch(e => { console.error(e); process.exit(1); });
