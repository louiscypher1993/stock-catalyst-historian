import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

async function main() {
  const { data: rows } = await supabase
    .from('inference_results')
    .select('*')
    .gte('created_at', '2026-07-14T09:05:00Z')
    .lte('created_at', '2026-07-14T09:25:00Z')
    .order('created_at', { ascending: true });

  console.log(`=== Total rows: ${rows?.length ?? 0} ===\n`);

  console.log('=== ALL symbols scanned, with key fields ===');
  for (const r of rows ?? []) {
    console.log(`${r.symbol.padEnd(12)} rec=${(r.recommendation ?? '').padEnd(10)} risk=${r.risk_score}  D3=${r.model_d3_return_2d}  D5=${r.model_d5_return_2w}  B=${r.model_b_return_1m}  D1=${r.model_d1_return_3m}  D2=${r.model_d2_return_6m}  D4=${r.model_d4_return_3d}  unreliable_reason=${r.unreliable_reason}`);
  }

  const flagged = (rows ?? []).filter(r => r.unreliable_reason !== null);
  console.log(`\n=== FLAGGED rows (unreliable_reason set): ${flagged.length} ===`);
  for (const r of flagged) {
    console.log(`${r.symbol}: reason=${r.unreliable_reason}  rec=${r.recommendation}  D3=${r.model_d3_return_2d} D5=${r.model_d5_return_2w} B=${r.model_b_return_1m} D1=${r.model_d1_return_3m} D2=${r.model_d2_return_6m} D4=${r.model_d4_return_3d}  z_score=${r.z_score}`);
  }

  console.log('\n=== GFC.PA / PKO.WA specifically ===');
  for (const sym of ['GFC.PA', 'PKO.WA']) {
    const row = (rows ?? []).find(r => r.symbol === sym);
    console.log(`${sym}: ${row ? JSON.stringify({ unreliable_reason: row.unreliable_reason, recommendation: row.recommendation, z_score: row.z_score, D3: row.model_d3_return_2d, D5: row.model_d5_return_2w }) : 'NOT in this run'}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
