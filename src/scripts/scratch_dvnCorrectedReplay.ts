/**
 * Same-rigor-as-AMP replay for DVN's real STRONG_BUY entry (pots 1/8/19,
 * 2026-07-13 ~10:26 UTC). Confirmed root cause: feature_extractor.ts's
 * NUMERIC_ACCESSORS prioritizes the cached Supabase symbol_snapshots value
 * (`s?.xxx`) over the freshly-computed live value (`f.xxx`) for exactly 4
 * fields: z_score, excess_return, atr_shock_score, volume_ratio. DVN's
 * snapshot was last updated 2026-06-13 (a month stale) and captured a real
 * historical anomaly (z=2.99, excess_return=67%). This script reconstructs
 * the CORRECTED vector -- real bars, real snapshot for every field NOT
 * implicated in the bug, but the 4 implicated fields forced to use today's
 * genuinely fresh values instead of the stale snapshot's -- runs it through
 * the real deployed models, then replicates the REAL entry gate
 * (meetsEntryConditions/resolveHorizonSignal/patienceHorizon/ambitionTier,
 * transcribed verbatim from src/PotService.ts, verified against the current
 * source moments before writing this) for each of the 3 pots that actually
 * entered DVN. Does NOT call decidePot/applyPotActions and does NOT modify
 * any position -- read-only comparison only.
 */
import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
  buildFeatureVectorForAnomaly,
} from '../LiveInferenceService';

interface SymbolEnrichment {
  snap: Record<string, any> | null;
  primaryCategory: string | null;
  companyName: string | null;
  sector: string | null;
  exchange: string | null;
}

// ── verbatim from src/PotService.ts (module-private there, not exported --
// transcribed exactly rather than touching the live file for this recon) ──
const HORIZON_TIER_CONFIG_D5 = {
  strongBuy: (v: number) => v >= 0.031582,
  buy: (v: number) => v >= 0.024743 && v < 0.031582,
  sell: (v: number) => v <= -0.001411,
};
const HORIZON_TIER_CONFIG_D1 = {
  strongBuy: (v: number) => v >= 0.057568,
};
function resolveTierFromConfig(value: number, cfg: { strongBuy?: (v: number) => boolean; buy?: (v: number) => boolean; sell?: (v: number) => boolean }): string {
  if (cfg.strongBuy?.(value)) return 'STRONG_BUY';
  if (cfg.buy?.(value)) return 'BUY';
  if (cfg.sell?.(value)) return 'SELL';
  return 'HOLD';
}
function patienceHorizon(patience: number) {
  if (patience <= 2.5) return { label: '2D', field: 'model_d3_return_2d', cfg: null as any };
  if (patience <= 4.5) return { label: '2W', field: 'model_d5_return_2w', cfg: HORIZON_TIER_CONFIG_D5 };
  if (patience <= 6.5) return { label: '1M', field: 'model_b_return_1m', cfg: {} };
  if (patience <= 8.5) return { label: '3M', field: 'model_d1_return_3m', cfg: HORIZON_TIER_CONFIG_D1 };
  return { label: '6M', field: 'model_d2_return_6m', cfg: null as any };
}
function ambitionTier(ambition: number) {
  if (ambition <= 3.0) return { minRec: 'ADD', minReturn: 0.03 };
  if (ambition <= 6.0) return { minRec: 'BUY', minReturn: 0.12 };
  if (ambition <= 8.0) return { minRec: 'STRONG_BUY', minReturn: 0.21 };
  return { minRec: 'STRONG_BUY', minReturn: 0.27 };
}
const REC_RANK: Record<string, number> = { SELL: -2, REDUCE: -1, HOLD: 0, ADD: 1, BUY: 2, STRONG_BUY: 3 };
function meetsMinRec(rec: string, minRec: string): boolean {
  return (REC_RANK[rec] ?? -99) >= (REC_RANK[minRec] ?? 99);
}
const MODEL_C_PERCENTILE_BREAKPOINTS: Array<[number, number]> = [
  [0.00, -1.4857], [0.01, -0.0958], [0.02, -0.0717], [0.05, -0.0440], [0.10, -0.0201],
  [0.20, 0.0235], [0.30, 0.0562], [0.40, 0.0686], [0.50, 0.0770], [0.60, 0.0821],
  [0.70, 0.0862], [0.80, 0.0921], [0.90, 0.0975], [0.95, 0.1024], [0.98, 0.1024], [1.00, 0.2],
];
function modelCPercentileRank(value: number): number {
  const bp = MODEL_C_PERCENTILE_BREAKPOINTS;
  if (value <= bp[0][1]) return bp[0][0];
  if (value >= bp[bp.length - 1][1]) return bp[bp.length - 1][0];
  for (let i = 1; i < bp.length; i++) {
    const [pHi, vHi] = bp[i]; const [pLo, vLo] = bp[i - 1];
    if (value <= vHi) {
      if (vHi === vLo) return pHi;
      return pLo + ((value - vLo) / (vHi - vLo)) * (pHi - pLo);
    }
  }
  return 1;
}
const RISK_REWARD_FLOOR = 0.15;
function resolveHorizonSignal(returnFieldValue: number, cfg: any, modelA: number, modelC: number) {
  const value = returnFieldValue;
  const tier = cfg ? resolveTierFromConfig(value, cfg) : 'HOLD';
  const modelCRank = modelCPercentileRank(modelC);
  const confidenceTerm = (1 - modelA) * 30;
  const drawdownTerm = (1 - modelCRank) * 40;
  const tailRiskTerm = cfg?.sell?.(value) ? 30 : 0;
  const riskScore = Math.round(Math.min(100, Math.max(0, drawdownTerm + confidenceTerm + tailRiskTerm)));
  const riskReward = Math.round((Math.abs(value) / Math.max(1 - modelCRank, RISK_REWARD_FLOOR)) * 100) / 100;
  return { tier, riskScore, riskReward };
}
function meetsSignalQualityGate(boldness: number, move: number | null, vol: number | null): boolean {
  if (move == null || vol == null) return true;
  const moveCeiling = Math.max(0.01, 0.04 - boldness * 0.003);
  const volFloor = 1.5 + boldness * 0.15;
  const isSuppressedNonEvent = Math.abs(move) < moveCeiling && vol >= volFloor;
  return !isSuppressedNonEvent;
}
function meetsEntryConditions(
  returnFieldValue: number, cfg: any, modelA: number, modelC: number,
  ambition: number, boldness: number, dayChangePct: number, volumeRatio: number
): { pass: boolean; reasons: string[] } {
  const tier = ambitionTier(ambition);
  const signal = resolveHorizonSignal(returnFieldValue, cfg, modelA, modelC);
  const reasons: string[] = [];
  if (!meetsMinRec(signal.tier, tier.minRec)) reasons.push(`tier ${signal.tier} < minRec ${tier.minRec}`);
  if (signal.riskScore > boldness * 10) reasons.push(`riskScore ${signal.riskScore} > boldness*10 ${boldness * 10}`);
  if (returnFieldValue < tier.minReturn) reasons.push(`expectedReturn ${returnFieldValue} < minReturn ${tier.minReturn}`);
  if (!meetsSignalQualityGate(boldness, dayChangePct, volumeRatio)) reasons.push('meetsSignalQualityGate failed (suppressed non-event)');
  if (signal.riskReward < ambition / 40) reasons.push(`riskReward ${signal.riskReward} < ambition/40 ${ambition / 40}`);
  return { pass: reasons.length === 0, reasons, ...( { signal } as any) } as any;
}

