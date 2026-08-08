/**
 * Re-run the live-vs-fold comparison with the LIVE side filtered the same way the fold is.
 *
 * 498784f concluded that B, C and D3 produce live output outside their own fold's middle
 * 80%. That comparison filtered the FOLD to real events at |z| >= 2.15 but left the LIVE
 * side unfiltered -- and live z_score has a median of 1.18, far below the 2.15 detection
 * floor, because inference_results also contains WATCHLIST and forced/held symbols that
 * were scored without ever tripping the threshold (writeResultToSupabase is called for
 * every processed symbol, not only anomalies).
 *
 * So the live population was a mixture of anomalies and deliberately-included non-anomalies
 * while the fold was anomalies only. This applies the same |z| >= 2.15 cut to both sides.
 * If the gap survives it is real; if it collapses, 498784f measured the watchlist.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const HEADS = ['model_b_return_1m', 'model_c_max_drawdown', 'model_d3_return_2d',
               'model_d5_return_2w', 'model_a_confidence'];
// fold p10/p50/p90 from scratch_live_vs_fold_all_heads.py, zfloor mode (real events, |z|>=2.15)
const FOLD: Record<string, [number, number, number]> = {
  model_a_confidence:   [1.0000, 1.0000, 1.0000],
  model_b_return_1m:    [0.1155, 0.1180, 0.1677],
  model_c_max_drawdown: [-0.0164, 0.0764, 0.0967],
  model_d3_return_2d:   [-0.0041, 0.0054, 0.0136],
  model_d5_return_2w:   [-0.0067, 0.0191, 0.0351],
};

function med(a: number[]): number {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from('inference_results')
      .select(['z_score', 'run_date', ...HEADS].join(','))
      .gte('run_date', '2026-07-27').lte('run_date', '2026-08-06').range(f, f + 999);
    if (error) throw error;
    rows.push(...(data as any[]));
    if (!data || data.length < 1000) break;
  }
  // C is v9.1 only up to the 2026-08-06 flip, matching the deployed-model fold predictions
  const anom = rows.filter(r => Math.abs(Number(r.z_score)) >= 2.15);
  console.log(`live rows 2026-07-27..08-06: ${rows.length}; at |z| >= 2.15: ${anom.length} ` +
              `(${(100 * anom.length / rows.length).toFixed(1)}%)\n`);

  console.log(`${'head'.padEnd(24)}${'fold p50'.padStart(10)}${'live ALL'.padStart(10)}` +
              `${'live |z|>2.15'.padStart(15)}${'fold p10..p90'.padStart(20)}${'matched?'.padStart(12)}`);
  console.log('-'.repeat(91));
  for (const h of HEADS) {
    const [p10, p50, p90] = FOLD[h];
    const allMed = med(rows.map(r => Number(r[h])));
    const anomMed = med(anom.map(r => Number(r[h])));
    const inside = anomMed >= p10 && anomMed <= p90;
    console.log(`${h.padEnd(24)}${p50.toFixed(4).padStart(10)}${allMed.toFixed(4).padStart(10)}` +
      `${anomMed.toFixed(4).padStart(15)}${`${p10.toFixed(4)}..${p90.toFixed(4)}`.padStart(20)}` +
      `${(inside ? 'yes' : '** NO **').padStart(12)}`);
  }
  console.log('\nIf the |z|>2.15 column lands inside the fold band where the ALL column did');
  console.log('not, then 498784f was measuring the watchlist population, not train/serve skew.');
}
main();
