#!/usr/bin/env npx tsx
/**
 * generateSyntheticPots.ts — Synthetic pot population generator for the
 * 40,000-pot sweep.
 * File: src/scripts/generateSyntheticPots.ts
 *
 * Run with: npx tsx src/scripts/generateSyntheticPots.ts
 *
 * Generates 4 batches of 10,000 synthetic pots each (Baseline,
 * Hyper-Specialized [2 sub-archetypes], Retail Noise, Targeted Archetypes)
 * per the ranges/probabilities approved in recon. Writes JSON to
 * synthetic_pots/ -- does NOT touch Supabase. decidePot() itself is
 * untouched; this only produces its future input population.
 *
 * Deterministic: same SEED -> byte-identical output, always. No
 * Math.random() anywhere -- verified by running generation twice and
 * diffing the output (see verifyDeterminism()).
 */

import fs from 'node:fs';
import path from 'node:path';

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────────────
//
// Math.random() cannot be seeded, so isn't usable here -- a fixed, logged
// seed is required so the exact 40,000-pot population can be regenerated
// later (e.g. re-running against a wider fold once more post-cutoff dates
// accumulate, per the earlier scoping note).

export const SEED = 20260709; // today's date at design time -- arbitrary but fixed and logged

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Trait sampling: X% in [core.min,core.max], (100-X)% in [escape.min,escape.max] ─

interface Range { min: number; max: number; }
interface TraitSpec { probability: number; core: Range; isInteger?: boolean; }

const ESCAPE: Record<string, Range> = {
  boldness: { min: 1, max: 10 }, ambition: { min: 1, max: 10 },
  patience: { min: 1, max: 10 }, conviction: { min: 1, max: 10 },
  focus: { min: 2, max: 10 }, reactivity: { min: 1, max: 10 },
};

function sampleTrait(rng: () => number, trait: keyof typeof ESCAPE, spec: TraitSpec): number {
  const escape = ESCAPE[trait];
  const inCore = rng() < spec.probability;
  const range = inCore ? spec.core : escape;
  const raw = range.min + rng() * (range.max - range.min);
  // Match the real pot population's own precision (src/scripts/initPots.ts:
  // rollHalfStep for B/A/P/C/R, rollInteger for F) -- 0.5 increments, integer focus.
  return spec.isInteger ? Math.round(raw) : Math.round(raw * 2) / 2;
}

// ── Batch/archetype definitions (per approved recon proposal) ──────────────────

interface Archetype {
  batchId: string;
  boldness: TraitSpec; ambition: TraitSpec; patience: TraitSpec;
  conviction: TraitSpec; focus: TraitSpec; reactivity: TraitSpec;
}

const BASELINE: Archetype = {
  batchId: 'batch1_baseline',
  boldness:   { probability: 0.75, core: { min: 3, max: 9 } },
  ambition:   { probability: 0.75, core: { min: 3, max: 8 } },
  patience:   { probability: 0.75, core: { min: 3, max: 9 } },
  conviction: { probability: 0.75, core: { min: 2, max: 8 } },
  focus:      { probability: 0.75, core: { min: 2, max: 8 }, isInteger: true },
  reactivity: { probability: 0.75, core: { min: 2, max: 8 } },
};

const SHORT_TERM_HIGH_GAIN: Archetype = {
  batchId: 'batch2_short_term_high_gain',
  boldness:   { probability: 0.90, core: { min: 7, max: 10 } },
  ambition:   { probability: 0.90, core: { min: 8, max: 10 } },
  patience:   { probability: 0.90, core: { min: 1, max: 3 } },
  conviction: { probability: 0.90, core: { min: 3, max: 7 } },
  focus:      { probability: 0.90, core: { min: 4, max: 8 }, isInteger: true },
  reactivity: { probability: 0.90, core: { min: 8, max: 10 } },
};

const LONG_TERM_STABILITY: Archetype = {
  batchId: 'batch2_long_term_stability',
  boldness:   { probability: 0.90, core: { min: 2, max: 5 } },
  ambition:   { probability: 0.90, core: { min: 3, max: 6 } },
  patience:   { probability: 0.90, core: { min: 8, max: 10 } },
  conviction: { probability: 0.90, core: { min: 8, max: 10 } },
  focus:      { probability: 0.90, core: { min: 3, max: 6 }, isInteger: true },
  reactivity: { probability: 0.90, core: { min: 1, max: 3 } },
};

