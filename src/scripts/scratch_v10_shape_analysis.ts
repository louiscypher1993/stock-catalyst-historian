/**
 * v10 shape analysis: pure recon against already-computed synthetic_pots/
 * v10_history_sweep.db::pot_scores -- no new event-scoring. For each trait,
 * bins its 19 grid values while holding the other 5 traits within a
 * tolerance band of their (non-dead-band) median, reporting mean score per
 * bin so shape (monotonic/U/inverted-U/flat) is visible directly rather than
 * assumed from a linear regression coefficient.
 *
 * Exact-match conditioning (all 5 other traits pinned to one value) yields
 * N=0 -- the 40,000 pots are a sparse sample over a ~47M-point 6-dim grid,
 * not a dense grid themselves. Uses a +/-2.0 tolerance band instead (checked
 * empirically: gives full 19-bin coverage, min bin ~20-25 pots at the
 * sampled-space edges). Every bin reports its N; anything under ~30 is
 * flagged as low-trust per the request, not silently smoothed over.
 *
 * Dead-band handling: when varying patience itself, dead-band pots are kept
 * (the 1M dead zone, patience in (4.5,6.5], is a real, inherent part of
 * patience's shape) but each bin reports dead_band_frac so a structurally-
 * forced zero isn't mistaken for a "patience is bad here" quality signal.
 * When varying any OTHER trait, dead-band pots are excluded from the
 * conditioning pool -- holding patience within +/-2 of its median (4.5) pulls
 * in some patience values from the dead 1M band (5/5.5/6/6.5), which would
 * otherwise dilute the other trait's own shape with unrelated zeros.
 */
import Database from 'better-sqlite3';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWEEP_DB = path.join(__dirname, '..', '..', 'synthetic_pots', 'v10_history_sweep.db');
const TOL = 2.0;
const LOW_TRUST_N = 30;

const TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity'] as const;
type Trait = typeof TRAITS[number];

interface PotRow {
  pot_id: number; boldness: number; ambition: number; patience: number; conviction: number; focus: number; reactivity: number;
  dead_band: number; score_all_a: number; score_entered_a: number | null; participation_a: number;
  score_all_b: number; score_entered_b: number | null; participation_b: number;
}

const db = new Database(SWEEP_DB);
const allPots: PotRow[] = db.prepare('SELECT * FROM pot_scores').all() as any;
const nonDead = allPots.filter(p => p.dead_band === 0);

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const MEDIAN: Record<Trait, number> = {} as any;
for (const t of TRAITS) MEDIAN[t] = median(nonDead.map(p => p[t]));
console.log('Medians (non-dead-band pots):', MEDIAN);

interface Bin {
  value: number; n: number;
  meanAllA: number; meanEnteredA: number | null; nEnteredA: number; meanPartA: number;
  meanAllB: number; meanEnteredB: number | null; nEnteredB: number; meanPartB: number;
  deadBandFrac: number;
}

function analyzeTrait(varied: Trait): Bin[] {
  const others = TRAITS.filter(t => t !== varied);
  const pool = varied === 'patience' ? allPots : nonDead;
  const inWindow = pool.filter(p => others.every(o => Math.abs(p[o] - MEDIAN[o]) <= TOL));

  const byValue = new Map<number, PotRow[]>();
  for (const p of inWindow) {
    const v = p[varied];
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(p);
  }

  const bins: Bin[] = [];
  for (const [value, rows] of [...byValue.entries()].sort((a, b) => a[0] - b[0])) {
    const n = rows.length;
    const meanAllA = rows.reduce((s, r) => s + r.score_all_a, 0) / n;
    const meanAllB = rows.reduce((s, r) => s + r.score_all_b, 0) / n;
    const meanPartA = rows.reduce((s, r) => s + r.participation_a, 0) / n;
    const meanPartB = rows.reduce((s, r) => s + r.participation_b, 0) / n;
    const enteredA = rows.filter(r => r.score_entered_a !== null);
    const enteredB = rows.filter(r => r.score_entered_b !== null);
    const meanEnteredA = enteredA.length ? enteredA.reduce((s, r) => s + (r.score_entered_a as number), 0) / enteredA.length : null;
    const meanEnteredB = enteredB.length ? enteredB.reduce((s, r) => s + (r.score_entered_b as number), 0) / enteredB.length : null;
    const deadBandFrac = rows.filter(r => r.dead_band === 1).length / n;
    bins.push({ value, n, meanAllA, meanEnteredA, nEnteredA: enteredA.length, meanPartA, meanAllB, meanEnteredB, nEnteredB: enteredB.length, meanPartB, deadBandFrac });
  }
  return bins;
}

