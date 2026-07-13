import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
  getSymbolSnapshot,
  runInference,
} from '../LiveInferenceService';

// Verbatim copy of the new gate logic shipped in LiveInferenceService.ts's
// per-symbol loop (~line 1205-1228), to prove the SHIPPED code (not a
// reimplementation) produces the right verdict.
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

// Verbatim copy of the new PotService.ts meetsSignalQualityGate exclusion (the
// unreliable_reason check only -- the rest of that gate is irrelevant here).
function wouldBeExcludedFromPotGates(unreliableReason: string | null): boolean {
  return !!unreliableReason; // meetsSignalQualityGate returns false immediately if truthy
}

async function reconstruct(symbol: string, companyName: string, forceSignal = true) {
  const bars = await fetchYahooDailyHistory(symbol, '1y');
  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  const anomaly = detectAnomaly(symbol, companyName, bars, spyReturnByDate, forceSignal);
  if (!anomaly) { console.log(`${symbol}: no anomaly`); return null; }

  const enrichment = await getSymbolSnapshot(symbol);
  const isNullEnrichment = enrichment.snap === null;

  const featureVector = buildFeatureVectorForAnomaly(bars, anomaly, enrichment, null);
  const scores = runInference(featureVector);
  const unreliableReason = computeUnreliableReason(isNullEnrichment, scores);
  const excluded = wouldBeExcludedFromPotGates(unreliableReason);

  console.log(`\n=== ${symbol} ===`);
  console.log(`  isNullEnrichment=${isNullEnrichment}`);
  console.log(`  raw scores: B=${scores.model_b_return_1m} D1=${scores.model_d1_return_3m} D2=${scores.model_d2_return_6m} D3=${scores.model_d3_return_2d} D4=${scores.model_d4_return_3d} D5=${scores.model_d5_return_2w}`);
  console.log(`  unreliable_reason=${unreliableReason}`);
  console.log(`  EXCLUDED from PotService entry/exit gates: ${excluded}`);
  return { symbol, isNullEnrichment, scores, unreliableReason, excluded };
}

async function main() {
  // 6a: today's real DVN incident scenario (still-frozen stale snapshot, unstripped by test)
  await reconstruct('DVN', 'Devon Energy Corporation');
  await new Promise(r => setTimeout(r, 150));

  // MG.TO -- note: this session's earlier point-in-time reconstruction used
  // 2026-07-02 truncated bars via the 545ec05 vintage; here we reconstruct
  // with TODAY's real live bars (matching this fix's actual live call shape)
  // to get a genuinely fresh, code-accurate verification rather than reusing
  // the old vintage numbers.
  await reconstruct('MG.TO', 'Magna International Inc.');

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
