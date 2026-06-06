/**
 * QuantamentalGatingEngine.ts
 * ============================
 * A DETERMINISTIC, pure-TypeScript implementation of the institutional gating
 * logic that was previously expressed as an LLM "MoE routing" prompt.
 *
 * WHY THIS EXISTS (read this before changing anything):
 * The original MoE prompt asked a language model to do four things that a
 * language model is fundamentally bad at:
 *   1. Compare numbers against fixed thresholds (if x >= 0.85 ...).
 *   2. Apply gating rules in a strict priority order.
 *   3. Clamp and renormalise probabilities so they sum to exactly 1.0.
 *   4. Produce "deterministic" output — identical input, identical output.
 * LLMs are non-deterministic and unreliable at exact arithmetic, so asking a
 * model to do this is slow, expensive, and produces probability triples that
 * sum to 0.99 or 1.01. All of that logic lives here instead, as plain
 * functions: instant, free, perfectly deterministic, and unit-testable.
 *
 * WHAT STAYS WITH THE LLM:
 * Only the parts that genuinely need language understanding — reading the news
 * to identify a catalyst, writing the human-readable "rationale" strings for a
 * divergence, and classifying the catalyst taxonomy. Those are handled in
 * HistoricalEngine.ts / ExecutiveIntelligence.ts, NOT here.
 */

// ---------------------------------------------------------------------------
// SECTION 1: TYPES
// These mirror the canonical input/output schema of the MoE prompt so the
// deterministic engine is a drop-in replacement for the prompt's logic.
// ---------------------------------------------------------------------------

/** The four operational modes. Mirrors the prompt's MODE INITIALIZATION. */
export type EngineMode = "STANDARD" | "HIGH_SENSITIVITY" | "VERBOSE" | "ECHO";

/** Threshold profile resolved from the mode. */
export interface ThresholdProfile {
  p_tunnel: number;
  v_price_pct_of_vmax: number;
  t_market: number;
  mean_free_path: number;
  systemic_liquidity_evaporation_velocity_threshold: number;
  ice_bofa_high_yield_oas_threshold: number;
  suppressed_zscore: number;
}

/** Minimal shape of the input payload the engine consumes. */
export interface GatingInput {
  ticker: string;
  event_type?: "VOLATILITY_SHOCK" | "NULL_SAMPLE_BASELINE";
  mode?: EngineMode;
  market_data?: {
    price_change_pct_hourly?: number;
    relative_volume_ratio?: number;
    bid_ask_spread_absolute?: number;
    current_asset_price?: number;
  };
  narrative_data?: { local_sentiment_score?: number };
  alternative_data?: {
    digital_exhaust_velocity_14d?: number;
    rolling_30d_net_insider_volume_ratio?: number;
  };
  macro_regime?: {
    ice_bofa_high_yield_oas?: number;
    yield_curve_spread_10y2y?: number;
    macro_chaotic_flag?: boolean;
  };
  insider_behavioral_vector?: {
    insider_plan_modification_intensity?: number;
    plan_alteration_type?: string;
  };
  network_graph_data?: { network_ripple_index?: number };
  physical_intelligence?: {
    c_suite_anomalous_routing_score?: number;
    destination_synergy_flag?: boolean;
  };
  legal_docket_data?: {
    docket_entry_velocity_48h?: number;
    rocket_docket_flag?: boolean;
  };
  macro_systemic_liquidity?: { systemic_liquidity_evaporation_velocity?: number };
  physics_and_kinetic_vectors?: {
    market_temperature_t?: number;
    transmission_coefficient_p_tunnel?: number;
    mean_free_path_l?: number;
    lagrange_stability_index?: number;
    catalyst_velocity_v_price?: number;
    maximum_liquidity_velocity_v_max?: number;
  };
  temporal_coordinates?: {
    event_trigger_time?: number;
    knowledge_timestamp?: number;
  };
  /**
   * OPTIONAL extension for broadened non-event detection. A map of any external
   * signal name -> its z-score / intensity. Lets the engine detect "should have
   * moved but didn't" cases across ALL data sources, not just volume + filings.
   * e.g. { gdelt_tone_zscore: 3.1, reddit_virality: 80, cpi_surprise_z: 2.8 }
   */
  external_signal_intensities?: Record<string, number>;
}

