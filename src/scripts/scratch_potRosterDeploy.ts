/**
 * Deploy the roster-2 pots. DRY RUN by default; --apply writes to Supabase.
 *
 * DESIGN. Blocks A-C are the evidence design: one core at the measured optimum plus
 * one-factor-at-a-time variants, so any difference is ATTRIBUTABLE to one trait. Blocks
 * D-E exist purely to raise the data rate, using the two levers that control it:
 *   focus   -- PotService caps concurrent positions at `focus` and sizes each at 1/focus
 *              (PotService.ts:845,850), so focus 10 makes ~5x the trades of focus 2;
 *   patience-- 2D positions resolve in days, 2W in ~2 weeks, 3M in a quarter. Short
 *              horizons return outcomes an order of magnitude faster.
 * Both happen to align with what survived the time-split (focus 6-10, 2W best on
 * skill-per-unit-risk), so the fast blocks are not a compromise.
 *
 * HONEST LIMIT ON "MORE POTS = MORE DATA". Pots trade the SAME underlying signals -- on
 * 2026-08-12 pots 5/9/19 all bought PLBY in the same run. So extra pots buy RESOLUTION ON
 * SETTINGS, not extra independent market observations. The count of independent outcomes
 * is set by the scan, not by the pot roster. More pots cannot make a weak edge detectable;
 * they can only tell you which settings convert whatever edge exists into P&L.
 *
 * ratio = ambition/reactivity; threshold = H_BASE * ratio, so LOW ratio = low bar = trades
 * more. Sim: <1.0 negative, 1.2-3.5 good.
 * patience -> horizon: <=2.5 2D, <=4.5 2W, <=6.5 1M, <=8.5 3M, >8.5 6M.
 */
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const BAL = 10000;

interface Spec { name: string; boldness: number; ambition: number; patience: number; conviction: number; focus: number; reactivity: number; note: string }
const S = (name: string, boldness: number, ambition: number, patience: number, conviction: number, focus: number, reactivity: number, note: string): Spec =>
  ({ name, boldness, ambition, patience, conviction, focus, reactivity, note });

const ROSTER: Spec[] = [
  // ---- Block A: core + one-factor-at-a-time (the attributable design) ----
  S('R2 Core',          7, 6, 3.5, 5,  8, 3,   'measured optimum: bold 7, 2W, focus 8, ratio 2.0'),
  S('R2 Bold-5',        5, 6, 3.5, 5,  8, 3,   'low edge of the good boldness range'),
  S('R2 Bold-9',        9, 6, 3.5, 5,  8, 3,   'beyond it (8-10 identical in sim, NOT live)'),
  S('R2 Fast-2D',       7, 6, 2.0, 5,  8, 3,   'one horizon band down'),
  S('R2 Slow-1M',       7, 6, 5.5, 5,  8, 3,   'the band the sim calls harmful'),
  S('R2 Slowest-3M',    7, 6, 7.5, 5,  8, 3,   'two bands out'),
  S('R2 Focus-5',       7, 6, 3.5, 5,  5, 3,   'below the good focus range'),
  S('R2 Focus-10',      7, 6, 3.5, 5, 10, 3,   'top of range + max concurrency'),
  S('R2 Ratio-1.0',     7, 6, 3.5, 5,  8, 6,   'just under the good ratio band'),
  S('R2 Ratio-4.0',     7, 6, 3.5, 5,  8, 1.5, 'just over it'),
  S('R2 Conv-2',        7, 6, 3.5, 2,  8, 3,   'trait with no measured effect — does the null hold live?'),
  S('R2 Conv-8',        7, 6, 3.5, 8,  8, 3,   'ditto, other side'),

  // ---- Block B: ratio ladder at 2W (the surviving effect, at resolution) ----
  S('R2 Ratio-0.5',     7, 3, 3.5, 5,  8, 6,   'deep in the negative ratio band'),
  S('R2 Ratio-1.5',     7, 6, 3.5, 5,  8, 4,   'low edge of good'),
  S('R2 Ratio-2.5',     7, 5, 3.5, 5,  8, 2,   'mid'),
  S('R2 Ratio-3.5',     7, 7, 3.5, 5,  8, 2,   'high edge of good'),

  // ---- Block C: boldness ladder at 2W (strongest surviving effect) ----
  S('R2 Bold-3',        3, 6, 3.5, 5,  8, 3,   'negative-zone control'),
  S('R2 Bold-6',        6, 6, 3.5, 5,  8, 3,   'fills 5->7'),
  S('R2 Bold-8',        8, 6, 3.5, 5,  8, 3,   'fills 7->9'),

  // ---- Block D: 2D fast-data block (outcomes in days, focus 10 for volume) ----
  S('R2 Fast-Bold-5',   5, 6, 2.0, 5, 10, 3,   'fast data, low boldness'),
  S('R2 Fast-Bold-7',   7, 6, 2.0, 5, 10, 3,   'fast data, core boldness'),
  S('R2 Fast-Bold-9',   9, 6, 2.0, 5, 10, 3,   'fast data, high boldness'),

  // ---- Block E: high-concurrency 2W (most trades at the best horizon) ----
  S('R2 Wide-Ratio-3',  7, 6, 3.5, 5, 10, 2,   'focus 10 + ratio 3.0'),
  S('R2 Wide-Ratio-1',  9, 6, 3.5, 5, 10, 6,   'focus 10 + ratio 1.0, high boldness'),
];

