import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

async function main() {
  const { data: openPositions } = await supabase
    .from('pot_positions')
    .select('pot_id, symbol')
    .eq('status', 'open')
    .order('pot_id');
  console.log(`Total open positions: ${openPositions?.length ?? 0}`);
  const byPot: Record<number, number> = {};
  for (const p of openPositions ?? []) byPot[p.pot_id] = (byPot[p.pot_id] ?? 0) + 1;
  console.log('Per-pot open count:', byPot);
}
main().catch(e => { console.error(e); process.exit(1); });
