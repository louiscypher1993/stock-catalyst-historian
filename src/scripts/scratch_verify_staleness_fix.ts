import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
  getSymbolSnapshot,
  runInference,
} from '../LiveInferenceService';

// Regression check for the Phenomenon 3 fix (LiveInferenceService.ts's per-symbol
// loop, ~line 1187). Replicates the EXACT new strip snippet now shipped there
// (5 lines: shallow-copy enrichment.snap, delete the 4 fields) verbatim, then
// runs the resulting feature vector through the real infer.py -- to confirm the
// fix now produces automatically what this morning's manual scratch-script
// correction had to do by hand.
async function main() {
  const symbol = 'DVN';
  const bars = await fetchYahooDailyHistory(symbol, '1y');
  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  const anomaly = detectAnomaly(symbol, symbol, bars, spyReturnByDate, true);
  if (!anomaly) { console.log('detectAnomaly returned null'); process.exit(1); }

  console.log('=== Real fresh anomaly signal (today) ===');
  console.log(`  z_score=${anomaly!.zScore.toFixed(4)}  excess_return=${anomaly!.excessReturn.toFixed(4)}  ` +
    `atr_shock_score=${anomaly!.atrShockScore.toFixed(4)}  volume_ratio=${anomaly!.volumeRatio.toFixed(4)}`);

  // Real getSymbolSnapshot() call -- exercises whichever branch (local SQLite
  // vs Supabase fallback) this machine actually hits, unmodified.
  const enrichment = await getSymbolSnapshot(symbol);
  console.log(`\nenrichment.snap present: ${enrichment.snap !== null}`);
  console.log(`  raw snap.z_score=${enrichment.snap?.z_score}  raw snap.excess_return=${enrichment.snap?.excess_return}`);

  // ---- verbatim copy of the new shipped snippet (LiveInferenceService.ts ~1187) ----
  const freshSnap = enrichment.snap ? { ...enrichment.snap } : null;
  if (freshSnap) {
    delete freshSnap.z_score;
    delete freshSnap.excess_return;
    delete freshSnap.atr_shock_score;
    delete freshSnap.volume_ratio;
  }
  const featureVector = buildFeatureVectorForAnomaly(bars, anomaly!, { ...enrichment, snap: freshSnap } as any, null);
  // ---- end verbatim copy ----

  console.log(`\nFixed feature vector's key fields: z_score=${featureVector.z_score}  excess_return=${featureVector.excess_return}  ` +
    `atr_shock_score=${featureVector.atr_shock_score}  volume_ratio=${featureVector.volume_ratio}`);
  console.log('(these should now equal the FRESH anomaly values above, not the stale snap values)');

  const scores = runInference(featureVector);
  console.log('\n=== Model scores through the FIXED path ===');
  console.log(scores);

  console.log('\nThis morning\'s manually-corrected replay (Session 4, scratch_dvnCorrectedReplay.ts) found:');
  console.log('  D1 (3M) corrected = 0.0117 (was 0.5 stale)');
  console.log('  D5 (2W) corrected = 0.0141 (was 0.1801 stale)');
  console.log(`\nFixed-path actual: D1=${scores.model_d1_return_3m}  D5=${scores.model_d5_return_2w}`);

  const recommendation = scores.model_a_confidence >= 0.80 ? 'possible STRONG_BUY territory (modelA gate)' : 'modelA confidence below STRONG_BUY gate';
  console.log(`\nmodel_a_confidence=${scores.model_a_confidence} -- ${recommendation}`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
