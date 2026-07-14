import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

const HORIZON_TIER_CONFIG_D3 = { strongBuy: (v: number) => v >= 0.010831, sell: (v: number) => v <= -0.004385 };
const HORIZON_TIER_CONFIG_D5 = { strongBuy: (v: number) => v >= 0.031582, buy: (v: number) => v >= 0.024743 && v < 0.031582, sell: (v: number) => v <= -0.001411 };
const HORIZON_TIER_CONFIG_D1 = { strongBuy: (v: number) => v >= 0.057568 };
const HORIZON_TIER_CONFIG_D2 = { buy: (v: number) => v > 0.106656 };

function patienceHorizon(patience: number) {
  if (patience <= 2.5) return { label: '2D', field: 'model_d3_return_2d', cfg: HORIZON_TIER_CONFIG_D3 };
  if (patience <= 4.5) return { label: '2W', field: 'model_d5_return_2w', cfg: HORIZON_TIER_CONFIG_D5 };
  if (patience <= 6.5) return { label: '1M', field: 'model_b_return_1m', cfg: {} };
  if (patience <= 8.5) return { label: '3M', field: 'model_d1_return_3m', cfg: HORIZON_TIER_CONFIG_D1 };
  return { label: '6M', field: 'model_d2_return_6m', cfg: HORIZON_TIER_CONFIG_D2 };
}
function resolveTier(value: number, cfg: any): string {
  if (cfg.strongBuy?.(value)) return 'STRONG_BUY';
  if (cfg.buy?.(value)) return 'BUY';
  if (cfg.sell?.(value)) return 'SELL';
  return 'HOLD';
}

async function main() {
  const symbols = ['ASM.AS', 'BAB.L', 'CGNX', 'GFC.PA', 'MELE.BR', 'PKO.WA'];
  const { data: positions } = await supabase.from('pot_positions').select('*').in('symbol', symbols).eq('status', 'open');
  const { data: pots } = await supabase.from('pots').select('*');
  const { data: infRows } = await supabase.from('inference_results').select('*').in('symbol', symbols).gte('created_at', '2026-07-14T09:05:00Z').lte('created_at', '2026-07-14T09:25:00Z');

  const potById = new Map((pots ?? []).map((p: any) => [p.pot_id, p]));
  const infBySymbol = new Map((infRows ?? []).map((r: any) => [r.symbol, r]));

  for (const pos of positions ?? []) {
    const pot = potById.get(pos.pot_id);
    const inf = infBySymbol.get(pos.symbol);
    if (!pot || !inf) continue;
    const rMinusB = pot.reactivity - pot.boldness;
    const eligibleForReactivityExit = pos.direction === 'long' && rMinusB >= 2;
    const ph = patienceHorizon(pot.patience);
    const value = (inf as any)[ph.field];
    const tier = resolveTier(value, ph.cfg);
    const wouldHaveExitedWithoutFix = eligibleForReactivityExit && tier === 'SELL';
    console.log(`${pos.symbol} in pot ${pot.pot_id} ("${pot.name}", B=${pot.boldness} R=${pot.reactivity} P=${pot.patience}): ` +
      `R-B=${rMinusB} eligibleForReactivityExit=${eligibleForReactivityExit}  horizon=${ph.label}/${ph.field}=${value}  tier=${tier}  ` +
      `WOULD-HAVE-EXITED-WITHOUT-THE-FIX=${wouldHaveExitedWithoutFix}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
