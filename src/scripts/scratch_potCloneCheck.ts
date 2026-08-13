/**
 * Glass Hands (pot 8) and The Stoic (pot 1) posted IDENTICAL returns and t-stats over 3
 * trades despite differing on patience, conviction, focus and reactivity. Is that a
 * defect (traits not actually influencing decisions) or benign (both simply took every
 * signal on offer, so the same small set)?
 *
 * Decisive test: compare the actual positions. Same symbols AND same dates = they saw the
 * same opportunity set and both took all of it, which is expected when the number of
 * qualifying signals is below BOTH pots' focus caps. Different symbols with identical
 * returns would be the real alarm.
 */
import 'dotenv/config';

async function page<T>(q: (f: number, t: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw error;
    const b = (data ?? []) as T[]; out.push(...b); if (b.length < 1000) break;
  }
  return out;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const pots = await page<any>((f, t) => supabase.from('pots').select('*').order('pot_id').range(f, t));
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('pot_id, symbol, direction, entry_date, exit_date, entry_price, exit_price, position_size_gbp, realised_pnl, realised_return_pct, status, patience_horizon')
    .range(f, t));

  const A = 1, B = 8;
  for (const id of [A, B]) {
    const p = pots.find((x: any) => x.pot_id === id);
    console.log(`pot ${id} ${p.name}: bold=${p.boldness} amb=${p.ambition} pat=${p.patience} ` +
      `conv=${p.conviction} focus=${p.focus} react=${p.reactivity} ratio=${(p.ambition / p.reactivity).toFixed(2)}`);
  }

  const sig = (x: any) => `${x.symbol}|${x.entry_date}|${x.direction}`;
  const a = pos.filter((x: any) => x.pot_id === A);
  const b = pos.filter((x: any) => x.pot_id === B);
  const sa = new Set(a.map(sig)), sb = new Set(b.map(sig));
  const both = [...sa].filter(s => sb.has(s));
  console.log(`\npot ${A}: ${a.length} positions | pot ${B}: ${b.length} positions | identical (symbol+date+dir): ${both.length}`);
  console.log(`only in ${A}: ${[...sa].filter(s => !sb.has(s)).join(', ') || '(none)'}`);
  console.log(`only in ${B}: ${[...sb].filter(s => !sa.has(s)).join(', ') || '(none)'}`);

  console.log('\nside by side:');
  for (const s of [...new Set([...sa, ...sb])].sort()) {
    const x = a.find((r: any) => sig(r) === s), y = b.find((r: any) => sig(r) === s);
    const f = (r: any) => r ? `£${Number(r.position_size_gbp).toFixed(0)} pnl £${r.realised_pnl == null ? '-' : Number(r.realised_pnl).toFixed(2)} ret ${r.realised_return_pct == null ? '-' : (100 * Number(r.realised_return_pct)).toFixed(2) + '%'} [${r.status}]` : '(absent)';
    console.log(`  ${s}\n      pot${A}: ${f(x)}\n      pot${B}: ${f(y)}`);
  }

  // How many pots hold each symbol? If most pots hold the same names, the roster is not
  // exploring the decision space -- it is one strategy replicated with different sizing.
  console.log('\n--- concurrency: how many DISTINCT pots hold each symbol? ---');
  const bySym = new Map<string, Set<number>>();
  for (const x of pos.filter((r: any) => r.status === 'open')) {
    if (!bySym.has(x.symbol)) bySym.set(x.symbol, new Set());
    bySym.get(x.symbol)!.add(x.pot_id);
  }
  const counts = [...bySym.entries()].map(([s, v]) => [s, v.size] as const).sort((p, q) => q[1] - p[1]);
  for (const [s, n] of counts.slice(0, 10)) console.log(`  ${String(s).padEnd(12)} held by ${n} pots`);
  const openPots = new Set(pos.filter((r: any) => r.status === 'open').map((r: any) => r.pot_id)).size;
  console.log(`  (${bySym.size} distinct symbols across ${openPots} pots with open positions)`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
