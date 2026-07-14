import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

async function main() {
  const { data, error } = await supabase.from('inference_results').select('*').limit(1);
  console.log('Columns:', data && data[0] ? Object.keys(data[0]) : data, error);
  console.log('\nHas recommendation_basis column:', data && data[0] ? 'recommendation_basis' in data[0] : 'unknown');
}
main().catch(e => { console.error(e); process.exit(1); });
