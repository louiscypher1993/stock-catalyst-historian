/**
 * READ-ONLY AUDIT — writes nothing, to any store.
 *
 * Two questions, per TODO.md's top-of-queue item:
 *
 *  1. Does `position_size_gbp` satisfy the entry invariant from
 *     PotService.ts:887-888, i.e. `position_size_gbp === shares * entry_price`?
 *       - HOLDS  -> the size field is an honest record; the defect is upstream
 *                   (portfolioValue, or a native-currency entryPrice at the
 *                   Math.floor(positionGBP/entryPrice) step on :882). realised_pnl
 *                   is then internally consistent and only the COST RATIO is hurt.
 *       - BREAKS -> position_size_gbp alone is corrupt. Because the 2026-08-12 FX
 *                   repair wrote `newRet = newPnl / position_size_gbp`
 *                   (scratch_potFxRepairPreview.ts:38), any overlapping row's
 *                   realised_return_pct inherited the error, and the headline
 *                   -0.448%/trade is contaminated too.
 *
 *  2. Could `portfolioValue / focus` (PotService.ts:876) legitimately have
 *     produced a GBP 4-16 position on that entry date? Cross-checked against the
 *     pot's own snapshot portfolio_value at/just before entry.
 */
import 'dotenv/config';

const UNDERSIZED_GBP = 100;             // well below the ~GBP 1,250 sizing rule
const FX_REPAIR_EXITS = ['2026-07-14', '2026-07-15', '2026-07-16'];

