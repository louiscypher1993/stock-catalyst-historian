import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
} from '../LiveInferenceService';

const NULL_ENRICHMENT = { snap: null, primaryCategory: null, companyName: null, sector: null, exchange: null };

async function main() {
  for (const sym of ['GFC.PA', 'XBI', 'BBAR', 'SNP.RO', 'MOH.AT', 'PKO.WA']) {
    const bars = await fetchYahooDailyHistory(sym, '1y');
    const spyBars = await fetchYahooDailyHistory('SPY', '1y');
    const spyReturnByDate = buildSpyReturnMap(spyBars);
    const anomaly = detectAnomaly(sym, sym, bars, spyReturnByDate, true);
    if (!anomaly) { console.log(`${sym}: no anomaly`); continue; }
    const vector = buildFeatureVectorForAnomaly(bars, anomaly, NULL_ENRICHMENT as any, null);
    const numericKeys = Object.keys(vector).filter(k => typeof vector[k] === 'number');
    const zeroCount = numericKeys.filter(k => vector[k] === 0).length;
    console.log(`${sym}: ${zeroCount}/${numericKeys.length} numeric features are exactly 0 (z_score=${vector.z_score?.toFixed?.(4)})`);
    await new Promise(r => setTimeout(r, 150));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