export interface DivergenceSignal {
  source_vector: string;
  implied_direction: "UP" | "DOWN" | "FLAT";
  rationale: string;
}

/**
 * The deterministic verdict. This is everything the engine can decide WITHOUT
 * an LLM. The LLM later fills in narrative rationale strings and catalyst tags.
 */
export interface GatingVerdict {
  mode: EngineMode;
  thresholds: ThresholdProfile;

  // PIT / data integrity
  look_ahead_leakage_detected: boolean;
  compromised_vectors: string[];
  leakage_shield_multiplier: number;

  // Macro override (Tier 1)
  is_macro_gravity_dominant: boolean;
  macro_override_reasons: string[];

  // Execution gating
  is_statistically_tradeable: boolean;
  slippage_penalty_coefficient: number;

  // Classification
  event_classification: "HISTORICAL_EVENT" | "SUPPRESSED_NON_EVENT" | "LAMINAR_NOISE";
  suppressed_non_event_reason: string | null; // WHICH signal fired while price stayed flat
  dominant_physics_regime: string;
  dominant_alternative_vector: string;

  // Divergence (the "which sources disagree and why" feature)
  divergence_detected: boolean;
  conflicting_signals: DivergenceSignal[];

  // Probabilistic outputs (computed deterministically, NOT guessed by an LLM)
  // NOTE: these are PRIORS derived from rules. Real predictive probabilities
  // should come from a model trained on historical outcomes — see the comment
  // at computeDirectionalPriors().
  predictive_matrix: Record<
    "horizon_24h" | "horizon_3d" | "horizon_14d",
    {
      expected_direction: "UP" | "DOWN" | "FLAT" | "UNCERTAIN";
      up_probability: number;
      flat_probability: number;
      down_probability: number;
    }
  >;

  target_action_signal: string;
  pricing_decay_horizon_modifier: string;

  diagnostic_reasoning_log: string;
  was_relaxed_threshold_used: boolean;
}

// ---------------------------------------------------------------------------
// SECTION 2: THRESHOLD PROFILES
// Pure lookup. No model needed — these are constants from the spec.
// ---------------------------------------------------------------------------

const STANDARD_THRESHOLDS: ThresholdProfile = {
  p_tunnel: 0.85,
  v_price_pct_of_vmax: 0.95,
  t_market: 3.0,
  mean_free_path: 4.0,
  systemic_liquidity_evaporation_velocity_threshold: 2.5,
  ice_bofa_high_yield_oas_threshold: 4.5,
  suppressed_zscore: 2.5,
};

export function resolveThresholds(mode: EngineMode): ThresholdProfile {
  if (mode === "HIGH_SENSITIVITY") {
    // HIGH_SENSITIVITY relaxes the four physics gates but inherits the rest.
    return {
      ...STANDARD_THRESHOLDS,
      p_tunnel: 0.5,
      v_price_pct_of_vmax: 0.75,
      t_market: 1.5,
      mean_free_path: 1.5,
    };
  }
  // STANDARD and VERBOSE both run STANDARD thresholds.
  return { ...STANDARD_THRESHOLDS };
}

// ---------------------------------------------------------------------------
// SECTION 3: DATA INTEGRITY ENGINE (Point-In-Time leakage)
// This is the single most important institutional safeguard. It enforces that
// no data "from the future" leaks into a historical training example.
// ---------------------------------------------------------------------------

/**
 * Detects look-ahead bias. A node is compromised if the moment we KNEW the data
 * (knowledge_timestamp) is at or after the moment the event triggered
 * (event_trigger_time) — i.e. we are pretending to have known something we
 * could only have learned afterwards.
 *
 * Returns the multiplier the rest of the pipeline should apply to alternative
 * data: 1.0 = clean, 0.0 = leakage detected, zero its influence entirely.
 */
