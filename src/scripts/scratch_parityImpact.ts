/**
 * What do the two parity fixes actually do to live model inputs and outputs?
 *
 * LIVE_FEATURE_PARITY corrects two features the live path computes differently from the
 * training extractor:
 *   atr  atr_shock_score  -- live range/ATR (med 1.6034) vs training range/PRICE (0.0579)
 *   ced  competitor_event_density -- 0 on every live scan vs training median 30
 *
 * This rebuilds REAL live vectors for symbol/dates the live scanner itself flagged, under
 * each flag setting, and reports the effect on the served predictions. Nothing is enabled:
 * the flag is read from the environment per child invocation.
 *
 * The Model C flip earlier in this project is the reason this exists -- offline evidence
 * turned out not to describe live, and the check happened after the fact rather than
 * before. This is the before.
 *
 * Usage: npx tsx src/scripts/scratch_parityImpact.ts
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const OUT_DIR = path.join(process.cwd(), 'src', 'ml', 'scratch');
const MODES = ['', 'atr', 'ced', 'all'];

function run(mode: string): string {
  const dest = path.join(OUT_DIR, `parity_${mode || 'off'}.json`);
  execFileSync('npx', ['tsx', 'src/scripts/scratch_dumpLiveAnomalyVectors.ts', '50'], {
    env: { ...process.env, LIVE_FEATURE_PARITY: mode },
    stdio: 'ignore', shell: true,
  });
  fs.copyFileSync(path.join(OUT_DIR, 'live_anomaly_vectors.json'), dest);
  return dest;
}

for (const m of MODES) {
  const p = run(m);
  const blob = JSON.parse(fs.readFileSync(p, 'utf8'));
  const v = Object.values(blob.vectors) as any[];
  const med = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  console.log(`LIVE_FEATURE_PARITY=${(m || '<off>').padEnd(5)}  n=${v.length}  ` +
              `atr_shock_score med ${med(v.map(x => x.atr_shock_score)).toFixed(4).padStart(8)}  ` +
              `competitor_event_density med ${med(v.map(x => x.competitor_event_density)).toFixed(1).padStart(6)}`);
}
console.log(`\nwrote parity_*.json to ${OUT_DIR} — score them with src/ml/scratch_parity_score.py`);
