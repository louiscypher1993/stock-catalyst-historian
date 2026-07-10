# Audit Briefing — stock-catalyst-historian

**Prepared for**: a fresh audit pass (Claude Fable), ~2-day window
**Prepared**: 2026-07-11
**Purpose**: point the audit at high-value, not-yet-checked surface area, and hand over what's already been verified so the window isn't spent re-finding things this project's session history already found and fixed.

This is a paper-trading research system. **No real capital is at risk currently** — live/automated trading is explicitly parked; the "POTS" system trades synthetic/paper positions only. Treat correctness bugs as important (they'd corrupt the research signal and any future real-money decision built on it) but not as live financial incidents.

---

## STEP 1 — Already verified, do not re-litigate

Everything below was found **and** fixed **and** verified with decisive evidence (decile diagnostics against realized outcomes, bit-for-bit behavioral-equivalence testing, or direct before/after measurement) — not just reviewed. Source: git log on `feature/local-development` (commit hashes below) plus this project's memory files (`v9-1-model-state-and-open-items.md`, `supabase-schema-drift-hazard.md`).

1. **riskScore formula bug** (`PotService.ts`, commit `b4c9012`) — the Model C term used `Math.abs(modelC)*40`, which treated "no drawdown predicted" identically to "large drawdown predicted" (Model C's own predictions are positive ~85% of the time while its training label is negative ~94% of the time). Fixed via percentile-rank substitution. Verified: Spearman riskScore-vs-realized-MAE moved from **-0.131 (wrong direction) to +0.204 (correct direction)**.

2. **riskReward formula bug** (`PotService.ts`, commit `4577070`) — dividing by raw `|modelC|` blew up to 771x whenever modelC landed near zero (9.1% of rows). At `ambition>=4`, over half of rows clearing the live entry gate were numerical artifacts, not signal. Fixed via percentile-rank denominator + 0.15 floor, paired with recalibrating `meetsEntryConditions`' threshold from `ambition/5` to `ambition/40` to restore a monotonic pass-rate curve.

3. **stopLossPct horizon-blindness** (`PotService.ts`, commit `4577070`) — stop width previously ignored patience horizon entirely, causing low-Boldness/high-Patience pots to get stopped out by ordinary volatility before a long-horizon thesis had time to play out. Fixed via per-horizon floor (p25 max-adverse-excursion from real `daily_prices` history). Verified on the worst-20 synthetic-pot cluster: mean return **-40.02% → -29.40%**, stop-loss-close ratio **0.712 → 0.650**.

4. **D3/D4/D5 label-leakage / relabeling** (commit `14a3417`) — `event_features.forward_return_2d/3d/2w` were corrected in `market_cache.db` from an independent `daily_prices` source after a prior session's audit (OOS IC drift, live vendor re-fetch, full-dataset dry run, backed-up transactional UPDATE scoped to non-gapped rows only). D3/D4/D5 retrained on corrected labels as v9.2; A/B/C/D1/D2/E confirmed **bit-identical** to v9.1 (those fields are excluded from `model_bcde_cols`, so provably unaffected).

5. **decidePot()/applyPotActions() refactor** (`PotService.ts`, commit `fe17999`) — extracted the old inline `processPot`/`closePosition` logic into a pure `decidePot()` (no Supabase/HTTP/wall-clock reads) + `applyPotActions()` (all writes via a `PotPersistence` interface), motivated by `backtestPots.ts` having independently drifted from live `PotService.ts` on 4 axes. Verified via legacy-snapshot-vs-decidePot behavioral-equivalence testing: **1,075,457 total cases (1,015,151 entry/stop-loss/reactivity/patience-timeout + 60,306 PHASE-2 replacement), 0 mismatches, 100.0000% match rate.** Known, explicitly-flagged gap: this verifies the refactor matches the *old* logic exactly — it does **not** independently verify the old logic was *correct* against first principles. See STEP 3, item 1 — this is exactly the gap a fresh audit is well-placed to close.

6. **live-inference.yml concurrency race** (commit `dc1e426`) — two concurrent runs (schedule-triggered ~3.5h late colliding with a manual `workflow_dispatch`) raced for 57s on 2026-07-09, silently dropping `pot_snapshots` writes for 7/20 pots during the overlap. Not a `decidePot` bug — a write-contention race. Fixed via a static (not ref/branch-scoped) concurrency group, `cancel-in-progress: false`. `watchlist-pulse.yml` confirmed structurally unaffected (PULSE_MODE unconditionally skips `evaluateRun`).

7. **Model A confidence saturation** — re-diagnosed this session, correcting a prior session's diagnosis. Actual saturation is ~64-66% (not the previously-cited ~88%), and the mechanism is **not** feature redundancy (only 2 of 11 features correlate >0.7) — it's the isotonic calibrator collapsing an already-narrow raw-probability spread into a literal constant (1.0000) for the majority-positive class. `minConfidence(boldness)`'s entry gate is real (rejects ~34% of candidates) but its intended boldness-sensitivity is almost fully defeated by the distribution shape (pass rate only varies 65.06%→66.12% across the *entire* boldness range). **Fix proposed (recalibrate the isotonic fit, not decorrelate features), not deployed.**

8. **D1/D2/D3/D5 prediction compression** — root cause found this session via three scratch experiments (see `src/ml/scratch/` — kept, not deleted, because this one succeeded):
   - Early-stopping-rounds increase (50→150): **no effect** on D1/D2/D3/D5 (`best_iteration` bit-identical).
   - Custom asymmetric eval metric replacing RMSE for early stopping: **no effect** (bit-identical again) — this ruled out the early-stopping/objective-mismatch mechanism as the driver, despite it being a real, code-confirmed mismatch.
   - Regularization relaxation (`max_depth` 5→8, `subsample`/`colsample_bytree` 0.8→1.0): **this worked** — compression reduced 4.75x-6.6x across all four heads with IC flat-or-improved everywhere (no degradation). **Fix proposed, not deployed.** Two known caveats already identified (see STEP 2).

9. **Dashboard recommendation basis switch** (commit `cbac45f`) — `getRecommendation()` switched from `model_b_return_1m` (confirmed via decile analysis to have no usable signal in either tail) to `model_d5_return_2w` (the one head with robust, decile-verified signal), reusing `PotService.ts`'s already-verified `HORIZON_TIER_CONFIG`/`resolveTierFromConfig`. Offline-verified against 10,051 rows: 29.7% of rows change tier label; the downgrade direction is strongly validated (861 old STRONG_BUY/BUY rows downgraded had only 26.7% realized-positive 1-month outcomes vs. 45.7% population base rate — the old basis was actively misleading, not just uninformative). **Code-committed, NOT deployed** — see STEP 2.

---

## STEP 2 — Known open, already scoped — don't re-propose fixes

These have a clear next step already defined. A deep-dive should note they exist and, if directly relevant to something being audited, treat them as background — not re-diagnose or re-propose alternatives.

- **SEC 13F institutional-holdings backfill** — feasibility validated locally against a real downloaded quarterly bulk file (AAPL/MSFT/GOOGL spot-checked, CUSIP-mapping approach validated on 12 real symbols). **Blocked on Supabase** for the actual table/schema work. Local artifacts at `sec_13f_data/` (gitignored).
- **Dashboard basis switch deploy** — code committed (`cbac45f`) and pushed, but the `recommendation_basis` schema column, live shadow-period testing, and actual cutover are all **blocked on Supabase** being confirmed healthy. `inference_results` is still being written on the OLD modelB basis until deployed.
- **Sweep ranking-stability follow-up** — blocked on accumulated post-cutoff dates (need more elapsed real time before the relevant synthetic-pot sweep comparison is meaningful). Tracked, not actionable yet.
- **Regularization-relaxation retrain** (item 8 above) — proposed with two specific, already-identified caveats that a re-audit shouldn't rediscover as if new: (a) D3 shows a real, larger overfitting gap under the relaxed config (train/val IC gap more than doubled, 0.114→0.252, while test IC held flat — worth a milder relaxation for D3 specifically before trusting it); (b) tested on **one** temporal train/val/test split only — not yet confirmed robust across a different split.

**Supabase status**: down/degraded since 2026-07-09 (full resource exhaustion incident, recovering). `live-inference.yml` and `watchlist-pulse.yml` are correctly paused pending recovery — **do not re-enable them**, that's an explicit, deliberate, unrelated-to-this-audit decision.

---

## STEP 3 — Audit targets, prioritized

Ranked by how directly the surface area touches real decision-making logic (even paper-money) or data integrity that everything downstream depends on. This is a judgment call, not an exhaustive equal-weight list — use it to allocate the 2-day window, not as a checklist to clear top-to-bottom regardless of what's found.

### Priority 1 — decidePot()'s decision logic against first principles

The refactor (STEP 1 item 5) proved the new code matches the *old* code exactly, 1,075,457/1,075,457. It never asked whether the old code was *right*. This is the single highest-value target: `PotService.ts`'s `decidePot()`, `meetsEntryConditions()`, `stopLossPct()`, `ambitionTier()`, `patienceHorizon()`, `shortScore()`, the PHASE 2 replacement logic (the "beat threshold" comparison at the position-replacement site), and the position-sizing formula (`portfolioValue * (1/Focus)`, uncapped, compounding). Ask: does this logic actually implement what a reasonable trading strategy should do, independent of "does it match what was already there"? Same treatment `riskScore`/`riskReward` already got (decile diagnostic vs. realized outcomes) but applied to the entry/exit/sizing rules themselves, not just the risk-labeling formulas layered on top of them.

### Priority 2 — systematic sweep for the same bug class (combine-signals / divide / Math.abs-with-sign)

Two real, confirmed bugs this session (riskScore, riskReward) shared an exact shape: a formula that combines multiple model outputs, and/or divides by one of them, and/or applies `Math.abs()` to something with a meaningful, non-symmetric sign convention — and neither had ever been decile-tested against realized outcomes before this session found them. That's now a **confirmed bug class**, not a one-off. Candidates surfaced by a `Math.abs(` / composite-score grep that were never touched this session and deserve the same test:
- **`QuantamentalGatingEngine.ts`** (599 lines, `runGatingEngine`/`evaluateExecutionGate`/`evaluateMacroOverride`/`detectSignalDivergence`/`normaliseProbabilities`) — a whole second gating/scoring layer, never opened this session. Important nuance: confirmed via grep that this is wired into `HistoricalEngine.ts` (via `GatingAdapter.ts`), **not** the live `LiveInferenceService.ts`/`server.ts` path — so a bug here would corrupt training-label/backfill data quality, not directly cause a live bad trade. Still high-value given everything downstream depends on training data being correct, but characterize it accurately as training-pipeline risk, not live-decision risk.
- **`src/utils/physics.ts`** — `calculatePriceZScore`, `calculateVolumeRatio`, `calculateExcessReturn`, `calculateATRMoveNormalization`. These feed Model A's core 11-feature set directly (z_score, excess_return, volume_ratio are literal Model A inputs) and were only ever referenced by name this session, never independently checked for correctness.
- **`CorrelationEngine.ts`**, **`RegimeDetectionService.ts`**, **`HistoricalSimilarityService.ts`**, **`src/SignalNormalizer.ts`** — all matched the composite-score/weighted-sum grep, none opened this session.
- Broader instruction for the audit: grep for `Math.abs(` and any `score = ... + ... + ...` pattern project-wide, then triage by whether the combined signals have a meaningful sign convention (the riskScore bug's root cause) — don't assume the two found bugs are the only two.

### Priority 3 — `src/LiveScanner.ts` (the actual anomaly-detection entry point)

344 lines, never opened this session. This is upstream of everything — Model A/B/C/D/E and the whole POTS pipeline only ever see what this scanner flags as an anomaly in the first place. A bug here (missed anomalies, false positives, a threshold that doesn't match what the models were trained to expect) would be silently invisible to every downstream diagnostic this session ran, since all of those diagnostics started from "given an anomaly was detected."

### Priority 4 — Data pipeline integrity for services never touched this session

Of ~30 `*Service.ts` files, this session touched `LiveInferenceService.ts`, `PotService.ts`, `SignalValidationService.ts`, and read (but didn't audit for correctness) `EdgarService.ts`, `EnrichBackfillService.ts`, `FMPService.ts`. **Never touched at all**: `AlphaVantageService.ts`, `BatchScannerService.ts`, `CSVExportService.ts`, `CongressionalTradingService.ts`, `EODHDService.ts`, `EarningsCalendarService.ts`, `EarningsSentimentService.ts`, `ExportGraphDatasetService.ts`, `FDAService.ts`, `FREDService.ts`, `FinnhubService.ts`, `FinraShortInterestService.ts`, `GDELTService.ts`, `GoogleTrendsService.ts`, `NewsAPIService.ts`, `PeerDataService.ts`, `PolygonService.ts`, `RedditSentimentService.ts`, `ShortDataService.ts`, `StockProfileService.ts`, `StockTwitsService.ts`, `WikipediaService.ts`, `YouTubeService.ts`. Most of these are external-API data fetchers feeding the feature pipeline — lower urgency individually than Priority 1-3, but worth a **breadth-first correctness pass** (do they handle rate limits/nulls/API-shape-changes safely? do any silently return wrong-but-plausible data rather than erroring, which is the worst failure mode for a training feature?) rather than a deep line-by-line read of all 20+. `BatchScannerService.ts` specifically is worth a closer look given the name implies it scans the whole ~1,253-symbol universe — a cost/rate-limit/correctness issue here has the widest blast radius of this group.

### Priority 5 — Credentials / write-access to external systems

Lower priority given a quick check this session found no hardcoded secrets (`src/db/supabaseClient.ts` uses `SUPABASE_URL`/`SUPABASE_ANON_KEY` from env only, throws if missing — clean, minimal). Worth a confirm-not-deep-dive: `NTFY_TOPIC` (push notification write access to ntfy.sh), `GEMINI_API_KEY` (narrative generation, cost-bearing), `FMP_API_KEY`/`EODHD_API_KEY` (paid data vendors, cost-bearing), and the GitHub Actions workflow files' secrets usage. Confirm nothing writes with more privilege than it needs, and that failure modes (missing/expired key) fail loud, not silently-wrong.

### Priority 6 — TODO/FIXME/HACK triage

Only **one** file matched project-wide (`src/scripts/backtestPots.ts`, 3 TODOs) — already explained and low-priority: these describe a pre-refactor state (`historical_inference_results` not yet populated when written) and the file itself is explicitly being retired in favor of the synthetic-pot-sweep approach (per commit `4577070`'s message: "backtestPots.ts has its own non-imported copies of both stopLossPct and the ambition/5 gate — deliberately left stale, that script is being retired"). Don't spend audit time here beyond confirming it's genuinely dead/unreferenced by anything live.

---

## STEP 4 — Constraints for the audit itself

- **This is a paper-trading system.** No real capital at risk currently; live/automated trading is explicitly parked. Bugs matter for research/decision-quality integrity, not as live financial incidents.
- **Read-only recon strongly preferred over changes.** If something warrants a fix, follow this project's established pattern exactly: **recon → propose → explicit sign-off from Lewis → implement → verify → commit → separately-approved push.** Do not implement and commit in the same pass without an explicit go-ahead in between, even for something that looks obviously correct — this project has a consistent, deliberate discipline of pausing for sign-off before any commit that changes live-consumed values, and pausing again before any push.
- **Mandatory invariants, already established this session — do not violate:**
  - `npx tsc --noEmit` must be clean immediately before any commit that touches `.ts` files. Non-negotiable gate, checked every time this session, including a same-day re-check before a same-day push.
  - **Never restart the server mid-backfill** or mid-any-long-running-process. Check for running node/python processes before assuming it's safe to do so.
  - **Never force-push.** Regular pushes only, and only after explicit go-ahead — confirm local HEAD matches origin exactly after pushing (fetch + compare hashes), not just "push succeeded" in the terminal output.
  - **WAL-mode SQLite backups need all three files together**: `market_cache.db` + `market_cache.db-wal` + `market_cache.db-shm`. Backing up or copying just the `.db` file loses uncommitted WAL data. `.gitignore` already excludes all three (`*.db`, `*.db-shm`, `*.db-wal`).
  - **`db.ts` import side-effect warning**: importing `db.ts` opens `market_cache.db` at module-load time (`db.ts:10`), and on ANY open failure — including transient lock contention from another process holding the file — it **deletes and recreates the database file** (`db.ts:12-26`, the self-healing fallback). This is a genuinely dangerous side effect if two processes ever touch the live DB concurrently: importing `db.ts` while another process has the file locked can silently wipe it. Be aware of this before running any script that imports `db.ts` while `server.ts` or a scheduled workflow might be running.
  - **Supabase is down/recovering.** Any live-Supabase-dependent verification is blocked; use local SQLite (`market_cache.db`, `historical_inference_results` table) for offline verification, matching this session's established pattern throughout.
  - **`live-inference.yml` and `watchlist-pulse.yml` stay disabled** — this is deliberate and unrelated to whatever the audit finds; do not re-enable as a side effect of any fix.

---

*This document is a working handoff for the next audit session — not committed to git, not necessarily permanent. Safe to delete or supersede once the audit is underway.*
