/**
 * v10 recon: scores 40,000 synthetic pots' trait-buckets against two real
 * historical event populations --
 *   (a) the 10,051-row leakage-free test fold (historical_inference_results,
 *       true out-of-sample for the currently-deployed models)
 *   (b) 36,859 real post-2016 events, freshly scored by today's deployed
 *       model vintage (v9.3 B/D1/D2/D3/D5, v9.1 A/C/E, v9.2 D4 -- though
 *       only A/B/C/D1/D2/D3/D5 feed PotService.ts's gate logic) --
 *       IN-SAMPLE for ~78% of rows. Labeled "model fit to history, not
 *       out-of-sample performance" everywhere below, never as a return claim.
 *
 * Gate/tier/sizing logic transcribed verbatim from src/PotService.ts
 * (patienceHorizon, ambitionTier, shortScore, modelCPercentileRank,
 * resolveHorizonSignal, meetsEntryConditions, the inline short-entry gate) --
 * not reimplemented from memory. meetsSignalQualityGate is omitted: both
 * populations lack day_change_pct/volume_ratio/unreliable_reason, and the
 * gate fails OPEN (passes) whenever those are missing -- so it is always a
 * no-op here, exactly matching PotService.ts's own documented fallback.
 *
 * Simplification (stated once, per scope): full-horizon hold assumed for
 * every entry -- no stop-loss, no reactivity-driven exit, no patience-timeout
 * modeling mid-holding-period. This isolates signal-picking + sizing +
 * direction quality, not full exit-management quality.
 *
 * Local SQLite only. Reads synthetic_pots/v10_history_sweep.db (written by
 * scratch_v10_batch_infer_b.py and scratch_v10_extract_a.cjs) and
 * synthetic_pots/pots_seed_20260709.json. Writes results back into the same
 * local db. Never touches Supabase.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const SWEEP_DB = path.join(ROOT, 'synthetic_pots', 'v10_history_sweep.db');
const POTS_JSON = path.join(ROOT, 'synthetic_pots', 'pots_seed_20260709.json');

// ── Transcribed from PotService.ts (not reimplemented from memory) ─────────

const REC_RANK: Record<string, number> = { SELL: -2, REDUCE: -1, HOLD: 0, ADD: 1, BUY: 2, STRONG_BUY: 3 };

type HorizonLabel = '2D' | '2W' | '1M' | '3M' | '6M';

function patienceHorizon(patience: number): { label: HorizonLabel; modelField: string; truthField: string | null } {
  if (patience <= 2.5) return { label: '2D', modelField: 'model_d3_return_2d', truthField: 'forward_return_2d' };
  if (patience <= 4.5) return { label: '2W', modelField: 'model_d5_return_2w', truthField: 'forward_return_2w' };
  if (patience <= 6.5) return { label: '1M', modelField: 'model_b_return_1m', truthField: null }; // dead horizon (F4)
  if (patience <= 8.5) return { label: '3M', modelField: 'model_d1_return_3m', truthField: 'forward_return_3m' };
  return { label: '6M', modelField: 'model_d2_return_6m', truthField: 'forward_return_6m' };
}

function ambitionTier(ambition: number): { minRec: string; minReturn: number } {
  if (ambition <= 3.0) return { minRec: 'ADD', minReturn: 0.03 };
  if (ambition <= 6.0) return { minRec: 'BUY', minReturn: 0.12 };
  if (ambition <= 8.0) return { minRec: 'STRONG_BUY', minReturn: 0.21 };
  return { minRec: 'STRONG_BUY', minReturn: 0.27 };
}

function shortScore(boldness: number, reactivity: number, ambition: number): number {
  return boldness * 0.4 + reactivity * 0.4 + ambition * 0.2;
}

const MODEL_C_PERCENTILE_BREAKPOINTS: Array<[number, number]> = [
  [0.00, -1.4857], [0.01, -0.0958], [0.02, -0.0717], [0.05, -0.0440], [0.10, -0.0201],
  [0.20, 0.0235], [0.30, 0.0562], [0.40, 0.0686], [0.50, 0.0770], [0.60, 0.0821],
  [0.70, 0.0862], [0.80, 0.0921], [0.90, 0.0975], [0.95, 0.1002], [0.98, 0.1002],
  [0.99, 0.1009], [1.00, 0.1009],
];

function modelCPercentileRank(value: number): number {
  const bp = MODEL_C_PERCENTILE_BREAKPOINTS;
  if (value <= bp[0][1]) return bp[0][0];
  if (value >= bp[bp.length - 1][1]) return bp[bp.length - 1][0];
  for (let i = 1; i < bp.length; i++) {
    const [pHi, vHi] = bp[i];
    const [pLo, vLo] = bp[i - 1];
    if (value <= vHi) {
      if (vHi === vLo) return pHi;
      const frac = (value - vLo) / (vHi - vLo);
      return pLo + frac * (pHi - pLo);
    }
  }
  return 1;
}

// HORIZON_TIER_CONFIG, transcribed exactly (v9.3 recalibration values)
const TIER_CONFIG: Record<string, { strongBuy?: (v: number) => boolean; buy?: (v: number) => boolean; sell?: (v: number) => boolean }> = {
  model_d3_return_2d: { strongBuy: v => v >= 0.010831, sell: v => v <= -0.004385 },
  model_d5_return_2w: { strongBuy: v => v >= 0.031582, buy: v => v >= 0.024743 && v < 0.031582, sell: v => v <= -0.001411 },
  model_d1_return_3m: { strongBuy: v => v >= 0.057568 },
  model_d2_return_6m: { buy: v => v > 0.106656 },
  model_b_return_1m: {}, // deliberately empty -- always HOLD (F4 dead zone)
};

function resolveTier(value: number, cfg: typeof TIER_CONFIG[string]): 0 | 1 | 2 | 3 {
  // 0=HOLD 1=BUY 2=STRONG_BUY 3=SELL
  if (cfg.strongBuy?.(value)) return 2;
  if (cfg.buy?.(value)) return 1;
  if (cfg.sell?.(value)) return 3;
  return 0;
}

// ── Load pots ────────────────────────────────────────────────────────────

interface Pot {
  synthetic_pot_id: number; batch_id: string;
  boldness: number; ambition: number; patience: number; conviction: number;
  focus: number; reactivity: number; starting_balance: number;
}
const pots: Pot[] = JSON.parse(fs.readFileSync(POTS_JSON, 'utf-8'));
console.log(`Loaded ${pots.length} pots`);

// F4 dead-band (structurally-inert, corrected count from this session's F4 finding)
function isDeadBand(p: Pot): boolean {
  if (p.patience > 4.5 && p.patience <= 6.5) return true; // 1M horizon, always HOLD
  if (p.patience > 8.5 && p.ambition > 6.0) return true;  // 6M horizon, BUY ceiling < STRONG_BUY requirement
  return false;
}
const deadBandCount = pots.filter(isDeadBand).length;
console.log(`Dead-band (structurally-inert) pots: ${deadBandCount}/${pots.length}`);

// ── Bucket construction: (horizonLabel, ambition, boldness, reactivity) --
// focus/conviction/starting_balance do not affect gate-pass/direction, and
// raw patience only matters via which of 5 horizons it resolves to (no
// mid-horizon exit modeling to make the exact calendar length matter) --
// so this is the true minimal bucket, coarser than the raw 27,123-tuple
// count reported during recon. ─────────────────────────────────────────────

interface Bucket {
  key: string; horizonLabel: HorizonLabel; modelField: string; truthField: string | null;
  ambition: number; boldness: number; reactivity: number;
  potIds: number[]; // pot_ids sharing this bucket (any focus)
}
const buckets = new Map<string, Bucket>();
for (const p of pots) {
  const h = patienceHorizon(p.patience);
  const key = `${h.label}|${p.ambition}|${p.boldness}|${p.reactivity}`;
  let b = buckets.get(key);
  if (!b) {
    b = { key, horizonLabel: h.label, modelField: h.modelField, truthField: h.truthField, ambition: p.ambition, boldness: p.boldness, reactivity: p.reactivity, potIds: [] };
    buckets.set(key, b);
  }
  b.potIds.push(p.synthetic_pot_id);
}
console.log(`Distinct (horizonLabel, ambition, boldness, reactivity) buckets: ${buckets.size}`);

const rawTupleKeys = new Set(pots.map(p => `${p.patience}|${p.ambition}|${p.boldness}|${p.reactivity}`));
console.log(`(for comparison) distinct raw (patience,ambition,boldness,reactivity) tuples: ${rawTupleKeys.size}`);

// ── Load event populations ──────────────────────────────────────────────

const db = new Database(SWEEP_DB, { readonly: true });

interface EventRow {
  symbol: string; date: string;
  model_a_confidence: number; model_b_return_1m: number; model_c_max_drawdown: number;
  model_d1_return_3m: number; model_d2_return_6m: number; model_d3_return_2d: number; model_d5_return_2w: number;
  forward_return_2d: number | null; forward_return_2w: number | null; forward_return_3m: number | null; forward_return_6m: number | null;
}
const popA: EventRow[] = db.prepare('SELECT * FROM model_scores_a').all() as any;
const popB: EventRow[] = db.prepare('SELECT * FROM model_scores_b').all() as any;
console.log(`Population (a) [leakage-free test fold]: ${popA.length} events`);
console.log(`Population (b) [full post-2016 real events, in-sample for ~78%]: ${popB.length} events`);

const truthFieldOf: Record<HorizonLabel, keyof EventRow | null> = {
  '2D': 'forward_return_2d', '2W': 'forward_return_2w', '1M': null, '3M': 'forward_return_3m', '6M': 'forward_return_6m',
};
const modelFieldOf: Record<HorizonLabel, keyof EventRow> = {
  '2D': 'model_d3_return_2d', '2W': 'model_d5_return_2w', '1M': 'model_b_return_1m', '3M': 'model_d1_return_3m', '6M': 'model_d2_return_6m',
};

// Precompute per-(event, horizonLabel): tierCode, riskScore, riskReward, predicted value, truth value.
// Cheap part (percentile rank / tier resolution) done once per event per horizon, not once per bucket per event.
interface HorizonArrays { tierCode: Uint8Array; riskScore: Float64Array; riskReward: Float64Array; pred: Float64Array; truth: Float64Array; n: number; }

function precompute(pop: EventRow[]): Record<HorizonLabel, HorizonArrays> {
  const horizons: HorizonLabel[] = ['2D', '2W', '1M', '3M', '6M'];
  const result = {} as Record<HorizonLabel, HorizonArrays>;
  for (const h of horizons) {
    const n = pop.length;
    const tierCode = new Uint8Array(n);
    const riskScore = new Float64Array(n);
    const riskReward = new Float64Array(n);
    const pred = new Float64Array(n);
    const truth = new Float64Array(n);
    const cfg = TIER_CONFIG[modelFieldOf[h]];
    const truthField = truthFieldOf[h];
    for (let i = 0; i < n; i++) {
      const row = pop[i];
      const value = (row as any)[modelFieldOf[h]] as number;
      pred[i] = value;
      truth[i] = truthField ? ((row as any)[truthField] as number) ?? 0 : 0;
      const tier = resolveTier(value, cfg);
      tierCode[i] = tier;
      const modelA = row.model_a_confidence;
      const modelC = row.model_c_max_drawdown;
      const modelCRank = modelCPercentileRank(modelC);
      const confidenceTerm = (1 - modelA) * 30;
      const drawdownTerm = (1 - modelCRank) * 40;
      const tailRiskTerm = cfg.sell?.(value) ? 30 : 0;
      riskScore[i] = Math.round(Math.min(100, Math.max(0, drawdownTerm + confidenceTerm + tailRiskTerm)));
      riskReward[i] = Math.round((Math.abs(value) / Math.max(1 - modelCRank, 0.15)) * 100) / 100;
    }
    result[h] = { tierCode, riskScore, riskReward, pred, truth, n };
  }
  return result;
}

const preA = precompute(popA);
const preB = precompute(popB);

// ── Core bucket-scoring: unit profit (positionGBP=1) per bucket, per population ──

interface BucketOutcome { sumUnitAll: number; sumUnitEntered: number; countEntered: number; n: number; }

function scoreBucket(b: Bucket, pre: Record<HorizonLabel, HorizonArrays>): BucketOutcome {
  const arr = pre[b.horizonLabel];
  const tier = ambitionTier(b.ambition);
  const minRecRank = REC_RANK[tier.minRec];
  const riskCap = b.boldness * 10;
  const ambOver40 = b.ambition / 40;
  const canShortBase = shortScore(b.boldness, b.reactivity, b.ambition) >= 7.0;

  let sumUnitAll = 0, sumUnitEntered = 0, countEntered = 0;
  const n = arr.n;
  for (let i = 0; i < n; i++) {
    const tc = arr.tierCode[i];
    const rs = arr.riskScore[i];
    const rr = arr.riskReward[i];
    const pred = arr.pred[i];
    const truth = arr.truth[i];

    const longTierOK = (tc === 2) || (tc === 1 && 2 >= minRecRank);
    let unitProfit = 0;
    let entered = false;
    if (longTierOK && rs <= riskCap && pred >= tier.minReturn && rr >= ambOver40) {
      unitProfit = truth;
      entered = true;
    } else if (tc === 3 && canShortBase && rs <= riskCap && (-pred) >= tier.minReturn) {
      unitProfit = -truth;
      entered = true;
    }
    if (entered) { sumUnitAll += unitProfit; sumUnitEntered += unitProfit; countEntered++; }
  }
  return { sumUnitAll, sumUnitEntered, countEntered, n };
}

console.log('\nScoring buckets against population (a)...');
const t0 = Date.now();
const outcomesA = new Map<string, BucketOutcome>();
for (const b of buckets.values()) outcomesA.set(b.key, scoreBucket(b, preA));
const tA = Date.now() - t0;
console.log(`  done in ${tA}ms`);

console.log('Scoring buckets against population (b)...');
const t1 = Date.now();
const outcomesB = new Map<string, BucketOutcome>();
for (const b of buckets.values()) outcomesB.set(b.key, scoreBucket(b, preB));
const tB = Date.now() - t1;
console.log(`  done in ${tB}ms`);

// ── Per-pot scores ───────────────────────────────────────────────────────

interface PotScore { pot_id: number; scoreAll: number; scoreEntered: number | null; participation: number; }

function potScores(outcomes: Map<string, BucketOutcome>): Map<number, PotScore> {
  const result = new Map<number, PotScore>();
  for (const p of pots) {
    const h = patienceHorizon(p.patience);
    const key = `${h.label}|${p.ambition}|${p.boldness}|${p.reactivity}`;
    const o = outcomes.get(key)!;
    const positionGBP = 10000 / p.focus;
    const scoreAll = positionGBP * (o.sumUnitAll / o.n);
    const scoreEntered = o.countEntered > 0 ? positionGBP * (o.sumUnitEntered / o.countEntered) : null;
    const participation = o.countEntered / o.n;
    result.set(p.synthetic_pot_id, { pot_id: p.synthetic_pot_id, scoreAll, scoreEntered, participation });
  }
  return result;
}

const scoresA = potScores(outcomesA);
const scoresB = potScores(outcomesB);

// ── Determinism check: real full-duplicate (patience,ambition,boldness,reactivity,focus) pots ──

const fullTupleGroups = new Map<string, number[]>();
for (const p of pots) {
  const k = `${p.patience}|${p.ambition}|${p.boldness}|${p.reactivity}|${p.focus}`;
  if (!fullTupleGroups.has(k)) fullTupleGroups.set(k, []);
  fullTupleGroups.get(k)!.push(p.synthetic_pot_id);
}
const dupGroups = [...fullTupleGroups.values()].filter(g => g.length >= 2).slice(0, 8);
console.log(`\n=== Determinism check (${dupGroups.length} real duplicate-trait-vector groups) ===`);
let determinismOK = true;
for (const group of dupGroups) {
  const base = scoresA.get(group[0])!;
  const baseB = scoresB.get(group[0])!;
  for (const id of group.slice(1)) {
    const s = scoresA.get(id)!;
    const sB = scoresB.get(id)!;
    const okA = s.scoreAll === base.scoreAll && s.scoreEntered === base.scoreEntered && s.participation === base.participation;
    const okB = sB.scoreAll === baseB.scoreAll && sB.scoreEntered === baseB.scoreEntered && sB.participation === baseB.participation;
    if (!okA || !okB) determinismOK = false;
    console.log(`  pot ${group[0]} vs pot ${id}: (a) bit-identical=${okA}, (b) bit-identical=${okB}`);
  }
}
console.log(`Determinism check: ${determinismOK ? 'PASS' : 'FAIL'}`);

// ── Dead-band cross-check ───────────────────────────────────────────────

const deadPots = pots.filter(isDeadBand);
const deadNonZeroA = deadPots.filter(p => scoresA.get(p.synthetic_pot_id)!.scoreAll !== 0 || scoresA.get(p.synthetic_pot_id)!.participation !== 0);
const deadNonZeroB = deadPots.filter(p => scoresB.get(p.synthetic_pot_id)!.scoreAll !== 0 || scoresB.get(p.synthetic_pot_id)!.participation !== 0);
console.log(`\n=== Dead-band cross-check: ${deadPots.length} structurally-inert pots ===`);
console.log(`  Non-zero under (a): ${deadNonZeroA.length}, under (b): ${deadNonZeroB.length} (expect 0, 0)`);

// ── Write results to local sqlite ───────────────────────────────────────

db.close();
const outDb = new Database(SWEEP_DB);
outDb.exec(`
  DROP TABLE IF EXISTS pot_scores;
  CREATE TABLE pot_scores (
    pot_id INTEGER, batch_id TEXT, boldness REAL, ambition REAL, patience REAL, conviction REAL, focus REAL, reactivity REAL,
    dead_band INTEGER,
    score_all_a REAL, score_entered_a REAL, participation_a REAL,
    score_all_b REAL, score_entered_b REAL, participation_b REAL
  );
`);
const insert = outDb.prepare(`INSERT INTO pot_scores VALUES (@pot_id,@batch_id,@boldness,@ambition,@patience,@conviction,@focus,@reactivity,@dead_band,
  @score_all_a,@score_entered_a,@participation_a,@score_all_b,@score_entered_b,@participation_b)`);
const insertMany = outDb.transaction((rows: any[]) => { for (const r of rows) insert.run(r); });
insertMany(pots.map(p => {
  const sa = scoresA.get(p.synthetic_pot_id)!;
  const sb = scoresB.get(p.synthetic_pot_id)!;
  return {
    pot_id: p.synthetic_pot_id, batch_id: p.batch_id, boldness: p.boldness, ambition: p.ambition, patience: p.patience,
    conviction: p.conviction, focus: p.focus, reactivity: p.reactivity, dead_band: isDeadBand(p) ? 1 : 0,
    score_all_a: sa.scoreAll, score_entered_a: sa.scoreEntered, participation_a: sa.participation,
    score_all_b: sb.scoreAll, score_entered_b: sb.scoreEntered, participation_b: sb.participation,
  };
}));
console.log(`\nWrote ${pots.length} pot_scores rows to ${SWEEP_DB}`);
console.log(`\nTiming: (a) bucket-scoring ${tA}ms, (b) bucket-scoring ${tB}ms`);

// Zero-participation counts among non-dead-band pots (relevant for regression (ii) sample size)
const nonDead = pots.filter(p => !isDeadBand(p));
const zeroPartA = nonDead.filter(p => scoresA.get(p.synthetic_pot_id)!.participation === 0).length;
const zeroPartB = nonDead.filter(p => scoresB.get(p.synthetic_pot_id)!.participation === 0).length;
console.log(`Non-dead-band pots with zero participation: (a) ${zeroPartA}/${nonDead.length}, (b) ${zeroPartB}/${nonDead.length}`);

outDb.close();
