# Audit Findings — stock-catalyst-historian

**Audit pass**: 2026-07-11, per `AUDIT_BRIEFING_2026-07.md` (priorities P1-P6)
**Discipline**: read-only — zero code changes, zero commits. Every empirical claim below was verified against local data (`market_cache.db`, `synthetic_pots/contaminated_sweep.db`), not inferred from code reading alone. Fixes are proposed, not implemented — each needs explicit sign-off per the established recon → propose → sign-off → implement → verify pattern.

Priorities P1-P3 produced significant findings. P4 (service breadth), P5 (credentials), P6 (backtestPots) came back clean or near-clean.

---

## F1 — HIGH — Train/serve skew family: ~13 model features hard-zeroed on every live inference

The known `competitor_event_density` gap (memory, v9.1 open item #2) is not an isolated case — it is one member of a **13+ feature family**.

`buildFeatureVectorForAnomaly` ([LiveInferenceService.ts:385-403](src/LiveInferenceService.ts#L385-L403)) sets only: z_score, excessReturn, atrShockScore, volumeRatio, relative_volume_30d, body_to_range_ratio, overnight_gap_pct, volume_price_clustering, kinetic_energy, temporal features, pre-returns. Cross-referencing every accessor in `NUMERIC_ACCESSORS` ([feature_extractor.ts:107-163](src/ml/feature_extractor.ts#L107-L163)) that reads **only `features_json`** (no signal-snapshot fallback), these are never set by the live path and are therefore **sent as 0 on every live inference** (null→0 conversion at [feature_extractor.ts:510](src/ml/feature_extractor.ts#L510)):

- **`seismic_magnitude_mw` — Model A's #1 gain feature (142.31, top of its ranking)**
- `rsi_14`, `dist_sma_50`, `dist_sma_200`, `obv_delta_10d`, `gap_fill_ratio`
- `market_reynolds_number`, `barycenter_stretch_20d`
- `ctb_velocity_7d`, `peer_average_return`, `peer_contagion_delta`, `economic_policy_uncertainty`
- `competitor_event_density` (already known)

Two compounding aggravations:
1. **`kinetic_energy` is set live but with a different formula on a different scale**: training uses `0.5 * relative_volume_30d * (return*100)²` ([HistoricalEngine.ts:2039](HistoricalEngine.ts#L2039)); live uses `0.5 * z²` ([LiveInferenceService.ts:257](src/LiveInferenceService.ts#L257)). A 10%-move-at-3x-volume trains as KE≈150; the same event serves as KE≈5-15. Since training's `seismic = (2/3)·log10(max(1,KE))`, seismic=0 encodes "tiny move" — so every live anomaly presents to Model A as a tiny move regardless of actual size.
2. **Null conventions differ**: training-side nulls become NaN in features.csv → XGBoost's learned missing-branch; live nulls become literal 0 → whatever side of each split 0 lands on. Even features that are *correctly* null live take different tree paths than the same nullness took in training.

**Impact**: every live `model_a_confidence`, B/C/D-head prediction, and therefore every POTS entry decision, dashboard value, and notification is computed on partially fabricated inputs. All of this session's model diagnostics ran on features.csv (training side, correct values) — the live distributions have never been measured and may differ materially.

**Proposed direction** (needs sign-off): compute the missing bar-derivable features live (rsi/sma/obv/gap_fill from `bars` are straightforward; seismic/KE just need the training formula reused), or explicitly zero them in *training* so both sides agree; align the null→0 vs NaN convention. Flag: this interacts with the parked Model A recalibration — recalibrating against training-side distributions won't fix live-side skew.

---

## F2 — HIGH — Model A's training label is a (near-)deterministic function of its own input features

`is_null_sample` — Model A's label source (`is_event = (is_null_sample == 0)`) — is derived at [HistoricalEngine.ts:601](HistoricalEngine.ts#L601) solely from `classifyEvent()`'s verdict ([QuantamentalGatingEngine.ts:315-372](QuantamentalGatingEngine.ts#L315-L372)), which is a hard rule over `|move| < 4%` + `volume_ratio >= 1.5` (or external signal z ≥ 2.5). But `excess_return` and `volume_ratio` are **Model A input features**.

**Empirically confirmed** (13,362-row sample of event_features): the separation is *perfect* — 0.0% of event-labeled rows sit in the sub-4%-move + volume≥1.5 box, and 0.0% of null-labeled rows have |excess_return| ≥ 4%. The label is learnable directly from two features the model receives. Additionally, 20.6% of null-labeled rows carry |z| > 2.15 (the live anomaly-trigger signature) — Model A is trained to suppress a fifth of z-anomalies purely by the 4%-move rule.

**Why this matters**: it reframes the Model A saturation finding. The isotonic calibrator collapses to 1.0/low-cluster because the raw predictions are near-perfectly separable — and they're separable **by construction**, not because the model learned anything about markets. "Model A confidence" is functionally a re-derivation of `classifyEvent()`, computable without a model. The parked "recalibrate the isotonic fit" proposal would make the outputs smoother but cannot fix that the underlying task is trivial. Any future Model A work should start from the label definition, not the calibration.

Secondary note: there are **two divergent `is_null_sample` derivations** — the verdict-only one at line 601 (what gets persisted) and the selection-flag one at [HistoricalEngine.ts:2242-2244](HistoricalEngine.ts#L2242-L2244) (`nullCandidates.slice(0, maxNull)`, which also takes first-N chronologically rather than sampling — a mild early-window selection bias). They happen to coincide in the current data but are structurally independent code paths that can drift.

---

## F3 — MEDIUM-HIGH — decidePot: zombie positions when a symbol has no price

PHASE 1's `if (!cp) continue` ([PotService.ts:547-548](src/PotService.ts#L547-L548)) skips **all** exit checks — including patience timeout — for any position whose symbol has no price in the priceMap. A delisted/acquired/halted symbol (not rare for anomaly-catalyst stocks) therefore:
- never exits, ever — the position stays open indefinitely;
- permanently consumes a Focus slot (`openCount >= pot.focus` counts it) and its `position_size_gbp` stays locked out of cash;
- the warning at [PotService.ts:1007](src/PotService.ts#L1007) ("exits/unrealised PnL will use entry price") describes behavior that **does not exist** — exits are skipped, not entry-priced.

Secondary path: PHASE 2 replacement *can* close a no-price position (fallback `?? pos.entry_price`, [PotService.ts:595](src/PotService.ts#L595)) at its entry price — booking 0% P&L on a potentially worthless position.

**Proposed direction**: patience-timeout should fire even without a price (close at last-known/entry price with an explicit `no_price` reason), or add a hard staleness rule (no price for N consecutive runs → force-close + flag). Needs a decision on what exit price to book for genuinely dead symbols.

---

## F4 — MEDIUM-HIGH — ~24% of POTS trait space is structurally incapable of trading, silently

Verified against the 40,000-pot sweep results:
- **Patience (4.5, 6.5] (1M horizon): 8,611 of 8,611 pots made zero trades in 10 years.** `HORIZON_TIER_CONFIG.model_b_return_1m` is deliberately empty (always HOLD — that emptiness is a data-supported finding), but the systemic consequence — an entire patience band that can never enter a position, long or short — was never surfaced.
- **Ambition > 8 AND Patience > 8.5: 1,022 of 1,022 pots zero trades.** `ambitionTier(A>8)` requires STRONG_BUY but the D2 (6M) config's maximum tier is BUY.

Any *live* pot with these traits does nothing forever; sweep-derived statistics (e.g. trait-performance regressions) silently include ~9,600 structurally-inert pots. **Proposed direction**: either document + exclude these bands from pot generation/sweeps, or remap dead patience bands to the nearest live horizon. Cheap fix, but it changes sweep-comparability — needs a deliberate decision.

---

## F5 — MEDIUM — Short-entry gate is semantically inverted for 2W pots; 2D shorts lose money outright

The short-entry gate `downside = Math.abs(expectedReturnForHorizon(...)); if (downside < tier.minReturn) continue` ([PotService.ts:707-708](src/PotService.ts#L707-L708)) is the same `Math.abs`-on-a-signed-quantity bug class as the fixed riskScore bug:

- For 2W-patience pots, SELL tier = `model_d5_return_2w <= 0.1341` — a range that is **almost entirely positive** (D5's p1 = +0.084). `Math.abs` turns "predicted +13% rise" into "13% downside." Within the shortable cohort the gate **selects the least-weak names** (highest predicted return) and rejects the genuinely weakest. Verified in the sweep: mid-ambition pots (restricted to the [0.12, 0.1341] slice) underperform low-ambition pots (whole tier) by 2.7pp per short round-trip (+5.23% vs +7.96% mean).
- **Ambition > 6 shorts are structurally impossible** (minReturn 0.21 > max |SELL value| 0.1341) — verified n=0 in 110,150 sweep shorts — directly contradicting `shortScore`'s `+0.2×Ambition` term, which *promotes* shorting as ambition rises.
- **2D-patience shorts lose money on average even on leakage-contaminated data**: -0.74% mean per round-trip (n=77,050), dragged by a fat left tail despite a 56.3% win rate. Honest out-of-sample results would likely be worse; borrow costs aren't modeled at all.
- The `REDUCE` branches in both the reactivity exit ([PotService.ts:567](src/PotService.ts#L567)) and short entry ([PotService.ts:700](src/PotService.ts#L700)) are **dead code** — `resolveTierFromConfig` can only return STRONG_BUY/BUY/SELL/HOLD.

**Proposed direction**: shorts should gate on the *signed* prediction relative to its cohort (e.g. D5 percentile rank, matching the riskScore fix pattern), not `Math.abs`; the 2D short path deserves a kill/keep decision given it's value-negative under even best-case data; remove dead REDUCE branches.

---

## F6 — MEDIUM — `computeAnalogueOutcomes` probabilistic outlook is units-broken (constant "sideways")

[HistoricalSimilarityService.ts:151-161](HistoricalSimilarityService.ts#L151-L161) buckets `return_1m` with thresholds written for percent (`> 10` = strong rally) against **fractional** data (verified: median 0.02, only 0.21% of rows exceed 10). Result: ~98% of analogues report "sideways" regardless of actual outcome. Consumed by the `/api` endpoints at [server.ts:399-400](server.ts#L399-L400) and [server.ts:475-476](server.ts#L475-L476) (flows into human-facing analogue summaries/narrative context). `winRate`/`averageReturn` fields are units-independent and fine. **Fix is a 5-line threshold change** (0.10/0.02/-0.02/-0.10) + display-unit check — but verify consumers' display formatting at the same time.

---

## F7 — MEDIUM — Entry selection is array-order, not quality-ranked; replacement opens a different signal than justified the close

- PHASE 3 long entries take the **first** qualifying result in `results` array order ([PotService.ts:645-649](src/PotService.ts#L645-L649)) — no ranking by expected return, riskReward, or tier strength. With one free slot and several qualifying signals, the winner is whatever the scan pipeline happened to order first.
- PHASE 2 replacement closes the worst position because one specific signal "beats it by threshold" ([PotService.ts:611-618](src/PotService.ts#L611-L618)) — but the freed slot is then filled by PHASE 3's array-order scan, which may open a **different**, merely-qualifying signal that doesn't beat the closed position. The close's justification doesn't bind the open.
- The beat comparison also uses the worst position's `expected_return_at_entry` (a stale prediction from entry day) rather than any measure of *remaining* expected return.

**Proposed direction**: sort qualifying entries by expected return (or riskReward) before filling slots; have replacement reserve its slot for the specific justifying signal. Behavior-changing for pots — needs the same before/after sweep verification as prior PotService changes.

---

## F8 — LOW-MEDIUM — No FX normalization in the pot ledger

International symbols' native-currency prices (¥283.75, ₹105.70 — both seen in real sweep trades) are treated as GBP throughout. The ledger stays *internally consistent* (percentage-based P&L), so returns aren't corrupted — but share counts are economically wrong, `position_size_gbp` is mislabeled for intl positions, and the `shares === 0` floor systematically skips high-nominal-currency stocks (a ¥50,000 stock "costs more than" a £500 allocation despite being ~£260). Universe selection is silently biased by currency nominal levels. Fix requires an FX source — medium effort, low urgency for paper trading, worth documenting on any results derived from intl symbols.

---

## F9 — LOW — LiveScanner.ts: unwired but dangerous-if-run (anomaly_cache contamination vector)

`src/LiveScanner.ts` is **not** part of the live pipeline (only reachable via manual `npm run scan:live`; the real detector is `detectAnomaly` in LiveInferenceService.ts). But if run, it writes rows into `anomaly_cache` via `setCachedAnalysis` with **fabricated constants** (`confidence_score: 95`, `causalConfidence: 85` hardcoded), a z-based `kinetic_energy` incompatible with training's formula, a statistically incoherent z-score (excess return measured against a raw-return baseline), and a universe silently truncated to 30 symbols. `HistoricalEngine` reads that same cache as legitimate analysis ([HistoricalEngine.ts:2212](HistoricalEngine.ts#L2212)). **Proposed direction**: delete or quarantine the script (remove the npm alias); it predates the real pipeline and everything it does is done better elsewhere.

---

## F10 — LOW — detectAnomaly's SPY adjustment algebraically cancels out of the z-score

[LiveInferenceService.ts:213-227](src/LiveInferenceService.ts#L213-L227): the rolling window subtracts **today's** SPY return from every historical day's return. Since the same constant is subtracted from both the numerator's excess return and the window mean, it cancels exactly — the "idiosyncratic" z-gate is mathematically identical to a raw-return z-gate. Consequence: on market-wide shock days the scanner fires across the whole universe (the very thing beta-stripping was meant to prevent). The `excessReturn` *feature* is still genuinely excess; only the gate is affected. Note: training-side anomaly selection (HistoricalEngine) should be checked for the same construction before fixing live-only — fixing serve but not train would *create* skew in the z-score feature's distribution. Recon needed before any change.

---

## F11 — Notes (no action urgency)

- **Gating engine's `predictive_matrix` is an explicit mock** (comment: "Mock directional probabilities") persisted whole into `event_features.gating_verdict_json`. It feeds no model feature and no decision — inert stored junk, but anyone querying that JSON later should know it's fabricated.
- **`divergence_detected` is constant-false in practice** (verified n=13,362 earlier session): its three source inputs are rarely/never populated. Dead feature riding along in signal_snapshot.
- **CorrelationEngine**: return calc assumes descending-sorted history while the Yahoo fallback returns ascending — correlation/beta are invariant to the flip (both series flip together), but `topEvents` date attribution is off-by-one under ascending data. Minor.
- **RegimeDetectionService**: `"transitioning"` macro regime is unreachable (conditions are exhaustive). Cosmetic.
- **Short stop-loss floors** (`HORIZON_STOP_FLOOR`) were derived from *long* max-adverse-excursion distributions but applied symmetrically to shorts.
- **`pot_snapshots` prevPnl regression risk**: `evaluateRun` reads latest snapshot's cumulative P&L; a failed snapshot write reverts the next run's baseline to an older value. The concurrency guard (dc1e426) removed the known cause; residual risk is single-write failures (already logged, not retried).

## Clean — audited, no findings

- `src/utils/physics.ts`, `src/SignalNormalizer.ts` — correct formulas, correct degenerate-case guards.
- `GatingAdapter.ts` — careful unit handling (the percent→fraction divide is explicit); one vestigial empty if-block.
- Credentials (P5): no hardcoded secrets anywhere (`supabaseClient.ts` env-only with fail-loud check; workflows use GitHub secrets; ntfy/Gemini/FMP keys all env-gated).
- `BatchScannerService.ts` (P4 breadth): budget-aware, progress-tracked, per-symbol error isolation. No red flags.
- `backtestPots.ts` (P6): confirmed dead — zero inbound references, manual-run only, already slated for retirement. Its 3 TODOs need no action.

## P4 scope note

The full breadth pass over the ~20 untouched data-fetcher services (FDAService, GDELTService, RedditSentimentService, etc.) was **not** completed line-by-line — P1-P3 findings consumed the budget on higher-value targets, which matches the briefing's "allocate by value, don't clear the checklist" instruction. The pattern-level scan (swallowed-error/fake-default greps) surfaced nothing alarming. Remaining services are lower priority: most feed sparse enrichment features whose failure mode (null) is handled by the null-indicator machinery.

---

## Recommended action order (all need sign-off before any implementation)

1. **F1** — live feature-vector integrity. Biggest blast radius: every live decision is affected today. Also cheap to *measure* first (run one live-style vector through both paths and diff).
2. **F2** — decide what Model A should actually mean before any retrain/recalibration work proceeds (supersedes part of the parked recalibration plan).
3. **F3 + F5** — decidePot exit/short fixes (small, sweep-verifiable, same pattern as prior PotService fixes).
4. **F4** — document/exclude inert trait bands (affects sweep interpretation immediately).
5. **F6** — 5-line units fix, human-facing.
6. **F7/F8/F9/F10** — as capacity allows; F9 is a 2-minute quarantine.
