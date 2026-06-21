import Database from 'better-sqlite3';

const db = new Database('market_cache.db', { readonly: true });
const syms = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMZN'];

for (const s of syms) {
  const rows = db.prepare(`
    SELECT date,
      json_extract(features_json, '$.insider_net_shares_30d') as net,
      json_extract(features_json, '$.insider_buy_count_30d') as buys,
      json_extract(features_json, '$.insider_sell_count_30d') as sells
    FROM event_features WHERE symbol = ? ORDER BY date DESC LIMIT 3
  `).all(s);
  console.log(s, JSON.stringify(rows));
}
db.close();
