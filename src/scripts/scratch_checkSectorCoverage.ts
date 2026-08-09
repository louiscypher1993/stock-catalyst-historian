/**
 * How often is `sector` populated in inference_results (what competitorDensityFrom keys
 * on)? A high null rate would mean the new competitor-density fix silently under-counts.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  const { data, error } = await sb.from('inference_results')
    .select('sector, run_date').gte('run_date', '2026-07-15').limit(5000);
  if (error) throw error;
  const rows = (data as any[]) ?? [];
  const withSector = rows.filter(r => r.sector).length;
  console.log(`rows: ${rows.length}, with sector: ${withSector} (${(100 * withSector / rows.length).toFixed(1)}%)`);
  const bySector = new Map<string, number>();
  for (const r of rows) {
    if (!r.sector) continue;
    bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + 1);
  }
  console.log('\ntop sectors:');
  for (const [s, n] of [...bySector].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${s.padEnd(28)} ${n}`);
  }
}
main();
