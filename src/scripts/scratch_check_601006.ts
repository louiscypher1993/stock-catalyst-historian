import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

async function main() {
  const { data: infRow } = await supabase
    .from('inference_results')
    .select('*')
    .eq('symbol', '601006.SS')
    .gte('created_at', '2026-07-14T00:00:00Z')
    .order('created_at', { ascending: false })
    .limit(3);
  console.log('=== 601006.SS inference_results (today) ===');
  console.log(JSON.stringify(infRow, null, 2));

  const { data: pos } = await supabase
    .from('pot_positions')
    .select('*')
    .eq('symbol', '601006.SS')
    .eq('pot_id', 2);
  console.log('\n=== pot_positions for 601006.SS, pot 2 ===');
  console.log(JSON.stringify(pos, null, 2));

  const { data: pot2 } = await supabase.from('pots').select('*').eq('pot_id', 2).single();
  console.log('\n=== Pot 2 config ===');
  console.log(JSON.stringify(pot2, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
