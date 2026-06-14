#!/usr/bin/env npx tsx
/**
 * initPots.ts — One-time seeder for the POTS multi-agent system.
 * File: src/scripts/initPots.ts
 *
 * Run with: npx tsx src/scripts/initPots.ts
 *
 * Safe to inspect before committing. Aborts if pots table already has rows.
 */

import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

// ── Distributions ──────────────────────────────────────────────────────────────

/** U(1,10) at 0.5 resolution → 19 values: 1.0, 1.5, 2.0, …, 10.0 */
function rollHalfStep(min = 1.0, max = 10.0): number {
  const steps = Math.round((max - min) / 0.5); // 18 intervals
  const idx = Math.floor(Math.random() * (steps + 1));
  return min + idx * 0.5;
}

/** U(1,10) integers */
function rollInteger(min = 1, max = 10): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Name pools ─────────────────────────────────────────────────────────────────

/**
 * Combo keys are checked first when two traits are closely tied for dominance.
 * Key format: dominant_trait_direction (e.g. "high_B") or combo "high_B_high_C".
 * Listed combos in priority order (most specific first).
 */
const NAME_POOLS: Record<string, readonly string[]> = {
  // Combo keys — checked before single traits
  high_B_high_C: ['The Stubborn Gambler', 'The Iron Fist'],
  high_B_low_C:  ['The Reckless Flipper', 'The Wild Card'],
  high_A_low_P:  ['The Impatient Hunter', 'The Quick Draw'],
  low_B_high_C:  ['The Cautious Holder', 'The Safe Keeper'],
  high_R_low_B:  ['The Nervous Watcher', 'The Anxious One'],
  high_A_high_R: ['The Hungry Hawk', 'The Trigger Happy'],
  low_P_high_B:  ['The Reckless Sprinter', 'The Kamikaze'],

  // Single trait keys
  high_B:   ['The Daredevil', 'The Cowboy', 'The Gambler'],
  low_B:    ['The Monk', 'The Tortoise', 'The Cautious One'],
  high_A:   ['The Hunter', 'The Overachiever', 'The Dreamer'],
  low_A:    ['The Realist', 'The Conservative', 'The Modest'],
  high_P:   ['The Marathon Runner', 'The Elder', 'The Stoic'],
  low_P:    ['The Sprinter', 'The Flash', 'The Day Trader'],
  high_C:   ['Diamond Hands', 'The Loyalist', 'The Mule'],
  low_C:    ['Glass Hands', 'The Jumpy', 'The Fickle'],
  low_F:    ['The Sniper', 'The Whale', 'The All-In'],
  high_F:   ['The Scattergun', 'The Hedgehog', 'The Diversifier'],
  high_R:   ['The Hawk', 'The Scanner', 'The Vigilant'],
  low_R:    ['The Sloth', 'The Set-and-Forget', 'The Slumberer'],

  // Fallback
  balanced: ['The Fox', 'Steady Eddie', 'The Opportunist', 'The Balanced', 'The Pragmatist'],
};

interface PotChars {
  boldness:   number;
  ambition:   number;
  patience:   number;
  conviction: number;
  focus:      number;
  reactivity: number;
}

/** Returns the NAME_POOLS key that best describes this pot's personality. */
function resolveNameKey(c: PotChars): string {
  const MID = 5.5;

  const traits = [
    { key: c.boldness   >= MID ? 'high_B' : 'low_B', dev: Math.abs(c.boldness   - MID) },
    { key: c.ambition   >= MID ? 'high_A' : 'low_A', dev: Math.abs(c.ambition   - MID) },
    { key: c.patience   >= MID ? 'high_P' : 'low_P', dev: Math.abs(c.patience   - MID) },
    { key: c.conviction >= MID ? 'high_C' : 'low_C', dev: Math.abs(c.conviction - MID) },
    { key: c.focus      >= MID ? 'high_F' : 'low_F', dev: Math.abs(c.focus      - MID) },
    { key: c.reactivity >= MID ? 'high_R' : 'low_R', dev: Math.abs(c.reactivity - MID) },
  ];

  // Sort by deviation descending
  traits.sort((a, b) => b.dev - a.dev);

  const maxDev    = traits[0].dev;
  const secondDev = traits[1].dev;

  // Nothing stands out — balanced
  if (maxDev < 1.5) return 'balanced';

  // Try combo key if top two are close (within 0.5 deviation of each other)
  if (secondDev >= 1.5 && Math.abs(maxDev - secondDev) <= 0.5) {
    const k1 = `${traits[0].key}_${traits[1].key}`;
    const k2 = `${traits[1].key}_${traits[0].key}`;
    if (NAME_POOLS[k1]) return k1;
    if (NAME_POOLS[k2]) return k2;
  }

  // Use single dominant trait
  if (NAME_POOLS[traits[0].key]) return traits[0].key;

  return 'balanced';
}

