/**
 * v10 recon: single/pairwise/triple-characteristic OLS regressions of pot
 * score (i)=score_all / (ii)=score_entered against the 6 pot traits
 * (boldness, ambition, patience, conviction, focus, reactivity), run
 * separately against population (a) [leakage-free] and (b) [full
 * post-2016, in-sample for ~78% -- "model fit to history", not a
 * performance claim]. Reads synthetic_pots/v10_history_sweep.db's
 * pot_scores table (written by scratch_v10_engine.ts). Local SQLite only.
 *
 * Structurally-inert (dead-band) pots are excluded from every regression.
 * score_entered regressions additionally exclude pots with zero
 * participation in that population (undefined "mean profit when entered").
 */
import Database from 'better-sqlite3';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SWEEP_DB = path.join(__dirname, '..', '..', 'synthetic_pots', 'v10_history_sweep.db');

const TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity'] as const;
type Trait = typeof TRAITS[number];

function combinations<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...rest] = arr;
  const withHead = combinations(rest, k - 1).map(c => [head, ...c]);
  const withoutHead = combinations(rest, k);
  return [...withHead, ...withoutHead];
}

// OLS via normal equations: X (n x k, col0=intercept), y (n). Returns coefficients + R^2.
function ols(X: number[][], y: number[]): { coefs: number[]; r2: number; n: number } {
  const n = y.length;
  const k = X[0].length;
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty: number[] = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  // Gauss-Jordan solve XtX * coefs = Xty
  const M = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    let pv = M[col][col];
    if (Math.abs(pv) < 1e-12) { pv = 1e-12; M[col][col] = pv; }
    for (let c = col; c <= k; c++) M[col][c] /= pv;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c <= k; c++) M[r][c] -= factor * M[col][c];
    }
  }
  const coefs = M.map(row => row[k]);

  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    let pred = 0;
    for (let a = 0; a < k; a++) pred += coefs[a] * X[i][a];
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { coefs, r2, n };
}

interface PotRow {
  pot_id: number; boldness: number; ambition: number; patience: number; conviction: number; focus: number; reactivity: number;
  dead_band: number; score_all_a: number; score_entered_a: number | null; participation_a: number;
  score_all_b: number; score_entered_b: number | null; participation_b: number;
}

const db = new Database(SWEEP_DB);
const rows: PotRow[] = db.prepare('SELECT * FROM pot_scores WHERE dead_band = 0').all() as any;
console.log(`Regression sample (non-dead-band pots): ${rows.length}`);

const rowsEnteredA = rows.filter(r => r.participation_a > 0);
const rowsEnteredB = rows.filter(r => r.participation_b > 0);
console.log(`  score_entered(a) sample (participation_a > 0): ${rowsEnteredA.length}`);
console.log(`  score_entered(b) sample (participation_b > 0): ${rowsEnteredB.length}`);

interface RegResult {
  traits: string; n: number; k: number;
  r2_a_all: number; r2_a_entered: number;
  r2_b_all: number; r2_b_entered: number;
  coefs_a_all: Record<string, number>; coefs_a_entered: Record<string, number>;
  coefs_b_all: Record<string, number>; coefs_b_entered: Record<string, number>;
}

function runFor(traitCombo: Trait[]): RegResult {
  const k = traitCombo.length + 1;
  const buildX = (sample: PotRow[]) => sample.map(r => [1, ...traitCombo.map(t => r[t])]);

  const yAllA = rows.map(r => r.score_all_a);
  const yAllB = rows.map(r => r.score_all_b);
  const yEntA = rowsEnteredA.map(r => r.score_entered_a as number);
  const yEntB = rowsEnteredB.map(r => r.score_entered_b as number);

  const resAllA = ols(buildX(rows), yAllA);
  const resAllB = ols(buildX(rows), yAllB);
  const resEntA = ols(buildX(rowsEnteredA), yEntA);
  const resEntB = ols(buildX(rowsEnteredB), yEntB);

  const toCoefMap = (coefs: number[]) => {
    const m: Record<string, number> = { intercept: coefs[0] };
    traitCombo.forEach((t, i) => { m[t] = coefs[i + 1]; });
    return m;
  };

  return {
    traits: traitCombo.join('+'), n: rows.length, k,
    r2_a_all: resAllA.r2, r2_a_entered: resEntA.r2, r2_b_all: resAllB.r2, r2_b_entered: resEntB.r2,
    coefs_a_all: toCoefMap(resAllA.coefs), coefs_a_entered: toCoefMap(resEntA.coefs),
    coefs_b_all: toCoefMap(resAllB.coefs), coefs_b_entered: toCoefMap(resEntB.coefs),
  };
}

const allCombos: Trait[][] = [
  ...combinations(TRAITS, 1),
  ...combinations(TRAITS, 2),
  ...combinations(TRAITS, 3),
];
console.log(`Running ${allCombos.length} regressions (6 single + 15 pairwise + 20 triple) x 2 populations x 2 score types...`);

const results = allCombos.map(runFor);

db.exec(`
  DROP TABLE IF EXISTS regressions;
  CREATE TABLE regressions (
    traits TEXT, n INTEGER, k INTEGER,
    r2_a_all REAL, r2_a_entered REAL, r2_b_all REAL, r2_b_entered REAL,
    coefs_a_all TEXT, coefs_a_entered TEXT, coefs_b_all TEXT, coefs_b_entered TEXT
  );
`);
const insert = db.prepare(`INSERT INTO regressions VALUES (@traits,@n,@k,@r2_a_all,@r2_a_entered,@r2_b_all,@r2_b_entered,@coefs_a_all,@coefs_a_entered,@coefs_b_all,@coefs_b_entered)`);
const insertMany = db.transaction((rs: RegResult[]) => {
  for (const r of rs) insert.run({
    traits: r.traits, n: r.n, k: r.k,
    r2_a_all: r.r2_a_all, r2_a_entered: r.r2_a_entered, r2_b_all: r.r2_b_all, r2_b_entered: r.r2_b_entered,
    coefs_a_all: JSON.stringify(r.coefs_a_all), coefs_a_entered: JSON.stringify(r.coefs_a_entered),
    coefs_b_all: JSON.stringify(r.coefs_b_all), coefs_b_entered: JSON.stringify(r.coefs_b_entered),
  });
});
insertMany(results);
console.log(`Wrote ${results.length} regression rows to ${SWEEP_DB}::regressions`);

// Console summary sorted by R^2 (score_all, population a) descending, per tier
function printTier(tierName: string, tierResults: RegResult[]) {
  console.log(`\n=== ${tierName} (sorted by R2 score_all, population a, descending) ===`);
  const sorted = [...tierResults].sort((x, y) => y.r2_a_all - x.r2_a_all);
  console.log('traits'.padEnd(28) + 'R2(a,all)'.padStart(11) + 'R2(a,ent)'.padStart(11) + 'R2(b,all)'.padStart(11) + 'R2(b,ent)'.padStart(11));
  for (const r of sorted) {
    console.log(
      r.traits.padEnd(28) +
      r.r2_a_all.toFixed(4).padStart(11) +
      r.r2_a_entered.toFixed(4).padStart(11) +
      r.r2_b_all.toFixed(4).padStart(11) +
      r.r2_b_entered.toFixed(4).padStart(11)
    );
  }
}
printTier('SINGLE-characteristic', results.filter(r => r.k === 2));
printTier('PAIRWISE-characteristic', results.filter(r => r.k === 3));
printTier('TRIPLE-characteristic', results.filter(r => r.k === 4));

db.close();
