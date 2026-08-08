/**
 * Dump REAL live feature vectors so they can be diffed field-by-field against training rows.
 *
 * Six indirect explanations for the live/fold output gap (3e6ed25) have now failed. This
 * stops hypothesising and captures what the live path actually feeds the models, using the
 * exported production functions rather than a reimplementation -- fetchYahooDailyHistory,
 * detectAnomaly and buildFeatureVectorForAnomaly are the same calls
 * LiveInferenceService.ts:1380 makes.
 *
 * detectAnomaly is invoked with forceEmit=true (its 4th arg, as scratch_phenomenon3-
 * BlastRadius.ts does) so a vector is produced for every symbol rather than only those
 * tripping the z-floor today -- the goal is to compare feature CONSTRUCTION, not to
 * reproduce a detection.
 *
 * Symbols default to names that appear in features.csv so the comparison has a training
 * counterpart. Writes JSON for scratch_c_vector_diff.py to analyse.
 *
 * Usage: npx tsx src/scripts/scratch_dumpLiveVectors.ts [SYM ...]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
} from '../LiveInferenceService';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'TRIP', 'F', 'INTC', 'PFE', 'KO', 'T', 'CSCO', 'WMT'];
const SYMBOLS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SYMBOLS;
const OUT = path.join(process.cwd(), 'src', 'ml', 'scratch', 'live_vectors.json');

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data: snapRows } = await supabase.from('symbol_snapshots').select('*').in('symbol', SYMBOLS);
  const snapBySymbol = new Map((snapRows || []).map((r: any) => [r.symbol, r]));
  console.log(`symbol_snapshots rows found: ${snapBySymbol.size} of ${SYMBOLS.length}`);

  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  console.log(`SPY bars: ${spyBars.length}\n`);

  const vectors: Record<string, any> = {};
  const context: Record<string, any> = {};
  for (const symbol of SYMBOLS) {
    try {
      const bars = await fetchYahooDailyHistory(symbol, '1y');
      if (!bars.length) { console.log(`${symbol}: no bars`); continue; }
      const anomaly = detectAnomaly(symbol, symbol, bars, spyReturnByDate, true);
      if (!anomaly) { console.log(`${symbol}: detectAnomaly null (bars=${bars.length})`); continue; }
      const row: any = snapBySymbol.get(symbol);
      const enrichment = {
        snap: row?.latest_signal_snapshot ?? null,
        primaryCategory: null,
        companyName: row?.company_name ?? null,
        sector: row?.sector ?? null,
        exchange: row?.exchange ?? null,
      };
      vectors[symbol] = buildFeatureVectorForAnomaly(bars, anomaly, enrichment as any, null);
      context[symbol] = {
        date: anomaly.date, z: anomaly.zScore, excess_return: anomaly.excessReturn,
        has_snapshot: !!row, sector: row?.sector ?? null,
      };
      console.log(`${symbol}: OK  date=${anomaly.date} z=${anomaly.zScore.toFixed(3)} ` +
                  `snap=${row ? 'yes' : 'NO'}`);
    } catch (e: any) {
      console.log(`${symbol}: ERROR ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 150));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ vectors, context }, null, 2));
  console.log(`\nwrote ${OUT} (${Object.keys(vectors).length} vectors)`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