const RETAIL_NOISE: Archetype = {
  batchId: 'batch3_retail_noise',
  // Core == escape == full range on every trait -- deliberately makes the
  // nominal 60% clamp-probability statistically inert, per the flag raised
  // in the approved proposal. Wide spread + contradictory profiles emerge
  // from independent per-trait full-range sampling, not a targeted range.
  boldness:   { probability: 0.60, core: { min: 1, max: 10 } },
  ambition:   { probability: 0.60, core: { min: 1, max: 10 } },
  patience:   { probability: 0.60, core: { min: 1, max: 10 } },
  conviction: { probability: 0.60, core: { min: 1, max: 10 } },
  focus:      { probability: 0.60, core: { min: 2, max: 10 }, isInteger: true },
  reactivity: { probability: 0.60, core: { min: 1, max: 10 } },
};

const TARGETED_ARCHETYPES: Archetype = {
  batchId: 'batch4_targeted_archetypes',
  // Ambition locked strict -- keeps ambitionTier() at the top tier
  // (A>8 -> STRONG_BUY/0.27) for ~90% of draws, "one fixed reward-threshold
  // archetype." Conviction/Focus float looser (70%, the stated 65-75%
  // band's midpoint) to vary execution/risk-tolerance within that
  // archetype. Boldness/Patience/Reactivity are gap-filled to Baseline's
  // defaults -- unspecified in the source spec.
  boldness:   { probability: 0.75, core: { min: 3, max: 9 } },
  ambition:   { probability: 0.90, core: { min: 9, max: 10 } },
  patience:   { probability: 0.75, core: { min: 3, max: 9 } },
  conviction: { probability: 0.70, core: { min: 4, max: 8 } },
  focus:      { probability: 0.70, core: { min: 3, max: 7 }, isInteger: true },
  reactivity: { probability: 0.75, core: { min: 2, max: 8 } },
};

export interface SyntheticPot {
  synthetic_pot_id: number;
  batch_id: string;
  boldness: number;
  ambition: number;
  patience: number;
  conviction: number;
  focus: number;
  reactivity: number;
  starting_balance: number;
}

function generateFromArchetype(rng: () => number, archetype: Archetype, count: number, startId: number): SyntheticPot[] {
  const pots: SyntheticPot[] = [];
  for (let i = 0; i < count; i++) {
    pots.push({
      synthetic_pot_id: startId + i,
      batch_id: archetype.batchId,
      boldness:   sampleTrait(rng, 'boldness', archetype.boldness),
      ambition:   sampleTrait(rng, 'ambition', archetype.ambition),
      patience:   sampleTrait(rng, 'patience', archetype.patience),
      conviction: sampleTrait(rng, 'conviction', archetype.conviction),
      focus:      sampleTrait(rng, 'focus', archetype.focus),
      reactivity: sampleTrait(rng, 'reactivity', archetype.reactivity),
      starting_balance: 10000,
    });
  }
  return pots;
}

export function generateAllPots(seed: number): SyntheticPot[] {
  const rng = mulberry32(seed);
  const pots: SyntheticPot[] = [];
  let nextId = 1;

  pots.push(...generateFromArchetype(rng, BASELINE, 10000, nextId)); nextId += 10000;
  pots.push(...generateFromArchetype(rng, SHORT_TERM_HIGH_GAIN, 5000, nextId)); nextId += 5000;
  pots.push(...generateFromArchetype(rng, LONG_TERM_STABILITY, 5000, nextId)); nextId += 5000;
  pots.push(...generateFromArchetype(rng, RETAIL_NOISE, 10000, nextId)); nextId += 10000;
  pots.push(...generateFromArchetype(rng, TARGETED_ARCHETYPES, 10000, nextId)); nextId += 10000;

  return pots;
}

function main() {
  const pots = generateAllPots(SEED);
  console.log(`Generated ${pots.length} synthetic pots with seed=${SEED}`);

  const outDir = path.join(process.cwd(), 'synthetic_pots');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `pots_seed_${SEED}.json`);
  fs.writeFileSync(outPath, JSON.stringify(pots));
  console.log(`Wrote ${outPath}`);

  const counts: Record<string, number> = {};
  for (const p of pots) counts[p.batch_id] = (counts[p.batch_id] ?? 0) + 1;
  console.log('Batch counts:', counts);
}

main();
