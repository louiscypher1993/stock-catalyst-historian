import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
  getSymbolSnapshot,
  runInference,
} from '../LiveInferenceService';

async function check(symbol: string, companyName: string) {
  const bars = await fetchYahooDailyHistory(symbol, '1y');
  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  const anomaly = detectAnomaly(symbol, companyName, bars, spyReturnByDate, true);
  if (!anomaly) { console.log(`${symbol}: no anomaly (may have moved since the test run)`); return; }
  const enrichment = await getSymbolSnapshot(symbol);
  const isNullEnrichment = enrichment.snap === null;
  const vector = buildFeatureVectorForAnomaly(bars, anomaly, enrichment, null);
  const scores = runInference(vector);
  console.log(`\n${symbol}: isNullEnrichment=${isNullEnrichment}`);
  console.log(`  RAW (pre-clamp): D3=${scores.model_d3_return_2d}  D5=${scores.model_d5_return_2w}  B=${scores.model_b_return_1m}  D1=${scores.model_d1_return_3m}  D2=${scores.model_d2_return_6m}  D4=${scores.model_d4_return_3d}`);
  console.log(`  z_score=${anomaly.zScore}  excess_return=${anomaly.excessReturn}`);
  const primaryOutlier = Math.abs(scores.model_d3_return_2d) > 0.30 || Math.abs(scores.model_d5_return_2w) > 0.40;
  console.log(`  Would primary trigger fire NOW (|D3|>0.30 or |D5|>0.40)? ${primaryOutlier}`);
}

async function main() {
  await check('DIVISLAB.NS', 'Divi\'s Laboratories');
  await new Promise(r => setTimeout(r, 150));
  await check('601899.SS', 'Zijin Mining Group');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
