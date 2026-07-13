import 'dotenv/config';
import { GLOBAL_MARKETS } from '../marketsData';
import { supabase } from '../db/supabaseClient';

async function main() {
  const universe = new Set<string>();
  for (const market of GLOBAL_MARKETS) {
    for (const stock of market.stocks) universe.add(stock.symbol.toUpperCase());
  }
  console.log(`Total live-scanned universe: ${universe.size} distinct symbols`);

  // Fetch ALL symbol_snapshots symbols (paginate if needed)
  let covered = new Set<string>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase.from('symbol_snapshots').select('symbol').range(from, from + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const row of data) covered.add(row.symbol.toUpperCase());
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`symbol_snapshots covered symbols: ${covered.size}`);

  const zeroSnapshotSymbols = [...universe].filter(s => !covered.has(s));
  console.log(`\nSymbols in universe with ZERO symbol_snapshots coverage: ${zeroSnapshotSymbols.length}`);
  console.log(zeroSnapshotSymbols.slice(0, 60).join(', '));
  if (zeroSnapshotSymbols.length > 60) console.log(`... and ${zeroSnapshotSymbols.length - 60} more`);

  // Confirm the original named examples still have zero coverage
  const originalExamples = ['GFC.PA', 'XBI', 'BBAR', 'SNP.RO', 'MOH.AT', 'PKO.WA'];
  console.log('\n=== Original named examples, still zero-coverage? ===');
  for (const sym of originalExamples) {
    console.log(`  ${sym}: in universe=${universe.has(sym)}  covered=${covered.has(sym)}  ZERO-COVERAGE=${!covered.has(sym)}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
