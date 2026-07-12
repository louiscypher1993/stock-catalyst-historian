# DEEP DIVE BRIEFING — Extended Multi-Session Investigation

**Created**: 2026-07-11 (evening), by the session that shipped F1-F10 + v9.3.
**Window**: ~37.5 hours of Fable access from creation time. Lewis unavailable for most of it (~16h away to start). The machine stays on; full local resources (market_cache.db, CPU, disk) are available throughout.
**This document is the single source of truth for scope, constraints, and context.** Any future session starts cold — read this file AND `DEEP_DIVE_PROGRESS.md` before doing anything.

---

## Scope and Priority Order (work top to bottom, don't skip ahead)

### PRIORITY 1 — Regression/consistency check on this session's own fixes

(F1-F10 audit, D3 investigation, v9.3 compression retrain — full detail in `AUDIT_FINDINGS_2026-07.md` and the Context summary below.) These were verified individually but never cross-checked against each other. Specifically:

- **CHECK THIS FIRST, it's fast and could be a real self-inflicted bug**: `obv_delta_10d`'s formula was redefined this session in BOTH `LiveInferenceService.ts` and `HistoricalEngine.ts` (F1 commit `b4e5987`, fix #5 of 6). Was `features.csv` regenerated from the new HistoricalEngine.ts formula before v9.3's retrain, or is v9.3 trained on STALE obv_delta_10d values while live now computes the new formula? If stale, this is a NEW train/serve skew this session accidentally introduced — quantify it with the same rigor as the original F1 measurement (real events, real vectors, real model scoring) if confirmed.
  - **HEAD START (verified 2026-07-11 by the briefing author — do not re-derive)**: `src/ml/features.csv` mtime is **Jul 7 19:21**; F1's formula change landed **Jul 11 03:31** (`b4e5987`); v9.3 models were trained **Jul 11 ~18:04** from that stale Jul 7 CSV. So yes: v9.3 (and all other deployed heads) are trained on OLD-formula obv_delta_10d, live computes the NEW formula. The F1 commit message explicitly acknowledged this would be true "until the next retrain regenerates them" — the v9.3 retrain reused the old CSV instead of regenerating. Note the skew began at F1 deploy time and affects EVERY head consuming full_feature_cols (B/C/D1-D5/E), not just the v9.3 five; it is currently latent because live runs are effectively paused (Supabase down). Remaining work: quantify old-vs-new value divergence on real events + model prediction/rank impact; check obv_delta_10d's gain importance per head; write up recommendation (regenerate features.csv + retrain, vs. revert live formula, vs. accept).
- Do any of F1-F10's other fixes interact in untested ways? (e.g. F10's beta-hedge change vs F2's rule-based gate — shared state? v9.3's retrain vs D4, which stayed on v9.2 — any inconsistency worth knowing about even though D4 is unused/dead-wired?)
- Are deliberately-deferred items still correctly deferred and documented, or has anything drifted? (`sector_relative_z_score` still hard-zeroed for D5 and un-fixed; `riskScore`/`positionSizePct`'s `model_a_confidence` dependency left untouched per F2's scoping; `averageReturn1m/6m` outlier values noted in F6 but not fixed)

### PRIORITY 2 — SEC 13F real build-out (local-only, staged for Supabase migration)

Per the 13F scoping (see Context summary): the bulk quarterly Form 13F Data Set approach is validated, the fuzzy-match + filer-count-disambiguation mapping rule is validated on real data, the two known traps (false-positive name matches, pre/post-2023 VALUE unit change) have working fixes. This window, go further than scoping:

