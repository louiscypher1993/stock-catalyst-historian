import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
  getSymbolSnapshot,
  runInference,
} from '../LiveInferenceService';

function computeUnreliableReason(isNullEnrichment: boolean, scores: any): string | null {
  const rawOutlierPrimary = Math.abs(scores.model_d3_return_2d) > 0.30 || Math.abs(scores.model_d5_return_2w) > 0.40;
  const rawOutlierSecondaryCount = [
    Math.abs(scores.model_b_return_1m) > 1.8,
    Math.abs(scores.model_d1_return_3m) > 2.5,
    Math.abs(scores.model_d2_return_6m) > 2.5,
    Math.abs(scores.model_d4_return_3d) > 1.0,
  ].filter(Boolean).length;
  const isRawPredictionOutlier = rawOutlierPrimary || rawOutlierSecondaryCount >= 2;
  return isNullEnrichment ? 'null_enrichment' : (isRawPredictionOutlier ? 'raw_prediction_outlier' : null);
}

async function main() {
  const symbols = ['GFC.PA', 'XBI', 'BBAR', 'SNP.RO', 'MOH.AT', 'PKO.WA'];
  let allCaught = true;
  for (const sym of symbols) {
    const bars = await fetchYahooDailyHistory(sym, '1y');
    const spyBars = await fetchYahooDailyHistory('SPY', '1y');
    const spyReturnByDate = buildSpyReturnMap(spyBars);
    const anomaly = detectAnomaly(sym, sym, bars, spyReturnByDate, true);
    if (!anomaly) { console.log(`${sym}: no anomaly`); continue; }

    const enrichment = await getSymbolSnapshot(sym);
    const isNullEnrichment = enrichment.snap === null;
    const vector = buildFeatureVectorForAnomaly(bars, anomaly, enrichment, null);
    const scores = runInference(vector);
    const reason = computeUnreliableReason(isNullEnrichment, scores);
    const caught = !!reason;
    allCaught = allCaught && caught;
    console.log(`${sym}: isNullEnrichment=${isNullEnrichment}  D3=${scores.model_d3_return_2d.toFixed(4)} D5=${scores.model_d5_return_2w.toFixed(4)}  unreliable_reason=${reason}  CAUGHT=${caught}`);
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`\nAll 6 caught: ${allCaught}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
