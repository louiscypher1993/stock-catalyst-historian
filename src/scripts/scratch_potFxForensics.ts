/**
 * Are the 4 scale-broken positions a LIVE hole or unrepaired pre-F8 residue?
 * F8 (point-in-time FX conversion for high-nominal currencies) landed 2026-07-14 (934a36e).
 * If these positions were ENTERED before that and exited after, their entry price is
 * legacy-unconverted while the exit price is converted -- residue, and the fix is a data
 * repair, not a code change. If any were entered AFTER 2026-07-14, the code still has a hole.
 */
import 'dotenv/config';

const F8 = '2026-07-14';

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data, error } = await supabase.from('pot_positions')
    .select('id, pot_id, symbol, direction, status, entry_date, exit_date, entry_price, exit_price, current_price, shares, position_size_gbp, realised_pnl, exit_reason')
    .order('entry_date');
  if (error) throw error;
  const pos = data ?? [];

  const inr = pos.filter((p: any) => /\.(NS|BO)$/.test(p.symbol));
  console.log(`INR-market positions: ${inr.length} (of ${pos.length} total)\n`);
  console.log('id    pot sym              status  entry_date  exit_date   entry_px    exit_px   ratio  pnl£     entered');
  console.log('-'.repeat(112));
  for (const p of inr as any[]) {
    const px = p.exit_price ?? p.current_price;
    const ratio = px && p.entry_price ? px / p.entry_price : NaN;
    const era = p.entry_date >= F8 ? 'POST-F8' : 'pre-F8';
    console.log(
      `${String(p.id).padStart(5)}${String(p.pot_id).padStart(4)} ${String(p.symbol).padEnd(16)}` +
      `${String(p.status).padEnd(8)}${String(p.entry_date).padEnd(12)}${String(p.exit_date ?? '-').padEnd(12)}` +
      `${String(p.entry_price).padStart(9)}${String(px ?? '-').padStart(11)}` +
      `${(Number.isFinite(ratio) ? ratio.toFixed(1) : '-').padStart(8)}` +
      `${(p.realised_pnl ?? 0).toFixed(0).padStart(8)}  ${era}`);
  }

  const broken = (pos as any[]).filter(p =>
    p.status === 'closed' && p.direction === 'long' && p.position_size_gbp &&
    Math.abs(p.realised_pnl / p.position_size_gbp) > 1);
  console.log(`\nscale-broken CLOSED positions: ${broken.length}`);
  const postF8 = broken.filter(b => b.entry_date >= F8);
  console.log(`  entered POST-F8 (would mean a live code hole): ${postF8.length}`);
  console.log(`  entered pre-F8  (unrepaired residue):          ${broken.length - postF8.length}`);

  const openBroken = (pos as any[]).filter(p =>
    p.status === 'open' && p.current_price && p.entry_price &&
    Math.abs(p.current_price / p.entry_price - 1) > 1);
  console.log(`\nOPEN positions with >100% implied move (still corrupting live marks): ${openBroken.length}`);
  for (const o of openBroken)
    console.log(`  id ${o.id} pot ${o.pot_id} ${o.symbol} entry ${o.entry_price} current ${o.current_price} ` +
      `(${(100 * (o.current_price / o.entry_price - 1)).toFixed(0)}%) entered ${o.entry_date}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
