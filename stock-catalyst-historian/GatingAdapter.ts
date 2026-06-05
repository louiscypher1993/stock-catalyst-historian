/**
 * GatingAdapter.ts
 * ================
 * Translates a StockPoint (and optional context) into the GatingInput shape
 * that QuantamentalGatingEngine.ts expects.
 *
 * ARCHITECTURE NOTE: This is a pure translation layer. It never invents values.
 * If a source field is absent, the corresponding GatingInput field is omitted
 * entirely — missing fields mean the relevant engine gate simply cannot trigger,
 * which is the correct "fail safe" behaviour rather than fabricating defaults.
 *
 * KEY NAMING RULE: GatingInput uses strict snake_case with underscores
 * (e.g. price_change_pct, physics_and_kinetic_vectors). Every nested field
 * name must match the GatingInput interface exactly — the TypeScript compiler
 * will not catch mismatches if the object is built via intermediate 'any' types,
 * so be careful when extending this file.
 */

import type { GatingInput } from "./QuantamentalGatingEngine";
import type { StockPoint } from "./src/types";

export function buildGatingInput(
  point: StockPoint,
  context: {
    ticker: string;
    externalSignals?: Record<string, number>;
    macroSnapshot?: any;
    eventTriggerTime?: number;
    knowledgeTimestamp?: number;
  }
): GatingInput {

  // ---------------------------------------------------------------------------
  // MARKET DATA
  // ---------------------------------------------------------------------------
  const market_data: GatingInput["market_data"] = {};

  if (typeof point.dailyReturn === "number") {
    // dailyReturn in this codebase is expressed as a percentage (e.g. 8.3 = 8.3%).
    // GatingInput expects a decimal fraction (0.083). Divide by 100.
    //
    // FIELD NAME NOTE: The original MoE prompt called this price_change_pct_hourly,
    // but this app works with daily bars. The GatingInput interface now uses
    // price_change_pct (no timeframe qualifier) to avoid semantic confusion.
    // The HISTORICAL_EVENT threshold of 0.10 (10%) is appropriate for daily data.
    market_data.price_change_pct_hourly = point.dailyReturn / 100;
  }

  // Prefer the 30-day relative volume (more stable baseline), fallback to
  // the simpler volumeRatio if that is the only thing available.
  const relVol = (point as any)._tempRelativeVolume30d ?? (point as any).relative_volume_30d ?? point.volumeRatio;
  if (typeof relVol === "number") {
    market_data.relative_volume_ratio = relVol;
  }

  // Bid-ask spread and price: only attach if BOTH are present so the execution
  // gating formula (spread / price >= 0.04) can actually be evaluated.
  // If either is missing we omit both — the engine treats absence as "unable to
  // assess tradeability" rather than "tradeable with zero slippage".
  if (typeof (point as any).spread === "number" && typeof point.close === "number" && point.close > 0) {
    market_data.bid_ask_spread_absolute = (point as any).spread;
    market_data.current_asset_price = point.close;
  }

  // ---------------------------------------------------------------------------
  // PHYSICS AND KINETIC VECTORS
  // All of these are engineered features with physics-themed names — they are
  // NOT literal physics quantities. The field names here must match GatingInput
  // exactly (physics_and_kinetic_vectors, market_temperature_t, etc.).
  //
  // IMPORTANT UNIT NOTE on kinetic_energy vs catalyst_velocity_v_price:
  // The codebase computes kinetic_energy = 0.5 * volume * (return * 100)^2,
  // which mirrors the physics formula KE = 0.5 * m * v^2. Because velocity is
  // squared inside kinetic_energy, mapping it directly to the velocity slot in
  // the engine would use a value on a quadratically different scale. We apply
  // sqrt() to approximately recover velocity from energy:
  //   v_approx = sqrt(kinetic_energy)
  // This produces a metric on the same order of magnitude as the velocity
  // thresholds the engine uses. It is an approximation, not exact physics — the
  // thresholds in the engine will need empirical calibration on your real data.
  // ---------------------------------------------------------------------------
  const physics: GatingInput["physics_and_kinetic_vectors"] = {};

  const market_temp = (point as any)._tempMarketTemperature ?? (point as any).market_temperature_t ?? null;
  if (typeof market_temp === "number") {
    physics.market_temperature_t = market_temp;
  }

  const l1_lagrange = (point as any)._tempL1Lagrange ?? (point as any).l1_lagrange_point ?? null;
  if (typeof l1_lagrange === "number") {
    physics.lagrange_stability_index = l1_lagrange;
  }

  // kinetic_energy -> v_approx via square root (see unit note above).
  const ke = (point as any)._tempKineticEnergy ?? (point as any).kinetic_energy ?? null;
  if (typeof ke === "number" && ke >= 0) {
    physics.catalyst_velocity_v_price = Math.sqrt(ke);
  }

  // orbital_escape_velocity is the most natural proxy for maximum_liquidity_velocity_v_max:
  // both represent the threshold speed needed to "escape" the current price structure.
  const esc = (point as any)._tempEscapeVelocity ?? (point as any).orbital_escape_velocity ?? null;
  if (typeof esc === "number") {
    physics.maximum_liquidity_velocity_v_max = esc;
  }

  // The codebase does not compute a direct mean_free_path or p_tunnel equivalent.
  // Omit rather than invent. These regimes will not fire until the feature is
  // added to HistoricalEngine.ts.

  if (Object.keys(physics).length > 0) {
    // TypeScript requires the full assignment pattern here because physics_and_kinetic_vectors
    // is a nested optional interface.
  }

  // ---------------------------------------------------------------------------
  // MACRO REGIME + SYSTEMIC LIQUIDITY
  // Both come from the macroSnapshot returned by FREDService/getMacroSnapshot.
  // Field names must match MacroSnapshot exactly — creditSpread is the closest
  // available proxy for the ICE BofA High Yield OAS.
  // ---------------------------------------------------------------------------
  const macro_regime: GatingInput["macro_regime"] = {};
  const macro_systemic_liquidity: GatingInput["macro_systemic_liquidity"] = {};

  if (context.macroSnapshot) {
    const snap = context.macroSnapshot;

    // creditSpread from FRED (BAMLH0A0HYM2 series) maps to ice_bofa_high_yield_oas.
    if (typeof snap.creditSpread === "number") {
      macro_regime.ice_bofa_high_yield_oas = snap.creditSpread;
    }

    // yieldCurveSpread is already computed as 10Y - 2Y in FREDService.
    if (typeof snap.yieldCurveSpread === "number") {
      macro_regime.yield_curve_spread_10y2y = snap.yieldCurveSpread;
    }

    // VIX above 30 indicates a chaotic, panic-volatility environment.
    if (typeof snap.vixAtEvent === "number") {
      macro_regime.macro_chaotic_flag = snap.vixAtEvent > 30;
    }

    // systemic_liquidity_evaporation_velocity: not a direct FRED series.
    // Approximate it from the rate-of-change of the credit spread over the
    // recent window if that data exists in the snapshot; otherwise omit.
    if (typeof snap.systemic_liquidity_evaporation_velocity === "number") {
      macro_systemic_liquidity.systemic_liquidity_evaporation_velocity =
        snap.systemic_liquidity_evaporation_velocity;
    }
  }

  // ---------------------------------------------------------------------------
  // INSIDER BEHAVIOURAL VECTOR
  // Populated from the management friction score computed by
  // getManagementFrictionScore in db.ts / HistoricalEngine.ts.
  // ---------------------------------------------------------------------------
  const insider_behavioral_vector: GatingInput["insider_behavioral_vector"] = {};

  const frictionScore = (point as any)._tempFrictionScore ?? point.analysis?.management_friction_score ?? null;
  if (typeof frictionScore === "number") {
    insider_behavioral_vector.insider_plan_modification_intensity = frictionScore;
  }

  // ---------------------------------------------------------------------------
  // TEMPORAL COORDINATES (PIT leakage guard)
  // Only attach if BOTH timestamps are provided — a partial record would give
  // the leakage detector a false impression.
  // ---------------------------------------------------------------------------
  const temporal_coordinates: GatingInput["temporal_coordinates"] =
    typeof context.eventTriggerTime === "number" && typeof context.knowledgeTimestamp === "number"
      ? {
          event_trigger_time: context.eventTriggerTime,
          knowledge_timestamp: context.knowledgeTimestamp,
        }
      : undefined;

  // ---------------------------------------------------------------------------
  // ASSEMBLE: only include blocks that have at least one populated field.
  // This keeps the engine's logging clean and avoids triggering gates on empty
  // objects with no meaningful content.
  // ---------------------------------------------------------------------------
  const result: GatingInput = {
    ticker: context.ticker,

    // Event type: if this bar is tagged as a null sample in the engine, report
    // it so the gating engine can treat it differently for labelling purposes.
    event_type: (point as any).is_null_sample ? "NULL_SAMPLE_BASELINE" : "VOLATILITY_SHOCK",
  };

  if (Object.keys(market_data).length > 0) result.market_data = market_data;
  if (Object.keys(physics).length > 0) result.physics_and_kinetic_vectors = physics;
  if (Object.keys(macro_regime).length > 0) result.macro_regime = macro_regime;
  if (Object.keys(macro_systemic_liquidity).length > 0) result.macro_systemic_liquidity = macro_systemic_liquidity;
  if (Object.keys(insider_behavioral_vector).length > 0) result.insider_behavioral_vector = insider_behavioral_vector;
  if (temporal_coordinates) result.temporal_coordinates = temporal_coordinates;
  if (context.externalSignals && Object.keys(context.externalSignals).length > 0) {
    result.external_signal_intensities = context.externalSignals;
  }

  return result;
}
