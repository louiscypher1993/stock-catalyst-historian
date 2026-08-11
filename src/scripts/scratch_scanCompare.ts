/** Per-run health across the expansion boundary: row volume, quarantine mix, and
 * expansion-cohort share. Windows are actual run spans confirmed via the Actions API. */
import 'dotenv/config';
import * as fs from 'fs';

const RUNS: Array<[string, string, string]> = [
  ['Fri 08-07 20:38 (pre-exp)', '2026-08-07T20:38:00Z', '2026-08-07T20:50:00Z'],
  ['Mon 08-10 08:21 (pre-exp)', '2026-08-10T08:20:00Z', '2026-08-10T08:32:00Z'],
  ['Mon 08-10 16:12 (EXPANDED)', '2026-08-10T16:12:00Z', '2026-08-10T16:29:00Z'],
  ['Mon 08-10 20:40 (EXPANDED)', '2026-08-10T20:40:00Z', '2026-08-10T21:01:00Z'],
  ['Tue 08-11 08:05 (EXPANDED)', '2026-08-11T08:05:00Z', '2026-08-11T08:21:00Z'],
];

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const expansion = JSON.parse(fs.readFileSync('src/universe_expansion.json', 'utf8'));
  const expSyms = new Set<string>(expansion.symbols.map((s: any) => s.symbol.toUpperCase()));

  for (const [label, from, to] of RUNS) {
    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supabase.from('inference_results')
        .select('symbol, unreliable_reason, risk_score, model_d5_return_2w')
        .gte('created_at', from).lt('created_at', to).range(off, off + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const exp = rows.filter(r => expSyms.has(r.symbol.toUpperCase()));
    const unrel = rows.filter(r => r.unreliable_reason).length;
    const risks = rows.map(r => r.risk_score).filter((v): v is number => v != null).sort((a, b) => a - b);
    const expLeaked = exp.filter(r => !r.unreliable_reason);
    console.log(`${label.padEnd(28)} rows=${String(rows.length).padStart(4)}  ` +
      `unreliable=${String(unrel).padStart(3)} (${(100 * unrel / Math.max(1, rows.length)).toFixed(0)}%)  ` +
      `expansion=${String(exp.length).padStart(3)}  ` +
      `risk_p50=${risks.length ? risks[Math.floor(risks.length / 2)] : 'n/a'}` +
      (expLeaked.length ? `  ** ${expLeaked.length} EXPANSION ROWS NOT QUARANTINED **` : ''));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
