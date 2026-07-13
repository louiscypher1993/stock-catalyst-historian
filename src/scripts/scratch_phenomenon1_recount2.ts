import 'dotenv/config';
import fs from 'fs';
import { GLOBAL_MARKETS } from '../marketsData';
import { supabase } from '../db/supabaseClient';

async function main() {
  const universe = new Set<string>();
  for (const market of GLOBAL_MARKETS) {
    for (const stock of market.stocks) universe.add(stock.symbol.toUpperCase());
  }

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

  const zeroSnapshotSymbols = new Set([...universe].filter(s => !covered.has(s)));

  const scratchPath = 'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/newly_added_symbols.json';
  const newlyAddedBy280b911: string[] = JSON.parse(fs.readFileSync(scratchPath, 'utf-8'));
  const newlyAddedSet = new Set(newlyAddedBy280b911.map(s => s.toUpperCase()));

  const zeroCovAndNew = [...zeroSnapshotSymbols].filter(s => newlyAddedSet.has(s));
  const zeroCovAndOld = [...zeroSnapshotSymbols].filter(s => !newlyAddedSet.has(s));

  console.log(`Total zero-coverage: ${zeroSnapshotSymbols.size}`);
  console.log(`  Of which, added by 280b911 (2026-06-19, AFTER the 06-13 migration -- structurally could never be covered): ${zeroCovAndNew.length}`);
  console.log(`  Of which, already in universe BEFORE 280b911 (existed at migration time, still zero coverage -- genuinely never anomaly-flagged in backfill): ${zeroCovAndOld.length}`);
  console.log(`\nSample of "old but still zero-coverage" symbols (first 40):`);
  console.log(zeroCovAndOld.slice(0, 40).join(', '));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
