/**
 * checkpointReadout.ts — the October go/no-go question, asked honestly.
 *
 * THE QUESTION IS NOT "is the measured edge positive". It is: **given the evidence we
 * actually have, what can we rule out?** Those differ enormously here, and conflating
 * them is how a checkpoint turns into a coin flip dressed as a decision.
 *
 * THE OVERLAP PROBLEM, WHICH DOMINATES EVERYTHING ELSE. Day-clustering fixes correlation
 * WITHIN a run_date and does nothing about correlation ACROSS them. Consecutive run_dates'
 * 2W outcomes share 13 of their 14 days, so N run_dates is nowhere near N independent
 * observations. The project's power-budget work flagged this and could not act on it
 * ("19 days is far too few to estimate the autocorrelation"). It is now the binding
 * constraint, so this script confronts it directly rather than reporting a naive t:
 *
 *     effective independent windows  ~=  (calendar span of run_dates) / (horizon days)
 *
 * That is deliberately crude. Newey-West at lag = horizon is the principled fix, but with
 * a lag comparable to the sample length it cannot be estimated — so the honest move is a
 * transparent bound, not a sophisticated number resting on an unestimable nuisance.
 *
 * WHAT IS REPORTED. Per head: the naive day-clustered IC and t, the effective-n t, the
 * 95% CI on that basis, and then the only two questions that matter for a go/no-go:
 *   - does the CI exclude ZERO?          (is there a demonstrated edge?)
 *   - does the CI exclude the ANCHOR?    (is the training-time edge refuted?)
 * If neither is excluded, the data is UNDERPOWERED and the correct verdict is "cannot
 * tell yet" — which is a different finding from "no edge", and must not be reported as one.
 *
 * READ-ONLY.
 */
import 'dotenv/config';
import { roundTripCost } from '../costModel';

const PARITY = '2026-08-09', POSITION = 1250;
const HEADS = [
  { h: '2D', days: 2,  anchor: 0.0826 },
  { h: '2W', days: 14, anchor: 0.1111 },
  { h: '1M', days: 30, anchor: -0.0278 },
];
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a: number[]) => a.length < 2 ? NaN
  : Math.sqrt(a.reduce((s, b) => s + (b - mean(a)) ** 2, 0) / (a.length - 1));
function spearman(a: number[], b: number[]) {
  const rk = (xs: number[]) => { const i2 = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(xs.length).fill(0);
    for (let i = 0; i < i2.length;) { let j = i; while (j + 1 < i2.length && i2[j+1][0] === i2[i][0]) j++;
      const av = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[i2[k][1]] = av; i = j + 1; } return r; };
  const ra = rk(a), rb = rk(b), ma = mean(ra), mb = mean(rb);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { n += (ra[i]-ma)*(rb[i]-mb); da += (ra[i]-ma)**2; db += (rb[i]-mb)**2; }
  return da && db ? n / Math.sqrt(da*db) : 0;
}
const dayDiff = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('outcome_results')
      .select('symbol, run_date, horizon, predicted_return, actual_return, dividend_credit')
      .gte('run_date', PARITY).range(f, f + 999);
    if (error) throw error;
    rows.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  console.log(`=== OCTOBER CHECKPOINT READOUT — post-parity (>= ${PARITY}) ===`);
  console.log(`matured outcome rows: ${rows.length}\n`);

  for (const H of HEADS) {
    const use = rows.filter(r => r.horizon === H.h && r.predicted_return != null && r.actual_return != null);
    if (!use.length) { console.log(`\u25b8 ${H.h}: no matured rows\n`); continue; }
    const byDay = new Map<string, any[]>();
    for (const r of use) { const d = String(r.run_date).slice(0,10);
      if (!byDay.has(d)) byDay.set(d, []); byDay.get(d)!.push(r); }
    const days = [...byDay.keys()].sort();
    const ics: number[] = [];
    for (const d of days) {
      const g = byDay.get(d)!; if (g.length < 5) continue;
      const y = g.map(r => Number(r.actual_return));
      if (new Set(y).size < 2) continue;
      ics.push(spearman(g.map(r => Number(r.predicted_return)), y));
    }
    const span = dayDiff(days[0], days[days.length-1]) + 1;
    const nEff = Math.max(1, span / H.days);
    const m = mean(ics), s = sd(ics);
    const tNaive = s > 0 ? m / (s / Math.sqrt(ics.length)) : NaN;
    const tEff   = s > 0 ? m / (s / Math.sqrt(nEff)) : NaN;
    const half   = 1.96 * s / Math.sqrt(nEff);
    const lo = m - half, hi = m + half;
    const net = use.map(r => 100 * (Number(r.actual_return)
      - roundTripCost(r.symbol, POSITION).totalGBP / POSITION + Number(r.dividend_credit ?? 0)));

    console.log(`\u25b8 ${H.h}   n=${use.length} rows, ${ics.length} scored run_dates, span ${span} calendar days`);
    console.log(`    day-clustered IC   ${m>=0?'+':''}${m.toFixed(4)}   (naive t=${tNaive.toFixed(2)} on ${ics.length} days)`);
    console.log(`    EFFECTIVE independent windows  ~${nEff.toFixed(1)}   (span ${span}d / horizon ${H.days}d)`);
    console.log(`    honest t on that basis         ${tEff.toFixed(2)}`);
    console.log(`    95% CI for the IC              [${lo.toFixed(4)}, ${hi.toFixed(4)}]`);
    console.log(`      excludes ZERO?      ${lo > 0 || hi < 0 ? 'YES' : 'NO  <- no demonstrated edge'}`);
    console.log(`      excludes ANCHOR ${H.anchor >= 0 ? '+' : ''}${H.anchor.toFixed(4)}? ${lo > H.anchor || hi < H.anchor ? 'YES  <- training-time edge REFUTED' : 'NO  <- anchor still inside the interval'}`);
    console.log(`    mean net return @\u00a3${POSITION}  ${mean(net).toFixed(3)}%/trade  (unselective, all scored)`);
    const verdict = (lo > 0) ? 'EDGE DEMONSTRATED'
      : (hi < 0) ? 'NEGATIVE EDGE DEMONSTRATED'
      : (lo > H.anchor || hi < H.anchor) ? 'ANCHOR REFUTED, but no sign established'
      : 'UNDERPOWERED — cannot distinguish "no edge" from "edge as designed"';
    console.log(`    => ${verdict}\n`);
  }
  console.log('Reading: an interval containing BOTH zero and the anchor means the data has not');
  console.log('yet earned an opinion. That is not the same as a negative result, and a go/no-go');
  console.log('resting on it would be a coin flip wearing a verdict\u2019s clothes.');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