/** Pick a name from the pool, avoiding already-used names. Falls back to balanced then numbered. */
function pickName(key: string, usedNames: Set<string>): string {
  const tryPool = (poolKey: string): string | null => {
    const pool = NAME_POOLS[poolKey];
    if (!pool) return null;
    const available = (pool as string[]).filter(n => !usedNames.has(n));
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  };

  // Try primary pool
  const primary = tryPool(key);
  if (primary) return primary;

  // Try balanced fallback
  const balanced = tryPool('balanced');
  if (balanced) return balanced;

  // Last resort: numbered suffix from any pool
  const allNames = Object.values(NAME_POOLS).flat();
  for (let i = 2; i <= 10; i++) {
    const candidate = `${allNames[0]} ${i}`;
    if (!usedNames.has(candidate)) return candidate;
  }
  throw new Error('Could not generate unique name — add more names to NAME_POOLS');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== POTS Seeder ===\n');

  // Guard: abort if already seeded
  const { data: existing, error: checkErr } = await supabase.from('pots').select('pot_id');
  if (checkErr) {
    console.error('❌ Supabase check failed:', checkErr.message);
    process.exit(1);
  }
  if (existing && existing.length > 0) {
    console.error(`❌ pots table already has ${existing.length} rows. Aborting.`);
    console.error('   To reseed from scratch: DELETE FROM pots; in Supabase SQL editor.');
    process.exit(1);
  }

  const usedNames = new Set<string>();
  const pots: Array<PotChars & { name: string }> = [];

  for (let i = 0; i < 20; i++) {
    let attempts = 0;
    while (true) {
      const c: PotChars = {
        boldness:   rollHalfStep(),
        ambition:   rollHalfStep(),
        patience:   rollHalfStep(),
        conviction: rollHalfStep(),
        focus:      rollInteger(),
        reactivity: rollHalfStep(),
      };
      const key  = resolveNameKey(c);
      const name = pickName(key, usedNames);

      if (!usedNames.has(name)) {
        usedNames.add(name);
        pots.push({ ...c, name });
        break;
      }
      if (++attempts > 100) {
        throw new Error(`Could not find unique name for pot ${i + 1} after 100 attempts`);
      }
    }
  }

  // Print summary
  console.log('Generated 20 pots:\n');
  console.log('No  Name                            B     A     P     C     F     R');
  console.log('──  ──────────────────────────────  ────  ────  ────  ────  ──    ────');
  pots.forEach((p, i) => {
    const num = String(i + 1).padStart(2);
    const nm  = p.name.padEnd(32);
    const B   = p.boldness.toFixed(1).padStart(4);
    const A   = p.ambition.toFixed(1).padStart(4);
    const P   = p.patience.toFixed(1).padStart(4);
    const C   = p.conviction.toFixed(1).padStart(4);
    const F   = String(p.focus).padStart(2);
    const R   = p.reactivity.toFixed(1).padStart(4);
    console.log(`${num}  ${nm}  ${B}  ${A}  ${P}  ${C}  ${F}    ${R}`);
  });

  // Verify no duplicates
  const nameSet = new Set(pots.map(p => p.name));
  if (nameSet.size !== 20) {
    console.error('\n❌ Duplicate names detected — this should never happen.');
    process.exit(1);
  }

  console.log('\nWriting to Supabase...');

  const rows = pots.map(p => ({
    name:             p.name,
    boldness:         p.boldness,
    ambition:         p.ambition,
    patience:         p.patience,
    conviction:       p.conviction,
    focus:            p.focus,
    reactivity:       p.reactivity,
    starting_balance: 10000,
  }));

  const { data: inserted, error: insertErr } = await supabase
    .from('pots')
    .insert(rows)
    .select('pot_id, name');

  if (insertErr) {
    console.error('❌ Insert failed:', insertErr.message);
    process.exit(1);
  }

  console.log(`\n✅ ${inserted?.length ?? 0} pots seeded successfully.\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
