/** Does the Gemini audit's specific clone symptom (identical D1/3M and D2/6M values
 * across unrelated symbols) still appear post-parity, on this morning's run? */
import 'dotenv/config';

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('inference_results')
    .select('symbol, unreliable_reason, model_d1_return_3m, model_d2_return_6m, model_b_return_1m')
    .gte('created_at', '2026-08-10T08:20:00Z').lt('created_at', '2026-08-10T08:32:00Z');
  if (error) throw error;
  const rows = data ?? [];
  for (const [label, field] of [['D1 (3M)', 'model_d1_return_3m'], ['D2 (6M)', 'model_d2_return_6m'], ['B (1M)', 'model_b_return_1m']] as const) {
    const byVal = new Map<string, string[]>();
    for (const r of rows as any[]) {
      const k = Number(r[field]).toFixed(4);
      if (!byVal.has(k)) byVal.set(k, []);
      byVal.get(k)!.push(`${r.symbol}${r.unreliable_reason ? '*' : ''}`);
    }
    const clones = [...byVal.entries()].filter(([, s]) => s.length >= 3).sort((a, b) => b[1].length - a[1].length);
    console.log(`${label}: ${byVal.size} distinct values over ${rows.length} rows`);
    for (const [v, syms] of clones.slice(0, 5)) console.log(`  ${v} shared by ${syms.length}: ${syms.join(', ')}`);
  }
  console.log('\n(* = unreliable_reason set)');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
