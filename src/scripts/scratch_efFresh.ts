import Database from 'better-sqlite3';
const d = new Database('market_cache.db', { readonly: true, fileMustExist: true });
const r = d.prepare(`SELECT substr(date,1,7) m, COUNT(*) n FROM event_features
  WHERE date >= '2026-01-01' GROUP BY m ORDER BY m`).all() as any[];
console.log('event_features rows by month, 2026:');
for (const x of r) console.log(`  ${x.m}  ${x.n}`);
const mx = d.prepare(`SELECT MAX(date) mx FROM training_events_v11`).get() as any;
console.log(`\ntraining_events_v11 max date: ${mx.mx}`);
