/**
 * verifyShadowTable.ts — prove the shadow-divergence table is actually writable
 * BEFORE turning LIVE_BENCHMARK_MODE=shadow on.
 *
 * WHY THIS EXISTS. The recorded failure mode on this project is a Supabase write that
 * fails while the run stays green — new fields need a matching ALTER TABLE or the write
 * silently does nothing. If that happened here, shadow mode would look like it was
 * working for weeks and produce no evidence at all. So this does a real round trip:
 * insert a clearly-marked probe row with the SAME key shape and column set the live
 * service uses, read it back, compare it, then delete it.
 *
 * It deliberately uses SUPABASE_ANON_KEY by default, because that is the key
 * live-inference.yml actually passes — verifying with the service-role key would prove
 * the wrong thing (service role bypasses RLS; anon does not).
 *
 * Usage:
 *   npx tsx src/scripts/verifyShadowTable.ts
 *   npx tsx src/scripts/verifyShadowTable.ts --service   # compare the two key postures
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const PROBE_SYMBOL = '__VERIFY_PROBE__';
const PROBE_DATE = '1970-01-01';

async function main() {
  const useService = process.argv.includes('--service');
  const url = process.env.SUPABASE_URL;
  const key = useService
    ? process.env.SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error(`missing SUPABASE_URL or ${useService ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY'}`);
    process.exit(1);
  }
  console.log(`verifying with the ${useService ? 'SERVICE-ROLE' : 'ANON'} key ` +
              `(live-inference.yml passes ANON — that is the one that must work)\n`);
  const db = createClient(url, key);

  // 1. does the table exist / is it readable
  const read = await db.from('shadow_benchmark_divergence').select('run_date').limit(1);
  if (read.error) {
    console.error(`FAIL — cannot read table (${read.error.code ?? '?'}): ${read.error.message}`);
    if (read.error.code === 'PGRST205') {
      console.error('\nThe table does not exist yet. Run the shadow_benchmark_divergence');
      console.error('block at the end of src/db/supabase_migration.sql in the Supabase');
      console.error('SQL editor, then re-run this script.');
    }
    process.exit(1);
  }
  console.log('PASS  table exists and is readable');

  // 2. write a probe row using exactly the shape the live service upserts
  const row = {
    run_date: PROBE_DATE,
    run_slot: 'verify',
    symbol: PROBE_SYMBOL,
    benchmark: '^AXJO',
    bar_date: PROBE_DATE,
    z_spy: 1.234,
    z_native: 2.345,
    detected_spy: false,
    detected_native: true,
    close: 42.5,
  };
  const ins = await db.from('shadow_benchmark_divergence')
    .upsert([row], { onConflict: 'run_date,run_slot,symbol' });
  if (ins.error) {
    console.error(`FAIL — insert rejected (${ins.error.code ?? '?'}): ${ins.error.message}`);
    console.error('\nMost likely RLS is enabled with no insert policy for this key.');
    console.error('The anon key must be able to insert here exactly as it can for');
    console.error('inference_results, or shadow mode will log to console only.');
    process.exit(1);
  }
  console.log('PASS  insert accepted');

  // 3. read it back — an accepted insert that stores nothing is the silent failure
  const back = await db.from('shadow_benchmark_divergence')
    .select('*').eq('symbol', PROBE_SYMBOL).eq('run_date', PROBE_DATE);
  if (back.error || !back.data?.length) {
    console.error('FAIL — insert reported success but the row is NOT retrievable.');
    console.error('This is exactly the silent-failure mode this script exists to catch.');
    process.exit(1);
  }
  const got = back.data[0] as any;
  const mismatches = Object.entries(row).filter(([k, v]) =>
    typeof v === 'number' ? Math.abs((got[k] ?? NaN) - v) > 1e-6 : got[k] !== v);
  if (mismatches.length) {
    console.error('FAIL — round-tripped values differ:', mismatches);
    process.exit(1);
  }
  console.log('PASS  row read back with identical values');

  // 4. clean up
  const del = await db.from('shadow_benchmark_divergence')
    .delete().eq('symbol', PROBE_SYMBOL).eq('run_date', PROBE_DATE);
  console.log(del.error
    ? `WARN  probe row left behind (${del.error.message}); delete symbol='${PROBE_SYMBOL}' by hand`
    : 'PASS  probe row cleaned up');

  console.log('\nAll checks passed — safe to set LIVE_BENCHMARK_MODE=shadow.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
