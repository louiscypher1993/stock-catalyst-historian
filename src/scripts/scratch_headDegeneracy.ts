/**
 * Model B emits only 69 distinct values across 684 post-expansion live rows (10.1%) --
 * worse than the known D4 collapse (82/261). Before calling that an expansion problem,
 * the control: was B already collapsed BEFORE the universe grew?
 *
 * Pre-expansion window is the same length as post, ending at the expansion timestamp, so
 * the two are compared at similar row counts rather than similar calendar spans.
 */
import 'dotenv/config';

const EXPANSION = '2026-08-10T10:29:00Z';
const HEADS = ['model_b_return_1m', 'model_d1_return_3m', 'model_d2_return_6m',
               'model_d3_return_2d', 'model_d5_return_2w', 'model_c_max_drawdown',
               'model_a_confidence'];

async function fetchWindow(gte: string, lt: string) {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select(['symbol', 'run_date', 'created_at', ...HEADS].join(','))
      .gte('created_at', gte).lt('created_at', lt)
      .order('created_at', { ascending: true }).range(f, f + 999);
    if (error) throw error;
    const b = data ?? []; rows.push(...b); if (b.length < 1000) break;
  }
  return rows;
}

function report(label: string, rows: any[]) {
  console.log(`\n=== ${label}: ${rows.length} rows ===`);
  console.log(`${'head'.padEnd(24)}${'distinct'.padStart(9)}${'%'.padStart(8)}   ${'shared>1sym'.padStart(11)}`);
  for (const h of HEADS) {
    const vals = rows.map(r => r[h]).filter((v: any) => v != null) as number[];
    if (!vals.length) { console.log(`${h.padEnd(24)}${'(none)'.padStart(9)}`); continue; }
    const d = new Set(vals.map(v => v.toFixed(6)));
    const bySym = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r[h] == null) continue;
      const v = (r[h] as number).toFixed(6);
      if (!bySym.has(v)) bySym.set(v, new Set());
      bySym.get(v)!.add(String(r.symbol).toUpperCase());
    }
    const multi = [...bySym.values()].filter(s => s.size > 1).length;
    const pct = 100 * d.size / vals.length;
    console.log(`${h.padEnd(24)}${String(d.size).padStart(9)}${pct.toFixed(1).padStart(8)}%${String(multi).padStart(12)}` +
      `${pct < 15 ? '   <-- COLLAPSED' : ''}`);
  }
}

async function main() {
  const post = await fetchWindow(EXPANSION, '2099-01-01T00:00:00Z');
  const pre  = await fetchWindow('2026-08-04T00:00:00Z', EXPANSION);
  report('PRE-expansion  (08-04 -> 08-10)', pre);
  report('POST-expansion (08-10 -> now)', post);
  console.log('\n% = distinct values as a share of rows. A continuous regression head should be');
  console.log('near 100%. Low means many rows share an identical prediction -- leaf-value collapse.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
