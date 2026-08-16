import 'dotenv/config';
import { roundTripCost } from '../costModel';
async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data } = await supabase.from('pot_positions')
    .select('pot_id, symbol, position_size_gbp, realised_return_pct')
    .eq('status','closed').order('position_size_gbp', { ascending: true }).limit(6);
  for (const p of data ?? []) {
    const c = roundTripCost(p.symbol, Number(p.position_size_gbp));
    console.log(`pot ${String(p.pot_id).padStart(2)} ${String(p.symbol).padEnd(10)} size GBP ${Number(p.position_size_gbp).toFixed(2).padStart(8)}  cost GBP ${c.totalGBP.toFixed(2)}  = ${(100*c.totalGBP/Number(p.position_size_gbp)).toFixed(1)}%`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
