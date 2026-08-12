/**
 * (2) WHERE DOES THE ACCUMULATOR DRIFT COME FROM?
 *
 * realised_pnl_cumulative is a running total (PotService.ts:819: prev + thisRun), so it can
 * only drift if a run's increment disagrees with the exits that actually happened. Walk it
 * DAY BY DAY -- there are ~3 runs a day but exit_date is only a date, so a position closing
 * on day D cannot be attributed to a specific run -- and compare:
 *
 *   actual   = last-snapshot-of-day(D).cumulative - last-snapshot-of-day(D-1).cumulative
 *   expected = sum(realised_pnl) over positions with exit_date == D
 *
 * A day where those disagree is a day the ledger and the accumulator parted company. The
 * pattern across days (and whether the exit_reason of that day's closes is distinctive)
 * should identify the mechanism.
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
  const snaps = await page<any>((f, t) => supabase.from('pot_snapshots')
    .select('pot_id, run_date, realised_pnl_cumulative').order('run_date', { ascending: true }).range(f, t));
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('pot_id, symbol, exit_date, realised_pnl, exit_reason, direction').eq('status', 'closed').range(f, t));

  // last snapshot of each (pot, day)
  const daily = new Map<string, { pot: number; day: string; cum: number }>();
  for (const s of snaps) {
    const day = String(s.run_date).slice(0, 10);
    daily.set(`${s.pot_id}|${day}`, { pot: s.pot_id, day, cum: s.realised_pnl_cumulative ?? 0 });
  }

  const pots = [...new Set(snaps.map(s => s.pot_id))].sort((a, b) => a - b);
  const offenders: any[] = [];
  for (const potId of pots) {
    const days = [...daily.values()].filter(d => d.pot === potId).sort((a, b) => a.day.localeCompare(b.day));
    let prev = 0;
    for (const d of days) {
      const actual = d.cum - prev;
      const closes = pos.filter(p => p.pot_id === potId && p.exit_date === d.day);
      const expected = closes.reduce((a, b) => a + (b.realised_pnl ?? 0), 0);
      if (Math.abs(actual - expected) > 0.5) {
        offenders.push({
          pot: potId, day: d.day, actual, expected, gap: actual - expected,
          nCloses: closes.length,
          reasons: [...new Set(closes.map(c => c.exit_reason))].join(','),
          symbols: closes.map(c => c.symbol).join(','),
        });
      }
      prev = d.cum;
    }
  }

  console.log(`days where the accumulator disagrees with the ledger: ${offenders.length}\n`);
  console.log('pot  day         actual£   expected£      gap£  closes  exit_reasons          symbols');
  console.log('-'.repeat(104));
  for (const o of offenders.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 30))
    console.log(`${String(o.pot).padStart(3)}  ${o.day}  ${o.actual.toFixed(2).padStart(9)}` +
      `${o.expected.toFixed(2).padStart(11)}${o.gap.toFixed(2).padStart(10)}  ${String(o.nCloses).padStart(6)}  ` +
      `${(o.reasons || '-').padEnd(20)}  ${o.symbols.slice(0, 30)}`);

  console.log('\n--- gap totals by pot ---');
  const byPot = new Map<number, { gap: number; days: number }>();
  for (const o of offenders) {
    const e = byPot.get(o.pot) ?? { gap: 0, days: 0 };
    e.gap += o.gap; e.days++;
    byPot.set(o.pot, e);
  }
  for (const [p, v] of [...byPot.entries()].sort((a, b) => Math.abs(b[1].gap) - Math.abs(a[1].gap)))
    console.log(`  pot ${String(p).padStart(2)}: ${String(v.days).padStart(3)} bad days, net gap £${v.gap.toFixed(2)}`);

  console.log('\n--- is the gap concentrated on days with NO closes (phantom increments)? ---');
  const phantom = offenders.filter(o => o.nCloses === 0);
  const missed = offenders.filter(o => o.nCloses > 0 && Math.abs(o.actual) < 0.01);
  console.log(`  days the accumulator moved with NO ledger closes: ${phantom.length} (net £${phantom.reduce((a, b) => a + b.gap, 0).toFixed(2)})`);
  console.log(`  days the ledger closed but the accumulator did NOT move: ${missed.length} (net £${missed.reduce((a, b) => a + b.gap, 0).toFixed(2)})`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
