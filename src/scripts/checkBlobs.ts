import Database from 'better-sqlite3';
const db = new Database('market_cache.db');
const row = db.prepare(
  'SELECT signal_snapshot_json, features_json FROM event_features WHERE signal_snapshot_json IS NOT NULL AND features_json IS NOT NULL LIMIT 1'
).get() as any;
const snap = JSON.parse(row.signal_snapshot_json);
const feat = JSON.parse(row.features_json);
console.log('signal_snapshot_json keys:', Object.keys(snap).length, JSON.stringify(Object.keys(snap).slice(0,10)));
console.log('features_json keys:', Object.keys(feat).length, JSON.stringify(Object.keys(feat).slice(0,10)));
