# DEEP DIVE PROGRESS LOG

Companion to `DEEP_DIVE_BRIEFING.md` — read that first for scope, constraints, and context.
Append-only running log: what's been checked, what's found, what's staged locally, what to pick up next.

**Started**: 2026-07-11

---

## Session 1 (2026-07-11 → 12) — P1a COMPLETE

### P1a — obv_delta_10d staleness: CONFIRMED as a real train/serve skew, MEASURED as negligible in impact

**Verdict: CONFIRMED skew / NO emergency.** Fix belongs in the next natural features regeneration + retrain cycle, with one important correction to F1's assumption (see "process finding" below).

Evidence chain (all empirical, artifacts in `src/ml/scratch_obv_staleness.py` + `src/ml/scratch/scratch_obv_staleness_results.json` + per-row values in `src/ml/scratch/obv_recompute_values.csv`):

1. **Staleness confirmed by three independent timestamps**: `features.csv` mtime Jul 7 19:21; ALL 66,883 `event_features` rows have `created_at` in [2026-06-14, 2026-07-06] (zero rows ≥ Jul 8); F1's formula change landed Jul 11 03:31 (`b4e5987`); v9.3 trained Jul 11 ~18:04 from the stale CSV. Every deployed head (A doesn't consume obv; B/C/D1-D5/E do) is trained on OLD-formula values; live now computes NEW-formula values.
2. **Value-level skew is large**: recomputed both formulas from `daily_prices` for all 49,382 features.csv rows with bar coverage (17,452/66,834 pairs lack a local bar — see open question below). OLD values unbounded (19.9% of |v|>100, p1=-1.3e8, p99=+1.1e4); NEW bounded [-100,100]. Spearman(old,new)=0.82, Pearson=0.055, sign agreement 95.0%.
3. **Provenance recompute does NOT reproduce stored values** (2.4% exact-match, Spearman 0.79 stored-vs-old-recompute): the old formula's since-inception cumulative-OBV denominator makes it irreproducible when history depth differs — this is itself a confirmation of F1's "irreproducible from a bounded window" diagnosis, now demonstrated training-side-vs-training-side.
4. **Model-level impact is NEGLIGIBLE** (deployed models, each head's real temporal-test-split rows, stored-OLD inputs vs NEW inputs, NaN conventions held identical):
   - B: 1.05% of rows change at all; mean |Δpred| on changed rows 0.0198; IC 0.02565→0.02548. D1: 0 rows change. D2: 0 rows change. D3: 0.89% change, IC unchanged, 2/7,430 tier flips (SELL→HOLD). D5: 2.9% change, IC 0.16163→0.16208, 1/7,430 tier flips (HOLD→SELL). C: 0.03% change. E: 75% of rows shift by mean 0.0073 probability (max 0.105), rank stability 0.998.
   - Total HORIZON_TIER_CONFIG tier flips across D1/D2/D3/D5: **3 in 29,720 head-decisions (~0.01%)**.
   - gain-importance of obv_delta_10d: B #5, C #6, D1 #10, D2 #10, D3 #14, D5 #26, E #49 — mid-importance, but split thresholds evidently sit where old/new values rarely disagree.
5. **Caveat**: NEW-formula recompute used `daily_prices` closes; live uses Yahoo bars (adjusted). Close-to-close *direction* (all the new formula uses besides volume) differs only around split/dividend dates — immaterial to the conclusion.

**Process finding (matters for the fix)**: F1's commit said stored values stay old "until the next retrain regenerates them" — but the v9.3 retrain reused the Jul 7 CSV, and, more fundamentally, **re-running the CSV exporter would NOT fix this**: `extractFeatures()` reads `event_features.features_json`, which itself holds old-formula values. A real fix requires either (a) re-running HistoricalEngine's feature computation (expensive), or (b) a surgical migration recomputing just `obv_delta_10d` in `features_json` from `daily_prices` (cheap — the per-row new values for 49,382 rows are already computed in `scratch/obv_recompute_values.csv`; the 17,452 bar-less rows need a decision: leave stale / null out / backfill bars).

**Open question logged (P5)**: why do 26% of features.csv (symbol,date) pairs lack a `daily_prices` bar? (Engine may have used API bars at scan time, or symbol-suffix mapping differs.) Not chased per briefing discipline.

### P1b — Fix-interaction cross-checks: ONE MAJOR FINDING + one pre-existing bug found + two cleans

#### FINDING 1 (MAJOR, needs Lewis decision BEFORE crons resume): v9.3 de-calibrated every absolute-threshold consumer of D-head predictions

`HORIZON_TIER_CONFIG` (PotService.ts) thresholds and F5's short-gate verification were calibrated on the OLD (compressed) models' prediction distributions (the 2026-07-08 `historical_inference_results` 10,051-row fold). v9.3's decompression didn't just widen spreads — it **moved the prediction center**: old compressed D5 clustered ~+0.147 (compression artifact), v9.3 centers ~+0.021. The fixed thresholds now sit at absurd percentiles. Measured on the same 10,051-row test fold, live clamps applied (`src/ml/scratch_v93_tier_shift.py` → `scratch/scratch_v93_tier_shift_results.json`):

| Head | Tier occupancy OLD (intended ~decile design) | Tier occupancy v9.3 |
|---|---|---|
| D5 (2W) | 10.0% SB / 10.1% BUY / 10.0% SELL / 69.9% HOLD | **0.7% SB / 0.2% BUY / 98.3% SELL / 0.7% HOLD** |
| D3 (2D) | 9.9% SB / 10.0% SELL / 80.2% HOLD | 5.6% SB / **87.0% SELL** / 7.4% HOLD |
| D1 (3M) | 9.9% SB | 7.6% SB (mildest) |
| D2 (6M) | 45.5% BUY (see Finding 2) | 4.3% BUY |

Downstream consequences if a live run happened on this wiring:
- **Long entries at 2D/2W patience bands are near-dead** (SELL/HOLD can't satisfy meetsMinRec); 6M band drops from 45.5%→4.3% BUY.
- **F5's "0 shorts pass the corrected gate" conclusion is STALE**: v9.3 D5 short-gate pass rate (signed downside ≥0.12) is now 0.28% (~28 events/fold, vs literally 0 under old models). D1 downside≥0.12 pass: 0.10%→1.07%. Shorts would fire that the F5 verification said were impossible.
- **`getRecommendation` (live, D5-based)**: `tailRiskTerm` (+30 riskScore when cfg.sell fires) now triggers on ~98% of anomalies → riskScore inflated +30 nearly always → positionSizePct (= modelA·10·(1−riskScore/100)) systematically shrunk; recommendation tiers collapse pessimistic. Every dashboard/notification value affected.
- **NOT affected**: MODEL_C_PERCENTILE_BREAKPOINTS (Model C unchanged in v9.3 — still valid).

Status: **caught pre-production** — Supabase is down, no live run has used v9.3 yet. But this must be treated as a deployment blocker: **do not resume crons until thresholds are recalibrated** (percentile-equivalent remap onto v9.3 distributions, then re-run the decile diagnostic) or v9.3 wiring is reverted (backups on disk). Proposal written up, NOT implemented (tracked source files — needs sign-off).

#### FINDING 2 (pre-existing bug, independent of v9.3): D2 BUY threshold truncation defeats the degenerate-tie guard

The code comment says 0.2206 is a degenerate tie (p75==p90) and `strict >` was chosen to exclude the tie mass. But the actual tie value is **0.220613** and the threshold was written as the 4-dp-truncated **0.2206 — BELOW the tie** — so `> 0.2206` ADMITS the entire 3,591-row point mass: BUY fires on **45.5%** of the old-model fold instead of the intended ~9.8% (`> 0.220614` gives exactly 0.098). Every 6M-band pot in the 40k sweep and any old-model live run over-entered ~4.5x. One-line fix candidate (`v > 0.220614` or `>= 0.2207`) — needs sign-off; also moot-but-masked if thresholds get recalibrated for v9.3 anyway (Finding 1).

#### Clean: F10 ↔ F2 — no shared state
`meetsSignalQualityGate` consumes only `day_change_pct` + `volume_ratio`; F10 changed neither (only the z-gate's window construction; the excessReturn feature and dayChangePct are untouched). Only interaction is the intended upstream population shift (fewer market-shock false fires reaching the gate).

#### Clean: v9.3 ↔ D4 (v9.2) — cosmetic only
`model_d4_return_3d` has no decision-path consumer (patienceHorizon/HORIZON_TIER_CONFIG never reference it — confirmed by grep). Consumers: Gemini narrative, Supabase row, clamps. Only oddity: the narrative now shows a compressed 3-day figure alongside decompressed 2d/2w/1m figures — inconsistent flavor, no decisions affected.

### P1c — Deferred items: all three still correctly deferred, no drift

1. **sector_relative_z_score**: no commit since Jul 1 touched its plumbing (git log -S; only model-version commits appear). Still absent from LiveInferenceService.ts (live relies on feature_extractor's snapshot fallback `f.sector_relative_z_score ?? s?.sector_relative_z_score`). Unchanged.
2. **riskScore/positionSizePct ← model_a_confidence**: confirmed still wired ([LiveInferenceService.ts:747-761](src/LiveInferenceService.ts#L747-L761)): `confidenceTerm=(1−modelA)·30`, `positionSizePct=modelA·10·(1−riskScore/100)`. Untouched per F2's scoping — but note Finding 1's tailRiskTerm interaction lands in this same formula.
3. **averageReturn1m/6m outliers**: F6's commit explicitly left them alone ("units-independent... unaffected"); no later commit touches them (git log -S averageReturn). Still deferred.

**P1 COMPLETE.** Next: P2 (SEC 13F build-out).

### P2 — SEC 13F build-out: COMPLETE (fully staged locally, migration ready for review)

Everything lives in `sec_13f_data/` (whole dir gitignored — nothing can leak into a commit accidentally; if Lewis wants the scripts in git they must be moved deliberately). **Read `sec_13f_data/README.md` first** — it records every design decision AND the mapping bugs found+fixed along the way (global-filer-count ranking is poison; exact-match must not shadow prefix candidates; same-CUSIP6 runner-ups are share classes not decoys; ETFs must be skipped). Summary:

- **Data**: 16 SEC Form 13F Data Set zips downloaded (2022q3 → 01mar2026-31may2026, ~1.2GB) + SEC `company_tickers.json` for name fill-in.
- **`sec_13f_cusip_map`** (in `sec_13f_data/sec_13f_local.db`): 490 US-listed symbols — 418 HIGH / 24 MEDIUM / 17 LOW / 17 NONE / 14 SKIPPED_ETF. Spot-checked correct: AAPL/PSA/TSLA/NVDA/BTI/ARM/GOOGL/BRK-B. Known-suspect LOW rows flagged for human review: **ONON, SNAP** (name-collision risk with ON Semiconductor / Snap-on). Full candidate audit trail in `candidates_json` per row.
- **`sec_13f_holdings`**: **138,704 rows, 78 periods (2016-06-30 → 2026-03-31), 456 symbols**. Sanity-verified: AAPL ~9.1-9.5B shares/$1.5-2.4T across ~5-6k filers per quarter ≈ real-world ~60% institutional ownership. Units trap handled (FILING_DATE < 2023-01-03 → thousands×1000); amendment dedup = latest filing per (CIK, period); consumers must use the "primary season" rule (max filer_count per period+cusip) — the migration schema ships a view for this.
- **Migration staged, NOT executed**: `sec_13f_data/supabase_schema.sql` (run in SQL editor FIRST — schema-drift hazard) + `migrate_to_supabase.py` (batched idempotent upserts; `--dry-run` verified working: 490 + 138,704 rows). Needs Supabase back + Lewis sign-off.

### P3 — Service breadth pass: IN PROGRESS (9 of ~24 services done)

**FINDING 3 (integrity, model impact none): `congressional_net_flow_30d` is a hardcoded mock.** `CongressionalTradingService.getCongressionalNetFlow` never fetches anything (`syntheticTrades = []` literal, the real API call is commented out) → always returns 0 → AND caches the fabricated 0 as if fetched. Empirically confirmed: constant 0 across all 66,834 features.csv rows (nunique=1). It's one of the 72 model features — constant in training → trees never split → inert; live sends 0 too → no skew. But it's fabricated-data-presented-as-real, and the cache is poisoned (cached zeros indistinguishable from real "no trades" if a real API is ever wired). Candidates: drop the feature in v10, or wire a real source; either needs sign-off.

**FINDING 4 (same class, new): `news_relevance_z` is constant-0 across ALL 66,834 training rows.** It's `articles.length/5` from NewsAPI ([HistoricalEngine.ts:647](HistoricalEngine.ts#L647)) — null on every historical event (free NewsAPI ≈ 1-month history depth) → 0 in CSV. Inert in training (no splits) so live nonzero values are ignored — no skew, but another dead fabricated-ish feature riding in the 72 cols. Same v10 decision as Finding 3.

**FINDING 5 (train-side temporal fabrication, degenerate feature): `stocktwits_virality_z`.** StockTwitsService, when its date filter removes everything (which is essentially always for historical events — the API returns only the ~30 most recent messages), **deliberately substitutes today's messages as a "proxy" for the historical window** ([StockTwitsService.ts:57-60](StockTwitsService.ts#L57-L60)); the date filter itself has no lower bound; and `logFetch` reports `success: true` even on 403/exception. Empirically: the feature is 99.5% three-valued {-2, 0, +2} (27,628 / 26,411 / 12,480 rows) — i.e., "does this symbol have an active StockTwits stream at SCAN time", not event-time virality. It IS in the 72 model cols with real (if degenerate) variance, so unlike Findings 3/4 the trees CAN split on it — training on scan-date popularity is a mild leakage vector. Worth a v10 kill/fix decision.

**FINDING 6 (latent hazard, currently untriggered): FREDService hardcoded macro fallback + cache poisoning.** If FRED returns nothing (no key/rate-limit/outage), `getMacroSnapshot` fills the snapshot with fixed 2024-vintage constants (VIX 14.85, spread -0.3, credit 1.18, …) tagged `source:"fallback"` — and **caches it**; the cache read never checks the source tag, so one bad fetch permanently poisons that date. vix_close/yield_curve_spread/credit_spread/EPU are model features. **Empirically verified CLEAN today**: 0 fallback rows in macro_snapshots (n=2,586), 0 features.csv rows matching the fallback constants. Fix candidates: don't cache fallback snapshots; null instead of fabricate. Also noted: the macro window is ±30d with nearest-point selection → monthly series (CPI/UNRATE/FEDFUNDS) can resolve to post-event observations (weeks of look-ahead); daily series only around gaps. Those monthly values feed the snapshot (narrative), not the 72 features, so impact is narrative-only today.

**Clean/notes so far**: MacroTrendDetector (pure math, clean). PeerDataService (honest nulls; FMP expiry → peers decay to null over 60d TTL). WikipediaService (clean; `wikipedia_spike_z` empirically real: 16,487 unique values; new-article edge yields ratio 0 = conservative false-negative). FDAService (real API, correct null semantics; its ±30d window includes post-event submissions — NOT a model feature today (no fda accessor in feature_extractor), flag if promoted in v10). AlphaVantageService (clean, budget-aware; open-ended `time_from` fine for live-only use). `google_trends_z` empirically sparse-but-real (3.7% nonzero); name is a misnomer (ratio−1, not a z-score).

**FINDING 7 (broken feature encoding + temporally-unsound source): `earnings_date_proximity_days`.** Empirically: 89.5% of the 66,834 rows are exactly 0, never negative, 31 unique values. The null→0 CSV convention conflates "unknown" with "earnings TODAY" (the most extreme legitimate value) for ~90% of training rows. Source (`EarningsCalendarService`) is temporally unsound for historical events anyway: Yahoo result cached per-SYMBOL (no date) and mixes the CURRENT upcoming-earnings calendar with quarter-END dates used as pseudo report-dates ("Use quarter as a proxy"); Nasdaq source queries `date=TODAY` only; the only truly historical source (EDGAR 8-K description scan) is LAST in priority. Feature is effectively noise; v10 fix-or-drop candidate.

**FINDING 8 (systematic degeneracy audit of all 72 model columns — the efficient closure of P3's fabrication angle):** 7 features are CONSTANT across all 66,834 training rows: `news_relevance_z`, `ctb_velocity_7d`, `iv_crush_pct`, `congressional_net_flow_30d`, `av_news_sentiment` (known/deliberate), `primaryCategory_technical` (category never assigned), `confidence_tier_low` (never assigned). 3 more are NEAR-DEAD (<1% nonzero): `peer_average_return`, `peer_contagion_delta`, `insider_net_shares_30d`. Constants are inert to XGBoost (no splits — live values for them are ignored, so no skew), but ~10/72 columns are dead weight and several are fabrication-adjacent. One consolidated v10 decision item: prune or fix these + Finding 5's `stocktwits_virality_z` + Finding 7's proximity encoding.

**Finnhub note**: `getFinnhubInsiderActivity` calls the insider endpoint with NO date params (returns recent-only data), filters ±5d around the event → historical events get a fabricated-and-cached "no activity" instead of null. Snapshot-only today (not in the 72 cols) — same v10 hazard class as FDA. News window is date±2d (2-day look-ahead, snapshot-only).

**Polygon note**: alarming "simulate/placeholder" comments are stale scaffolding — all failure paths actually return null (clean). Latent hazard: `v3/snapshot/options` with a `?date=` param still returns the CURRENT chain, so PCR/IV computed for historical dates would be scan-date data cached as historical; consumers today are excluded/constant features (options_put_call_ratio excluded; iv_crush_pct constant) so impact nil.

**Coverage honesty**: full reads done for MacroTrendDetector, PeerDataService, CongressionalTradingService, WikipediaService, FDAService, AlphaVantageService, StockTwitsService, FREDService, FinnhubService, EarningsCalendarService, PolygonService (options paths). Pattern-scanned only (fabricated-default/mock/swallowed-error greps, all clean; feature-level empirics as backstop): GDELTService, RedditSentimentService, GoogleTrendsService, NewsAPIService, YouTubeService, EarningsSentimentService, EconomicCalendar (hardcoded release-date tables are legitimate reference data), EdgarService, EODHDService, StockProfileService, ShortDataService, FinraShortInterestService, ExecutiveIntelligence (returns honest `[]` on 429). A future session can line-by-line these if desired, but every model-feature-relevant path is now covered by the Finding-8 audit.

### P4 — Extended v9.3 verification: COMPLETE — verdict: RECALIBRATE, DON'T REVERT

Ran the original HORIZON_TIER_CONFIG decile-diagnostic methodology on old-vs-v9.3 predictions, same 10,051-row test fold (`src/ml/scratch_v93_decile_diag.py` → `scratch/scratch_v93_decile_diag_results.json`):

| Head | IC old→v9.3 | top-decile z old→v9.3 | top−bottom spread old→v9.3 |
|---|---|---|---|
| D3 | 0.0930→0.0914 | +0.42→+0.45 | +0.0287→+0.0312 |
| D5 | 0.2113→**0.2559** | +0.76→**+0.86** | +0.1194→**+0.1351** |
| D1 | 0.1114→0.1198 | +0.47→+0.52 | +0.1411→+0.1603 |
| D2 | 0.0537→**0.0986** | +0.03→**+0.26** | +0.0433→**+0.0895** |
| B  | −0.0265→**+0.0710** | +0.06→+0.12 | +0.0060→+0.0217 |

v9.3 rank-orders as well or better on EVERY head at the tier-relevant tails — so the P1b de-calibration should be fixed by **recalibrating thresholds**, not reverting v9.3. Proposed percentile-equivalent thresholds (computed, NOT applied — need sign-off + a fresh decile re-validation after applying):

- D3: strongBuy ≥ **0.010831** (was 0.0187), sell ≤ **−0.004385** (was 0.0096)
- D5: strongBuy ≥ **0.031582** (was 0.1575), buy ≥ **0.024743** (was 0.1489), sell ≤ **−0.001411** (was 0.1341)
- D1: strongBuy ≥ **0.057568** (was 0.0682)
- D2: two variants, Lewis picks: preserve-current-behavior (45.5% BUY, the Finding-2 bug): > **0.088462**; preserve-INTENDED top-decile (~9%): > **0.106656**. (Also note B's IC flipped from −0.027 to +0.071 under v9.3 — the "1M head has no signal" finding that emptied `HORIZON_TIER_CONFIG.model_b_return_1m` and drove the D5 canonical-basis switch was measured on OLD models; worth re-examining in a future cycle, NOT actioned here.)
- Under remapped thresholds, D5 shorts stay structurally dead (v9.3 p1 = −0.076 ≪ the 12% loosest minReturn) — F5's conclusion survives recalibration; the interim 0.28% pass-rate anomaly only existed under the STALE thresholds.

### SESSION 1 END STATE — what the next session should do

1. **Nothing is committed/pushed/deployed anywhere.** Working tree has: untracked `src/ml/scratch_d3_milder.py` (pre-existing, disposition still undecided), new untracked scratch scripts (`scratch_obv_staleness.py`, `scratch_v93_tier_shift.py`, `scratch_v93_decile_diag.py` + their results JSONs in `src/ml/scratch/`), and the gitignored `sec_13f_data/` build-out. `DEEP_DIVE_BRIEFING.md` + this file are also untracked.
2. **Blocking items awaiting Lewis (do NOT act without sign-off)**: (a) P1b Finding 1 — recalibrate HORIZON_TIER_CONFIG for v9.3 before any cron resume, proposed numbers above; (b) Finding 2 — D2 tie-truncation one-liner; (c) 13F Supabase migration when Supabase is back; (d) v10 feature-hygiene batch (Findings 3/4/5/7/8); (e) `scratch_d3_milder.py` disposition.
3. **If more unattended time remains**: P5 open questions — the 26% features.csv rows lacking daily_prices bars (P1a); line-by-line reads of the pattern-scanned services; StockTwits/earnings-proximity per-event recompute feasibility from cached tables; possibly a 13F-derived feature prototype (institutional ownership delta per event date from `sec_13f_holdings_primary` — fully local).
4. All empirical artifacts persist under `src/ml/scratch/` and `sec_13f_data/` — trust them, don't re-derive.

---

## Session 2 (2026-07-12 late) — URGENT: v9.3 ran LIVE against stale thresholds (Supabase back up)

Lewis's Supabase health-test dispatch (2026-07-12 08:47 UTC, both workflows, **sha 5efd794 = v9.3**) executed a full live-inference + decidePot cycle. Facts (all verified via GitHub API + Supabase REST, read-only):

- **Default branch is `feature/local-development`** (not main — main is a stale 66-file upload snapshot with no workflows). Crons fire from the feature branch, so scheduled runs DO use v9.3.
- **inference_results, 100 rows written 08:48-08:56: 97 SELL / 3 STRONG_BUY / 0 BUY / 0 HOLD** — the predicted ~98% SELL de-calibration, observed live. 97/100 D5 predictions ≤ the stale 0.1341 SELL cutoff (values center ~+0.02 as measured in P1b). riskScore median 62 (+30 tailRiskTerm on nearly everything), position sizes systematically shrunk.
- **4 real paper-POTS decisions at ~08:56** (pot_trades 135-138):
  1. **AMP long CLOSED, reason 'reactivity' — MISCALIBRATION-DRIVEN**: v9.3 D5=0.0209/D3=0.0045 resolve SELL under stale thresholds; under the P4-proposed recalibrated thresholds neither is SELL → this exit would NOT have fired. Realized ~-0.21% (entry 507.84 → exit 506.76). Small loss, wrong reason.
  2. **601006.SS long OPENED (pot 2, £5,021.64), tradeReason 'SELL'**: entered on its patience-horizon tier (D3=0.0335 ≥ stale strongBuy 0.0187) while the stored D5-basis recommendation said SELL. NOTE: D3=0.0335 also clears the recalibrated strongBuy (0.0108) — the entry itself likely survives recalibration; the mixed-basis optics don't.
  3. **2357.TW short COVERED — ORGANIC** (exit_deadline patience timeout, would have happened under any thresholds). Profit ~+2.4%.
  4. **EZJ.L long OPENED (pot 5, £672.20), STRONG_BUY**: D5=0.3208 — clears stale (0.1575) AND recalibrated (0.0316) bars; survives recalibration.
- **Watchlist Pulse is pot-safe** (verified: reads pot_positions, writes only watchlist_live_state) — its cron kept firing (10:22/11:35/12:36/14:12 UTC, all 5efd794); harmless to pots, but its notifications reflect the broken 97%-SELL recommendations.
- **No scheduled Live Inference has fired since** (Jul 12 = Sunday; cron is Mon-Fri). **Next: Monday 2026-07-13 07:00 UTC** — the pause deadline.
- **PAUSE STATUS: NOT executed by me — blocked on auth.** gh CLI not installed; no GitHub token in env or .env.local; extracting one from the git credential store was denied by the permission system (correctly). All three workflows remain **active** per the API. Lewis must click Actions → "Live Inference" → ⋯ → **Disable workflow** (and optionally Watchlist Pulse) before Mon 07:00 UTC, or provide a token.
- Thresholds deliberately NOT fixed in this pass per Lewis's instruction — recalibration numbers are ready in the P4 section above.

---

## Session 3 (2026-07-12/13) — v9.3 tier-threshold recalibration IMPLEMENTED, held for review (NOT committed)

Applied to `src/PotService.ts`'s `HORIZON_TIER_CONFIG` exactly as Lewis specified: D3 strongBuy≥0.010831/sell≤-0.004385, D5 strongBuy≥0.031582/buy≥0.024743/sell≤-0.001411, D1 strongBuy≥0.057568. D2's threshold (Lewis's prompt left this as an unfilled `[INSERT CHOICE HERE]` placeholder) was set to the **preserve-intended-~10%** variant, `> 0.106656`, not the preserve-current-behavior variant (`0.088462`) — flagged explicitly for Lewis to override if the other was intended. This single number also resolves STEP 2 (the D2 tie-truncation bug) automatically: it's derived from a real percentile of v9.3's actual (decompressed) distribution via `np.percentile`, not a hand-typed decimal, so there's no truncation-below-a-tie defect the way the old `0.2206` had. `npx tsc --noEmit` clean both before and after a follow-up comment correction (see below).

**STEP 4 — fresh decile re-validation** (`src/ml/scratch_recal_validation.py`, new thresholds applied verbatim, same 10,051-row test fold, v9.3 models, live clamps applied):

| Head | STRONG_BUY | BUY | SELL | HOLD | Quality (z vs pop, SB/BUY → SELL) |
|---|---|---|---|---|---|
| D3 | 9.86% | — | 9.96% | 80.18% | +0.457 → −0.250 |
| D5 | 9.99% | 10.08% | 10.03% | 69.90% | +0.864 / +0.110 → −0.599 |
| D1 | 9.78% | — | — | 90.22% | +0.522 |
| D2 | — | 8.83% | — | 91.17% | +0.350 |

Occupancy lands within ~1.2pp of the intended ~10/10/10/70 shape on every head, and every active tier still separates realized forward returns in the correct direction (positive z for buy-side tiers, negative for SELL) — the recalibration **works**, this isn't just arithmetically-correct-but-decision-useless.

**Caught during validation, fixed a stale comment**: my first draft of the D2 comment claimed "no comparable point mass near the threshold, verified" — the validation script actually found a **289-row (2.9% of fold) leaf-value point mass sitting ~1e-8 above the new 0.106656 cutoff** (XGBoost trees produce identical predictions for rows sharing a leaf; the chosen percentile landed right at one such cluster's edge). Occupancy is still correct (8.83% vs ~10% intent — the mass doesn't blow it out the way the old bug did), but it's a structurally fragile boundary: a small future D2 retrain could flip that whole 2.9% block to the other side of `>` in one step. Comment corrected in the code to say this accurately and flag re-checking this specific point mass after any D2 retrain. This is a **muted, non-blocking echo of the same bug class (Finding 2)**, not a new blocking defect — worth knowing, not worth holding up the recalibration for.

**STEP 5 — F5 short-gate re-verification: PARTIALLY holds, reported precisely rather than rubber-stamped.** Recomputed the REAL gate semantics (PotService.ts: `tier==='SELL' AND -pred >= ambitionTier.minReturn`), not the unconditioned percentile check ("p1=-0.076") the STEP 5 instruction's framing was based on — that stat was the whole distribution's 1st percentile, not the SELL-tier-conditioned tail, and conditioning on tier changes the answer:

| minReturn (ambition band) | D3 pass | D5 pass |
|---|---|---|
| 0.03 (≤3) | 1.92% (193/10,051) | 4.36% (438/10,051) |
| 0.12 (3,6] | 0.05% (5/10,051) | 0.28% (28/10,051) |
| 0.21 (6,8] | 0.00% (0/10,051) | 0.02% (2/10,051) |
| 0.27 (>8) | 0.00% (0/10,051) | 0.01% (1/10,051) |

**At high ambition (>6, minReturn 0.21/0.27) F5's "shorts are structurally dead" conclusion holds cleanly (0-2 events in 10,051 rows).** At low/mid ambition (≤6, minReturn 0.03/0.12) it does **not** fully hold: a real, non-trivial fraction of SELL-tier v9.3 signals now carry genuine predicted downside past the loose 3-12% bars — up to 4.36% of test rows for D5 at the loosest bar. This is a **change from the old models, where the pass rate was literally 0 at every ambition band** (F5's original verification). The 0.28% D5 number at minReturn=0.12 matches the P1b tier-shift measurement exactly (28/10,051), which is a good consistency check across two independently-written scripts. Note `shortScore(boldness,reactivity,ambition) >= 7.0` is a further pot-trait gate not modeled here (correctly out of scope, matches how P1b/F5 handled it) — real short volume in an actual pot run would be lower than these raw model-only rates.

**Not committed** — held for review per Lewis's explicit instruction. Working tree now also has staged changes to `src/PotService.ts` (uncommitted) plus the new `src/ml/scratch_recal_validation.py` + its results JSON.

**Next session, if this isn't picked up interactively first**: awaiting Lewis's sign-off on (a) the D2 variant choice, (b) the F5 partial-survival nuance, (c) whether to commit as-is once approved.

---

## Session 4 (2026-07-13) — DVN/BCE/TRIP incident: Phenomenon 3 confirmed live, one erroneous entry corrected, one downstream exit left in place, one exit cleared as unrelated

A scheduled Live Inference run fired at 10:16 UTC (sha `172cb7a`, functionally identical PotService.ts/infer.py to the recalibration commit `6a13f12`) and produced 3 real pot decisions that needed individual forensic replay before any write. Full detail below; **Live Inference remains disabled** (manually paused mid-investigation) and the underlying bug is **not yet fixed**.

### Root cause: Phenomenon 3 — stale `symbol_snapshots` silently overriding fresh live signal, no staleness check

`src/ml/feature_extractor.ts`'s `NUMERIC_ACCESSORS` map uses the pattern `s?.field ?? f.field` for several features — `z_score`, `excess_return`, `atr_shock_score`, `volume_ratio` among them — where `s` is the cached Supabase `symbol_snapshots.latest_signal_snapshot` and `f` is the freshly-computed live value from today's real bars. The `??` unconditionally prefers `s` whenever it's non-null, **regardless of age**. There is no staleness check anywhere in this path.

DVN's `symbol_snapshots` row was last updated **2026-06-13 — a full month stale** — and captured a genuine historical anomaly (`z_score=2.99`, `excess_return=67%`, `event_classification="HISTORICAL_EVENT"`, VIX regime "extreme"). On today's run, DVN's real anomaly was mundane (`z_score=0.39`, `excess_return=0.97%`), but the stale snapshot silently won the `??`, feeding the month-old extreme values into the live feature vector. Raw (pre-clamp) model output came out pathological — 57–114% predicted returns across D1/D2/D3/D4/B simultaneously — which cleared multiple entry gates once clamped to plausible-looking values.

This is distinct from **Phenomenon 1** (null-collapse: symbols with zero `symbol_snapshots` coverage — see the earlier session) and **Phenomenon 2** (benign blue-chip tree-leaf clustering among AXP/CVX/O/PLD/TSLA/META/BCE, confirmed sane on raw-prediction inspection). Phenomenon 3 needs *some* prior anomaly ever captured for a symbol — which, structurally, is true of most "covered" symbols, since that's how they get a snapshot in the first place. It is a materially broader-reaching hazard than Phenomenon 1: it doesn't require a never-backfilled symbol, just an old one.

### Consequence 1 — DVN STRONG_BUY entries, pots 1/8/19 (£3,842.93 total): confirmed erroneous, corrected

Verified via the same corrected-replay methodology used for the earlier AMP incident — reconstructed DVN's real feature vector with the 4 confirmed stale-priority fields forced to today's fresh values (everything else held real), ran it through the actual deployed `infer.py`, then replayed each pot's real entry gate (`meetsEntryConditions`/`resolveHorizonSignal`/`patienceHorizon`/`ambitionTier`, transcribed verbatim from `PotService.ts`, not reimplemented from memory):

| | Stale (used) | Corrected | Gate result |
|---|---|---|---|
| D1 (3M) — pots 1, 8 | 0.5000 (clamp ceiling) | **0.0117** | Tier HOLD (need ≥0.057568); misses tier by 5x, misses minReturn (0.12) by ~10x |
| D5 (2W) — pot 19 | 0.1801 | **0.0141** | Tier HOLD (need ≥0.024743); misses tier by ~2x, misses minReturn (0.12) by ~8.5x |

Not borderline in either case. Caveat surfaced and not hidden: `model_b_return_1m` stayed extreme (96.6%) even after correcting the 4 confirmed fields — likely a second, untraced stale field (`price_target_upside_pct=278.43%`, no live equivalent to fall back to) — but moot for this decision since the 1M horizon is a documented dead band (`HORIZON_TIER_CONFIG.model_b_return_1m` empty; no pot's patience ever gates on it).

**Resolved same-day**, per Lewis's explicit sign-off, following the full recon → report → confirm → write → verify discipline:
- New `exit_reason`/`reason` value `manual_correction` — no existing convention covered a corrective exit (only `patience`/`short_cover`/`stop_loss`/`replacement`/`reactivity` existed). Added to `pot_positions`'s `pot_positions_exit_reason_check` CHECK constraint via `ALTER TABLE` (Lewis ran this directly — no service-role/DDL access was available from this environment; confirmed via `pg_get_constraintdef` before altering).
- Exit price: **$42.23 — identical to entry**, because the US market had not yet opened since the erroneous entry (confirmed live via a fresh Yahoo quote at write time). Not an artificial zero-out; genuinely the current market price at that moment.
- Result: **£0.00 realized P&L across all 3 positions** (110, 111, 112) — zero market exposure was actually incurred. `pot_trades` (145/146/147) and `pot_positions` independently re-fetched post-write and confirmed consistent. No other open position in pots 1/8/19 was touched (verified by listing all remaining open positions in each pot).

### Consequence 2 — BCE replacement-exits, pots 1/8 (-£69.85, -£55.88 = -£125.73 combined): confirmed downstream of the same bug, left closed

`PotService.ts`'s PHASE 2 replacement logic picks the worst-performing held position by genuine realized return, then only executes the close if some other candidate's `expectedReturnForHorizon` beats the worst position's `expected_return_at_entry` by `(11-ambition)*0.015`. BCE was legitimately the worst position in both pots (real -5.61% decline since 2026-06-23 entry — not itself a bug). But the beat-check that actually triggered the close used DVN's corrupted `model_d1_return_3m=0.5`: needed >0.4336 to clear the bar for ambition=5.5, and DVN's stale-driven 0.5 cleared it. Checked the full 79-symbol run: DVN was the **only** candidate clearing this threshold (next-best, `000660.KS` at 0.4005, falls short by 0.033). With DVN's corrected value (0.0117), **no candidate in that run's universe would have cleared the bar, and BCE would have stayed open in both pots.** BCE's own signal was checked and is not itself corrupted (mundane `z_score=0.53`, `excess_return=0.45%` despite BCE also carrying a June-13-dated snapshot) — the corruption entering this decision came entirely from DVN's side of the comparison.

**Deliberately not reversed.** Precedent set by the earlier AMP incident: reopening BCE would not "undo" anything — the -5.61% price decline between 2026-06-23 and today already happened and is real, independent of the invalid decision path that surfaced it. Reopening now would just be a new, unmotivated position dressed up as a correction, not a genuine undo (unlike DVN, where entry and same-day exit price were identical, making the correction a true no-op). The **causal attribution** (this loss was realized via a corrupted gate, not a legitimate replacement decision) is what's being corrected/documented here — the money is real and stays as booked.

### Consequence 3 — TRIP exit, pot 19 (+£26.40): checked, confirmed clean, unrelated

`exit_reason='patience'`, and `exit_deadline` (2026-07-13) equals `exit_date` (2026-07-13) exactly — a pure date comparison (`todayStr >= pos.exit_deadline`), no model signal consulted at all. TRIP's own snapshot is also June-13-dated (same structural precondition as every other symbol here), but it's irrelevant since patience exits never touch a model prediction. No action needed; the DVN entry that filled TRIP's freed slot is already covered under Consequence 1.

### Status: not yet fixed, recurrence still possible

The `s?.field ?? f.field` accessor-precedence bug in `feature_extractor.ts` is still live in deployed code. Today's actions corrected the realized consequences of one specific incident (DVN + its downstream BCE replacements); they do **not** prevent the same mechanism firing again on the next enabled run, for DVN or any other symbol whose cached snapshot happens to have captured a large historical anomaly. **Live Inference stays disabled pending a fix decision.** A staleness-gate fix (e.g. ignore `s?.field` if `symbol_snapshots.updated_at` is older than some threshold, or prefer `f.field` outright for these 4 fields since a fresh live computation always exists for them) has been discussed but **not implemented or committed** — needs its own scoping + sign-off pass, separate from this incident's cleanup.

Artifacts (all read-only recon, all still on disk, none committed): `src/scripts/scratch_reconstructFeatureVectors.ts`, `src/scripts/scratch_reconstructPhenomenon2.ts`, `src/scripts/scratch_dvnCorrectedReplay.ts`.

### Pot 5 follow-up (2026-07-13, later same day)

The same Phenomenon 3 blast-radius recon that produced this session's findings also flagged 3 open positions in pot 5 (MG.TO #85, DVN #103, EZJ.L #109) as potential casualties, since all three carried the same frozen 2026-06-13 `symbol_snapshots` snapshot at entry. Point-in-time-correct replay (real bars/anomaly reconstructed as of each actual entry date, not today's data) confirmed:

- **DVN #103 (entered 2026-07-07) and EZJ.L #109 (entered 2026-07-12): both non-borderline erroneous** — corrected D5/D1 miss their tier thresholds and minReturn floors by wide margins, matching the same pattern as this morning's incident. Closed via `manual_correction`, real market price at close time: DVN $42.41→$43.855 (+£37.57), EZJ.L 672.20p→675.20p (+£3.00). Combined **+£40.57 realised**.
- **MG.TO #85 (entered 2026-07-02): inconclusive, left open.** Reconstruction did not reproduce the real stored entry (unlike DVN/EZJ.L, which matched exactly), and the entry's commit-message provenance suggests a possible backfill/manual seed rather than a normal live-inference run — needs separate investigation before any verdict. Currently open, +£27.96 unrealised, not urgent.

**Reporting caveat (important):** `manual_correction`-tagged trades (`pot_trades` ids 145-149, spanning pots 1, 8, and 19, plus 148-149 in pot 5) should be **excluded from any P&L/performance analysis** of the pots they touch. These are real, correctly-booked gains/losses, but they reflect bug remediation (closing positions the system should never have opened), not trading skill or genuine signal performance. Including them in aggregate return/win-rate stats for pots 1, 2, 5, 8, or 19 would misrepresent the strategy's real performance.

**Still outstanding, not yet started**:
- Why `symbol_snapshots` froze at a single `updated_at` (2026-06-13) across all 1,112 rows and hasn't updated since (`migrate_snapshots.ts` appears to have run once and never again) — this is the actual root cause behind Phenomenon 3 and hasn't been investigated yet.
- A portfolio-wide sweep: 35 of 44 distinct symbols across 77 open positions carry nonzero stale-severity per the blast-radius recon; only pot 5's 3 have been individually replayed.
- Entry-checks on the 14 days of recently-closed positions (exits confirmed clean via date/price mechanisms, entries unchecked).

### Sanity gate + null-enrichment check: two known residual gaps (found during the 2026-07-14 test-dispatch verification)

Committed as `b3a652e` (Phenomenon 3 accessor-precedence fix) and `f687a39` (mechanism-agnostic raw-prediction sanity gate + direct null-enrichment completeness check, both feeding a new `inference_results.unreliable_reason` column that `meetsSignalQualityGate` hard-excludes from every entry/short-entry/replacement/reactivity-exit path). A single controlled `workflow_dispatch` test run (2026-07-14, run #72, `sha=8ce6e29`) verified the mechanism end-to-end — 15/54 scanned symbols flagged, all correctly excluded, the one real trade that fired was independently confirmed clean and unrelated to either phenomenon. Two accepted, low-priority gaps surfaced along the way:

1. **MG.TO's B-only single-head gap**: replaying MG.TO's real incident values against the current stale snapshot showed `model_b_return_1m` at ~26x its normal range with no other head firing — a lone extreme B value alone doesn't trip the sanity gate's secondary corroboration rule (by design, since B/D1/D2/D4 all have legitimately wide real tails and none is safe as a standalone trigger). Accepted as-is: `model_b_return_1m` has no `HORIZON_TIER_CONFIG` entry at all (a pre-existing, separately-documented dead band), so no pot decision anywhere consumes it as a gating signal — this gap is cosmetic/dashboard-narrative exposure only, not a trading-decision risk.
2. **Clamp-vs-gate gray zone**: raw D3/D5 values landing between the clamp ceiling (0.20/0.35) and the sanity gate's threshold (0.30/0.40) get clamped for display/decision purposes but are not flagged as unreliable. Confirmed live on today's test run: `DIVISLAB.NS` and `601899.SS` both showed clamped `D3=0.2` (the ceiling) but `unreliable_reason=null`. The market had moved by the time this was checked, so the exact historical raw value couldn't be re-observed directly — but the code's construction makes it logically airtight regardless: the clamp and the gate check both read the identical `scores.model_d3_return_2d` in the same statement block with no async gap between them, so `clamped=0.2` + `unreliable_reason=null` can only mean raw D3 sat in **(0.20, 0.30]** at run time. Not a bug — a deliberate consequence of the clamp bound (protects the stored/displayed value) sitting tighter than the gate threshold (only targets values far outside all real history) — just newly observed on live data rather than only in population percentiles.

Also noted: the 2026-07-14 test only exercised the afternoon-slot's 13 reactivity-eligible pots (`workflow_dispatch` has no schedule context, so it defaults to `slot=afternoon`, excluding pots 1/8/11/16/18 whose reactivity < 4.0) and produced zero entry-side trades (the one real trade was a reactivity exit). The entry-exclusion path is replay-verified (STEP 6a/b/c) but has not yet been observed rejecting a live would-have-fired entry.

### MG.TO #85 provenance resolved, and a bigger finding surfaced along the way (2026-07-14)

The "inconclusive, left open" status recorded above for MG.TO #85 is resolved: **confirmed as a genuine automated live-inference entry**, not a Phenomenon 1/3 casualty and not a manual/backfill trade. A real `schedule`-triggered GitHub Actions run (queued 2026-07-01T17:30:29Z, delayed ~23h by the "heatwave pause" runner-capacity outage, actually ran 2026-07-02T16:46:13Z–17:05:34Z) produced `pot_trades`/`pot_positions` #85 at 17:05:22Z — 12 seconds before that run's completion.

The point-in-time replay's apparent mismatch had nothing to do with data corruption or either phenomenon. `expected_return_at_entry = 0.35` looked anomalous only because it's a **1-month (`model_b_return_1m`) value under the pre-cutover recommendation-basis formula** (`modelA≥0.80 && modelB≥0.05 && riskScore≤40 → STRONG_BUY`), not a D5 (2-week) value — the D5-basis cutover (`cbac45f`) didn't land until **2026-07-10, 8 days after MG.TO's entry**. Replaying with current (D5-basis) code against a pre-cutover position compares two different recommendation formulas — an apples-to-oranges mismatch, not a reproduction failure. **Replay-methodology lesson: any position dated before 2026-07-10 needs code-vintage-aware replay** (checkout as of just before `cbac45f`, not just bars/model-file matching), since the recommendation basis itself changed, not only the thresholds.

**Bigger finding, surfaced as a side effect of this recon**: there is a **17-day `inference_results` write blackout, 2026-06-19T21:05 → 2026-07-06T17:53**, spanning *every* symbol, not just MG.TO — confirmed zero rows written across that entire window despite multiple scheduled runs completing with `conclusion: success`. Root cause: commit `41913ea` ("heatwave pause in backfill", 2026-06-21) added `alphavantage_sentiment_avg` to `writeResultToSupabase()`'s upsert payload and to `supabase_migration.sql`'s tracked DDL, but the matching `ALTER TABLE` was never actually run against production. Every write in the window then failed with a column-not-found error — invisibly, because `writeResultToSupabase()` wraps the insert in try/catch and only `console.error`s on failure (`src/LiveInferenceService.ts:967-972`), never throws, so the GitHub Actions job still reported `success`. This is the same schema-drift hazard class already on record ([[supabase-schema-drift-hazard]]) — this is its first observed real-world consequence at scale: a **two-and-a-half-week window where no live-inference run's actual computed scores can be independently verified**, for any symbol, not only positions. A live drift check (2026-07-14) found no currently-active recurrence of this specific failure mode — see the audit note below.

**Audit note (2026-07-14 live drift check)**: cross-referenced all 17 `ALTER TABLE ... ADD COLUMN` statements across `supabase_migration.sql` against the live Supabase schema (via direct row inspection) — all 17 columns confirmed present, including `alphavantage_sentiment_avg` itself (the specific column that caused the blackout is now applied). `supabase_pots_migration.sql` and `supabase_watchlist_pulse_migration.sql` contain no `ADD COLUMN` statements at all, so neither carries this risk. No file→DB drift found in the failure direction that caused the blackout (file claims a column, DB lacks it).

One related but lower-severity gap found in the *opposite* direction (DB ahead of file, undocumented): `inference_results.unreliable_reason` (this session's sanity-gate column) and the broadened `pot_positions.exit_reason` CHECK constraint (now permitting `'manual_correction'`, used repeatedly this session) both exist and work live, but neither is reflected in the tracked migration SQL files — `supabase_pots_migration.sql:40-43` still lists only `'patience','stop_loss','reactivity','replacement','short_cover'`. This doesn't cause silent failures today (both work correctly against the live DB as altered), but if either file were ever used to rebuild the DB from scratch, both would be missing — worth a documentation-sync pass, not urgent.

---

### Portfolio-wide Phenomenon 1/3 sweep (2026-07-14)

Extends the pot-5-only replay above to the full live portfolio. **Scope**: 109 positions checked (74 open + 38 closed-in-last-30-days, excluding pot 5's already-resolved MG.TO/DVN/EZJ.L), collapsing to 67 distinct (symbol, entry_date) pairs. Replayed across **9 code-vintage eras** via detached git worktrees (junction-linked `node_modules`), each era's gate logic (`meetsEntryConditions`/`ambitionTier`/`patienceHorizon`/`HORIZON_TIER_CONFIG`/`resolveHorizonSignal`) read directly from that vintage's actual `PotService.ts` rather than transcribed from memory — this caught and corrected a small transcription error in the earlier ad-hoc DVN replay script's `MODEL_C_PERCENTILE_BREAKPOINTS` (real era8/9 values are `[0.95,0.1002],[0.98,0.1002],[0.99,0.1009],[1.00,0.1009]`, not `[0.95,0.1024],[0.98,0.1024],[1.00,0.2]` as that script had it — didn't change DVN's already-confirmed verdict, but worth knowing the source script had drifted from ground truth).

**Structural caveat — F1 confound**: `F1` ("live/train feature-vector skew — 6 fixes, 8x Model A gate-flip reduction", fixed 2026-07-11) predates this sweep's coverage for every era except era8/9. Pre-fix, live inference silently zeroed/mismatched 6 named features the model was trained to expect, and Model A's gate decisions were documented as **8x more unstable** as a direct consequence. This means **no position entered before 2026-07-11 can get a clean, single-cause Phenomenon 1/3 verdict in isolation** — a second, independently-diagnosed source of noise sits on top of any stale/fresh z-score comparison for that whole window. Where this showed up directly (Model A collapsing to ~0.01–0.03 despite non-trivial stale z-scores, and the stale-input replay failing to even reproduce the real recorded entry), positions were left explicitly unresolved rather than force-fit into CONFIRMED/NOT_A_CASUALTY.

**Verdict breakdown** (109 positions):

| Verdict | Count | Meaning |
|---|---|---|
| CONFIRMED_CASUALTY | 25 | Stale-input replay reproduces the real entry passing; corrected inputs fail cleanly on return-magnitude/riskScore terms, not Model A collapse |
| NOT_A_CASUALTY | 18 | Corrected inputs still pass — real signal, coincidentally matches |
| REPLAY_FIDELITY_MISMATCH | 23 | Stale-input replay does *not* reproduce the real entry passing — consistent with F1's documented pre-fix instability, not a phenomenon verdict |
| INCONCLUSIVE_REPLAY_MISMATCH | 29 (16 pairs) | `detectAnomaly` returns null even with the force-bypass flag — likely a different entry mechanism (replacement/reactivity/watchlist-pulse), same category as the MG.TO code-vintage lesson |
| PHENOM1_SIGNAL_PLAUSIBLE | 9 | Zero-coverage entry's own signal passes the gate on its own merits — not obviously degenerate |
| PHENOM1_WOULD_NOT_PASS_GATE | 2 | Zero-coverage entry's signal doesn't clear the gate even without any correction applied |
| ALREADY_RESOLVED_DVN | 3 | Pots 1/8/19's DVN, already confirmed and closed earlier this session |

**Action taken**: all 14 open `CONFIRMED_CASUALTY` positions closed via `manual_correction` at real current market prices (`500510.BO`'s 3 positions used the 2026-07-10 last-valid close — Yahoo returned null for 07-13/07-14 and EODHD's key was rejecting with 401, no fresher price obtainable from any source, confirmed before writing):

| Symbol | Pot | Entry | Exit | Realised P&L |
|---|---|---|---|---|
| BAJFINANCE.NS (#4) | 7 | 918.30 | 1006.60 | +£192.31 |
| BPCL.NS (#5) | 7 | 302.35 | 305.35 | +£19.84 |
| LT.NS (#6) | 7 | 4049.30 | 3848.70 | -£99.08 |
| 500510.BO (#7) | 7 | 4050.20 | 3946.55* | -£51.18 |
| BAJFINANCE.NS (#13) | 15 | 918.30 | 1006.60 | +£96.16 |
| 500510.BO (#14) | 15 | 4050.20 | 3946.55* | -£25.59 |
| BAJFINANCE.NS (#15) | 17 | 918.30 | 1006.60 | +£320.52 |
| 500510.BO (#16) | 17 | 4050.20 | 3946.55* | -£85.30 |
| HDFCLIFE.NS (#21) | 15 | 581.20 | 555.20 | -£26.00 |
| QAN.AX (#22) | 15 | 9.94 | 10.25 | +£31.00 |
| EVN.AX (#23) | 15 | 12.93 | 11.78 | -£88.55 |
| AKRBP.OL (#24) | 15 | 319.50 | 324.40 | +£14.70 |
| TTE (#30) | 15 | 84.36 | 81.35 | -£33.11 |
| CVX (#33) | 15 | 180.40 | 181.03 | +£3.15 |

**Total realised: +£268.86.** Verified consistent between `pot_positions` and `pot_trades` post-write; pots 7 and 17 now have zero open positions (all their holdings were among these 14); pot 15's 2 remaining open positions (`DASH` #28, `SHEL` #29) confirmed untouched. Overall open-position count: 74 → 60.

**Correction (2026-07-14, later same day)**: 9 of the 14 rows above (`BAJFINANCE.NS` #4/#13/#15, `BPCL.NS` #5, `LT.NS` #6, `500510.BO` #7/#14/#16, `HDFCLIFE.NS` #21) are INR-denominated and were affected by F8 (native-currency prices treated as GBP throughout the pot ledger, fixed and backfilled this same day — see F8's own section below). The £ figures shown in the table above for those 9 rows are the **pre-fix, uncorrected values** — real numbers at the time they were written, now superseded. Corrected values (post-backfill): `BAJFINANCE.NS` #4 £1.41 (was +£192.31), #13 £0.70 (was +£96.16), #15 £2.34 (was +£320.52); `BPCL.NS` #5 £0.06 (was +£19.84); `LT.NS` #6 -£0.87 (was -£99.08); `500510.BO` #7 -£0.50 (was -£51.18), #14 -£0.25 (was -£25.59), #16 -£0.83 (was -£85.30); `HDFCLIFE.NS` #21 -£0.23 (was -£26.00). The other 5 rows (`QAN.AX`, `EVN.AX`, `AKRBP.OL`, `TTE`, `CVX`) are USD/AUD/NOK/EUR-denominated and unaffected — their figures above are still correct as shown. **Corrected combined total for this batch of 14: -£70.98** (was +£268.86) — the swing is almost entirely the 3 `BAJFINANCE.NS` closes, whose apparent +£192-320 gains were never real at that magnitude. Live database values are already corrected (backfilled, not just documented) — this note exists so the number doesn't look inconsistent between this record and the database going forward.

The **11 already-closed confirmed casualties** (`NOKIA.HE` #10, `XLE` #27, `AKRBP.OL` #17/#25, `AMZN` #70/#67, `MU` #76, `VZ` #78/#79, `VRT` #77 — combined **-£630.01** already realised) are left as historical record only — unrecoverable, audit note only, **do not reopen**, same precedent as BCE's earlier `replacement` exits.

The **2 `PHENOM1_WOULD_NOT_PASS_GATE`** positions (`HEIO.AS` #74, `CGNX` #99) are noted but **not** treated as casualties — nothing was actually corrected for either (enrichment was legitimately null both then and now; there's no stale-vs-fresh comparison to make), so a failing gate check on the raw signal alone isn't evidence of a phenomenon-driven error, just a weak signal.

**Known gap, not chased further per scoping decision**: the 23 `REPLAY_FIDELITY_MISMATCH` and 29 `INCONCLUSIVE_REPLAY_MISMATCH` positions (52 total, spanning most of pots 2/3/5/9/13/16/19/20 among others) are genuinely unresolved — not cleared, not confirmed casualties. Do not read this sweep as full portfolio coverage; a meaningful chunk of flagged positions still carries no verdict either way.

**Reporting caveat, extended**: the `manual_correction` P&L-exclusion note logged earlier for pots 1/5/8/19 now also covers **pots 2, 7, 15, and 17** — all `manual_correction`-tagged trades across the full portfolio (today's 14 new closes plus the pre-existing ones) should be excluded from any aggregate return/win-rate analysis of the pots they touch, for the same reason as before: these are real, correctly-booked bug-remediation outcomes, not signal performance.

---

### F7 — PHASE 2/3 entry selection: Fix B shipped, Fix A held as an open decision (2026-07-14)

`AUDIT_FINDINGS_2026-07.md`'s F7 flagged two related PHASE 2/3 issues in `PotService.ts`: (1) PHASE 3 long entries take the first qualifying result in array order, no ranking by expected return/riskReward/tier; (2) PHASE 2 replacement closes a position because a specific signal beats it, but the freed slot then goes to PHASE 3's independent array-order scan, which can open a **different**, merely-qualifying signal unrelated to whatever justified the close. Re-confirmed accurate against current code before implementing (only `f687a39`'s `unreliable_reason` exclusion touches this region since the original audit, and it only narrows the candidate pool uniformly via `meetsEntryConditions` — no conflict).

**Fix B (shipped)**: PHASE 2 now records `reservedForReplacement = replacementSignal.symbol` when it closes a position for a named justifying signal. PHASE 3 moves that symbol to the front of its candidate scan before iterating, so the freed slot goes to the signal that justified the close first, falling through to the normal scan only if that specific candidate turns out infeasible (price/shares/cash) — reusing PHASE 3's real feasibility checks rather than duplicating open-action logic in PHASE 2.

**Fix A (held, not implemented, not abandoned)**: rank PHASE 3's candidate scan by expected return before filling slots (riskReward was considered and rejected as the ranking key — see the recon's reasoning: it's calibrated as a gate/floor, not a fine-grained differentiator, and ranking on it risks re-importing Model C's own known instability as ordering noise). Implemented and sweep-tested alongside Fix B, then **deliberately backed out and held** once the sweep data showed a real, non-trivial risk/return tradeoff that wasn't part of the original scoping decision:

- **Fix A+B combined**: 44.46% of the 40,000-pot sweep affected (far more than recon predicted — any pot that ever hits >1 qualifying candidate for a limited slot across the 407-day fold gets flagged, a much lower bar than expected). On the affected subset: `total_return_pct` **+20.11 mean / +15.14 median** (substantial, real improvement, majority-positive 11,001 vs 6,644) — but `sharpe` **-0.156 mean** (majority-negative, 9,658 vs 7,987), `max_drawdown_pct` **worse in 73% of affected pots** (12,983 vs 3,378), `win_rate_pct` **-4.32pp mean** (majority-negative, 8,623 vs 7,129). Ranking by raw expected return picks bigger predicted payouts, not better risk-adjusted ones — the data shows that gap concretely. `events_skipped_no_price` delta was exactly 0 in both configurations (confirms the fix changes *which* candidate fills a slot, never *whether* one gets filled).
- **Fix B alone**: only 4.97% of the sweep affected (1,987/40,000 — an order of magnitude narrower, much closer to the original recon estimate), and **no directional skew on any metric** — `total_return_pct` mean -7.74/median -0.19 (essentially a coin-flip, 988 vs 999), `sharpe` mean -0.012/median +0.042 (near-neutral), `max_drawdown_pct` mean +0.31/median 0.00 (616/1,987 pots showed zero change at all), `win_rate_pct` mean +0.78 (mild positive lean), `trade_count` total slightly *decreased* (-1,723, opposite direction from Fix A+B's +17,191 — consistent with less wasted churn from opening a less-considered candidate that gets quickly re-exited). This confirms Fix B is structurally sound independent of ranking philosophy: it doesn't chase bigger predicted payouts, so there's no reason to expect (and the data doesn't show) a systematic skew toward higher-variance picks.

**Fix A remains a candidate for future work** — testing alternate ranking metrics (riskReward as originally considered, or a blended score) against the same before/after sweep infrastructure (`scratch_f7_sweep_with_tradelog.ts` + `scratch_f7_diff.ts` + `scratch_f7_classify.ts`, all still on disk, untracked) before any future decision to ship it. Not scheduled, not scoped further than this.

**Also still deferred from the original F7 scoping, unrelated to the Fix A/B split above**: short-entry ranking has the identical array-order-first-match structural issue as PHASE 3 long entries — noted in the original recon, never addressed, no timeline.

---

### F8 — FX normalization for high-nominal currencies: fixed and backfilled (2026-07-14)

`AUDIT_FINDINGS_2026-07.md`'s F8 flagged international symbols' native-currency prices being treated as GBP throughout the pot ledger — internally consistent for % returns, but share counts, `position_size_gbp`, and unrealised/realised P&L were economically wrong (a >100x overstatement for INR), and the `shares===0` entry floor was silently biased against high-nominal currencies regardless of real cost.

**Scoped fix, not full normalization**: per explicit decision, only currencies with a severe (>~80x per GBP) price-level mismatch get corrected — USD/EUR/AUD/CAD/CHF/etc. are within tolerance and deliberately left unconverted. A general suffix→currency mapping gates a static `HIGH_NOMINAL_CURRENCIES` set (`INR`/`JPY`/`KRW`/`HUF`/`IDR`/`VND`/`CLP`) through FRED's daily FX series, cross-converted to GBP via `DEXUSUK` — so a new JPY/KRW symbol gets covered automatically the moment it appears, no code change needed. The `shares===0` skip-bias itself was deliberately **not** fixed — documented as a known, currently-unobserved latent risk (no evidence of an actual missed trade in this portfolio's history), revisit only if it manifests for real.

**FRED coverage** (tested live 2026-07-14): `DEXINUS` (INR), `DEXJPUS` (JPY), `DEXKOUS` (KRW), `DEXUSUK` (GBP-cross) all confirmed working with real data. No working series found for `HUF`/`IDR`/`VND`/`CLP` under standard or OECD-style naming — included in the high-nominal set anyway (nothing to revisit if a series is found later) but gracefully fall through to unconverted + a warning; currently unreachable via any mapped exchange suffix regardless, so this doesn't affect anything live today.

**Two choke points fixed**, both calling the same `convertToGBPIfHighNominal()` (`FREDService.ts`): (1) `LiveInferenceService.ts`'s `potResults.push` (new scan results), (2) `PotService.ts`'s `evaluateRun()` `fetchCurrentPrice` fallback for held-but-not-rescanned symbols — a separate, independent price-fetch path that would otherwise mark a converted entry price against an unconverted current price on any day a position isn't actively rescanned. `decidePot()` itself untouched. Verified via the shared function directly: INR conversions produce the expected cross-rate, JPY/KRW convert correctly with zero code change, USD/EUR/AUD/GBP all return exactly unchanged. Shipped as `934a36e`.

**Backfill executed** for the 14 already-affected INR positions found in recon (`BAJFINANCE.NS` #1/#3/#4/#13/#15, `500510.BO` #7/#8/#9/#14/#16, `BPCL.NS` #5, `LT.NS` #6, `HDFCLIFE.NS` #20/#21) — `entry_price`/`position_size_gbp`/`current_price`-or-`exit_price`/`unrealised_pnl`-or-`realised_pnl`+`realised_return_pct` recomputed using the point-in-time FX rate as of each position's actual entry/exit/today date; `shares` left untouched as historical fact of what quantity was held. All 14 writes confirmed via re-fetch to match the reviewed preview exactly, no drift. `current_value_gbp`/`unrealised_return_pct` for the 4 still-open rows (#3/#8/#9/#20) weren't part of the reviewed preview and were deliberately **not** added to this backfill, rather than derive new values that were never reviewed — the same no-silent-writes discipline held throughout this session. This isn't a standing risk: `evaluateRun()`'s PHASE 5 (`PotService.ts:993-1002`) unconditionally refreshes `current_value_gbp`/`unrealised_pnl`/`unrealised_return_pct`/`current_price` for every remaining open position on every eligible run, via `priceMap` (populated for every open-position symbol regardless of anomaly status — through `results` if scanned today, through choke point 2's `fetchCurrentPrice` fallback otherwise, both now FX-converted). There's no dependency on these specific symbols being flagged anomalous again. Every pot has `reactivity >= 1.5`, so all of them (including pots 3/10/13/15 holding these 4 positions) are eligible for the morning slot, which runs daily on weekdays — confirmed the Live Inference schedule is currently `active` via GitHub's API, so these two fields self-heal within roughly one day, not the ~31-day anomaly-rescan cadence.

**% returns shift slightly for several backfilled positions** (e.g. #1: 4.37%→4.77%; #6: -4.95%→-5.54%) — not a bug, reflects real GBP/INR movement between entry and exit that the pre-fix calculation never captured at all (it implicitly assumed a constant, cancelling-out conversion factor).

**Connects directly to today's portfolio-wide sweep** (previous section): 9 of these 14 positions were part of that batch's `manual_correction` closes, meaning the £ P&L figures reported there earlier today were pre-fix values, now superseded — see the correction note appended to that section.

---

### v10 — Per-event pot scoring: patience dominates, ambition secondary with a sign-flip (2026-07-15)

Separate from the existing 40,000-pot **walk-forward** sweep (day-by-day, compounding capital, Focus-slot contention, order effects over the 407-day fold), this scores real historical anomaly events **independently**: every pot gets a fresh, isolated $10,000 for one event, `decidePot()`'s real gate/direction/sizing logic decides whether/how it trades, and profit is `($10,000/focus) × real forward_return_{horizon}` (negated if short) using ground-truth forward returns — not the model's own prediction. Averaged per pot across all events in a population, this isolates signal-picking + sizing + direction quality from portfolio-management/sequencing noise. **Simplification, stated once**: full-horizon hold assumed, no stop-loss/reactivity/patience-timeout mid-hold exit modeling — this is not a full backtest.

**Two separate populations, local SQLite only** (`synthetic_pots/v10_history_sweep.db`, new file, no Supabase writes):
- **(a) headline, leakage-free**: **8,948 events** — the `historical_inference_results` test fold (10,051 rows, genuinely held out from the currently-deployed models' training per `train_regression_heads_v9_3.py`'s temporal 70/15/15 split), filtered to `is_null_sample=0`. The initial extraction missed this filter (caught and fixed before committing); the 1,103 excluded rows were negative-control samples, not real detections.
- **(b) contrast, labeled "model fit to history, not out-of-sample performance"**: **36,859 events** (`event_features`, `is_null_sample=0`, `date>=2016-01-01`), freshly batch-scored through today's deployed vintage (v9.3 B/D1/D2/D3/D5, v9.1 A/C/E) via a vectorized script, not per-call `infer.py` reloads. Excludes 8,583 pre-2016 rows (predate `daily_prices` coverage; suspiciously constant `vixAtEvent`/quarterly-aligned dates — look like placeholder/backfill artifacts) and all `is_null_sample=1` rows.
- **Relationship between (a) and (b), confirmed by join, not assumed**: every one of (a)'s 8,948 events is also present in (b) — (a) is a clean subset of (b), not a separately-drawn or overlapping-but-distinct population. They are reported and interpreted as two separate populations throughout (leakage-free headline vs. in-sample contrast), not merged into one event count.

**Bucket collapse**: 27,123 distinct raw `(patience,ambition,boldness,reactivity)` tuples across the 40,000 pots collapse further to **17,211** buckets once patience resolves to its horizon (raw patience value doesn't matter beyond that, given the full-horizon-hold simplification). Runtime: <1s (a) / ~2.7s (b) for the bucket×event pass.

**Checks**: dead-band cross-check — all **10,236** structurally-inert pots scored exactly $0 under both populations. This figure is a real, traceable correction to `AUDIT_FINDINGS_2026-07.md`'s original F4 count (9,633 = 8,611+1,022), not an unexplained recount: the original audit used `ambition>8` as the second dead band's boundary, but `ambitionTier()`'s actual STRONG_BUY threshold is `ambition>6.0` (both (6,8] and (8,10] require STRONG_BUY, differing only in `minReturn`) — the (6,8] slice (603 pots) was missed originally. 8,611 + 1,625 = 10,236 is the corrected figure, already documented in `PotService.ts`'s own F4 comment; this run's `isDeadBand()` implements the same `>6.0` boundary and reproduces it exactly. Determinism check — 8 real duplicate-trait-vector pot pairs (found naturally among the 40,000, not injected), bit-identical on both populations. One real bug caught and fixed in the regression tooling: the OLS Gauss-Jordan solver divided by a pivot cell after that cell had already mutated to 1, producing garbage coefficients (R² ~ -10³⁰); fixed by capturing the pivot value before the divide, verified against a noiseless synthetic case.

**Regressions**: OLS, 6 single + 15 pairwise + 20 triple trait combinations, run separately against (a)/(b) and against both score types (mean profit over all events vs. mean profit over entered-only events), dead-band pots excluded (29,764 sample; entered-only regressions further restricted to pots with nonzero participation — 23,714/29,764 for (a), 29,210/29,764 for (b)).

| trait(s) | R²(a,all) | R²(a,entered) | R²(b,all) | R²(b,entered) |
|---|---|---|---|---|
| patience | 0.305 | 0.258 | 0.332 | 0.037 |
| ambition | 0.198 | 0.005 | 0.107 | 0.285 |
| reactivity | 0.091 | 0.004 | 0.045 | 0.022 |
| focus | 0.072 | 0.065 | 0.102 | 0.217 |
| conviction | 0.066 | 0.000 | 0.013 | 0.011 |
| boldness | 0.024 | 0.007 | 0.006 | 0.149 |
| ambition+patience | 0.385 | 0.272 | 0.354 | 0.286 |
| patience+focus | 0.341 | 0.297 | 0.389 | 0.287 |
| boldness+patience | 0.306 | 0.306 | 0.417 | 0.153 |
| **ambition+patience+focus** | **0.422** | 0.311 | **0.412** | 0.532 |
| boldness+ambition+patience | 0.393 | 0.311 | 0.458 | 0.348 |

(Full 41-combo table + coefficients: `v10_history_sweep.db::regressions`.)

**Headline finding**: patience is by far the strongest single driver in both populations. Ambition is a real secondary driver but with a sign-flip once patience/focus are controlled for (coefficient -5.6 in (a), -2.2 in (b) in the best triple) — higher ambition raises the entry bar enough that the resulting drop in participation outweighs the per-trade quality gain. Best model is `ambition+patience+focus`, R²≈0.41-0.42 in both populations — a real, directionally consistent signal, ~60% of variance still unexplained. (a) and (b) track each other closely on sign and rough magnitude throughout — a genuine check that (b)'s in-sample contamination isn't distorting the *shape* of the relationship, though its absolute numbers still aren't a performance claim.

**Reconciliation flag, not resolved here**: this differs in method from an earlier walk-forward-sweep finding described as favoring higher Boldness/lower Patience — searched `AUDIT_BRIEFING_2026-07.md`, `DEEP_DIVE_BRIEFING.md`, and this file for that specific claim and could not locate an exact prior citation. The two methodologies are genuinely different (isolated single-event scoring vs. compounding, slot-contended, order-dependent walk-forward), so they may legitimately be capturing different things — flagging for reconciliation against whatever the original source was, not silently treating one as replacing the other.

**Artifacts** (untracked, left on disk per convention): `src/ml/scratch_v10_batch_infer_b.py`, `src/scripts/scratch_v10_extract_a.cjs`, `src/scripts/scratch_v10_engine.ts`, `src/scripts/scratch_v10_regressions.ts`, `synthetic_pots/v10_history_sweep.db` (gitignored under the existing `synthetic_pots/` rule).

#### Trait-shape follow-up (2026-07-15): where in each trait's range the effect actually lives

Recon-only against the already-computed `pot_scores` table — no new event-scoring. Regression coefficients assume linearity; this bins each trait's 19 grid values (holding the other 5 within ±2.0 of their non-dead-band median — exact-match conditioning on all 5 gives N=0, since the 40,000 pots are a sparse sample over a ~47M-point 6-dim grid, not a dense grid) to see actual shape. Every bin's N is reported; bins under 30 are flagged low-trust rather than smoothed over.

| Trait | Shape | Best-performing region | Notes |
|---|---|---|---|
| **ambition** | monotonic decreasing (corr -0.81/-0.92) | ≈3.5-6 | **The cliff at >6.5 is a tier-threshold mechanism, not a preference** — `ambitionTier()` requires STRONG_BUY above 6.0, and participation collapses (85%→3%→0%) because fewer events clear that bar, not because the model dislikes high-ambition pots. |
| **focus** | monotonic decreasing (corr -0.90/-0.90) | focus=2 (lowest available) | Smooth, solid decline through focus=10. |
| **patience** | rises 3→4.5, dead at 5-6.5, positive again 7-8.5, highest at 9-10 | 9-10, most cleanly at **patience=9** | **The 5-6.5 gap is structural, not a quality signal** — `HORIZON_TIER_CONFIG.model_b_return_1m` is deliberately empty (always HOLD), so no pot can trade there regardless of any other trait. The 9-10 bin also mixes in an increasing share (34-57%) of pots that are dead-band for a different reason (ambition>6 combined with patience>8.5) — the true alive-pot average there is higher than the blended figure shown. |
| **boldness** | rises 1→4, then a broad plateau ~4-8.5 | 4-8.5 broadly, no narrow peak | Low boldness (<3.5) clearly worse; no differentiation inside the plateau. |
| **reactivity** | flat/noisy 1.5-7.5, real drop above ≈8 | no narrow optimum below 8; only signal is "avoid >8" | Both populations agree on the drop-off point. |
| **conviction** | **flat/noisy — no defensible optimum at all** | none | Peak/trough locations don't even agree between (a) and (b); this is the one trait where the low single-trait R² (0.066/0.013) reflects a genuine absence of signal, not just a weak linear fit to a real nonlinear shape. |

**Triple-context refinement** (`ambition+patience+focus`, holding the other two at each trait's own single-trait best value): all three sharpen rather than contradict the single-trait view. Ambition: monotonic decreasing, cliff confirmed, most trustworthy peak ≈3.5-6 (the apparent 1-2.5 peak is low-N, 4-12 pots). Patience: dead gap at 5-6.5 confirmed again; clean peak at **patience=9** (N=42, participation≈1.0 — trades almost every time), the most solid single number in the whole analysis. Focus: monotonic decreasing, focus=2 clearly best (N=46).

**Joint optimum: ambition≈3.5-6, patience≈9, focus=2** — moderate (not high) ambition, long patience horizon, small/concentrated positions. Holds consistently whether traits are viewed singly or jointly; (a)/(b) agree on shape everywhere except the fine detail of the patience dead-gap.

---

### v10 feature-hygiene decision + next-phase roadmap (2026-07-15)

**Feature-hygiene decision, finalized.** Consolidates the P3 fabrication/degeneracy findings (Findings 3-8) into per-feature DROP/FIX/KEEP-AS-IS calls:

- **DROP** (all training-input-only, one-line reasoning each):
  - `congressional_net_flow_30d` — constant 0, fabricated (hardcoded mock, real API call commented out); zero information to lose.
  - `news_relevance_z` — constant 0, structurally unfixable for historical rows (free-tier NewsAPI depth can't be backfilled).
  - `stocktwits_virality_z` — has real variance but it's a scan-date-proxy leakage artifact, not event-time signal; the historical data doesn't exist to fix it properly.
  - `av_news_sentiment` — constant, same class as congressional/news.
  - `primaryCategory_technical` — constant one-hot level, never populated.
  - `confidence_tier_low` — constant one-hot level, never populated.
  - `peer_average_return` — near-dead (<1% nonzero); honest-null root cause (FMP 60-day TTL decay) but still near-zero training value.
  - `peer_contagion_delta` — same as above.
  - `insider_net_shares_30d` — near-dead; root cause not fully pinned down this session, but that doesn't change the training-value verdict.
- **DROP-now/FIX-later**: `earnings_date_proximity_days` — broken encoding (89.5% conflates null with "earnings today"); a real fix needs an `EarningsCalendarService` source-priority reorder plus full historical re-extraction, out of scope for this pass.
- **KEEP-AS-IS**: `obv_delta_10d` — real, mid-importance signal; the known train/serve skew is already measured negligible (3/29,720 tier flips), fix belongs in the next natural retrain cycle, not this hygiene batch.

**Scope of the DROP decision**: purely a training-input change — none of the 10 appear outside feature-vector construction in `LiveInferenceService.ts`/`PotService.ts`/the dashboard, so no live-code changes are needed. Just exclude from `feature_metadata`'s `full_feature_cols`, re-export `features.csv`, retrain — whenever that next happens.

**Two residual issues NOT resolved by this decision, flagged separately**: `congressional_net_flow_30d`'s cache-poisoning (fabricated zeros indistinguishable from real fetched zeros) stays live if `CongressionalTradingService` is ever wired to a real API. `stocktwits_virality_z`'s underlying scan-date-proxy-substitution bug stays live in `StockTwitsService.ts` regardless of the model no longer consuming it.

**`obv_delta_10d` will NOT self-refresh on a future retrain** just by regenerating `features.csv` — the historical `event_features.features_json` blobs still hold pre-F1-fix values (regenerating `features.csv` only re-exports what's already in `features_json`). Needs its own explicit step: full `HistoricalEngine` re-run (expensive) or the cheaper surgical migration already scoped, with 49,382/66,834 rows' worth of recompute values already sitting in `scratch/obv_recompute_values.csv` (17,452 bar-less rows still need a leave-stale/null/backfill decision).

**Next-phase roadmap, proposed**: five items, suggested build order **(2) → observe → (1) → (3) → (4)**, with (5) unsequenced/ongoing:
1. Top-3-buys-per-horizon report.
2. Predicted-vs-actual tracker.
3. Live-scan-timing-vs-exchange-hours recon.
4. IBKR integration — explicitly sequenced after (2) has run a couple weeks post-fix, not immediately.
5. Watchlist-pulse cadence review + skip-if-just-scanned optimization.

---
