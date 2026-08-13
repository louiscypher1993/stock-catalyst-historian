import 'dotenv/config';
async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data: pots } = await supabase.from('pots').select('pot_id,name,patience,ambition,boldness,focus').in('pot_id',[33,34,29,44]);
  for (const p of pots ?? []) console.log(`pot ${p.pot_id} ${p.name}: pat=${p.patience} amb=${p.ambition} bold=${p.boldness} focus=${p.focus}`);
  const { data: t } = await supabase.from('pot_trades').select('pot_id,symbol,action,reason,run_date').gte('run_date','2026-08-11').eq('action','BUY');
  const c: Record<string,number> = {};
  for (const x of t ?? []) c[x.reason ?? 'null'] = (c[x.reason ?? 'null'] ?? 0) + 1;
  console.log('\nBUY trades since 08-11, by logged `reason`:', c);
  const { data: pos } = await supabase.from('pot_positions').select('pot_id,symbol,patience_horizon,entry_date').eq('pot_id',33).eq('symbol','COR');
  console.log('pot33 COR position:', pos);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
