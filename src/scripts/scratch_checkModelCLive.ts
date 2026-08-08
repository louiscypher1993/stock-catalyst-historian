/**
 * Did Model C v9.5 actually take effect in production?
 *
 * Enabled 2026-08-06 17:46 UTC (e745e08). The prediction to check was specific: v9.1
 * reported a POSITIVE max drawdown -- "never trades below entry" -- on 84.3% of anomalies
 * in the offline study, and v9.5 should report that on ~0%.
 *
 * *** WHAT IT ACTUALLY SHOWED — the 84.3% was never a live number. ***
 *
 *   BEFORE flip: n=1748  median=-0.0979  "no downside"=0.6%
 *   AFTER  flip: n= 165  median=-0.2717  "no downside"=0.0%
 *
 * So the user-facing defect that justified enabling v9.5 was, in production, occurring on
 * 0.6% of rows and not 84.3%. The 84.3% is a property of the offline test fold, and it was
 * quoted in 346ee55 and e745e08 as though it described live. It does not.
 *
 * The flip is nonetheless close to a no-op for DECISIONS: both versions' live values fall
 * far below their breakpoint distributions, so riskScore's drawdown term is saturated
 * either way (39.6/40 -> 37.3/40) and position size moves ~5% relative. Run
 * scratch_allheads.ts alongside this: on 2026-08-07 only C moved, so the shift is the
 * flip rather than the market.
 *
 * Reads inference_results only. Note model_c_percentile_rank is deliberately NOT in this
 * table (it was added to the pot payload, not the Supabase write), so model_c_max_drawdown
 * is the signal here -- which is also why the saturation had to be derived by hand rather
 * than read off directly. Worth adding the rank to the write before the next C change.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const FLIP = '2026-08-06';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);

  type Row = { run_date: string; model_c_max_drawdown: number | null; symbol: string };

  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('inference_results')
      .select('run_date, model_c_max_drawdown, symbol')
      .gte('run_date', '2026-07-25')
      .range(from, from + 999);
    if (error) throw error;
    all.push(...(data as Row[]));
    if (!data || data.length < 1000) break;
  }

  const rows = all.filter(r => r.model_c_max_drawdown != null);
  console.log(`inference_results since 2026-07-25: ${rows.length} rows with a Model C value\n`);

  const byDate = new Map<string, number[]>();
  for (const r of rows) {
    const d = String(r.run_date).slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(r.model_c_max_drawdown as number);
  }

  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  console.log(`${'run_date'.padEnd(12)}${'n'.padStart(6)}${'mean'.padStart(10)}${'median'.padStart(10)}${'% positive'.padStart(12)}   model`);
  console.log('-'.repeat(64));
  for (const d of [...byDate.keys()].sort()) {
    const v = byDate.get(d)!;
    const pos = v.filter(x => x > 0).length / v.length;
    const era = d >= FLIP ? 'v9.5?' : 'v9.1';
    const flag = d === FLIP ? '  <- flip day (17:46 UTC, mid-day)' : '';
    console.log(`${d.padEnd(12)}${String(v.length).padStart(6)}${mean(v).toFixed(4).padStart(10)}` +
                `${median(v).toFixed(4).padStart(10)}${(pos * 100).toFixed(1).padStart(11)}%   ${era}${flag}`);
  }

  const pre = rows.filter(r => String(r.run_date).slice(0, 10) < FLIP).map(r => r.model_c_max_drawdown as number);
  const post = rows.filter(r => String(r.run_date).slice(0, 10) > FLIP).map(r => r.model_c_max_drawdown as number);
  console.log('\n' + '='.repeat(64));
  for (const [name, v] of [['BEFORE flip', pre], ['AFTER flip ', post]] as [string, number[]][]) {
    if (!v.length) { console.log(`${name}: no rows`); continue; }
    console.log(`${name}: n=${v.length}  mean=${mean(v).toFixed(4)}  median=${median(v).toFixed(4)}  ` +
                `"no downside"=${(v.filter(x => x > 0).length / v.length * 100).toFixed(1)}%`);
  }
  console.log('\nNOTE: the offline fold predicted 84.3% "no downside" for v9.1. Live shows');
  console.log('~0.6%. The fold does not represent live inputs — see the header.');

}
main();