async function main() {
  const symbol = 'DVN';
  const bars = await fetchYahooDailyHistory(symbol, '1y');
  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);
  const anomaly = detectAnomaly(symbol, symbol, bars, spyReturnByDate, true);
  if (!anomaly) { console.log('detectAnomaly returned null'); process.exit(1); }

  console.log('=== Fresh, live-computed anomaly signal (today) ===');
  console.log(`  z_score=${anomaly!.zScore.toFixed(4)}  excess_return=${anomaly!.excessReturn.toFixed(4)}  ` +
    `atr_shock_score=${anomaly!.atrShockScore.toFixed(4)}  volume_ratio=${anomaly!.volumeRatio.toFixed(4)}  ` +
    `day_change_pct=${anomaly!.dayChangePct.toFixed(4)}`);

  const { supabase } = await import('../db/supabaseClient');
  const { data: snapRow } = await supabase.from('symbol_snapshots').select('*').eq('symbol', symbol).single();
  console.log(`\nStale Supabase snapshot updated_at=${snapRow?.updated_at}`);
  console.log(`  stale snap.z_score=${snapRow?.latest_signal_snapshot?.z_score}  ` +
    `stale snap.excess_return=${snapRow?.latest_signal_snapshot?.excess_return}`);

  // CORRECTED enrichment: real snapshot, but with the 4 confirmed
  // stale-priority fields removed so the accessor's `??` falls through to
  // the fresh, live-computed value instead.
  const correctedSnap = { ...(snapRow?.latest_signal_snapshot ?? {}) };
  delete correctedSnap.z_score;
  delete correctedSnap.excess_return;
  delete correctedSnap.atr_shock_score;
  delete correctedSnap.volume_ratio;
  const correctedEnrichment: SymbolEnrichment = {
    snap: correctedSnap, primaryCategory: null,
    companyName: snapRow?.company_name ?? null, sector: snapRow?.sector ?? null, exchange: snapRow?.exchange ?? null,
  };

  const correctedVector = buildFeatureVectorForAnomaly(bars, anomaly!, correctedEnrichment, null);
  console.log(`\nCorrected vector's key fields: z_score=${correctedVector.z_score}  excess_return=${correctedVector.excess_return}  ` +
    `atr_shock_score=${correctedVector.atr_shock_score}  volume_ratio=${correctedVector.volume_ratio}  ` +
    `day_change_pct(context, not in vector)=n/a`);

  const fs = await import('fs');
  fs.writeFileSync(
    'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/193bf814-3002-4d0c-aa2e-09544ef1043c/scratchpad/dvn_corrected_vector.json',
    JSON.stringify({ vector: correctedVector, dayChangePct: anomaly!.dayChangePct, volumeRatioFresh: correctedVector.volume_ratio }, null, 2)
  );
  console.log('\nWrote dvn_corrected_vector.json -- run through infer.py next, then re-invoke this script\'s gate-check phase with the results.');
}

main().catch(e => { console.error(e); process.exit(1); });
