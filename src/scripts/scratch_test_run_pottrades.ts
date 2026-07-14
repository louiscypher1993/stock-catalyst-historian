import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

async function main() {
  const { data: trades } = await supabase
    .from('pot_trades')
    .select('*')
    .gte('created_at', '2026-07-14T09:05:00Z')
    .lte('created_at', '2026-07-14T09:25:00Z')
    .order('created_at', { ascending: true });
  console.log(`=== pot_trades in test-run window: ${trades?.length ?? 0} ===`);
  console.log(JSON.stringify(trades, null, 2));

  const { data: snapshots } = await supabase
    .from('pot_snapshots')
    .select('*')
    .gte('run_date', '2026-07-14T00:00:00Z')
    .order('pot_id');
  console.log(`\n=== pot_snapshots written today: ${snapshots?.length ?? 0} ===`);
  console.log(JSON.stringify((snapshots ?? []).map(s => ({pot_id: s.pot_id, run_date: s.run_date, open: s.open_positions_count})), null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