async function page<T>(q: (f: number, t: number) => any): Promise<T[]> {
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

const n = (v: any) => (v == null ? null : Number(v));
const f2 = (v: any, d = 2) => (v == null ? '   —   ' : Number(v).toFixed(d));

async function main() {
  const { supabase } = await import('../db/supabaseClient');

  const positions = await page<any>((f, t) => supabase.from('pot_positions')
    .select('id, pot_id, symbol, direction, status, entry_date, entry_price, shares, ' +
            'position_size_gbp, exit_date, exit_price, realised_pnl, realised_return_pct, exit_reason')
    .order('id', { ascending: true }).range(f, t));

  const pots = await page<any>((f, t) => supabase.from('pots')
    .select('pot_id, name, focus, starting_balance').range(f, t));

  const snaps = await page<any>((f, t) => supabase.from('pot_snapshots')
    .select('pot_id, run_date, portfolio_value, realised_pnl_cumulative')
    .order('run_date', { ascending: true }).range(f, t));

  const potById = new Map<number, any>(pots.map(p => [p.pot_id, p]));
  const snapsByPot = new Map<number, any[]>();
  for (const s of snaps) {
    if (!snapsByPot.has(s.pot_id)) snapsByPot.set(s.pot_id, []);
    snapsByPot.get(s.pot_id)!.push(s);
  }

  /** Latest snapshot on or before `date` for a pot (falls back to earliest after). */
  const snapAt = (potId: number, date: string) => {
    const list = snapsByPot.get(potId) ?? [];
    let best: any = null;
    for (const s of list) if (s.run_date <= date) best = s;
    return best ?? list[0] ?? null;
  };

  console.log(`pot_positions rows: ${positions.length}  (pots: ${pots.length}, snapshots: ${snaps.length})`);

  // ── Population reconciliation (105 vs 84) ───────────────────────────────────
  const closed = positions.filter(p => p.status === 'closed');
  const closedWithRet = closed.filter(p => p.realised_return_pct != null);
  const closedCostable = closedWithRet.filter(p => p.position_size_gbp);
  console.log('\n=== POPULATION RECONCILIATION ===');
  console.log(`  status='closed'                              : ${closed.length}`);
  console.log(`     ...with realised_return_pct non-null      : ${closedWithRet.length}`);
  console.log(`     ...and position_size_gbp truthy (cost n)  : ${closedCostable.length}`);
  console.log(`  status='open'                                : ${positions.filter(p => p.status === 'open').length}`);

  // ── Invariant check across EVERY row ────────────────────────────────────────
  type Row = {
    p: any; implied: number | null; ratio: number | null;
    undersized: boolean; fxOverlap: boolean;
  };
  const rows: Row[] = positions.map(p => {
    const sh = n(p.shares), ep = n(p.entry_price), sz = n(p.position_size_gbp);
    const implied = sh != null && ep != null ? sh * ep : null;
    const ratio = implied != null && sz ? implied / sz : null;
    return {
      p, implied, ratio,
      undersized: sz != null && sz > 0 && sz < UNDERSIZED_GBP,
      fxOverlap: p.status === 'closed' && FX_REPAIR_EXITS.includes(String(p.exit_date)),
    };
  });

  const breaks = rows.filter(r => r.ratio != null && Math.abs(r.ratio - 1) > 0.02);
  console.log('\n=== INVARIANT  position_size_gbp === shares * entry_price ===');
  console.log(`  rows checkable            : ${rows.filter(r => r.ratio != null).length}`);
  console.log(`  rows violating by >2%     : ${breaks.length}`);
  if (breaks.length) {
    const rs = breaks.map(r => r.ratio!).sort((a, b) => a - b);
    console.log(`  violation ratio (implied/stored) min ${f2(rs[0], 3)}  ` +
      `median ${f2(rs[Math.floor(rs.length / 2)], 3)}  max ${f2(rs[rs.length - 1], 3)}`);
  }

  // ── The undersized cohort ───────────────────────────────────────────────────
  const under = rows.filter(r => r.undersized).sort((a, b) =>
    Number(a.p.position_size_gbp) - Number(b.p.position_size_gbp));

  console.log(`\n=== UNDERSIZED COHORT (position_size_gbp < GBP ${UNDERSIZED_GBP}) — n=${under.length} ===`);
  console.log('id     pot sym          st     entry_date  entry_px    shares  size_gbp  sh*px      ratio  ret%      pnl_gbp   fx?');
  for (const r of under) {
    const p = r.p;
    console.log(
      `${String(p.id).padStart(5)}  ${String(p.pot_id).padStart(3)} ${String(p.symbol).padEnd(12)} ` +
      `${String(p.status).padEnd(6)} ${String(p.entry_date).padEnd(11)} ` +
      `${f2(p.entry_price, 4).padStart(10)} ${String(p.shares).padStart(7)} ` +
      `${f2(p.position_size_gbp).padStart(9)} ${f2(r.implied).padStart(10)} ` +
      `${f2(r.ratio, 3).padStart(7)} ${f2(p.realised_return_pct == null ? null : 100 * Number(p.realised_return_pct), 2).padStart(8)} ` +
      `${f2(p.realised_pnl).padStart(9)}  ${r.fxOverlap ? 'YES' : '-'}`);
  }

  // ── Q2: could portfolioValue/focus have produced this? ──────────────────────
  console.log('\n=== SIZING CROSS-CHECK  (expected = portfolio_value / focus at entry) ===');
  console.log('id     pot name                 focus  snap_date   portfolio_val  expected_size  actual_size  actual/expected');
  for (const r of under) {
    const p = r.p;
    const pot = potById.get(p.pot_id);
    const s = snapAt(p.pot_id, String(p.entry_date));
    const pv = n(s?.portfolio_value);
    const focus = n(pot?.focus);
    const expected = pv != null && focus ? pv / focus : null;
    const sz = n(p.position_size_gbp);
    console.log(
      `${String(p.id).padStart(5)}  ${String(p.pot_id).padStart(3)} ${String(pot?.name ?? '?').padEnd(20)} ` +
      `${String(focus ?? '?').padStart(5)}  ${String(s?.run_date ?? '—').padEnd(11)} ` +
      `${f2(pv).padStart(13)} ${f2(expected).padStart(14)} ${f2(sz).padStart(12)} ` +
      `${f2(expected && sz ? sz / expected : null, 4).padStart(16)}`);
  }

  // ── FX-repair overlap, stated explicitly ────────────────────────────────────
  const fxRows = rows.filter(r => r.fxOverlap);
  console.log(`\n=== FX-REPAIR WINDOW (exit_date in ${FX_REPAIR_EXITS.join('/')}) — n=${fxRows.length} ===`);
  console.log('id     pot sym          exit_date   exit_px     size_gbp   pnl_gbp    ret%      undersized?');
  for (const r of fxRows) {
    const p = r.p;
    console.log(
      `${String(p.id).padStart(5)}  ${String(p.pot_id).padStart(3)} ${String(p.symbol).padEnd(12)} ` +
      `${String(p.exit_date).padEnd(11)} ${f2(p.exit_price, 4).padStart(10)} ` +
      `${f2(p.position_size_gbp).padStart(10)} ${f2(p.realised_pnl).padStart(10)} ` +
      `${f2(p.realised_return_pct == null ? null : 100 * Number(p.realised_return_pct), 2).padStart(9)}   ` +
      `${r.undersized ? '*** YES ***' : 'no'}`);
  }

  const overlap = under.filter(r => r.fxOverlap);
  console.log(`\nOVERLAP (undersized AND in the FX-repair window): ${overlap.length}` +
    (overlap.length ? `  -> ${overlap.map(r => `${r.p.symbol}#${r.p.id}`).join(', ')}` : ''));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