- Build the real CUSIP-mapping script properly (not just the earlier spot-check), applying the highest-filer-count disambiguation rule, for the FULL ~553 US-listed symbol universe (not just the 12-symbol sample).
- Run the real backfill against however many quarters are reasonably obtainable in this window, writing to LOCAL SQLite tables (mirror the proposed `sec_13f_holdings`/`sec_13f_cusip_map` schema, but as local tables — new local .db file or new tables in market_cache.db, builder's call, document which in PROGRESS).
- This produces a fully staged, ready-to-migrate dataset — write a clear migration script/instructions for moving local → Supabase once it's back, but do NOT attempt to write to Supabase (it's down).
- Flag match-confidence per symbol per the existing `match_confidence` column design — don't silently drop ambiguous matches, log them.
- Raw material already on disk: `sec_13f_data/01mar2026-31may2026_form13f.zip` + `FORM13F_readme.htm` (SEC's own dataset documentation). More quarters download from SEC's "Form 13F Data Sets" page (https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets). Company names for fuzzy matching: `company_profiles` / `fmp_company_profiles` tables in market_cache.db; symbol universe derivable from `event_features`/`daily_prices` symbols filtered to US-listed.

### PRIORITY 3 — P4 breadth pass, done properly this time

The original audit only pattern-scanned the ~20 data-fetcher services. Deep-dive each for the same bug classes found elsewhere this session: silent null/zero fallbacks presented as real data, train/serve skew, unit mismatches, swallowed errors, hardcoded/mock data masquerading as real. Service files (project root): FDAService, GDELTService, RedditSentimentService, EarningsCalendarService, WikipediaService, YouTubeService, AlphaVantageService, CongressionalTradingService, EODHDService, EarningsSentimentService, EconomicCalendar, EdgarService, FinnhubService, FinraShortInterestService, FREDService, GoogleTrendsService, MacroTrendDetector, NewsAPIService, PeerDataService, PolygonService, ShortDataService, StockProfileService, StockTwitsService, ExecutiveIntelligence. (BatchScannerService already audited clean; LiveScanner already quarantined in F9.)

### PRIORITY 4 — Extended verification of v9.3's deployment

With compute effectively free, re-run a fuller version of the sweep-style verification against the newly-deployed v9.3 models (reuse the existing `decidePot()`/`historical_inference_results` infrastructure) — deeper than what was done during deployment, since that was scoped for speed, not exhaustiveness.

### PRIORITY 5 — Anything else genuinely interesting found along the way

Logged but not chased unless P1-P4 are exhausted.

---

## Hard constraints (do not violate — these do NOT loosen just because more compute/local-DB access is available)

- **No commit, push, or deploy of anything to git or Supabase without Lewis's explicit sign-off** — he will not be available to review for up to ~16 hours at a time, so nothing gets merged unattended, regardless of how much local verification work has been done. Local SQLite staging (new tables/files, not touching tracked source files) is fine and encouraged per Priority 2 — the constraint is specifically about git/Supabase writes and deployed model files (`src/ml/model_*_v*.json`, `feature_metadata_*.json`, `calibrator_*.pkl`, `infer.py` wiring).
- **Never invoke `runLiveInference`/`LiveInferenceService` directly** (project invariant, applies regardless of Supabase's current status).
- **Never restart the server, never force-push.**
- **`npx tsc --noEmit` as a sanity gate on anything that touches TS**, even in scratch/staging form.
- **All work must be Supabase-independent for writes** (reads/checks against local market_cache.db are fully fine and expected — that's the whole point of this window).

---

## Session continuity protocol (CRITICAL — read this first, every time)

This investigation spans multiple independent sessions. At the START of EVERY session:

1. Read `DEEP_DIVE_PROGRESS.md` (create if it doesn't exist yet) — the running log of what's been checked, what's found, what's still open, and what's been staged locally (e.g. how much of the SEC 13F backfill is done).
2. Do NOT restart from scratch or re-verify already-confirmed findings. Trust the progress log as ground truth for what's already done.
3. Pick up at the exact next unchecked/unfinished item in priority order.

At the END of EVERY session (or when running low on context/budget):

1. Append to `DEEP_DIVE_PROGRESS.md`: what was checked this session, what was found (real findings vs ruled-out hypotheses, same discipline as the F1-F10 work), what was staged locally (file paths, row counts, completion state), and exactly what the next session should pick up.
2. Do this BEFORE running out of context, not after — if a session is approaching its limit, stop investigating and write the progress update as the last action.
3. Never leave an in-progress finding OR an in-progress backfill half-written without a clear "STOPPED HERE, resume with X" note — a fresh session must be able to continue exactly where it left off without re-deriving anything.

---

## Context summary (condensed from the originating session — for a model with no conversation access)

### What this project is

`stock-catalyst-historian` is a stock-catalyst detection + paper-trading system ("POTS") on branch `feature/local-development`. Two halves:

1. **Training/historical side**: `HistoricalEngine.ts` scans ~10 years of daily bars (local SQLite `market_cache.db`, table `daily_prices`, 3.5M rows, 1,404 symbols incl. SPY, 2016-2026) for anomaly events, computes ~72 features per event into `event_features` (66,883 rows, `features_json` blob), which is exported to `src/ml/features.csv` (the training matrix). `src/ml/train_all_models_v9.py` trains 9 XGBoost models: **A** (event classifier → `model_a_confidence`, isotonic-calibrated), **B** (1m fwd return), **C** (max drawdown), **D1** (3m), **D2** (6m), **D3** (2d), **D4** (3d — trained but effectively dead-wired/unused downstream), **D5** (2w), **E** (12m outperform probability). Temporal 70/15/15 split with 21-day embargo; asymmetric MSE (alpha=2.5 penalizing overestimation); VIX/liquidity sample weighting.
2. **Live side**: GitHub Actions cron → `runLiveInference()` in `src/LiveInferenceService.ts` → `detectAnomaly()` (z-score gate) → `buildFeatureVectorForAnomaly()` → `src/ml/infer.py` (loads model JSONs) → results upserted to Supabase `inference_results` → `PotService.decidePot()` runs paper-trading pots (traits: Ambition/Patience/Focus/Boldness; patience band selects the model head via `HORIZON_TIER_CONFIG`; entry/exit tiers STRONG_BUY/BUY/SELL/HOLD). Sweep infrastructure simulates thousands of synthetic pots against `historical_inference_results` (40,000-pot sweep; `synthetic_pots/contaminated_sweep.db` — see methodology lesson below for why "contaminated").

**Current environment facts**: Supabase is DOWN (503) — all live writes impossible, live crons effectively paused; this is why local-only staging is the mode of work. FMP premium expired 2026-07-06 — all FMP data was cached to SQLite before expiry (the `fmp_*` tables). Model wiring in `infer.py` as of commit `5efd794`: A/C/E on v9.1, D4 on v9.2, **B/D1/D2/D3/D5 on v9.3**.

### The July 2026 audit (F1-F11) and what was fixed — commit hashes

Full detail in `AUDIT_FINDINGS_2026-07.md`. Status of each:

- **F1 (HIGH, FIXED `b4e5987`)** — Train/serve skew: ~13 model features silently hard-zeroed or mis-scaled on every live inference (incl. `seismic_magnitude_mw`, Model A's #1 gain feature; `kinetic_energy` on a wrong formula/scale; `rsi_14`, `dist_sma_50/200`, `obv_delta_10d`, `gap_fill_ratio`, `market_reynolds_number`, `barycenter_stretch_20d`, etc.). Fix ported training formulas into the live path (6 sub-fixes), verified on a 126-event stratified sample; 8x reduction in Model A gate-flips. **Sub-fix #5 REDEFINED `obv_delta_10d` in both HistoricalEngine.ts and LiveInferenceService.ts** (old: 10-day OBV delta normalized by absolute level of a since-inception cumulative sum — irreproducible from a bounded live window; new: net volume-signed pressure over last 10 trading days as % of total volume in that window, bounded [-100,100]) and explicitly did NOT regenerate features.csv — this is the seed of Priority 1's first check.
- **F2 (HIGH, FIXED `f8a9dfd`, option c)** — Model A's training label (`is_null_sample` via `classifyEvent()`) is a near-deterministic function of its own input features (|move|<4% + volume_ratio≥1.5 — both are model inputs; separation empirically PERFECT on 13,362 rows). "Model A confidence" is functionally a re-derivation of a hard rule. Fix replaced the Model A entry gate in decidePot with an explicit boldness-graded RULE-based gate (no model). NOTE deliberately deferred: `riskScore`/`positionSizePct` still consume `model_a_confidence` — left untouched per F2's scoping.
- **F3 (MED-HIGH, FIXED `bc950c9`)** — Zombie positions: positions whose symbol had no price skipped ALL exit checks forever (locked Focus slot + capital). Fix: patience-timeout now fires without a price (close at entry, 0 return, reason `patience_no_price`/`short_cover_no_price`). Stop-loss/reactivity still correctly require a real price.
- **F4 (MED-HIGH, DOCUMENTED `bbb12fb`)** — ~24% of POTS trait space structurally incapable of trading (patience (4.5,6.5] → 1M head with deliberately-empty tier config: 8,611/8,611 sweep pots zero trades; Ambition>8 ∧ Patience>8.5: 1,022/1,022 zero trades). Fix was documentation + sweep-generation tagging, NOT remapping — dead bands still exist by design.
- **F5 (MED, FIXED `bc950c9`)** — Short-entry gate used `Math.abs(expected return)` on a signed quantity — semantically inverted for 2W pots (selected the LEAST-weak names). Fixed to gate on the signed prediction. **Short-threshold decision (OPEN, deliberate)**: the corrected gate collapses realistic D5 short volume to near-zero (D5 SELL tier's deepest real predicted decline in the fold is only -2.66%, below even the loosest 12% minReturn threshold; 400 trades passed the old inverted gate, 0 pass the corrected one). This correctly exposes that D5-based shorting was never justified by real predictions. Whether short-side thresholds should be recalibrated to restore meaningful short volume is an explicit, separate follow-up decision — NOT scoped into F5, still undecided.
- **F6 (MED, FIXED `4d37cdf`)** — `computeAnalogueOutcomes` bucketed fractional returns against percent thresholds (~98% of analogues reported "sideways"). Thresholds fixed to 0.10/0.02/-0.02/-0.10. NOTE deferred: `averageReturn1m/6m` outlier values observed during this work were noted but NOT fixed.
- **F7 (MED, NOT FIXED)** — Entry selection is array-order not quality-ranked; PHASE 2 replacement close doesn't bind the PHASE 3 open. Proposed (sort by expected return; reserve slot for justifying signal) but needs sweep-verified sign-off. Open.
- **F8 (LOW-MED, NOT FIXED)** — No FX normalization in pot ledger (intl prices treated as GBP; % P&L internally consistent, share counts/universe selection biased). Documented only.
- **F9 (LOW, FIXED `d663ac8`)** — LiveScanner.ts quarantined (unwired script that would write fabricated constants into anomaly_cache if run).
- **F10 (LOW, FIXED `d1f2309`)** — `detectAnomaly`'s z-score gate subtracted a single constant SPY return from every window day — algebraically cancels out of the z-score, making the "idiosyncratic" gate a raw-return gate (fires universe-wide on market shock days). Fix ported training's per-day rolling-60-day beta regression (`buildBetaHedgedExcessReturns()` + `buildSpyReturnMap()`, SPY fetch widened 1mo→1y, both call sites: `runLiveInference` and server.ts `/api/scan-symbol`). Verified: Spearman vs training z 0.9186→0.9321; COVID-crash false-fire rate 79.8%→33.5%.
- **F11 (notes, no action)** — gating engine's `predictive_matrix` is an explicit mock (inert); `divergence_detected` constant-false; CorrelationEngine topEvents date attribution off-by-one under ascending data; unreachable "transitioning" regime; short stop-loss floors derived from long distributions; pot_snapshots prevPnl single-write-failure residual risk.
- Also fixed this session (pre-audit, D3 investigation): **`1566ae3`** — `overnight_gap_pct`/`vix_close` ~100x live scale bugs.

### D3 investigation and resolution

D3 (2d head) tier assignment was near-random live — root-caused to the ~100x scale bugs fixed in `1566ae3`. Separately, the v9.3 regularization work flagged D3's train-val IC gap doubling (0.114→0.252) under full relaxation; a dedicated scratch experiment (`src/ml/scratch_d3_milder.py`, results in `src/ml/scratch/scratch_d3_milder_results.json`) tested milder max_depth (6,7) plus an alternate temporal split and concluded the gap widening is a **training-fit artifact, not a real generalization loss** — test IC flat across all configs, conclusion robust across 2 splits. No D3-specific config warranted; full relaxation applied to all 5 heads. (`scratch_d3_milder.py` is still UNTRACKED in git — disposition undecided, ask Lewis.)

### v9.3 compression fix and deployment

Deployed regression heads had severe prediction compression (val label IQR / val pred IQR — e.g. D3 34.2x). Root cause: over-tight regularization. Fix ("memory #26"): `max_depth` 5→8, `subsample` 0.8→1.0, `colsample_bytree` 0.8→1.0 (eta/objective/eval_metric/seed unchanged), validated in `src/ml/scratch_relaxreg.py` across 2 temporal splits — compression fixed on all 5 heads, IC flat-or-improved on every head. Real retrain: `src/ml/train_regression_heads_v9_3.py` (B/D1/D2/D3/D5 only; A/C/E untouched) → `model_{b,d1,d2,d3,d5}_v9.3.json` + `feature_metadata_v9.3.json`. Verified twice: `verify_v9_3.py` (native Booster + explicit `iteration_range`, reproduced scratch-predicted numbers to 4dp: IC_test B 0.0710 / D1 0.1198 / D2 0.0986 / D3 0.0914 / D5 0.2559; compression B 7.4x / D1 20.5x / D2 9.6x / D3 7.2x / D5 12.8x) and `verify_v9_3_via_infer.py` (through infer.py's actual sklearn-wrapper load path on the FULL 10,051-row test set: exact 0.0000 IC delta every head — this also empirically confirmed the sklearn wrapper auto-restricts to `best_iteration` despite no explicit `iteration_range`; a real potential silent-divergence source, checked not assumed). Deployed in `5efd794` (wired into infer.py; feature_metadata_v9.3 column list confirmed identical+same-order as v9.1's 72 cols). Pre-retrain deployed files kept as `*_pre_regularization_backup.json` (md5-verified byte-identical) — instant fallback.

### SEC 13F scoping findings (the "memory #23" material)

- **Approach validated**: SEC's bulk quarterly **Form 13F Data Sets** (structured zips, one per quarter). One quarter already on disk: `sec_13f_data/01mar2026-31may2026_form13f.zip` (+ `FORM13F_readme.htm`). Inside: pipe-delimited tables incl. INFOTABLE (per-holding rows: CUSIP, VALUE, SSHPRNAMT, filer id) and COVERPAGE/SUBMISSION (filer identity, period).
- **Mapping rule validated on real data**: symbol→CUSIP mapping via fuzzy company-name match against INFOTABLE issuer names, then disambiguate by **highest distinct-filer count** among candidate CUSIPs. Evidence: AAPL's real CUSIP had 6,676 distinct filers vs worst decoy's 382 (17x gap); PSA 1,205 vs decoys' 1-7. Caveat: smaller/less-covered names may have thinner real-vs-decoy margins — spot-check per company at build time, don't trust blindly; record `match_confidence`.
- **Trap 1 (has working fix)**: false-positive name matches (e.g. "Apple Hospitality" vs "Apple Inc") — the filer-count rule exists precisely for this; fuzzy match alone has a real, measured false-positive rate.
- **Trap 2 (has working fix)**: **VALUE units discontinuity** — pre-2023 filings report VALUE in THOUSANDS of dollars; from Jan 3, 2023 onward in whole dollars (confirmed from SEC's own documentation). Any backfill spanning pre-2023 quarters must branch on this.
- Also real: filer-reported CUSIP inconsistency exists independently of decoy-name matches (same issuer, variant CUSIPs across filers) — aggregate accordingly.
- **Proposed schema** (build as LOCAL tables this window): `sec_13f_cusip_map` (symbol, cusip, matched_name, filer_count, match_confidence, quarter_validated) and `sec_13f_holdings` (quarter, cusip, symbol, total_value_usd, total_shares, filer_count, derived deltas). Migration to Supabase deferred until it's back.

### Key methodology lesson (applies to ALL backtest-style verification here)

`getSymbolSnapshot(symbol)` returns the **latest** `signal_snapshot_json` for a symbol (`ORDER BY date DESC LIMIT 1`). That is correct for live inference but **look-ahead-contaminated for any backtest**: joining today's snapshot onto historical events injects future information. The full-catalogue sweep was knowingly built this way — hence the artifact name `contaminated_sweep.db` — and its results are optimistic upper bounds, usable for structural findings (e.g. F4's zero-trade bands, F5's short-gate comparisons) but NOT for absolute performance claims. Point-in-time-correct analysis must join `event_features` on (symbol, date) — or use only data as-of the event date. Any new verification built in this window (esp. Priority 4) must use point-in-time joins.

### Working discipline expected by Lewis (adapted for this unattended window)

Normal mode is strict recon → report → explicit sign-off → implement → verify empirically (real local data, never assumptions) → report → explicit "commit" → explicit "push" (with before/after/origin-matches confirmation). **In this window**: local staging and scratch work proceed autonomously; anything requiring git/Supabase/deployed-file writes gets WRITTEN UP in PROGRESS.md as a ready-to-review proposal instead of executed. Findings must distinguish CONFIRMED (empirically verified) from PLAUSIBLE (code-read only). Every empirical claim gets verified against real local data. Known hazard to keep in mind for any future Supabase work: new upsert fields need matching ALTER TABLE or writes fail silently while runs stay green (17-day outage precedent).
