/**
 * How much of the feature vector does live actually populate?
 *
 * B, C and D3 sit outside their fold distributions in every time window (498784f, and the
 * controls after it). The remaining explanation is that live feature VECTORS differ from
 * training rows. signal_completeness_score is computed per row at scan time and stored, so
 * it measures this directly without needing to reconstruct a vector.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!);
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from('inference_results')
      .select('run_date, signal_completeness_score, symbol, unreliable_reason')
      .gte('run_date', '2026-06-01').range(f, f + 999);
    if (error) throw error;
    rows.push(...(data as any[]));
    if (!data || data.length < 1000) break;
  }
  const v = rows.map(r => Number(r.signal_completeness_score)).filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p: number) => v[Math.floor(p * (v.length - 1))];
  console.log(`rows since 2026-06-01: ${rows.length}, with a completeness score: ${v.length}\n`);
  console.log(`  p01 ${q(0.01).toFixed(3)}   p10 ${q(0.10).toFixed(3)}   median ${q(0.50).toFixed(3)}` +
              `   p90 ${q(0.90).toFixed(3)}   p99 ${q(0.99).toFixed(3)}`);
  console.log(`  mean ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)}`);
  const byMonth = new Map<string, number[]>();
  for (const r of rows) {
    const m = String(r.run_date).slice(0, 7);
    const s = Number(r.signal_completeness_score);
    if (!Number.isFinite(s)) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(s);
  }
  console.log('\nby month (FMP premium expired 2026-07-06):');
  for (const m of [...byMonth.keys()].sort()) {
    const a = byMonth.get(m)!;
    console.log(`  ${m}  n=${String(a.length).padStart(5)}  mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3)}`);
  }
  const flagged = rows.filter(r => r.unreliable_reason).length;
  console.log(`\nrows flagged unreliable: ${flagged} / ${rows.length} (${(100 * flagged / rows.length).toFixed(1)}%)`);
}
main();
