/**
 * Did rows get DELETED from pot_positions on 2026-07-07?
 * pot_positions.id is SERIAL, so deletions leave gaps in the sequence. If the accumulator
 * moved on a day with no surviving ledger closes AND there are id gaps, rows were removed
 * after the fact -- which would make the accumulator right and the ledger incomplete,
 * the opposite of what a naive "recompute from positions" repair would assume.
 */
import 'dotenv/config';

async function page<T>(q: (f: number, t: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw error;
    const b = (data ?? []) as T[];
    out.push(...b); if (b.length < 1000) break;
  }
  return out;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('id, pot_id, symbol, entry_date, exit_date, status, realised_pnl').order('id').range(f, t));

  console.log(`total position rows: ${pos.length}`);
  const ids = pos.map(p => p.id).sort((a, b) => a - b);
  console.log(`id range: ${ids[0]} .. ${ids[ids.length - 1]}  (expected ${ids[ids.length - 1] - ids[0] + 1} rows if none deleted)`);

  const missing: number[] = [];
  for (let i = ids[0]; i <= ids[ids.length - 1]; i++) if (!ids.includes(i)) missing.push(i);
  console.log(`MISSING ids: ${missing.length}` + (missing.length ? ` -> ${missing.slice(0, 40).join(', ')}${missing.length > 40 ? ' ...' : ''}` : ''));

  console.log(`\npositions with exit_date 2026-07-07: ${pos.filter(p => p.exit_date === '2026-07-07').length}`);
  const around = ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'];
  for (const d of around)
    console.log(`  exits on ${d}: ${pos.filter(p => p.exit_date === d).length}   entries: ${pos.filter(p => p.entry_date === d).length}`);

  // where do the surviving ids sit relative to the gap?
  if (missing.length) {
    const lo = Math.min(...missing), hi = Math.max(...missing);
    const before = pos.filter(p => p.id < lo).slice(-3);
    const after = pos.filter(p => p.id > hi).slice(0, 3);
    console.log('\nrows bracketing the gap:');
    for (const p of before) console.log(`  id ${p.id} pot ${p.pot_id} ${p.symbol} entry ${p.entry_date} exit ${p.exit_date ?? '-'} [${p.status}]`);
    console.log(`  --- ${missing.length} missing ids (${lo}..${hi}) ---`);
    for (const p of after) console.log(`  id ${p.id} pot ${p.pot_id} ${p.symbol} entry ${p.entry_date} exit ${p.exit_date ?? '-'} [${p.status}]`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