export function auditPointInTime(input: GatingInput): {
  leakageDetected: boolean;
  compromisedVectors: string[];
  shieldMultiplier: number;
} {
  const compromised: string[] = [];
  const tc = input.temporal_coordinates;

  // If we have explicit timestamps, the test is direct and unambiguous.
  if (
    tc &&
    typeof tc.knowledge_timestamp === "number" &&
    typeof tc.event_trigger_time === "number"
  ) {
    if (tc.knowledge_timestamp >= tc.event_trigger_time) {
      // Every alternative-data vector that depends on this timeline is tainted.
      // We name them explicitly so the pit_leakage_audit is a real forensic log.
      if (input.alternative_data) compromised.push("alternative_data");
      if (input.physical_intelligence) compromised.push("physical_intelligence");
      if (input.network_graph_data) compromised.push("network_graph_data");
      if (input.legal_docket_data) compromised.push("legal_docket_data");
      if (compromised.length === 0) compromised.push("temporal_coordinates");
    }
  }

  const leakageDetected = compromised.length > 0;
  return {
    leakageDetected,
    compromisedVectors: compromised,
    // Spec rule: leakage => 0.0 (zero influence), else 1.0.
    shieldMultiplier: leakageDetected ? 0.0 : 1.0,
  };
}

// ---------------------------------------------------------------------------
// SECTION 4: MACRO OVERRIDE ENGINE (Tier 1 priority)
// "Localized alpha is destroyed in a systemic crash." Before we trust any
// stock-specific signal, we check whether the whole market is on fire.
// ---------------------------------------------------------------------------

