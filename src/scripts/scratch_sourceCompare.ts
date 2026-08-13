import Database from 'better-sqlite3';
const d = new Database('market_cache.db', { readonly: true, fileMustExist: true });
for (const t of ['event_features', 'event_features_daily', 'training_events_v11']) {
  try {
    const c: any = d.prepare(`SELECT COUNT(*) n, MIN(date) mn, MAX(date) mx FROM ${t}`).get();
    const snap: any = d.prepare(`SELECT COUNT(*) n FROM ${t} WHERE signal_snapshot_json IS NOT NULL`).get();
    const pre21: any = d.prepare(`SELECT COUNT(*) n FROM ${t} WHERE date < '2021-01-01'`).get();
    const nulls: any = d.prepare(`SELECT COUNT(*) n FROM ${t} WHERE is_null_sample = 1`).get();
    console.log(`${t}`);
    console.log(`  rows=${c.n}  ${c.mn} -> ${c.mx}`);
    console.log(`  usable (signal_snapshot_json NOT NULL) = ${snap.n}   <- what the extractor actually takes`);
    console.log(`  pre-2021 = ${pre21.n} (${(100*pre21.n/c.n).toFixed(1)}%)   injected non-events = ${nulls.n}`);
  } catch (e: any) { console.log(`${t}: ${e.message}`); }
  console.log();
}
// Column parity: does each table even have the columns the extractor SELECTs?
const need = ['cache_key','symbol','date','primaryCategory','features_json','signal_snapshot_json',
  'confidence_tier','is_null_sample','forward_return_2w','forward_return_3m','pre_return_3d','pre_vol_ratio_5d'];
for (const t of ['event_features_daily', 'training_events_v11']) {
  const cols = new Set((d.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(r => r.name));
  const missing = need.filter(c => !cols.has(c));
  console.log(`${t}: ${cols.size} cols; missing from extractor's SELECT: ${missing.length ? missing.join(', ') : 'NONE — drop-in compatible'}`);
}
