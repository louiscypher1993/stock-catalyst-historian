/**
 * Is event_features stopping at 2026-06-18 a WRITER failure or forward-label MATURITY
 * gating? Decisive test: if rows are only written once labels exist, recent months would
 * carry no NULL long-horizon labels. If NULLs are present, the table accepts immature
 * rows and the stop is the writer.
 */
import Database from 'better-sqlite3';
const d = new Database('market_cache.db', { readonly: true, fileMustExist: true });
const rows = d.prepare(`
  SELECT substr(date,1,7) m, COUNT(*) n,
         SUM(CASE WHEN forward_return_2w  IS NULL THEN 1 ELSE 0 END) n2w,
         SUM(CASE WHEN forward_return_3m  IS NULL THEN 1 ELSE 0 END) n3m,
         SUM(CASE WHEN forward_return_12m IS NULL THEN 1 ELSE 0 END) n12m,
         SUM(CASE WHEN signal_snapshot_json IS NULL THEN 1 ELSE 0 END) nosnap
  FROM event_features WHERE date >= '2025-06-01' GROUP BY m ORDER BY m`).all() as any[];
console.log('month     rows   null2W   null3M  null12M  noSnapshot');
for (const r of rows)
  console.log(`${r.m}  ${String(r.n).padStart(5)}  ${String(r.n2w).padStart(6)}  ${String(r.n3m).padStart(7)}  ${String(r.n12m).padStart(7)}  ${String(r.nosnap).padStart(10)}`);
const last = d.prepare(`SELECT date, COUNT(*) n FROM event_features WHERE date >= '2026-06-01' GROUP BY date ORDER BY date`).all() as any[];
console.log('\nJune 2026 daily counts (looking for a cliff vs a taper):');
console.log(last.map((r:any)=>`${r.date.slice(5)}:${r.n}`).join('  '));
