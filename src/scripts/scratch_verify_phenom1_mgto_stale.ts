import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
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
  const symbol = 'MG.TO';
  const bars = await fetchYahooDailyHistory(symbol, '1y');
  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  const anomaly = detectAnomaly(symbol, symbol, bars, spyReturnByDate, true);
  if (!anomaly) { console.log('no anomaly'); process.exit(1); }

  const { supabase } = await import('../db/supabaseClient');
  const { data: snapRow } = await supabase.from('symbol_snapshots').select('*').eq('symbol', symbol).single();
  const staleEnrichment = {
    snap: snapRow?.latest_signal_snapshot ?? null, primaryCategory: null,
    companyName: 'Magna International Inc.', sector: snapRow?.sector ?? null, exchange: snapRow?.exchange ?? null,
  };
  console.log(`MG.TO real still-frozen stale snap: z_score=${staleEnrichment.snap?.z_score} excess_return=${staleEnrichment.snap?.excess_return}`);

  // Deliberately NOT applying the Phenomenon 3 strip here -- testing the
  // sanity gate as an INDEPENDENT backstop against this real stale input,
  // simulating "what if Phenomenon 3's fix hadn't caught this".
  const staleVector = buildFeatureVectorForAnomaly(bars, anomaly, staleEnrichment as any, null);
  const scores = runInference(staleVector);
  console.log(`\nraw scores (stale snap, today's real bars): B=${scores.model_b_return_1m} D1=${scores.model_d1_return_3m} D2=${scores.model_d2_return_6m} D3=${scores.model_d3_return_2d} D4=${scores.model_d4_return_3d} D5=${scores.model_d5_return_2w}`);
  const reason = computeUnreliableReason(false, scores);
  console.log(`unreliable_reason=${reason}  EXCLUDED=${!!reason}`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
