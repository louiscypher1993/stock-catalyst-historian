/**
 * The v13 'honest-union' arm lost (-0.0111 vs the honest control), but it is a CONFOUNDED
 * test of clean bars: its own comment says pre-2021 rows carried "premium NaN". So it
 * changed two things at once -- correct bar granularity AND the removal of every
 * enrichment feature on those rows -- and cannot separate them.
 *
 * The untested option is a JOIN: clean price columns from training_events_v11, enrichment
 * blobs from event_features, matched on (symbol, date). The enrichment does NOT need
 * re-fetching (FMP premium expired 2026-07-06 and must never be re-run) because it is
 * already stored. This measures whether that join actually retains the rows.
 */
import Database from 'better-sqlite3';
const d = new Database('market_cache.db', { readonly: true, fileMustExist: true });

const q = (s: string) => (d.prepare(s).get() as any).n;

const efAll  = q(`SELECT COUNT(*) n FROM event_features WHERE signal_snapshot_json IS NOT NULL`);
const efPre  = q(`SELECT COUNT(*) n FROM event_features WHERE signal_snapshot_json IS NOT NULL AND date < '2021-01-01'`);
console.log(`enriched rows in event_features: ${efAll}  (pre-2021: ${efPre})`);

for (const [label, where] of [
  ['any price_source', ''],
  ["price_source='daily_reextract'", `AND t.price_source='daily_reextract'`],
] as const) {
  const all = q(`SELECT COUNT(*) n FROM event_features e JOIN training_events_v11 t
                 ON t.symbol=e.symbol AND t.date=e.date
                 WHERE e.signal_snapshot_json IS NOT NULL ${where}`);
  const pre = q(`SELECT COUNT(*) n FROM event_features e JOIN training_events_v11 t
                 ON t.symbol=e.symbol AND t.date=e.date
                 WHERE e.signal_snapshot_json IS NOT NULL AND e.date < '2021-01-01' ${where}`);
  console.log(`\njoin on ${label}`);
  console.log(`  all rows retained : ${all}  (${(100*all/efAll).toFixed(1)}% of enriched)`);
  console.log(`  pre-2021 retained : ${pre}  (${(100*pre/efPre).toFixed(1)}% of enriched pre-2021)  <- the rows the join exists to repair`);
}

const src = d.prepare(`SELECT price_source, COUNT(*) n FROM training_events_v11 GROUP BY price_source ORDER BY n DESC`).all() as any[];
console.log(`\ntraining_events_v11 price_source: ${src.map(r=>`${r.price_source}=${r.n}`).join('  ')}`);
const preSrc = d.prepare(`SELECT price_source, COUNT(*) n FROM training_events_v11 WHERE date<'2021-01-01' GROUP BY price_source ORDER BY n DESC`).all() as any[];
console.log(`  pre-2021 only:                  ${preSrc.map(r=>`${r.price_source}=${r.n}`).join('  ')}`);
