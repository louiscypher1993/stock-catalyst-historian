import 'dotenv/config';
import { fileURLToPath } from 'url';
import { db, getCachedCompanyProfile } from './db';
import { supabase } from './src/db/supabaseClient';

async function migrateSnapshots() {
  const rows = db.prepare(`
    SELECT symbol, primaryCategory, signal_snapshot_json
    FROM event_features
    WHERE signal_snapshot_json IS NOT NULL
    GROUP BY symbol
    HAVING MAX(date)
  `).all() as { symbol: string; primaryCategory: string | null; signal_snapshot_json: string }[];

  console.log(`[MigrateSnapshots] Found ${rows.length} symbols with signal snapshots.`);

  const BATCH = 100;
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(row => {
      const cached = getCachedCompanyProfile(row.symbol);
      const profile = cached?.profile;
      return {
        symbol: row.symbol,
        company_name: profile?.name ?? row.symbol,
        sector: profile?.sector ?? null,
        exchange: profile?.exchange ?? null,
        is_us_listed: !row.symbol.includes('.'),
        latest_signal_snapshot: JSON.parse(row.signal_snapshot_json),
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from('symbol_snapshots')
      .upsert(batch, { onConflict: 'symbol' });

    if (error) {
      errors += batch.length;
      console.error(`[MigrateSnapshots] Batch ${i / BATCH + 1} error:`, error.message);
    } else {
      upserted += batch.length;
    }

    console.log(`[MigrateSnapshots] Progress: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }

  console.log(`[MigrateSnapshots] Done. Upserted ${upserted} symbols, ${errors} errors.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrateSnapshots().catch(console.error);
}

export { migrateSnapshots };
