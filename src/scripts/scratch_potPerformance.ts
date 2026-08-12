/**
 * Rank the 20 live pots to pick the 5-6 worth KEEPING as a comparison arm against the
 * proposed re-spec roster (TODO: pot roster re-spec).
 *
 * HEALTH WARNING BUILT IN. Ranking 20 pots on realised P&L is the same selection-on-noise
 * problem as picking the best of 770k sim configs, with a far smaller sample. So every rank
 * carries: n, the share of P&L from the single biggest trade, a t-stat on mean return, and
 * a first-half/second-half split. A pot leading on 6 trades, or on one trade, has not
 * demonstrated anything yet.
 *
 * Two success measures, because they answer different questions:
 *   portfolio_value / starting_balance  -- what the pot is actually worth (includes open
 *                                          marks, so it moves with unrealised positions)
 *   mean realised_return_pct            -- decision quality per closed trade, size-neutral
 */
import 'dotenv/config';

async function page<T>(q: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw error;
    const b = (data ?? []) as T[];
    out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

async function main() {
  const { supabase } = await import('../db/supabaseClient');

  const pots = await page<any>((f, t) => supabase.from('pots').select('*').order('pot_id').range(f, t));
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('pot_id, symbol, direction, status, entry_date, exit_date, realised_pnl, realised_return_pct, patience_horizon, exit_reason')
    .range(f, t));
  const snaps = await page<any>((f, t) => supabase.from('pot_snapshots')
    .select('pot_id, run_date, portfolio_value, realised_pnl_cumulative, open_positions_count')
    .order('run_date', { ascending: true }).range(f, t));

  console.log(`pots ${pots.length} | positions ${pos.length} | snapshots ${snaps.length}`);
  const closed = pos.filter(p => p.status === 'closed' && p.realised_return_pct != null);
  console.log(`closed positions: ${closed.length}   open: ${pos.filter(p => p.status === 'open').length}`);
  if (!closed.length) { console.log('nothing closed yet'); process.exit(0); }

  const ds = closed.map(c => c.exit_date).filter(Boolean).sort();
  const mid = ds[Math.floor(ds.length / 2)];
  console.log(`closed-trade window: ${ds[0]} .. ${ds[ds.length - 1]}   (split ${mid})`);
  const latest = new Map<number, any>();
  for (const s of snaps) latest.set(s.pot_id, s);   // ordered ascending, so last wins

  const rows = pots.map((p: any) => {
    const mine = closed.filter(c => c.pot_id === p.pot_id);
    const rets = mine.map(m => m.realised_return_pct as number);
    const pnl = mine.map(m => m.realised_pnl as number);
    const snap = latest.get(p.pot_id);
    const totRet = snap ? (snap.portfolio_value / p.starting_balance - 1) * 100 : NaN;
    const m = mean(rets);
    const sd = rets.length > 1
      ? Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) : NaN;
    const h1 = mine.filter(x => (x.exit_date ?? '') < mid).map(x => x.realised_return_pct as number);
    const h2 = mine.filter(x => (x.exit_date ?? '') >= mid).map(x => x.realised_return_pct as number);
    const totalPnl = pnl.reduce((a, b) => a + b, 0);
    const horizons = [...new Set(mine.map(x => x.patience_horizon))].join('/');
    return {
      p, n: rets.length, totRet, meanRet: m,
      t: sd > 0 ? m / (sd / Math.sqrt(rets.length)) : NaN,
      win: rets.filter(x => x > 0).length / (rets.length || 1),
      topShare: totalPnl !== 0 ? Math.max(...pnl.map(Math.abs)) / Math.abs(totalPnl) : NaN,
      h1: h1.length ? mean(h1) : NaN, h2: h2.length ? mean(h2) : NaN,
      n1: h1.length, n2: h2.length, horizons,
      openN: snap?.open_positions_count ?? 0,
    };
  }).sort((a: any, b: any) => (b.totRet || -Infinity) - (a.totRet || -Infinity));

  console.log('\nrank pot                    bold  amb  pat conv  foc react |  n  totRet%  meanRet%   t    win%  top%  h1%    h2%   split  horizon');
  console.log('-'.repeat(129));
  rows.forEach((x: any, i: number) => {
    const p = x.p;
    const split = (x.h1 > 0 && x.h2 > 0) ? 'both+' : (x.h1 < 0 && x.h2 < 0) ? 'both-' : 'FLIP';
    const f = (v: number, d = 1, w = 6) => (Number.isFinite(v) ? v.toFixed(d) : '  -').padStart(w);
    console.log(
      `${String(i + 1).padStart(3)}  ${String(p.name).padEnd(22)}${String(p.boldness).padStart(4)}${String(p.ambition).padStart(5)}` +
      `${String(p.patience).padStart(5)}${String(p.conviction).padStart(5)}${String(p.focus).padStart(5)}${String(p.reactivity).padStart(6)} |` +
      `${String(x.n).padStart(3)}${f(x.totRet, 2, 9)}${f(x.meanRet, 2, 10)}${f(x.t, 2, 6)}` +
      `${f(100 * x.win, 0, 7)}${f(100 * x.topShare, 0, 6)}${f(x.h1, 1, 7)}${f(x.h2, 1, 7)}  ${split.padEnd(6)} ${x.horizons}`);
  });

  console.log('\n--- ratio check on the leaders (ambition/reactivity; <1 was the negative band) ---');
  rows.slice(0, 8).forEach((x: any, i: number) =>
    console.log(`  ${i + 1}. ${String(x.p.name).padEnd(22)} ratio ${(x.p.ambition / x.p.reactivity).toFixed(2)}  ` +
      `patience ${x.p.patience} -> ${x.horizons || 'n/a'}  boldness ${x.p.boldness}`));

  const allRet = closed.map(c => c.realised_return_pct as number);
  console.log(`\nALL pots pooled: n=${allRet.length}  mean ${mean(allRet).toFixed(3)}%  ` +
    `win ${(100 * allRet.filter(x => x > 0).length / allRet.length).toFixed(0)}%`);
  const byReason: Record<string, number> = {};
  for (const c of closed) byReason[c.exit_reason ?? 'null'] = (byReason[c.exit_reason ?? 'null'] ?? 0) + 1;
  console.log('exit reasons:', byReason);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
