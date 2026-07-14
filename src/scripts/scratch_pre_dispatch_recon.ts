import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

async function main() {
  const { data: pots } = await supabase.from('pots').select('*').order('pot_id');
  console.log('=== Pots ===');
  console.log(JSON.stringify(pots, null, 2));

  const { data: openPositions } = await supabase
    .from('pot_positions')
    .select('pot_id, symbol, direction, entry_date, status')
    .eq('status', 'open')
    .order('pot_id');
  console.log(`\n=== Open positions: ${openPositions?.length ?? 0} total ===`);
  const byPot: Record<number, number> = {};
  for (const p of openPositions ?? []) byPot[p.pot_id] = (byPot[p.pot_id] ?? 0) + 1;
  console.log('Per-pot open count:', byPot);
  console.log('Symbols:', [...new Set((openPositions ?? []).map(p => p.symbol))].sort().join(', '));
}
main().catch(e => { console.error(e); process.exit(1); });
