import 'dotenv/config';
import { fetchFREDSeries } from '../../FREDService';

const SERIES_TO_TEST = [
  'DEXINUS', 'DEXJPUS', 'DEXKOUS', 'DEXUSUK',
  // Best-guess IDs for the less-standard currencies -- likely NOT on FRED's daily H.10 list
  'DEXHUUS', 'DEXIDUS', 'DEXVNUS', 'DEXCLUS',
  'CCUSMA02HUM618', 'CCUSMA02IDM618', 'CCUSMA02VNM618', 'CCUSMA02CLM618',
];

async function main() {
  for (const series of SERIES_TO_TEST) {
    try {
      const points = await fetchFREDSeries(series, '2026-06-01', '2026-07-14');
      if (points.length > 0) {
        const last = points[points.length - 1];
        console.log(`${series}: OK -- ${points.length} points, latest ${last.date}=${last.value}`);
      } else {
        console.log(`${series}: EMPTY (no data returned -- series likely doesn't exist or no observations in range)`);
      }
    } catch (e: any) {
      console.log(`${series}: ERROR ${e.message}`);
    }
  }
  process.exit(0);
}

main();
