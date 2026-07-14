import 'dotenv/config';

const TODAY = '2026-07-14';

const CLOSES = [
  { id: 4,  pot_id: 7,  symbol: 'BAJFINANCE.NS', entry_price: 918.3,  shares: 2.17794,  position_size_gbp: 2000,    exit_price: 1006.5999755859375 },
  { id: 5,  pot_id: 7,  symbol: 'BPCL.NS',       entry_price: 302.35, shares: 6.61485,  position_size_gbp: 2000,    exit_price: 305.3500061035156 },
  { id: 6,  pot_id: 7,  symbol: 'LT.NS',         entry_price: 4049.3, shares: 0.493913, position_size_gbp: 2000,    exit_price: 3848.699951171875 },
  { id: 7,  pot_id: 7,  symbol: '500510.BO',     entry_price: 4050.2, shares: 0.493803, position_size_gbp: 2000,    exit_price: 3946.550048828125 },
  { id: 13, pot_id: 15, symbol: 'BAJFINANCE.NS', entry_price: 918.3,  shares: 1.08897,  position_size_gbp: 1000,    exit_price: 1006.5999755859375 },
  { id: 14, pot_id: 15, symbol: '500510.BO',     entry_price: 4050.2, shares: 0.246901, position_size_gbp: 1000,    exit_price: 3946.550048828125 },
  { id: 15, pot_id: 17, symbol: 'BAJFINANCE.NS', entry_price: 918.3,  shares: 3.6299,   position_size_gbp: 3333.33, exit_price: 1006.5999755859375 },
  { id: 16, pot_id: 17, symbol: '500510.BO',     entry_price: 4050.2, shares: 0.823005, position_size_gbp: 3333.33, exit_price: 3946.550048828125 },
  { id: 21, pot_id: 15, symbol: 'HDFCLIFE.NS',   entry_price: 581.2,  shares: 1,        position_size_gbp: 581.2,   exit_price: 555.2000122070312 },
  { id: 22, pot_id: 15, symbol: 'QAN.AX',        entry_price: 9.94,   shares: 100,      position_size_gbp: 994,     exit_price: 10.25 },
  { id: 23, pot_id: 15, symbol: 'EVN.AX',        entry_price: 12.93,  shares: 77,       position_size_gbp: 995.61,  exit_price: 11.779999732971191 },
  { id: 24, pot_id: 15, symbol: 'AKRBP.OL',      entry_price: 319.5,  shares: 3,        position_size_gbp: 958.5,   exit_price: 324.3999938964844 },
  { id: 30, pot_id: 15, symbol: 'TTE',           entry_price: 84.36,  shares: 11,       position_size_gbp: 927.96,  exit_price: 81.3499984741211 },
  { id: 33, pot_id: 15, symbol: 'CVX',           entry_price: 180.4,  shares: 5,        position_size_gbp: 902,     exit_price: 181.02999877929688 },
];

async function main() {
  const { supabase } = await import('../db/supabaseClient');

  const results: any[] = [];
  for (const pos of CLOSES) {
    const returnPct = (pos.exit_price / pos.entry_price) - 1;
    const positionSizeGbp = pos.position_size_gbp; // actual stored value, matching closePosition()'s convention
    const realisedPnl = returnPct * positionSizeGbp;

    const { error: updateErr } = await supabase
      .from('pot_positions')
      .update({
        status: 'closed',
        exit_date: TODAY,
        exit_price: pos.exit_price,
        realised_pnl: parseFloat(realisedPnl.toFixed(4)),
        realised_return_pct: parseFloat(returnPct.toFixed(6)),
        exit_reason: 'manual_correction',
      })
      .eq('id', pos.id);

    const { error: tradeErr } = await supabase.from('pot_trades').insert({
      pot_id: pos.pot_id,
      symbol: pos.symbol,
      action: 'SELL',
      price: pos.exit_price,
      shares: pos.shares,
      position_size_gbp: parseFloat(positionSizeGbp.toFixed(2)),
      reason: 'manual_correction',
      run_date: new Date().toISOString(),
    });

    results.push({ id: pos.id, symbol: pos.symbol, pot_id: pos.pot_id, realisedPnl: parseFloat(realisedPnl.toFixed(4)), updateErr: updateErr?.message, tradeErr: tradeErr?.message });
    console.log(`#${pos.id} ${pos.symbol} pot${pos.pot_id}: realisedPnl=£${realisedPnl.toFixed(2)} updateErr=${updateErr?.message ?? 'none'} tradeErr=${tradeErr?.message ?? 'none'}`);
  }

  const totalPnl = results.reduce((s, r) => s + r.realisedPnl, 0);
  console.log(`\nTotal realised P&L: £${totalPnl.toFixed(2)}`);

  const fs = await import('fs');
  fs.writeFileSync('C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/close_results.json', JSON.stringify(results, null, 2));
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
