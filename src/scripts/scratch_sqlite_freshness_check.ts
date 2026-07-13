import 'dotenv/config';
import { db } from '../../db';

async function main() {
  const maxDate = db.prepare(`SELECT MAX(date) as maxDate FROM event_features`).get() as { maxDate: string };
  console.log('Absolute MAX(date) across all of event_features:', maxDate.maxDate);

  const recentRows = db.prepare(`
    SELECT symbol, date, created_at FROM event_features
    WHERE date >= '2026-07-01'
    ORDER BY date DESC LIMIT 20
  `).all();
  console.log('\nRows with date >= 2026-07-01:', JSON.stringify(recentRows, null, 2));

  const countByMonth = db.prepare(`
    SELECT substr(date, 1, 7) as ym, COUNT(*) as cnt FROM event_features
    GROUP BY ym ORDER BY ym DESC LIMIT 6
  `).all();
  console.log('\nRow counts by year-month (most recent 6):', JSON.stringify(countByMonth, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
