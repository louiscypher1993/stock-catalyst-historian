import 'dotenv/config';

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('inference_results')
    .select('symbol, run_date, model_d4_return_3d, model_d3_return_2d, unreliable_reason')
    .gte('run_date', '2026-08-07')
    .order('run_date', { ascending: false })
    .limit(1000);
  if (error) throw error;
  const rows = data ?? [];
  for (const col of ['model_d4_return_3d', 'model_d3_return_2d'] as const) {
    const counts = new Map<string, { syms: string[]; unrel: number }>();
    for (const r of rows as any[]) {
      const v = Number(r[col]).toFixed(4);
      if (!counts.has(v)) counts.set(v, { syms: [], unrel: 0 });
      const e = counts.get(v)!;
      e.syms.push(r.symbol);
      if (r.unreliable_reason) e.unrel++;
    }
    const dupes = [...counts.entries()].filter(([, e]) => e.syms.length >= 4)
      .sort((a, b) => b[1].syms.length - a[1].syms.length).slice(0, 6);
    console.log(`${col}: ${rows.length} rows, ${counts.size} distinct values`);
    for (const [v, e] of dupes) {
      console.log(`  ${v} x${e.syms.length} (${e.unrel} unreliable): ${e.syms.slice(0, 8).join(',')}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
