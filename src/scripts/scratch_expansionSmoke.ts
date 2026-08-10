/**
 * End-to-end smoke test for a universe-expansion symbol, WRITING NOTHING.
 * Exercises exactly the live path a new symbol takes: getSymbolSnapshot (must resolve
 * sector from universe_expansion.json), bar fetch, forced detectAnomaly, vector build,
 * runInference. Prints the scores + the enrichment a new symbol actually gets.
 *
 * Usage: LIVE_FEATURE_PARITY=all npx tsx src/scripts/scratch_expansionSmoke.ts AAON BGEO.L
 */
import 'dotenv/config';
import {
  fetchYahooDailyHistory, buildSpyReturnMap, detectAnomaly, buildFeatureVectorForAnomaly,
  getSymbolSnapshot, runInference,
} from '../LiveInferenceService';

async function main() {
  const symbols = process.argv.slice(2);
  if (!symbols.length) throw new Error('pass symbols');
  const spy = buildSpyReturnMap(await fetchYahooDailyHistory('SPY', '1y'));
  for (const sym of symbols) {
    const enrichment = await getSymbolSnapshot(sym);
    console.log(`\n=== ${sym}`);
    console.log(`  snap=${enrichment.snap === null ? 'NULL (expected for expansion)' : 'present'}  ` +
                `sector=${enrichment.sector ?? 'null'}  primaryCategory=${enrichment.primaryCategory ?? 'null'}`);
    const bars = await fetchYahooDailyHistory(sym, '1y');
    const anomaly = detectAnomaly(sym, sym, bars, spy, true);
    if (!anomaly) { console.log('  detectAnomaly returned null'); continue; }
    console.log(`  z=${anomaly.zScore.toFixed(2)} date=${anomaly.date}`);
    const vec = buildFeatureVectorForAnomaly(bars, anomaly, enrichment, null, null);
    const sectorHots = Object.entries(vec).filter(([k, v]) => k.startsWith('sector_') && v);
    console.log(`  sector one-hot: ${sectorHots.map(([k]) => k).join(', ') || 'NONE'}`);
    const scores = runInference(vec);
    console.log(`  D5(2W)=${scores.model_d5_return_2w.toFixed(4)}  D3(2D)=${scores.model_d3_return_2d.toFixed(4)}  ` +
                `B(1M)=${scores.model_b_return_1m.toFixed(4)}  C=${scores.model_c_max_drawdown.toFixed(4)}  ` +
                `Crank=${scores.model_c_percentile_rank?.toFixed(4) ?? 'n/a'}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
