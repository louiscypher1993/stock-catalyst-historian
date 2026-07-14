/**
 * F8 backfill preview (read-only): computes OLD vs NEW entry_price/
 * position_size_gbp/unrealised_pnl-or-realised_pnl/realised_return_pct for
 * the 14 affected INR positions, using the same convertToGBPIfHighNominal
 * function the live fix uses (point-in-time FX rate per position's actual
 * entry/exit/today date). shares are NEVER changed -- historical fact of
 * what quantity was held. Reports the preview only; does not write anything.
 */
import 'dotenv/config';
import { convertToGBPIfHighNominal } from '../../FREDService';

const TODAY = '2026-07-14';

async function main() {
  const fs = await import('fs');
  const positions = JSON.parse(fs.readFileSync(
    'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/f8_backfill_positions.json',
    'utf-8'
  ));

  const results: any[] = [];

  for (const p of positions) {
    const correctedEntryPrice = await convertToGBPIfHighNominal(p.symbol, p.entry_price, p.entry_date);
    const newPositionSizeGbp = parseFloat((p.shares * correctedEntryPrice).toFixed(2));

    if (p.status === 'open') {
      const correctedCurrentPrice = await convertToGBPIfHighNominal(p.symbol, p.current_price, TODAY);
      const ret = (correctedCurrentPrice - correctedEntryPrice) / correctedEntryPrice;
      const currentValue = newPositionSizeGbp * (1 + ret);
      const newUnrealisedPnl = parseFloat((currentValue - newPositionSizeGbp).toFixed(2));
      results.push({
        id: p.id, symbol: p.symbol, pot_id: p.pot_id, status: 'open',
        old_entry_price: p.entry_price, new_entry_price: parseFloat(correctedEntryPrice.toFixed(4)),
        old_position_size_gbp: p.position_size_gbp, new_position_size_gbp: newPositionSizeGbp,
        old_current_price: p.current_price, new_current_price: parseFloat(correctedCurrentPrice.toFixed(4)),
        old_unrealised_pnl: p.unrealised_pnl, new_unrealised_pnl: newUnrealisedPnl,
      });
    } else {
      const correctedExitPrice = await convertToGBPIfHighNominal(p.symbol, p.exit_price, p.exit_date);
      const returnSoFar = (correctedExitPrice - correctedEntryPrice) / correctedEntryPrice;
      const newRealisedPnl = parseFloat((returnSoFar * newPositionSizeGbp).toFixed(4));
      const newRealisedReturnPct = parseFloat(returnSoFar.toFixed(6));
      results.push({
        id: p.id, symbol: p.symbol, pot_id: p.pot_id, status: 'closed', exit_reason: p.exit_reason,
        old_entry_price: p.entry_price, new_entry_price: parseFloat(correctedEntryPrice.toFixed(4)),
        old_position_size_gbp: p.position_size_gbp, new_position_size_gbp: newPositionSizeGbp,
        old_exit_price: p.exit_price, new_exit_price: parseFloat(correctedExitPrice.toFixed(4)),
        old_realised_pnl: p.realised_pnl, new_realised_pnl: newRealisedPnl,
        old_realised_return_pct: p.realised_return_pct, new_realised_return_pct: newRealisedReturnPct,
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));

  fs.writeFileSync(
    'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/f8_backfill_preview.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\nWrote f8_backfill_preview.json');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
