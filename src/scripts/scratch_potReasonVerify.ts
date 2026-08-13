/**
 * Verifies the trade-reason fix end-to-end through the real decidePot, not through
 * the helper in isolation — the point of the fix is that the LEDGER becomes readable,
 * so the assertion has to be on what decidePot actually emits.
 *
 * decidePot is pure (no Supabase, no HTTP, no wall clock — see its header), so a
 * synthetic snapshot exercises the identical code path live inference uses.
 *
 * Case 1 reproduces the defect that motivated the fix: pot 33's real configuration
 * (patience 3.5 -> 2W, ambition 3 -> minRec ADD), a D5 prediction inside the BUY band,
 * and a canonical recommendation of HOLD — i.e. getRecommendation's trend-opposition
 * downgrade fired but PotService's own tier resolution did not see it. Before the fix
 * this wrote "HOLD" against a BUY action.
 *
 * Case 2 is the control: same setup, canonical and gating tier agreeing. It must emit
 * a bare tier string, byte-identical to what every historical row holds — otherwise the
 * fix would silently reinterpret existing ledger data.
 */
import { decidePot } from '../PotService';

const basePot: any = {
  pot_id: 33, name: 'R2 Ratio-0.5', starting_balance: 10000,
  boldness: 7, ambition: 3, patience: 3.5, conviction: 5, focus: 8, reactivity: 5,
};

function resultRow(over: Record<string, unknown> = {}): any {
  return {
    symbol: 'COR', recommendation: 'HOLD',
    model_a_confidence: 0.99, model_c_max_drawdown: -0.05, model_c_percentile_rank: 0.9,
    model_b_return_1m: 0.0, model_d1_return_3m: 0.0, model_d2_return_6m: 0.0,
    model_d3_return_2d: 0.0,
    // Must satisfy BUY's band [0.024743, 0.031582) AND ambitionTier(3).minReturn of
    // 0.03 — the two constraints leave a narrow window, which is itself worth knowing.
    model_d5_return_2w: 0.0310,
    risk_score: 10, risk_reward_ratio: 5.0, current_price: 100,
    day_change_pct: 0.06, volume_ratio: 1.0, unreliable_reason: null,
    ...over,
  };
}

function run(label: string, rec: string) {
  const actions = decidePot({
    pot: basePot,
    results: [resultRow({ recommendation: rec })],
    openPositions: [],
    priceMap: { COR: 100 },
    prevRealisedPnl: 0,
    runDateStr: '2026-08-13T08:25:00.000Z',
    todayStr: '2026-08-13',
  } as any);

  const open = actions.find((a: any) => a.kind === 'open') as any;
  if (!open) { console.log(`${label}: NO OPEN ACTION — setup failed to trade`); return null; }
  console.log(`${label}: action=${open.tradeAction} reason="${open.tradeReason}"`);
  return open.tradeReason as string;
}

const divergent = run('divergent (canonical downgraded to HOLD)', 'HOLD');
const agreeing  = run('control   (canonical agrees: BUY)      ', 'BUY');

console.log();
const ok1 = divergent === 'BUY (canon:HOLD)';
const ok2 = agreeing === 'BUY';
console.log(`${ok1 ? 'PASS' : 'FAIL'}  divergent row records the GATING tier and flags the canonical value`);
console.log(`${ok2 ? 'PASS' : 'FAIL'}  agreeing row keeps the bare-tier shape of every historical row`);
process.exit(ok1 && ok2 ? 0 : 1);