function shapeOf(bins: Bin[], field: 'meanAllA' | 'meanAllB'): string {
  const trustworthy = bins.filter(b => b.n >= LOW_TRUST_N);
  if (trustworthy.length < 4) return 'insufficient trustworthy bins to characterize';
  const xs = trustworthy.map(b => b.value);
  const ys = trustworthy.map(b => b[field]);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < n; i++) { cov += (xs[i] - meanX) * (ys[i] - meanY); varX += (xs[i] - meanX) ** 2; varY += (ys[i] - meanY) ** 2; }
  const corr = (varX > 0 && varY > 0) ? cov / Math.sqrt(varX * varY) : 0;

  const peakIdx = ys.indexOf(Math.max(...ys));
  const troughIdx = ys.indexOf(Math.min(...ys));
  const isEndpoint = (i: number) => i === 0 || i === n - 1;

  if (Math.abs(corr) >= 0.7) return `monotonic ${corr > 0 ? 'increasing' : 'decreasing'} (corr=${corr.toFixed(2)})`;
  if (!isEndpoint(peakIdx) && Math.abs(corr) < 0.4) return `inverted-U, peak at ${xs[peakIdx]} (corr=${corr.toFixed(2)})`;
  if (!isEndpoint(troughIdx) && Math.abs(corr) < 0.4) return `U-shaped, trough at ${xs[troughIdx]} (corr=${corr.toFixed(2)})`;
  const range = Math.max(...ys) - Math.min(...ys);
  const relRange = meanY !== 0 ? Math.abs(range / meanY) : range;
  if (relRange < 0.3) return `flat/noisy -- no defensible optimal range (corr=${corr.toFixed(2)}, range/mean=${relRange.toFixed(2)})`;
  return `mixed/noisy (corr=${corr.toFixed(2)}, peak at ${xs[peakIdx]}, trough at ${xs[troughIdx]})`;
}

function printBins(varied: Trait, bins: Bin[]) {
  console.log(`\n=== ${varied} (holding others within +/-${TOL} of median, N=${bins.reduce((s, b) => s + b.n, 0)} total) ===`);
  console.log('value'.padStart(6) + 'N'.padStart(6) + 'deadFrac'.padStart(9) + 'meanAllA'.padStart(11) + 'meanEntA'.padStart(11) + 'partA'.padStart(8) + 'meanAllB'.padStart(11) + 'meanEntB'.padStart(11) + 'partB'.padStart(8));
  for (const b of bins) {
    const flag = b.n < LOW_TRUST_N ? ' *LOW-N*' : '';
    console.log(
      String(b.value).padStart(6) + String(b.n).padStart(6) + b.deadBandFrac.toFixed(2).padStart(9) +
      b.meanAllA.toFixed(2).padStart(11) + (b.meanEnteredA?.toFixed(2) ?? 'n/a').padStart(11) + b.meanPartA.toFixed(3).padStart(8) +
      b.meanAllB.toFixed(2).padStart(11) + (b.meanEnteredB?.toFixed(2) ?? 'n/a').padStart(11) + b.meanPartB.toFixed(3).padStart(8) + flag
    );
  }
  console.log(`Shape (score_all, a): ${shapeOf(bins, 'meanAllA')}`);
  console.log(`Shape (score_all, b): ${shapeOf(bins, 'meanAllB')}`);
}

