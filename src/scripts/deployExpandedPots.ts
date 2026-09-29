/**
 * deployExpandedPots.ts — add a small cohort of `universe = 'expanded'` pots that MIRROR
 * existing R2 pots trait-for-trait.
 *
 * DRY RUN BY DEFAULT. Pass --apply to insert.
 *
 * WHY MIRRORS RATHER THAN OPENING THE EXISTING POTS. If the current 44 pots were switched to
 * the expanded universe, their own histories would become a blend of two universes with no way
 * to separate before from after — exactly the error the 2026-08-09 parity boundary forced this
 * project to undo, where rows from 07-22..08-09 had to be EXCLUDED from every comparison
 * because averaging two regimes yields a number describing neither. Mirroring instead keeps the
 * originals as a clean control and makes the comparison paired: same traits, one variable
 * changed.
 *
 * WHY SIX AND NOT TWENTY-FOUR. Pots trade heavily overlapping signals — only ~30 distinct
 * symbols across 17 pots held positions in the August audit, with the top names held by 5-7
 * pots each. So extra pots buy resolution on SETTINGS, not extra independent market
 * observations, and N pots is nothing like N independent samples. Six matched pairs spread
 * across trait space detects a universe effect that interacts with traits, without pretending
 * to more power than exists.
 *
 * EXPECTATION MANAGEMENT: these start at zero closed trades. A 2W pot needs ~2 weeks per
 * outcome, so this is groundwork — it will say nothing about the October/December checkpoint.
 */
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');

/** Mirror these R2 pots exactly. Chosen to span the one-factor design rather than cluster:
 *  the measured optimum, both boldness edges, both ratio edges, and one non-2W horizon. */
const MIRROR = [
  'R2 Core',        // the measured optimum
  'R2 Bold-5',      // low edge of the workable boldness band
  'R2 Bold-9',      // beyond it
  'R2 Ratio-1.0',   // just under the good ambition/reactivity band
  'R2 Ratio-4.0',   // just over it
  'R2 Fast-2D',     // the only non-2W home horizon, for horizon coverage
];
const PREFIX = 'EXP ';

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const { data: pots, error } = await supabase.from('pots').select('*').order('pot_id');
  if (error) throw error;
  const all = pots ?? [];
  const byName = new Map(all.map((p: any) => [p.name, p]));

  console.log(`existing pots: ${all.length}`);
  const universes = new Map<string, number>();
  for (const p of all) universes.set(p.universe ?? '(null)', (universes.get(p.universe ?? '(null)') ?? 0) + 1);
  console.log(`  by universe: ${[...universes.entries()].map(([u, n]) => `${u}=${n}`).join(', ')}`);
  if (!all.length || all[0].universe === undefined) {
    console.error('\npots.universe column not found — apply the ALTER TABLE first.');
    process.exit(1);
  }

  const maxId = Math.max(...all.map((p: any) => Number(p.pot_id)));
  const rows: any[] = [];
  const problems: string[] = [];
  let nextId = maxId + 1;

  for (const name of MIRROR) {
    const src: any = byName.get(name);
    if (!src) { problems.push(`source pot '${name}' not found`); continue; }
    const newName = PREFIX + name.replace(/^R2 /, '');
    if (byName.has(newName)) { problems.push(`'${newName}' already exists — refusing to duplicate`); continue; }
    rows.push({
      pot_id: nextId++,
      name: newName,
      boldness: src.boldness, ambition: src.ambition, patience: src.patience,
      conviction: src.conviction, focus: src.focus, reactivity: src.reactivity,
      starting_balance: src.starting_balance,
      universe: 'expanded',
    });
  }

  console.log('\nproposed (traits copied verbatim from the mirrored pot):');
  console.log('  id   name                 bold  amb  pat conv  foc react  ratio  balance   mirrors');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log(`  ${String(r.pot_id).padStart(3)}  ${r.name.padEnd(20)} ${String(r.boldness).padStart(4)} ` +
      `${String(r.ambition).padStart(4)} ${String(r.patience).padStart(4)} ${String(r.conviction).padStart(4)} ` +
      `${String(r.focus).padStart(4)} ${String(r.reactivity).padStart(5)} ` +
      `${(r.ambition / r.reactivity).toFixed(2).padStart(6)} ${String(r.starting_balance).padStart(8)}   ${MIRROR[i]}`);
  }
  if (problems.length) { console.log('\nPROBLEMS:'); for (const p of problems) console.log(`  ⚠ ${p}`); }
  if (!rows.length || problems.length) {
    console.log('\nrefusing to proceed — resolve the problems above.');
    process.exit(1);
  }

  if (!APPLY) { console.log('\n--- DRY RUN — nothing written. Re-run with --apply. ---'); process.exit(0); }

  console.log('\n*** APPLY MODE — INSERTING ***');
  const { error: insErr } = await supabase.from('pots').insert(rows);
  if (insErr) { console.error('insert failed:', insErr.message); process.exit(1); }
  const { count } = await supabase.from('pots').select('*', { count: 'exact', head: true });
  console.log(`inserted ${rows.length}; pots now ${count}`);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
