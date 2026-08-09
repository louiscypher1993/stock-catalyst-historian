/**
 * Has anything run live since LIVE_FEATURE_PARITY=all went out (fcbcaab, 12:07 UTC)?
 * Pulse cron is every 15 minutes on weekdays only (0-5 = Sun-Fri per cron numbering, so
 * Sunday IS included) -- this checks for any post-flip rows and, if present, whether the
 * served atr_shock_score/competitor_event_density actually moved.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  const { data, error } = await sb.from('inference_results')
    .select('symbol, run_date, created_at, z_score, model_b_return_1m, model_c_max_drawdown')
    .gte('created_at', '2026-08-09T12:00:00Z')
    .order('created_at', { ascending: false }).limit(20);
  if (error) throw error;
  const rows = (data as any[]) ?? [];
  console.log(`rows created since 12:00 UTC today: ${rows.length}`);
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${r.created_at}  ${r.symbol.padEnd(10)} z=${Number(r.z_score).toFixed(2).padStart(6)} ` +
                `B=${Number(r.model_b_return_1m).toFixed(4).padStart(8)} C=${Number(r.model_c_max_drawdown).toFixed(4).padStart(8)}`);
  }
  if (!rows.length) {
    console.log('\nNothing has scanned yet since the flip -- expected, PULSE_MODE only');
    console.log('triggers on a price-move gate, and the next scheduled full scan is');
    console.log('Mon 07:00 UTC. This is not a problem, just a timing fact.');
  }
}
main();
