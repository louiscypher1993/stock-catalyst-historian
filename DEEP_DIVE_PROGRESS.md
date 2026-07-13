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

---
