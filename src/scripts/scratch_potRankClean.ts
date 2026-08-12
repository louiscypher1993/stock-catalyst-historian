/**
 * Clean pot ranking + blast radius of the entry/exit currency mismatch.
 *
 * Found 2026-08-12: four .NS/.BO positions show ~12,000% returns because entry_price was
 * stored GBP-converted while exit_price is native INR. £10,844 of £11,995 total 'patience'
 * P&L is phantom. Check whether other markets are affected (London quotes in PENCE, so a
 * pence/pound mismatch would give ~100x; JP/HK have their own scales), then rank on what
 * survives.
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
const suffix = (s: string) => (s.includes('.') ? '.' + s.split('.').pop() : 'US');
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const pots = await page<any>((f, t) => supabase.from('pots').select('*').order('pot_id').range(f, t));
  const pos = await page<any>((f, t) => supabase.from('pot_positions')
    .select('pot_id, symbol, direction, status, entry_date, exit_date, entry_price, exit_price, position_size_gbp, realised_pnl, realised_return_pct, exit_reason, patience_horizon')
    .eq('status', 'closed').range(f, t));

  console.log('=== BLAST RADIUS: implied entry/exit scale ratio by market ===');
  const byMkt: Record<string, { n: number; susp: number; rets: number[] }> = {};
  for (const p of pos) {
    const m = suffix(p.symbol);
    byMkt[m] ??= { n: 0, susp: 0, rets: [] };
    byMkt[m].n++;
    const r = p.realised_pnl / p.position_size_gbp;
    byMkt[m].rets.push(r);
    if (Math.abs(r) > 1) byMkt[m].susp++;
  }
  for (const [m, v] of Object.entries(byMkt).sort((a, b) => b[1].n - a[1].n)) {
    const rs = v.rets.slice().sort((a, b) => a - b);
    console.log(`  ${m.padEnd(6)} n=${String(v.n).padStart(3)}  |ret|>100%: ${v.susp}  ` +
      `median ${(100 * rs[Math.floor(rs.length / 2)]).toFixed(2)}%  max ${(100 * rs[rs.length - 1]).toFixed(1)}%`);
  }

  // exclusions: corrections are not outcomes; |ret|>100% on a long cash position is
  // impossible without a price-scale error.
  const BAD = (p: any) => p.exit_reason === 'manual_correction' ||
    (p.direction === 'long' && Math.abs(p.realised_pnl / p.position_size_gbp) > 1);
  const clean = pos.filter(p => !BAD(p));
  const dropped = pos.filter(BAD);
  console.log(`\nexcluded ${dropped.length} of ${pos.length} closed positions ` +
    `(${dropped.filter(d => d.exit_reason === 'manual_correction').length} corrections, ` +
    `${dropped.filter(d => d.exit_reason !== 'manual_correction').length} scale-broken)`);
  console.log(`phantom P&L removed: £${dropped.reduce((a, b) => a + (b.realised_pnl ?? 0), 0).toFixed(0)}`);
  console.log(`remaining total P&L: £${clean.reduce((a, b) => a + (b.realised_pnl ?? 0), 0).toFixed(0)} over ${clean.length} trades`);

  const rows = pots.map((p: any) => {
    const mine = clean.filter(c => c.pot_id === p.pot_id);
    const r = mine.map(m => m.realised_pnl / m.position_size_gbp);
    const pnl = mine.reduce((a, b) => a + b.realised_pnl, 0);
    const m0 = mean(r);
    const sd = r.length > 1 ? Math.sqrt(r.reduce((a, b) => a + (b - m0) ** 2, 0) / (r.length - 1)) : NaN;
    return {
      p, n: r.length, pnl, meanPct: 100 * m0,
      t: sd > 0 ? m0 / (sd / Math.sqrt(r.length)) : NaN,
      win: r.length ? r.filter(x => x > 0).length / r.length : NaN,
      horizon: [...new Set(mine.map(x => x.patience_horizon))].join('/'),
      ratio: p.ambition / p.reactivity,
    };
  }).filter((x: any) => x.n > 0).sort((a: any, b: any) => b.meanPct - a.meanPct);

  console.log('\n=== CLEAN RANKING (by mean return per trade; n shown because it decides everything) ===');
  console.log('rank pot                     n   pnl£   mean%     t   win%  bold  pat->horizon  ratio');
  console.log('-'.repeat(96));
  rows.forEach((x: any, i: number) => {
    const f = (v: number, d: number, w: number) => (Number.isFinite(v) ? v.toFixed(d) : '  -').padStart(w);
    console.log(`${String(i + 1).padStart(3)}  ${String(x.p.name).padEnd(22)}${String(x.n).padStart(3)}` +
      `${f(x.pnl, 0, 8)}${f(x.meanPct, 2, 8)}${f(x.t, 2, 6)}${f(100 * x.win, 0, 6)}` +
      `${String(x.p.boldness).padStart(6)}  ${String(x.p.patience).padStart(4)}->${String(x.horizon).padEnd(6)}${f(x.ratio, 2, 6)}`);
  });

  const meaningful = rows.filter((x: any) => x.n >= 8);
  console.log(`\npots with n>=8 closed trades: ${meaningful.length} of ${rows.length}`);
  const allr = clean.map(c => c.realised_pnl / c.position_size_gbp);
  console.log(`pooled: n=${allr.length}  mean ${(100 * mean(allr)).toFixed(3)}%  ` +
    `win ${(100 * allr.filter(x => x > 0).length / allr.length).toFixed(0)}%  ` +
    `total £${clean.reduce((a, b) => a + b.realised_pnl, 0).toFixed(0)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
