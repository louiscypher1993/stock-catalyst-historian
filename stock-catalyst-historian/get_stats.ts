import { GLOBAL_MARKETS } from './src/marketsData';

GLOBAL_MARKETS.forEach(m => {
  console.log(`=== ${m.name} ===`);
  const syms = m.stocks.map(s => `${s.symbol} (${s.companyName})`);
  console.log(syms.join(', '));
  console.log();
});