async function main() {
  const { supabase } = await import('../db/supabaseClient');

  // uniqueness within the new roster
  const key = (s: any) => [s.boldness, s.ambition, s.patience, s.conviction, s.focus, s.reactivity].join('|');
  const seen = new Map<string, string>();
  for (const s of ROSTER) {
    if (seen.has(key(s))) { console.error(`DUPLICATE within roster: ${s.name} == ${seen.get(key(s))}`); process.exit(1); }
    seen.set(key(s), s.name);
  }

  const { data: existing, error } = await supabase.from('pots').select('*');
  if (error) throw error;
  const exKeys = new Map((existing ?? []).map((p: any) => [key(p), p.name]));
  const clashes = ROSTER.filter(s => exKeys.has(key(s)));

  console.log(`existing pots: ${existing?.length ?? 0}   new roster: ${ROSTER.length}   ` +
    `total after: ${(existing?.length ?? 0) + ROSTER.length}`);
  console.log(clashes.length
    ? `\nWARNING — ${clashes.length} new pots duplicate an existing pot's traits:\n` +
      clashes.map(c => `  ${c.name} == ${exKeys.get(key(c))}`).join('\n')
    : '\nno trait collisions with the existing 20 pots');

  const horizon = (p: number) => p <= 2.5 ? '2D' : p <= 4.5 ? '2W' : p <= 6.5 ? '1M' : p <= 8.5 ? '3M' : '6M';
  console.log(`\n${APPLY ? '*** APPLY MODE — WILL WRITE ***' : '--- DRY RUN — no writes ---'}\n`);
  console.log('name                 bold  amb   pat  conv  foc  react  ratio  horizon  note');
  console.log('-'.repeat(114));
  for (const s of ROSTER) {
    console.log(`${s.name.padEnd(20)}${String(s.boldness).padStart(5)}${String(s.ambition).padStart(5)}` +
      `${String(s.patience).padStart(6)}${String(s.conviction).padStart(6)}${String(s.focus).padStart(5)}` +
      `${String(s.reactivity).padStart(7)}${(s.ambition / s.reactivity).toFixed(2).padStart(7)}` +
      `${horizon(s.patience).padStart(8)}   ${s.note}`);
  }

  const byH: Record<string, number> = {};
  for (const s of ROSTER) byH[horizon(s.patience)] = (byH[horizon(s.patience)] ?? 0) + 1;
  const slots = ROSTER.reduce((a, s) => a + s.focus, 0);
  console.log(`\nhorizon mix: ${JSON.stringify(byH)}`);
  console.log(`max concurrent positions across the new roster: ${slots} (sum of focus)`);
  console.log(`capital simulated: £${(ROSTER.length * BAL).toLocaleString()} (paper — no real money)`);

  if (APPLY) {
    const rows = ROSTER.map(s => ({
      name: s.name, boldness: s.boldness, ambition: s.ambition, patience: s.patience,
      conviction: s.conviction, focus: s.focus, reactivity: s.reactivity, starting_balance: BAL,
    }));
    const { data: ins, error: e } = await supabase.from('pots').insert(rows).select('pot_id, name');
    if (e) throw e;
    console.log(`\nINSERTED ${ins?.length ?? 0} pots:`);
    for (const r of ins ?? []) console.log(`  pot_id ${r.pot_id}  ${r.name}`);
  } else {
    console.log('\nRe-run with --apply to insert. Existing pots are never modified.');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
