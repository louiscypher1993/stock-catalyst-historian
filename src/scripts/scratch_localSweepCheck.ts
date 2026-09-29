/** Do the LOCAL sqlite sweep DBs already hold what Supabase holds? READ-ONLY. */
import Database from 'better-sqlite3';
import { existsSync, statSync } from 'fs';
const FILES = ['synthetic_pots/v10_history_sweep.db','synthetic_pots/contaminated_sweep.db'];
for (const f of FILES){
  console.log(`\n=== ${f} ${existsSync(f)?`(${(statSync(f).size/1048576).toFixed(0)} MB)`:'MISSING'} ===`);
  if (!existsSync(f)) continue;
  const db = new Database(f, { readonly: true, fileMustExist: true });
  const tabs = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as Array<{name:string}>;
  for (const t of tabs){
    const c = db.prepare(`SELECT COUNT(*) n FROM "${t.name}"`).get() as {n:number};
    console.log(`  ${t.name.padEnd(42)} ${String(c.n).padStart(9)} rows`);
  }
  db.close();
}
console.log('\nSupabase for comparison:');
console.log('  synthetic_pot_sweep_trades                 1902208');
console.log('  synthetic_pot_sweep_trades_contaminated    3825000');
console.log('  synthetic_pot_sweep_results                   40000');
console.log('  synthetic_pot_sweep_results_contaminated      10000');
