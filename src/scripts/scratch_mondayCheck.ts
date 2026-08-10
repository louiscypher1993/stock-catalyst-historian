/**
 * First post-parity live rows, per symbol rather than as a median.
 *
 * LIVE_FEATURE_PARITY=all went live 2026-08-09 12:07 UTC. Sunday's rows straddle that
 * (pulse runs every 15 min), so 2026-08-10 is the first clean cohort. n is small at the
 * 07:00 UTC scan — US has not opened — so this prints every row rather than a median that
 * would imply more precision than 4 observations support.
 *
 * Offline prediction to check against (src/ml/scratch_parity_score.py, mode=all):
 *   B +0.1173   C -0.0635   D3 +0.0051   D5 +0.0264
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  const { data, error } = await sb.from('inference_results')
    .select('symbol, run_date, created_at, z_score, excess_return, sector, model_b_return_1m, model_c_max_drawdown, model_d3_return_2d, model_d5_return_2w, risk_score, recommendation')
    .gte('run_date', '2026-08-09').order('created_at', { ascending: true });
  if (error) throw error;
  const rows = (data as any[]) ?? [];
  console.log(`rows since 2026-08-09: ${rows.length}   (parity enabled 2026-08-09 12:07 UTC)\n`);
  console.log(`${'created_at (UTC)'.padEnd(21)}${'symbol'.padEnd(12)}${'z'.padStart(8)}${'B'.padStart(9)}${'C'.padStart(9)}${'D3'.padStart(9)}${'D5'.padStart(9)}${'risk'.padStart(6)}  parity`);
  console.log('-'.repeat(96));
  for (const r of rows) {
    const t = String(r.created_at).replace('T', ' ').slice(0, 19);
    const post = String(r.created_at) >= '2026-08-09T12:07';
    console.log(`${t.padEnd(21)}${String(r.symbol).padEnd(12)}` +
      `${Number(r.z_score).toFixed(2).padStart(8)}` +
      `${Number(r.model_b_return_1m).toFixed(4).padStart(9)}` +
      `${Number(r.model_c_max_drawdown).toFixed(4).padStart(9)}` +
      `${Number(r.model_d3_return_2d).toFixed(4).padStart(9)}` +
      `${Number(r.model_d5_return_2w).toFixed(4).padStart(9)}` +
      `${String(r.risk_score ?? '—').padStart(6)}  ${post ? 'POST' : 'pre'}`);
  }
  const post = rows.filter(r => String(r.created_at) >= '2026-08-09T12:07');
  const atClamp = post.filter(r => Math.abs(Number(r.model_b_return_1m)) >= 0.2999).length;
  console.log(`\npost-parity rows: ${post.length}   B still at the +0.30 clamp: ${atClamp}` +
              `  (every day 2026-07-27..08-07 had B pinned at exactly 0.3000)`);
}
main();