export function evaluateMacroOverride(
  input: GatingInput,
  t: ThresholdProfile,
): { fired: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const liq = input.macro_systemic_liquidity?.systemic_liquidity_evaporation_velocity;
  const oas = input.macro_regime?.ice_bofa_high_yield_oas;
  const curve = input.macro_regime?.yield_curve_spread_10y2y;

  // Any ONE of these systemic stress conditions is enough to override.
  if (typeof liq === "number" && liq > t.systemic_liquidity_evaporation_velocity_threshold) {
    reasons.push(`systemic_liquidity_evaporation ${liq.toFixed(1)} > ${t.systemic_liquidity_evaporation_velocity_threshold}`);
  }
  if (typeof oas === "number" && oas > t.ice_bofa_high_yield_oas_threshold) {
    reasons.push(`high_yield_OAS ${oas.toFixed(1)} > ${t.ice_bofa_high_yield_oas_threshold}`);
  }
  if (typeof curve === "number" && curve < -0.4) {
    reasons.push(`yield_curve_inversion ${curve.toFixed(2)} < -0.40`);
  }

  return { fired: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// SECTION 5: EXECUTION GATING ENGINE
// A theoretically perfect signal is worthless if you cannot actually trade it
// without slippage eating the entire edge. This is the reality check.
// ---------------------------------------------------------------------------

export function evaluateExecutionGate(input: GatingInput): {
  tradeable: boolean;
  slippagePenalty: number;
} {
  const md = input.market_data ?? {};
  const spread = md.bid_ask_spread_absolute;
  const price = md.current_asset_price;
  const move = md.price_change_pct_hourly;

  // Guard against missing/zero price to avoid divide-by-zero.
  if (typeof spread === "number" && typeof price === "number" && price > 0 && typeof move === "number") {
    const spreadPct = spread / price;
    // Wide spread (>=4% of price) DURING a big move (>=10%) means "ghost pricing":
    // the quote you see is not the price you'll get. Refuse to call it tradeable.
    if (spreadPct >= 0.04 && Math.abs(move) >= 0.1) {
      return { tradeable: false, slippagePenalty: 0.0 };
    }
    // Otherwise scale a soft slippage penalty with the spread (0..1 coefficient).
    const penalty = Math.min(1.0, spreadPct / 0.04);
    return { tradeable: true, slippagePenalty: Number(penalty.toFixed(2)) };
  }
  // No spread data: assume tradeable but flag full uncertainty in slippage.
  return { tradeable: true, slippagePenalty: 0.0 };
}

// ---------------------------------------------------------------------------
// SECTION 6: EVENT CLASSIFICATION + BROADENED NON-EVENT DETECTION
// This is where we answer the user's question: "does the code account for
// non-events where something should have moved the price but didn't?"
// ---------------------------------------------------------------------------

/**
 * Classifies the bar as a real event, a SUPPRESSED non-event, or just noise.
 *
 * The crucial upgrade over the existing engine: a "suppressed non-event" is no
 * longer limited to volume + EDGAR filings. We treat the bar as a suppressed
 * non-event when the PRICE BARELY MOVED but ANY external signal fired hard.
 * That captures the "dog that didn't bark" — a CEO indictment, a hot CPI
 * print, a competitor bombshell — that the market shrugged off. Those are
 * often more informative than the events that DID move price.
 */
export function classifyEvent(
  input: GatingInput,
  t: ThresholdProfile,
): {
  classification: "HISTORICAL_EVENT" | "SUPPRESSED_NON_EVENT" | "LAMINAR_NOISE";
  suppressedReason: string | null;
} {
  const move = input.market_data?.price_change_pct_hourly ?? 0;
  const absMove = Math.abs(move);

  // A genuine, large price move is unambiguously a historical event.
  if (absMove >= 0.1) {
    return { classification: "HISTORICAL_EVENT", suppressedReason: null };
  }

  // The price is essentially flat. Did anything fire that SHOULD have moved it?
  if (absMove < 0.04) {
    const firedSignals: string[] = [];

    // Original two triggers (kept for backwards compatibility).
    const relVol = input.market_data?.relative_volume_ratio;
    if (typeof relVol === "number" && relVol >= 1.5) {
      firedSignals.push(`volume ${relVol.toFixed(1)}x`);
    }
    const docketVel = input.legal_docket_data?.docket_entry_velocity_48h;
    if (typeof docketVel === "number" && docketVel >= t.suppressed_zscore) {
      firedSignals.push(`legal_docket_velocity ${docketVel.toFixed(1)}`);
    }

    // BROADENED triggers: any external signal above its z-threshold counts.
    // This is the key fix discussed with the user — non-events should be
    // detected across ALL sources, not just volume and filings.
    const ext = input.external_signal_intensities ?? {};
    for (const [name, z] of Object.entries(ext)) {
      if (typeof z === "number" && Math.abs(z) >= t.suppressed_zscore) {
        firedSignals.push(`${name} ${z.toFixed(1)}σ`);
      }
    }

    // Insider behaviour firing while price is flat is a classic suppressed signal.
    const insider = input.insider_behavioral_vector?.insider_plan_modification_intensity;
    if (typeof insider === "number" && insider >= t.suppressed_zscore) {
      firedSignals.push(`insider_plan_modification ${insider.toFixed(1)}`);
    }

    if (firedSignals.length > 0) {
      return {
        classification: "SUPPRESSED_NON_EVENT",
        // The reason names EXACTLY which signals fired while price stayed flat,
        // so downstream training knows what was "absorbed" by the market.
        suppressedReason: firedSignals.join("; "),
      };
    }
  }

  // Small move, nothing fired: just background noise.
  return { classification: "LAMINAR_NOISE", suppressedReason: null };
}

// ---------------------------------------------------------------------------
// SECTION 7: PHYSICS / ALTERNATIVE VECTOR MAPPING
// These are deterministic threshold comparisons. NOTE: the "physics" labels are
// engineered features with colourful names, not literal physics — keep them if
// they aid intuition, but don't mistake them for validated predictors.
// ---------------------------------------------------------------------------

export function mapDominantPhysicsRegime(
  input: GatingInput,
  t: ThresholdProfile,
  macroFired: boolean,
): string {
  if (macroFired) return "SYSTEMIC_CONTAGION";
  const p = input.physics_and_kinetic_vectors ?? {};

  if (typeof p.transmission_coefficient_p_tunnel === "number" && p.transmission_coefficient_p_tunnel >= t.p_tunnel) {
    return "QUANTUM_TUNNELING";
  }
  if (
    typeof p.catalyst_velocity_v_price === "number" &&
    typeof p.maximum_liquidity_velocity_v_max === "number" &&
    p.catalyst_velocity_v_price >= t.v_price_pct_of_vmax * p.maximum_liquidity_velocity_v_max
  ) {
    return "MICHAELIS_MENTEN_SATURATION";
  }
  if (typeof p.market_temperature_t === "number" && Math.abs(p.market_temperature_t) >= t.t_market) {
    return "THERMODYNAMIC_PHASE_SHIFT";
  }
  if (typeof p.mean_free_path_l === "number" && p.mean_free_path_l >= t.mean_free_path) {
    return "MEAN_FREE_PATH_VACUUM";
  }
  if (
    typeof p.lagrange_stability_index === "number" &&
    p.lagrange_stability_index < 0.5 &&
    input.macro_regime?.macro_chaotic_flag === true
  ) {
    return "LAGRANGE_EQUILIBRIUM";
  }
  return "LAMINAR_NOISE";
}

export function mapDominantAlternativeVector(
  input: GatingInput,
  macroFired: boolean,
): string {
  // Spec rule: if macro override fired, Tier 3 alt vectors are not computed.
  if (macroFired) return "NONE";

  const phys = input.physical_intelligence ?? {};
  const legal = input.legal_docket_data ?? {};
  const alt = input.alternative_data ?? {};
  const sentiment = input.narrative_data?.local_sentiment_score ?? 0;
  const insider = input.insider_behavioral_vector ?? {};
  const network = input.network_graph_data ?? {};

  if ((phys.c_suite_anomalous_routing_score ?? 0) > 3.0 && phys.destination_synergy_flag === true) {
    return "MA_LEAKAGE";
  }
  if ((legal.docket_entry_velocity_48h ?? 0) > 2.5 && legal.rocket_docket_flag === true) {
    return "JURISDICTIONAL_CONTAGION";
  }
  if ((alt.digital_exhaust_velocity_14d ?? 0) > 2.0 && sentiment <= 0.0) {
    return "REVENUE_DISCONNECT";
  }
  if (
    (insider.insider_plan_modification_intensity ?? 0) > 2.5 &&
    (insider.plan_alteration_type === "TERMINATION" || insider.plan_alteration_type === "SUSPENSION_OF_SELL")
  ) {
    return "INSIDER_CANCELLATION";
  }
  if ((network.network_ripple_index ?? 0) > 2.5) {
    return "NETWORK_RIPPLE";
  }
  return "NONE";
}

// ---------------------------------------------------------------------------
// SECTION 8: SIGNAL DIVERGENCE & CONFLICT RESOLUTION
// The feature both you and Gemini asked for: when different inputs point in
// different directions, list WHICH says WHAT and WHY. This is deterministic —
// each source has a known directional reading. The LLM only needs to polish
// the rationale text later if you want richer prose; the structure is decided
// here so it is consistent and testable.
// ---------------------------------------------------------------------------

export function detectSignalDivergence(input: GatingInput): {
  divergenceDetected: boolean;
  conflictingSignals: DivergenceSignal[];
} {
  const signals: DivergenceSignal[] = [];

  // Each block below reads ONE source and translates it into a directional vote
  // with a plain-English reason. We only keep sources that express a clear view.

  // 1. Narrative / sentiment
  const sentiment = input.narrative_data?.local_sentiment_score;
  if (typeof sentiment === "number" && Math.abs(sentiment) > 0.2) {
    signals.push({
      source_vector: "narrative_data",
      implied_direction: sentiment > 0 ? "UP" : "DOWN",
      rationale: `Local sentiment score ${sentiment.toFixed(2)} indicates ${sentiment > 0 ? "positive" : "negative"} retail/news momentum.`,
    });
  }

  // 2. Macro regime (credit + curve)
  const oas = input.macro_regime?.ice_bofa_high_yield_oas;
  const curve = input.macro_regime?.yield_curve_spread_10y2y;
  if ((typeof oas === "number" && oas > 4.5) || (typeof curve === "number" && curve < -0.4)) {
    signals.push({
      source_vector: "macro_regime",
      implied_direction: "DOWN",
      rationale: `Macro stress (credit spread ${oas?.toFixed(1) ?? "n/a"}, curve ${curve?.toFixed(2) ?? "n/a"}) implies systemic downward pressure.`,
    });
  }

  // 3. Insider behaviour
  const insiderRatio = input.alternative_data?.rolling_30d_net_insider_volume_ratio;
  if (typeof insiderRatio === "number" && Math.abs(insiderRatio) > 0.2) {
    signals.push({
      source_vector: "insider_behavioral_vector",
      implied_direction: insiderRatio > 0 ? "UP" : "DOWN",
      rationale: `Net insider volume ratio ${insiderRatio.toFixed(2)} indicates corporate insider alignment.`,
    });
  }

  // Check if we have both UP and DOWN signals
  let hasUp = false;
  let hasDown = false;
  for (const s of signals) {
    if (s.implied_direction === "UP") hasUp = true;
    if (s.implied_direction === "DOWN") hasDown = true;
  }

  return {
    divergenceDetected: hasUp && hasDown,
    conflictingSignals: signals,
  };
}

// ---------------------------------------------------------------------------
// SECTION 9: BASELINE PROBABILITIES
// ---------------------------------------------------------------------------

export function normaliseProbabilities(unscaledUp: number, unscaledDown: number, unscaledFlat: number) {
  const sum = Math.max(unscaledUp + unscaledDown + unscaledFlat, 0.0001);
  return {
    up: Number((unscaledUp / sum).toFixed(4)),
    down: Number((unscaledDown / sum).toFixed(4)),
    flat: Number((unscaledFlat / sum).toFixed(4)),
  };
}

function computeDirectionalPriors(input: GatingInput, divergence: boolean) {
  // Mock directional probabilities deterministically
  const move = input.market_data?.price_change_pct_hourly ?? 0;
  let up = move > 0 ? 0.6 : 0.2;
  let down = move < 0 ? 0.6 : 0.2;
  let flat = divergence ? 0.5 : 0.2;
  
  const h24 = normaliseProbabilities(up, down, flat);
  const h3d = normaliseProbabilities(up * 0.9, down * 0.9, flat * 1.2);
  const h14d = normaliseProbabilities(up * 0.7, down * 0.7, flat * 1.5);

  return {
    horizon_24h: {
      expected_direction: h24.up > h24.down ? "UP" : (h24.down > h24.up ? "DOWN" : "FLAT"),
      up_probability: h24.up,
      flat_probability: h24.flat,
      down_probability: h24.down,
    },
    horizon_3d: {
      expected_direction: h3d.up > h3d.down ? "UP" : (h3d.down > h3d.up ? "DOWN" : "FLAT"),
      up_probability: h3d.up,
      flat_probability: h3d.flat,
      down_probability: h3d.down,
    },
    horizon_14d: {
      expected_direction: h14d.up > h14d.down ? "UP" : (h14d.down > h14d.up ? "DOWN" : "FLAT"),
      up_probability: h14d.up,
      flat_probability: h14d.flat,
      down_probability: h14d.down,
    }
  } as any;
}

// ---------------------------------------------------------------------------
// SECTION 10: MAIN GATING ENGINE
// ---------------------------------------------------------------------------

export function runGatingEngine(input: GatingInput): GatingVerdict {
  const mode = input.mode || "STANDARD";
  const thresholds = resolveThresholds(mode);

  const pit = auditPointInTime(input);
  const macro = evaluateMacroOverride(input, thresholds);
  const execution = evaluateExecutionGate(input);
  const classification = classifyEvent(input, thresholds);
  const dominance = mapDominantPhysicsRegime(input, thresholds, macro.fired);
  const alt = mapDominantAlternativeVector(input, macro.fired);
  const divergence = detectSignalDivergence(input);

  const matrices = computeDirectionalPriors(input, divergence.divergenceDetected);

  return {
    mode,
    thresholds,
    look_ahead_leakage_detected: pit.leakageDetected,
    compromised_vectors: pit.compromisedVectors,
    leakage_shield_multiplier: pit.shieldMultiplier,
    is_macro_gravity_dominant: macro.fired,
    macro_override_reasons: macro.reasons,
    is_statistically_tradeable: execution.tradeable,
    slippage_penalty_coefficient: execution.slippagePenalty,
    event_classification: classification.classification,
    suppressed_non_event_reason: classification.suppressedReason,
    dominant_physics_regime: dominance,
    dominant_alternative_vector: alt,
    divergence_detected: divergence.divergenceDetected,
    conflicting_signals: divergence.conflictingSignals,
    predictive_matrix: matrices,
    target_action_signal: pit.leakageDetected ? "REJECT_DUE_TO_LEAKAGE" : (macro.fired ? "MACRO_OVERRIDE" : "PROCEED"),
    pricing_decay_horizon_modifier: "STANDARD_DECAY",
    diagnostic_reasoning_log: "Executed deterministic gating engine successfully.",
    was_relaxed_threshold_used: mode === "HIGH_SENSITIVITY",
  };
}
