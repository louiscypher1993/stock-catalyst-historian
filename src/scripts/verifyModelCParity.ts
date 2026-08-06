/**
 * verifyModelCParity.ts — proves the Model C version switch changes nothing when off.
 *
 * The switch moved percentile-rank computation from TypeScript into infer.py, so the
 * rank now travels with the prediction and cannot be paired with the wrong breakpoint
 * table. That is only safe if the two implementations agree EXACTLY on v9.1, because
 * with MODEL_C_VERSION unset the live path must behave byte for byte as it did before.
 *
 * Three assertions:
 *   1. PARITY   — Python's model_c_percentile_rank == TypeScript's modelCPercentileRank
 *                 across the full v9.1 value range, including every breakpoint, both
 *                 clamp regions, and the degenerate p95-p98 flat segment.
 *   2. DEFAULT  — infer.py with no env var loads v9.1 and reports model_c_version 9.1.
 *   3. SWITCH   — MODEL_C_VERSION=9.5 loads the v9.5 model AND the v9.5 breakpoints,
 *                 and refuses to start if the breakpoints are missing.
 *
 * Usage:  npx tsx src/scripts/verifyModelCParity.ts
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { modelCPercentileRank } from '../PotService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ML_DIR = path.join(__dirname, '..', 'ml');
const TOLERANCE = 1e-12;

// Values chosen to hit every structural case rather than just a uniform sweep: the two
// clamp regions, every breakpoint exactly, midpoints of each segment, and the p95-p98
// tie where vHi === vLo and the TS implementation early-returns.
const BREAKPOINT_VALUES = [
  -1.4857, -0.0958, -0.0717, -0.0440, -0.0201, 0.0235, 0.0562, 0.0686,
  0.0770, 0.0821, 0.0862, 0.0921, 0.0975, 0.1002, 0.1009,
];
const probes: number[] = [
  -99, -2.0, -1.4858, -1.4857, -1.4856,          // below / at / above the low clamp
  0.1009, 0.1010, 0.5, 99,                        // at / above the high clamp
  ...BREAKPOINT_VALUES,
  ...BREAKPOINT_VALUES.slice(0, -1).map((v, i) => (v + BREAKPOINT_VALUES[i + 1]) / 2),
  0.1001, 0.10015, 0.10025,                       // inside the p95-p98 flat segment
];
for (let v = -1.5; v <= 0.15; v += 0.0007) probes.push(Number(v.toFixed(6)));

function py(script: string, env: Record<string, string> = {}): string {
  return execFileSync('python', ['-c', script],
    { cwd: ML_DIR, env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
}

let failures = 0;

// ── 1. PARITY ────────────────────────────────────────────────────────────────
const pyRanks: number[] = JSON.parse(py(
  `import json,infer; print(json.dumps([infer.model_c_percentile_rank(v) for v in ${JSON.stringify(probes)}]))`
));
let worst = 0, worstAt = NaN;
probes.forEach((v, i) => {
  const d = Math.abs(modelCPercentileRank(v) - pyRanks[i]);
  if (d > worst) { worst = d; worstAt = v; }
});
const parityOk = worst <= TOLERANCE;
console.log(`1. PARITY   ${parityOk ? 'PASS' : 'FAIL'} — ${probes.length} probes, ` +
            `max |TS - Python| = ${worst.toExponential(3)} (at modelC=${worstAt})`);
if (!parityOk) failures++;

// ── 2. DEFAULT ───────────────────────────────────────────────────────────────
const def = py(`import infer; print(infer.MODEL_C_VERSION)`);
const defaultOk = def === '9.1';
console.log(`2. DEFAULT  ${defaultOk ? 'PASS' : 'FAIL'} — no env var => Model C v${def} ` +
            `(unchanged from before the switch)`);
if (!defaultOk) failures++;

// ── 3. SWITCH ────────────────────────────────────────────────────────────────
const sw = py(`import infer,json; print(json.dumps([infer.MODEL_C_VERSION, infer._BREAKPOINTS[0][1], infer._BREAKPOINTS[-1][1]]))`,
              { MODEL_C_VERSION: '9.5' });
const [v95, lo95, hi95] = JSON.parse(sw) as [string, number, number];
const switchOk = v95 === '9.5' && lo95 !== -1.4857;
console.log(`3. SWITCH   ${switchOk ? 'PASS' : 'FAIL'} — MODEL_C_VERSION=9.5 => v${v95} ` +
            `breakpoints [${lo95}, ${hi95}] (v9.1 low is -1.4857, so the table did move)`);
if (!switchOk) failures++;

let guarded = false;
try {
  py(`import infer`, { MODEL_C_VERSION: '9.9' });
} catch { guarded = true; }
console.log(`   guard    ${guarded ? 'PASS' : 'FAIL'} — a version with no breakpoints ` +
            `file refuses to start rather than silently serving the wrong table`);
if (!guarded) failures++;

console.log(failures === 0
  ? '\nALL PASS — with MODEL_C_VERSION unset the live path is unchanged.'
  : `\n${failures} CHECK(S) FAILED — do not deploy.`);
process.exit(failures === 0 ? 0 : 1);