const results: Record<Trait, Bin[]> = {} as any;
for (const t of TRAITS) {
  results[t] = analyzeTrait(t);
  printBins(t, results[t]);
}

// ── Triple context: ambition+patience+focus ─────────────────────────────
// "best-performing region" per trait = value with the highest meanAllA among
// trustworthy bins (N>=30) from the single-trait analysis above.
function bestValue(bins: Bin[]): number {
  const trustworthy = bins.filter(b => b.n >= LOW_TRUST_N);
  const pool = trustworthy.length ? trustworthy : bins;
  return pool.reduce((best, b) => (b.meanAllA > best.meanAllA ? b : best), pool[0]).value;
}
const BEST: Record<'ambition' | 'patience' | 'focus', number> = {
  ambition: bestValue(results.ambition),
  patience: bestValue(results.patience),
  focus: bestValue(results.focus),
};
console.log('\n=== Best-performing single-trait values (score_all_a peak among N>=30 bins) ===');
console.log(BEST);

function analyzeTripleContext(varied: 'ambition' | 'patience' | 'focus'): Bin[] {
  const tripleOthers = (['ambition', 'patience', 'focus'] as const).filter(t => t !== varied);
  const outsideTriple = TRAITS.filter(t => !(['ambition', 'patience', 'focus'] as const).includes(t as any));
  const pool = varied === 'patience' ? allPots : nonDead;
  const inWindow = pool.filter(p => {
    for (const o of tripleOthers) if (Math.abs(p[o] - BEST[o]) > TOL) return false;
    for (const o of outsideTriple) if (Math.abs(p[o] - MEDIAN[o]) > TOL) return false;
    return true;
  });
  const byValue = new Map<number, PotRow[]>();
  for (const p of inWindow) {
    const v = p[varied];
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v)!.push(p);
  }
  const bins: Bin[] = [];
  for (const [value, rows] of [...byValue.entries()].sort((a, b) => a[0] - b[0])) {
    const n = rows.length;
    const meanAllA = rows.reduce((s, r) => s + r.score_all_a, 0) / n;
    const meanAllB = rows.reduce((s, r) => s + r.score_all_b, 0) / n;
    const meanPartA = rows.reduce((s, r) => s + r.participation_a, 0) / n;
    const meanPartB = rows.reduce((s, r) => s + r.participation_b, 0) / n;
    const enteredA = rows.filter(r => r.score_entered_a !== null);
    const enteredB = rows.filter(r => r.score_entered_b !== null);
    const meanEnteredA = enteredA.length ? enteredA.reduce((s, r) => s + (r.score_entered_a as number), 0) / enteredA.length : null;
    const meanEnteredB = enteredB.length ? enteredB.reduce((s, r) => s + (r.score_entered_b as number), 0) / enteredB.length : null;
    const deadBandFrac = rows.filter(r => r.dead_band === 1).length / n;
    bins.push({ value, n, meanAllA, meanEnteredA, nEnteredA: enteredA.length, meanPartA, meanAllB, meanEnteredB, nEnteredB: enteredB.length, meanPartB, deadBandFrac });
  }
  return bins;
}

console.log('\n\n########## TRIPLE CONTEXT: ambition+patience+focus ##########');
console.log(`Holding the other two of the triple at their single-trait best value (+/-${TOL}); boldness/conviction/reactivity held at overall median (+/-${TOL}).`);
for (const varied of ['ambition', 'patience', 'focus'] as const) {
  const bins = analyzeTripleContext(varied);
  console.log(`\n--- varying ${varied}, holding {${(['ambition', 'patience', 'focus'] as const).filter(t => t !== varied).map(t => `${t}=${BEST[t]}`).join(', ')}} ---`);
  printBins(varied, bins);
}

db.close();
