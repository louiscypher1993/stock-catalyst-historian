import 'dotenv/config';
import { startBackfill, getBackfillStatus } from './EnrichBackfillService';
import { db } from './db';

const SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN'];

function snapshot(label: string) {
  console.log(`\n--- ${label} ---`);
  for (const s of SYMBOLS) {
    const rows = db.prepare(`
      SELECT date,
        json_extract(features_json, '$.insider_net_shares_30d') as net,
        json_extract(features_json, '$.insider_buy_count_30d') as buys,
        json_extract(features_json, '$.insider_sell_count_30d') as sells
      FROM event_features WHERE symbol = ? ORDER BY date DESC LIMIT 3
    `).all(s);
    console.log(s, JSON.stringify(rows));
  }
}

async function main() {
  snapshot('BEFORE');

  await startBackfill(SYMBOLS, true);

  // startBackfill resolves only after full pass; status should be idle now
  console.log('\nFinal status:', getBackfillStatus());

  snapshot('AFTER');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
