/**
 * Per-symbol round-trip trading costs for the historic-pots net-of-cost analysis.
 *
 * The pots stake conviction/10 x £100k, so only four position sizes ever occur:
 * £10k / £40k / £70k / £100k. Cost in bps is size-dependent (fixed per-order and FX
 * minimums), so all four are dumped per symbol.
 *
 * Uses the deployed IBKR_DEFAULT config unchanged, including slippageBpsPerLeg = 0 —
 * that default is deliberate (no measured latency data yet), so a separate run with
 * suggestedLatencySlippageBps() is emitted alongside as the pessimistic bound rather
 * than silently baking a guess into the headline number.
 *
 * Usage: npx tsx src/scripts/dumpPotCosts.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { roundTripCost, suggestedLatencySlippageBps, IBKR_DEFAULT } from '../costModel';

const DIR = path.join(process.cwd(), 'src', 'ml', 'scratch', 'historic_pots');
const SIZES = [10000, 40000, 70000, 100000];

function main() {
  const csv = fs.readFileSync(path.join(DIR, 'events.csv'), 'utf8').split('\n');
  const header = csv[0].split(',');
  const symIdx = header.indexOf('symbol');
  const symbols = new Set<string>();
  for (const line of csv.slice(1)) {
    const s = line.split(',')[symIdx];
    if (s) symbols.add(s.trim());
  }
  console.log(`unique symbols: ${symbols.size}`);

  const out: Record<string, { bps: number[]; bpsSlip: number[] }> = {};
  for (const sym of symbols) {
    // roundTripCost divides slippageBpsPerLeg by 10000 itself (costModel.ts:151), so it
    // takes BPS directly here -- unlike fxBpsPerLeg on the same interface, which is a
    // fraction. Passing suggested/10000 silently yields zero slippage.
    const slipCfg = { ...IBKR_DEFAULT, slippageBpsPerLeg: suggestedLatencySlippageBps(sym) };
    out[sym] = {
      bps: SIZES.map(v => roundTripCost(sym, v).totalBps),
      bpsSlip: SIZES.map(v => roundTripCost(sym, v, slipCfg).totalBps),
    };
  }
  fs.writeFileSync(path.join(DIR, 'costs.json'),
    JSON.stringify({ sizes: SIZES, config: IBKR_DEFAULT.label, symbols: out }));

  const all = Object.values(out);
  for (let i = 0; i < SIZES.length; i++) {
    const b = all.map(c => c.bps[i]).sort((x, y) => x - y);
    const s = all.map(c => c.bpsSlip[i]).sort((x, y) => x - y);
    console.log(`£${SIZES[i].toLocaleString()}: median ${b[b.length >> 1].toFixed(1)}bps ` +
      `(p10 ${b[Math.floor(b.length * 0.1)].toFixed(1)} / p90 ${b[Math.floor(b.length * 0.9)].toFixed(1)})` +
      `   with latency-slippage: median ${s[s.length >> 1].toFixed(1)}bps`);
  }
  console.log(`\nwrote ${path.join(DIR, 'costs.json')}`);
}
main();
