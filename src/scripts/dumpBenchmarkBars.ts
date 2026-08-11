/**
 * Dump daily bars for every native benchmark index, for the historic-pots
 * benchmark-neutralisation step (alpha vs beta).
 *
 * Mirrors LiveInferenceService's NATIVE_BENCHMARK mapping exactly, so a symbol is
 * hedged against the SAME index the training pipeline would have used for it
 * (see the live-spy-benchmark-mismatch work: the deployed path hedges everything
 * against SPY, but training used 11 local benchmarks).
 *
 * Usage: npx tsx src/scripts/dumpBenchmarkBars.ts
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fetchYahooDailyHistory } from '../LiveInferenceService';

const OUT = path.join(process.cwd(), 'src', 'ml', 'scratch', 'historic_pots', 'benchmark_bars.json');
const TICKERS = ['^AXJO', '^SSMI', '^OMX', '^STI', '^FTSE', '^GDAXI', '^FCHI',
                 '^GSPTSE', '^BSESN', '^HSI', '^GSPC'];

async function main() {
  const out: Record<string, Record<string, number>> = {};
  for (const t of TICKERS) {
    try {
      const bars = await fetchYahooDailyHistory(t, '3y');
      const m: Record<string, number> = {};
      for (const b of bars ?? []) {
        if (b.close > 0) m[b.date] = b.close;
      }
      out[t] = m;
      const dates = Object.keys(m).sort();
      console.log(`${t}: ${dates.length} bars  ${dates[0]} -> ${dates[dates.length - 1]}`);
    } catch (e: any) {
      console.warn(`${t}: FAILED ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`\nwrote ${OUT} (${Object.keys(out).length} benchmarks)`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
