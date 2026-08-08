/**
 * What does inference_results actually store, and which of those columns are MODEL INPUTS?
 *
 * The live-vs-fold output gap (498784f) has to originate in the inputs. Rather than guess
 * at which suspect is responsible, this lists the columns available live so the input
 * distributions can be compared directly against features.csv, feature by feature.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  const { data, error } = await sb.from('inference_results').select('*')
    .gte('run_date', '2026-08-01').limit(1);
  if (error) throw error;
  const row = (data as any[])[0];
  const cols = Object.keys(row).sort();
  console.log(`inference_results: ${cols.length} columns\n`);
  console.log(cols.join('\n'));
}
main();
