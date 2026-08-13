/**
 * The expanded-scan health check showed median risk_score falling from ~38 (Aug 4-7) to
 * ~15-20 (Aug 10-11). The boundary sits between 2026-08-09 01:16 and 2026-08-10 02:33 --
 * i.e. the LIVE_FEATURE_PARITY=all cutover at 2026-08-09 12:07 UTC (fcbcaab), NOT the
 * universe expansion at 2026-08-10 10:29. This separates the two and asks whether the
 * 37-38 spike (TODO item 1) survived the parity fix.
 */
import 'dotenv/config';

const PARITY = '2026-08-09T12:07:00Z';

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: Array<{ risk_score: number | null; created_at: string; unreliable_reason: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('risk_score, created_at, unreliable_reason')
      .gte('created_at', '2026-07-22T00:00:00Z')
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    const b = data ?? [];
    rows.push(...b as any);
    if (b.length < 1000) break;
  }

  for (const [label, set] of [
    ['PRE-parity ', rows.filter(r => r.created_at < PARITY)],
    ['POST-parity', rows.filter(r => r.created_at >= PARITY)],
  ] as const) {
    const v = set.map(r => r.risk_score).filter((x): x is number => x != null).sort((a, b) => a - b);
    if (!v.length) { console.log(`${label}: no rows`); continue; }
    const hist = new Map<number, number>();
    for (const x of v) hist.set(x, (hist.get(x) ?? 0) + 1);
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const q = (p: number) => v[Math.floor(p * (v.length - 1))];
    console.log(`\n=== ${label} === n=${v.length}  distinct=${hist.size}`);
    console.log(`  p05=${q(.05)}  p25=${q(.25)}  p50=${q(.50)}  p75=${q(.75)}  p95=${q(.95)}`);
    console.log(`  most common: ${top.map(([s, c]) => `${s}(x${c})`).join('  ')}`);
    const spike = v.filter(x => x >= 37 && x <= 38).length;
    console.log(`  in 37-38 band: ${spike} of ${v.length} = ${(100 * spike / v.length).toFixed(1)}%`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
