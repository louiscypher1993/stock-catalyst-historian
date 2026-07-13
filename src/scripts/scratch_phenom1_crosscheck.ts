import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
  runInference,
} from '../LiveInferenceService';

const NULL_ENRICHMENT = { snap: null, primaryCategory: null, companyName: null, sector: null, exchange: null };

async function reconstructRawScores(symbol: string, enrichment: any, label: string) {
  const bars = await fetchYahooDailyHistory(symbol, '1y');
  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  const anomaly = detectAnomaly(symbol, symbol, bars, spyReturnByDate, true);
  if (!anomaly) { console.log(`${symbol}: no anomaly`); return null; }
  const vector = buildFeatureVectorForAnomaly(bars, anomaly, enrichment, null);
  const scores = runInference(vector);
  console.log(`\n=== ${label}: ${symbol} RAW (pre-clamp) scores ===`);
  console.log(scores);
  return scores;
}

async function main() {
  // 1. DVN with today's STILL-frozen stale snapshot (unstripped) -- reproduces
  //    today's real incident's raw blowup, for the sanity-gate cross-check.
  const { supabase } = await import('../db/supabaseClient');
  const { data: dvnSnap } = await supabase.from('symbol_snapshots').select('*').eq('symbol', 'DVN').single();
  const dvnStaleEnrichment = { snap: dvnSnap?.latest_signal_snapshot ?? null, primaryCategory: null, companyName: 'Devon Energy Corporation', sector: dvnSnap?.sector ?? null, exchange: dvnSnap?.exchange ?? null };
  await reconstructRawScores('DVN', dvnStaleEnrichment, 'DVN STALE (pre-fix scenario, todays incident)');

  // 2. A sample of confirmed zero-symbol_snapshots-coverage symbols (Phenomenon 1),
  //    NULL_ENRICHMENT (matches a fresh CI checkout with zero local/Supabase coverage)
  for (const sym of ['GFC.PA', 'XBI', 'BBAR', 'SNP.RO', 'MOH.AT', 'PKO.WA']) {
    try {
      await reconstructRawScores(sym, NULL_ENRICHMENT, 'Phenomenon 1 (null-collapse)');
    } catch (e: any) {
      console.log(`${sym}: error - ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
