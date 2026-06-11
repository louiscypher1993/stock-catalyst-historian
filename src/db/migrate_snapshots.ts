import 'dotenv/config';
import { db } from '../../db.ts';
import { supabase } from './supabaseClient.ts';

async function migrateSnapshots() {
  // Get the most recent signal_snapshot_json row per symbol
  const rows = db.prepare(`
    SELECT ef.symbol, ef.signal_snapshot_json,
           cp.name as company_name, cp.sector, cp.exchange,
           CASE WHEN ef.symbol NOT LIKE '%.%' THEN 1 ELSE 0 END as is_us_listed
    FROM event_features ef
    INNER JOIN (
      SELECT symbol, MAX(date) as max_date
      FROM event_features
      WHERE signal_snapshot_json IS NOT NULL
      GROUP BY symbol
    ) latest ON ef.symbol = latest.symbol AND ef.date = latest.max_date
    LEFT JOIN company_profiles cp ON ef.symbol = cp.symbol
  `).all() as any[];

  console.log(`Migrating ${rows.length} symbol snapshots to Supabase...`);

  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(r => ({
      symbol: r.symbol,
      company_name: r.company_name ?? null,
      sector: r.sector ?? null,
      exchange: r.exchange ?? null,
      is_us_listed: Boolean(r.is_us_listed),
      latest_signal_snapshot: r.signal_snapshot_json
        ? JSON.parse(r.signal_snapshot_json)
        : null,
      updated_at: new Date().toISOString()
    }));

    const { error } = await supabase
      .from('symbol_snapshots')
      .upsert(batch, { onConflict: 'symbol' });

    if (error) console.error(`Batch ${i / BATCH + 1} error:`, error);
    else console.log(`Batch ${i / BATCH + 1}/${Math.ceil(rows.length / BATCH)} done`);
  }

  console.log('Migration complete.');
}

migrateSnapshots().catch(console.error);
