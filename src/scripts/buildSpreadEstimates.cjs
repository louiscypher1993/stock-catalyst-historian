/**
 * buildSpreadEstimates.cjs — Tier-2 spread table (static, liquidity-tiered).
 *
 * Assigns each symbol a round-trip bid-ask spread by its median daily $-volume
 * tier. Chosen over the Abdi-Ranaldo OHLC estimator after validation (2026-07-24):
 * A-R over-estimated badly on our daily bars (KO, a mega-liquid name, came out at
 * 81bps vs ~1-2bps real; >half the universe pinned to the sanity cap), so the
 * clamp was doing all the work — i.e. it collapsed to a liquidity table anyway,
 * just with false per-name precision. This is that table, honestly.
 *
 * Tiers (round-trip proportional spread, bps of position value):
 *   high  >=$100M/day : 3    (mega-liquid; ~1-5bps real)
 *   mid   >=$10M       : 15
 *   low   >=$1M        : 50
 *   micro <$1M         : 100
 * Committed JSON so costModel reads it on CI (market_cache.db is local-only).
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const db = new Database(path.join(ROOT, 'market_cache.db'), { readonly: true });

const WINDOW = 60;
const TIERS = [ // [minMedianDollarVol, spreadBps]
  [100e6, 3], [10e6, 15], [1e6, 50], [0, 100],
];

const rows = db.prepare(`
  SELECT symbol, close, volume FROM daily_prices
  WHERE date >= (SELECT date(MAX(date), '-90 days') FROM daily_prices) AND close > 0 AND volume > 0
`).all();
const bySym = new Map();
for (const r of rows) { if (!bySym.has(r.symbol)) bySym.set(r.symbol, []); bySym.get(r.symbol).push(r.close * r.volume); }
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const out = {};
const counts = { 3: 0, 15: 0, 50: 0, 100: 0 };
for (const [sym, dv] of bySym) {
  if (dv.length < 10) continue;
  const mdv = median(dv.slice(-WINDOW));
  const spread = (TIERS.find(([min]) => mdv >= min) || [0, 100])[1];
  out[sym] = spread;
  counts[spread]++;
}
const OUT = path.join(__dirname, 'symbol_spread_bps.json');
fs.writeFileSync(OUT, JSON.stringify({
  _note: 'symbol -> round-trip bid-ask spread (bps), static liquidity-tier table by median daily $-volume (high>=100M:3 / mid>=10M:15 / low>=1M:50 / micro:100). Rebuild with buildSpreadEstimates.cjs.',
  _built: new Date().toISOString().slice(0, 10),
  spreadBps: out,
}, null, 2));
console.log(`Wrote ${Object.keys(out).length} symbols -> ${OUT}`);
console.log('tier counts (spreadBps -> #symbols):', counts);
console.log('sanity:', ['AAPL', 'KO', 'BP.L', 'SNAP', 'RIVN', 'PLUG'].map(s => `${s}=${out[s] ?? '?'}bps`).join('  '));
