/**
 * Discriminating check: on 2026-08-07, did ONLY Model C move?
 *
 * Only C was changed (MODEL_C_VERSION=9.5, enabled 2026-08-06 17:46 UTC). If C's median
 * shifts while B/D3/D5/A hold steady, the shift is the flip. If every head moves, it is
 * the market or the input data that day, and C is not implicated.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  const all: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from('inference_results')
      .select('run_date, model_c_max_drawdown, model_d5_return_2w, model_b_return_1m, model_a_confidence, model_d3_return_2d')
      .gte('run_date', '2026-07-27').range(f, f + 999);
    if (error) throw error;
    all.push(...(data as any[]));
    if (!data || data.length < 1000) break;
  }
  const byDate = new Map<string, any[]>();
  for (const r of all) {
    const d = String(r.run_date).slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(r);
  }
  const med = (a: any[]) => {
    const s = a.filter(x => x != null).sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : NaN;
  };
  const cols = ['model_c_max_drawdown', 'model_d5_return_2w', 'model_b_return_1m',
                'model_a_confidence', 'model_d3_return_2d'];
  console.log('MEDIAN per head per day — only Model C was changed, 2026-08-06 17:46 UTC\n');
  console.log('date'.padEnd(12) + 'n'.padStart(5) +
    cols.map(c => c.replace('model_', '').replace('_return', '').padStart(14)).join(''));
  console.log('-'.repeat(86));
  for (const d of [...byDate.keys()].sort()) {
    const rows = byDate.get(d)!;
    const flag = d === '2026-08-06' ? '  <- flip' : (d > '2026-08-06' ? '  v9.5' : '');
    console.log(d.padEnd(12) + String(rows.length).padStart(5) +
      cols.map(c => med(rows.map(r => r[c])).toFixed(4).padStart(14)).join('') + flag);
  }
}
main();
