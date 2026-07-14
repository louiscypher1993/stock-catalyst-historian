/**
 * F8 backfill execution: writes the ALREADY-PREVIEWED (f8_backfill_preview.json)
 * new_* values directly to pot_positions for the 14 affected rows. No FX
 * refetching, no recomputation -- purely persists what was already reviewed
 * and approved. shares is never touched.
 */
import 'dotenv/config';

async function main() {
  const fs = await import('fs');
  const preview = JSON.parse(fs.readFileSync(
    'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/f8_backfill_preview.json',
    'utf-8'
  ));

  const { supabase } = await import('../db/supabaseClient');

  const results: any[] = [];
  for (const row of preview) {
    const update: any = {
      entry_price: row.new_entry_price,
      position_size_gbp: row.new_position_size_gbp,
    };
    if (row.status === 'open') {
      update.current_price = row.new_current_price;
      update.unrealised_pnl = row.new_unrealised_pnl;
    } else {
      update.exit_price = row.new_exit_price;
      update.realised_pnl = row.new_realised_pnl;
      update.realised_return_pct = row.new_realised_return_pct;
    }

    const { error } = await supabase.from('pot_positions').update(update).eq('id', row.id);
    results.push({ id: row.id, symbol: row.symbol, error: error?.message ?? null });
    console.log(`#${row.id} ${row.symbol}: ${error ? 'ERROR ' + error.message : 'OK'}`);
  }

  const errors = results.filter(r => r.error);
  console.log(`\n${results.length - errors.length}/${results.length} rows updated successfully.`);
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors, null, 2));
  process.exit(errors.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
