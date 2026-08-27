# TODO — active backlog

Canonical to-do list, consolidated 2026-08-10. Ordering within sections is priority.
Items carry their gate (what must happen first) because most of this backlog is
time-gated, not effort-gated. History/evidence lives in the memory files and
`DEEP_DIVE_PROGRESS.md`; this file is only what is still OPEN.

## ✅ RESOLVED 2026-08-16 — the pot ledger now reads NET. Honest figure: −0.971%/trade

**`PotService.ts` never imports `costModel.ts`.** Verified: it imports nothing at all, and
`realisedPnl = returnSoFar × position_size_gbp` (`PotService.ts:701`) — pure price return,
no cost term. `costModel` IS wired into `outcomeScoreboard`, `dsrPboAudit`,
`readoutHarness`, `topBuysReport` and `dumpPotCosts` — **the pot ledger was the one consumer
that missed it.** Fixed as a READ layer: `src/potLedgerCosts.ts` + `src/scripts/potLedgerNet.ts`.

### The 14 impossible sizes: NOT a corrupt field. The audit inverted the plan.

The framing here was "repair `position_size_gbp` before wiring costs, or the ratio inherits
the artefact". **The repair was the wrong move and would have made things worse.**
`scratch_potSizeAudit.ts` measured it:

1. **The invariant `position_size_gbp === shares × entry_price` (`PotService.ts:887-888`)
   HOLDS on 185 of 185 rows**, the 14 included (ratio 1.000). The size field is an honest
   record, not a corrupted one.
2. **The prices are right.** `LT.NS` £31.8447 vs `500510.BO` £31.8518 — Larsen & Toubro on
   NSE and BSE, agreeing to 0.02%. Currency conversion on the price side works.
3. **The wrong input was the BUDGET, and the constant is exact.** Every one of the 14
   implies a `portfolioValue` of ~**£78.63** where the snapshot records £10,000 — a uniform
   **127.2×**, not the ~105× guessed above. Multiply size by focus and it is the same number
   every time regardless of pot: 15.73×5 = 78.65, 9.83×8 = 78.64, 7.86×10 = 78.60,
   39.32×2 = 78.64.
4. **Same-day control inside pot 13** settles it: `KBANK.BK` and `PKO.WA` sized at £1,250.00
   (= 10,000/8) on the genesis run while `500510.BO` sized at £9.83 (= 78.63/8). Same pot,
   same day, same focus — only the INR names were mis-sized, so the sizing budget was
   FX-converted on top of the price conversion that was already correct.
5. **12 of the 14 carry FRACTIONAL `shares`** (1.08897, 0.246901, …), impossible under
   `Math.floor` at `:882` — legacy code. The two dated 06-15 have integer shares, so the
   sizing code changed between 06-14 and 06-15 while the budget defect survived it.
6. **Bounded and unrepeatable:** no entry after 2026-06-15 is affected and **0 of 80 open
   positions** are. It cannot recur.

**Consequence: do not rewrite them.** Rewriting `position_size_gbp` would BREAK the
invariant that currently holds, and keeping the row coherent would mean inventing `shares`
and `realised_pnl` too — fabricating trades that never happened. They are honest records of
genuinely tiny trades. Flag, report, and state the basis; do not filter silently.

**⚠ A risk this raised and CLOSED, in the safe direction.** 13 of the 14 overlap the
FX-repair window, and `scratch_potFxRepairPreview.ts:38` wrote
`newRet = newPnl / position_size_gbp` — so a corrupt size would have corrupted the repaired
RETURNS too. It didn't: since size is exactly `shares × entry_price`, that reduces to
`shares×(exit−entry) / (shares×entry)` and **the shares cancel**. `realised_return_pct` was
never contaminated. Worth having checked; it could as easily have gone the other way.

### The numbers

Threshold for `sizingReliable` is audited, not assumed — worst flagged row 0.0079, best
reliable row 0.5961, threshold 0.20 in the empty gap between: **75.8× separation, clean
split**. (0.596 is itself a confirmation of the mechanism: `Math.floor(positionGBP /
entryPrice)` puts the floor for a *legitimate* row at ~0.5.)

All figures below are on the CORRECTED tax table (2026-08-16, near-term item 7 — full
exchange coverage, and India STT fixed from a 10× understatement).

| basis | n | cost % | gross | **net** |
|---|---|---|---|---|
| **ADMISSIBLE** (reliable rows, costed as traded) | 91 | 0.493% | −0.479% | **−0.971%** |
| IMPUTED (all rows, costed at intended size) | 105 | 0.498% | −0.349% | −0.847% |
| naive (all rows as traded — artefact intact) | 105 | 0.539% | −0.349% | −0.888% |

**Quote ADMISSIBLE, −0.971%/trade.** Not because the imputation is unsound but because the
cohort is **14 rows over 5 distinct symbols on 2 days** (BAJFINANCE.NS ×5, 500510.BO ×5,
HDFCLIFE.NS ×2, BPCL, LT). Its gross mean of +0.495% against a median of −3.157% is one
good BAJFINANCE print counted five times across five pots — the roster-overlap problem
already recorded below, in miniature. Those rows add correlated repeats, not information.

**⚠ A THREE-STEP CORRECTION WORTH KEEPING — the measuring instrument was the broken part.**
I predicted the imputation would be biased low, since `.NS`/`.BO` pay the FX minimum plus
Indian stamp and should cost *more* than the blend. The first measurement said the opposite
(cohort 0.376% vs 0.488% blend) and I recorded the prediction as refuted. **It was not: the
measurement was wrong.** `costModel`'s `.NS` entry read `0.0001` while its own note said
"~0.1%" — the value was out by 10× and understated every Indian trade. Corrected, the
cohort at intended size costs **0.564% against a 0.493% blend** — *more*, as originally
predicted. **A measurement that contradicts a well-reasoned prior is a reason to audit the
instrument, not only the prior.** Nothing here was wrong in a way that changed a decision
(admissible moved −0.967% → −0.971%), but the reasoning chain would have been.

### And the honest number is still worse than −0.971%

- **Pessimistic bound with latency slippage: −1.034%** (headline uses
  `slippageBpsPerLeg = 0`; no measured latency data yet — same convention as
  `dumpPotCosts.ts`).
- **The measured close-to-next-open signal decay (D5 ~11.6–24.9bps) is not in costModel**
  and so is in none of these figures.
- Tax coverage is now complete for every suffix the pots have traded, but `taxRate()`'s
  REVIEW fallback still returns 0 for any *new* venue. `potLedgerNet.ts` reports uncovered
  suffixes on every run, derived from `KNOWN_TAX_SUFFIXES` rather than a copied list.

**Realistically −1.0% to −1.2%/trade net. That is the baseline the October checkpoint gets
judged against.**

### What was deliberately NOT done

`PotService.ts:701` is untouched. Deducting cost inside `realisedPnl` propagates through
`totalRealisedPnl` (`:845`) → `portfolioValue` (`:822`) → `positionGBP = portfolioValue / F`
(`:876`), i.e. it changes how every future position is SIZED. That is a behavioural change
to a live paper-trading system and would split the record into non-comparable halves — the
same trap the 2026-07-07 accumulator rebase created. With 24 R2 pots at **0 closed trades**
accruing the data October depends on, a second discontinuity now would be expensive. If the
pots should trade net of costs, that is a deliberate decision at the checkpoint with its own
clock reset, not a side effect of a reporting fix.

Scripts: `potLedgerNet.ts` (the readout), `potLedgerCosts.ts` (the module),
`scratch_potSizeAudit.ts` (the audit that inverted the plan), `scratch_potCostVerify.ts`,
`scratch_potCostNet.ts`, `scratch_potMicro.ts`.

## Near-term (this week / next)

1. **Risk-score re-evaluation** *(gate: ~10 trading days of post-parity data, ~2026-08-21)*
   **⚠ PRE-REGISTERED 2026-08-16 — read `PREREG_2026-08-21_riskscore_refit.md` BEFORE
   running any part of this.** Acceptance criteria, the frozen candidate list and the
   abandon-conditions are fixed there ahead of the data. Two things it settles that are
   not obvious from the text below: (a) refitting percentiles on live output makes the
   result uniform BY CONSTRUCTION, so a distributional success test cannot fail and proves
   nothing — the real gate is whether live Model C has ≥50 distinct values at all, given A
   has 12; (b) **only A1/A2/C1 can honestly be decided on 08-21.** The confidence-term
   replacement and the beat-the-baseline test both need matured post-parity 2W outcomes,
   which are n=0 until ~08-23, so they land in early September.
   **⚠ RUN 2026-08-24 — A1 and C1 are DONE and both changed the plan. See AMENDMENT 1 in
   the prereg for the full record. Headlines:**
   - **The "37-38 spike = pinned drawdown term" claim is WRONG about production.** It
     measured the v9.1 FALLBACK table. `infer.py` serves `model_c_percentile_rank` from
     v9.5's own breakpoints and `PotService.ts:475` prefers it; the local table is only
     used when that field is absent — which is exactly what happens to any analysis
     reading Supabase, because **the rank is never persisted there**. On the same 1,101
     live rows the term is `>=37/40` on **91.7%** under v9.1 but **0.6%** under v9.5,
     median 38.7 vs 16.3, 4 distinct values vs 38. **Live, the term is healthy.**
     **`MODEL_C_PERCENTILE_BREAKPOINTS` refit is CANCELLED** — it would only change the
     fallback. **The real fix is to persist `model_c_percentile_rank` into
     `inference_results`** (ALTER TABLE first — [[supabase-schema-drift-hazard]]).
   - **Model C is NOT degenerate**: 525 distinct values over 1,101 rows. A emits 16, B
     emits 51 — the degeneracy is theirs.
   - **The confidence-term finding SURVIVES** (`model_a_confidence` IS stored, so it was
     measured on real production values). That part of the refit stands, gated on
     matured 2W outcomes in early September.
   - **C1 cutoff refit: adopt the UPPER tiers, reject the SELL target.** Live predictions
     are almost all positive (D5 3.5% negative, D2 0.0%), so forcing SELL to 10% puts the
     D5 cutoff at **+0.0147** — calling a predicted +1.47% GAIN a SELL, and handing 10%
     of rows a 30-point `tailRiskTerm` penalty that gates entry. Occupancy is the wrong
     instrument for a sign-defined tier.

   *(original framing, kept because the confidence-term half of it still holds)*
   Decomposed on 2,471 live rows (`scratch_riskDecompose.ts`, `defe2ad`): the 37-38
   spike is the drawdown term pinned by stale Model C breakpoints; `model_a_confidence`
   is ≥0.9999 on ~92% of rows so the 30-point confidence term is dead; 64-69 cluster =
   pinned term + binary 30-pt sell term. One change, three parts:
   - ~~refit `MODEL_C_PERCENTILE_BREAKPOINTS` on post-parity live C output~~ **CANCELLED
     2026-08-24, see above — persist the rank instead;**
   - **REPLACE the confidence term — measured 2026-08-10: the isotonic calibrator maps
     97.1% of fold EVENTS to exactly 1.0 (raw A: 41% ≥0.9999). A separates events from
     non-events; every row reaching riskScore IS an event, so the term never had
     discriminating power. Candidate replacements: signal_completeness, |z| percentile,
     or reweight the drawdown term. Do NOT recalibrate A — wrong tool for this term;**
   - switch riskScore to 1-2dp display THEN (decimals before the refit = false precision).
   - **⚠ ADD TO THIS REFIT — `HORIZON_TIER_CONFIG`'s cutoffs are miscalibrated live too
     (measured 2026-08-13, `scratch_liveTierOccupancy.ts`).** Same defect as the Model C
     breakpoints, in a different component: cutoffs fitted to a v9.3 *fold* distribution
     that live does not reproduce. On 418 post-parity clean live rows, against the
     design target of ~10% STRONG_BUY / ~10% BUY / ~10% SELL / ~70% HOLD:

     | head | STRONG_BUY | BUY | SELL | HOLD |
     |---|---|---|---|---|
     | D5 2W | **21.3%** | 35.6% | **3.6%** | 39.5% |
     | D3 2D | **48.3%** | — | 3.6% | 48.1% |
     | D1 3M | 12.9% | — | — | 87.1% |
     | D2 6M | — | 35.6% | — | 64.4% |

     **56.9% of live rows resolve BUY or better against a ~20% design target, and SELL
     fires on 3.6% against 10%.** D3 calls nearly half of everything STRONG_BUY. The
     stored canonical `recommendation` matches (18.7% STRONG_BUY, 32.5% BUY, 3.6% SELL),
     so this is what the system actually issues, not an artefact of recomputation. It
     dilutes the conviction signal the pots gate on — an `ambition≤3` pot needing only
     ADD-tier will clear on half the universe. Refit the cutoffs on post-parity live
     output at the same time as the C breakpoints; they share a cause and a fix.
     *Caveat: n=418 over ~4 days, and 50% of live rows are quarantined so this is a
     selected subset. Re-measure at the ~08-21 refit rather than treating 4 days as final.*
2. **Expansion cohort readouts** (`expansionReadout.ts`)
   - 2D: **✅ GATE OPEN 2026-08-24 — 10 days with ≥5 rows. VERDICT: NO SIGNAL.**
     (Gate slipped twice getting here, 08-11 → ~08-20 → 08-24, because the rule is a
     COUNT and each day needs ≥5 rows AND two days to mature. Quote day counts, never
     dates.)

     | 2D post-parity | day-IC | t | rows | days |
     |---|---|---|---|---|
     | 2026-08-13 | −0.1391 | −1.01 | 327 | 3 |
     | 2026-08-20 | −0.0395 | −0.51 | 638 | 8 |
     | **2026-08-24** | **−0.0023** | **−0.03** | 923 | **10** |

     **The trajectory is the finding, not the endpoint.** Across three measurements the
     cohort converged monotonically to **zero** and never toward the +0.083 D3 anchor.
     So the expansion symbols' 2D predictions carry **no information** — this is not a
     negative-signal result, it is a no-signal result, and the two have different
     implications (nothing to invert, nothing to salvage). Fails the readout's own
     criterion, which requires same-sign and within ~2× of the anchor.
     **2D quarantine stands, decided rather than pending.**
     Pre-parity cohort, for contrast: −0.1298, t=−2.11 over 13 days — still just short
     of the 95% bar (t-crit ≈2.18 on 12 df), and a poor prior, but a different regime.
   - **2W is the remaining question. ⚠ CORRECTED 2026-08-27 — the encouraging first
     read was noise, and it did not survive one extra day.**

     | 2W post-parity | day-IC | t | rows | days |
     |---|---|---|---|---|
     | 2026-08-24 | **+0.0604** | 0.86 | 392 | 4 |
     | **2026-08-27** | **−0.0037** | **−0.07** | 484 | **5** |

     The 08-24 figure was written up as "points the OTHER way — same sign as the +0.107
     D5 anchor, within 2×". **It was a four-day reading at t=0.86 and it evaporated
     immediately.** The ≥10-day rule exists precisely to stop four points being read as
     a direction; the rule was stated and then the number was described directionally
     anyway. Do not repeat that with the next partial read.
     Current: 5 of 10 days, day-IC ≈ 0 — now resembling 2D's no-signal result rather
     than contradicting it. Still undecided; ~5 more qualifying days → **mid-September**.
     This remains the readout the un-quarantine decision rests on.
   - 2D re-measured 2026-08-27 at **13 days: −0.0155 (t=−0.24)** — unchanged in
     substance, confirming the closed no-signal verdict as more days accrue.
   - 2W: the un-quarantine decision for the +1,183 expansion symbols. Positive day-IC
     over ≥10 days = open pots/notifications to the cohort; anything else = stays
     display-only. Pre-parity cohort IC was NEGATIVE (broken regime) — do not blend
     regimes. **Confirmed 2026-08-20: post-parity 2W has 0 matured rows**, exactly as
     expected (parity 08-09 + 14 days = 08-23 for the FIRST row). Then it needs ≥10
     qualifying days on top of that, so by the 2D item's own lesson the real 2W date is
     **well into September, not 08-23.** 08-23 is when the clock STARTS, not when it
     reads out.
3. **First expanded-scan health check** — **DONE 2026-08-13. Expansion is healthy; the
   two real findings are unrelated to it.**
   - **Runtime scaled proportionately**: main runs 8–9 min pre-expansion → 11–17 min
     post, for a 69% universe increase (1,723 → 2,906). Detection volume 87 → 108–157.
     No timeout pressure.
   - **Quarantine gate works**: 255 of 255 expansion-cohort rows carry
     `unreliable_reason` (`null_enrichment` 359, `raw_prediction_outlier` 2
     post-expansion). Nothing from the cohort can reach pots or notifications.
   - **⚠ CORRECTION — I nearly filed a false alarm here.** Pooled distinct-value counts
     appeared to show D5 collapsing 58.9% → 36.1%, the same shape as the known D4
     defect. It was an artefact: **distinct-share is not scale-invariant** (drawing more
     rows from a fixed set of achievable leaf values lowers the share combinatorially),
     and the windows had unequal n. Subsampling all windows to a matched n=91 over 400
     draws, **D5 is 80.0% distinct — healthy.** Same error class as the stamped-feature
     false headline: a ratio compared across unmatched denominators.
   - **The windows are also confounded**, which the naive comparison missed: parity
     landed 2026-08-09 12:07 UTC and expansion 2026-08-10 10:29 UTC, **22 hours apart**,
     so any "pre-expansion" window wider than that day is mostly pre-*parity* too. The
     91-row window between them is what separates them.

   Matched-n distinct-value share (n=91, 400 draws), core symbols only:

   | head | pre-parity | post-parity | post-expansion | attribution |
   |---|---|---|---|---|
   | B 1M | 8.6% | 35.2% | 30.1% | both |
   | D1 3M | 90.7% | 89.0% | 86.5% | stable |
   | D2 6M | 58.8% | 85.7% | 78.4% | both |
   | D3 2D | 80.0% | 76.9% | 81.9% | stable |
   | D5 2W | 91.4% | 84.6% | 80.0% | parity |
   | C | 56.9% | 97.8% | 90.2% | both |

   - **FINDING 1 — the parity fix measurably improved prediction diversity**: B
     8.6→35.2, C 56.9→97.8, D2 58.8→85.7. Independent corroboration that it was correct,
     from a different direction than the anchor-band check. The expansion's own effect is
     small everywhere (D5 −4.6pp, D1 −2.5pp, D3 +5.0pp).
   - **FINDING 2 — Model B and Model A are genuinely degenerate, and were before both
     changes.** This is NOT a sample-size artefact: it is capped by the *global* distinct
     count, which no subsample can exceed. **A emits 12 distinct values across 684 live
     rows** (ceiling 13.2% at n=91) — exactly the isotonic saturation already on record,
     re-measured from a new direction. **B emits 69** (ceiling 75.8%, observed 30.1%).
     B's degeneracy is consistent with its near-zero v13 fold IC (0.0045) and with
     `HORIZON_TIER_CONFIG.model_b_return_1m` being deliberately empty. Both belong in the
     retrain bundle; see the Model-A confidence-term replacement in item 1.
   - Scripts: `scratch_expandedScanHealthV2.ts`, `scratch_headDegeneracy.ts`,
     `scratch_coreDegeneracy.ts`, `scratch_degeneracyMatched.ts` (the definitive one).
4. **Native-vs-SPY benchmark adjudication** — **✅ CLOSED 2026-08-27. STAY ON SPY.
   The 2W verdict arrived and is significant under the metric that favours native.**

   | 2W (hedged — the headline) | n | eventfulness | native − SPY |
   |---|---|---|---|
   | SPY-only | 63 | **1.231** | |
   | native-only | 171 | **0.926** | −0.304, Welch **t=−2.65** |

   Raw (beta-contaminated, for contrast): −0.309, **t=−3.12**. Both directions agree.

   **The number that settles it is native-only's 0.926 — BELOW 1.000.** Eventfulness is
   normalised so 1.000 means "no more eventful than that symbol's average bar", so
   native's exclusive detections flag bars that move LESS than average. They are not
   merely worse than SPY's, they are anti-informative. Switching would trade 63 good
   detections for 171 worse-than-random ones.

   **⚠ And 2D WEAKENED as n grew — worth remembering before quoting the 08-13 figure.**
   It read −0.736 (t=−3.36) on 51/137 rows; at 101/267 it reads −0.261 (t=−1.79),
   same sign but no longer significant. The early large effect was partly small-sample.
   **2D is now NOT significant on its own; the decision rests on 2W**, which is the
   recommendation basis anyway. That is the right way round, but it is luck rather than
   design that the two agree in sign.

   *(the 2026-08-13 measurement and its methodology, kept — the eventfulness metric and
   both confound tests are still the reason this readout is trustworthy)*
   208 divergences logged 08-03→08-13 (57 SPY-only, 151 native-only). Scored as
   *eventfulness* = |forward return of the flagged bar| ÷ that symbol's mean |forward
   return| over the trailing year, so cross-market comparison is legitimate (the two
   groups hold different symbols — native-only skews .HK/.NS/.AX).

   | 2D | n | eventfulness | native−SPY |
   |---|---|---|---|
   | SPY-only | 51 | **2.06** | |
   | native-only | 137 | **1.33** | −0.736, Welch **t=−3.36** |

   **SPY's exclusive detections find bars ~2× as eventful as that symbol's average;
   native's exclusive detections are barely above a coin-toss.** Switching would add 137
   near-worthless detections and delete 51 good ones per 10 days. Two confounds were
   tested and neither overturns it: (a) the ±3-day tolerance on a +2-day horizon could
   match the flagged bar itself or earlier — fixing it *widened* the gap (t −4.62→−5.50
   pre-hedge); (b) raw returns favour SPY by construction, since SPY-only detections are
   enriched in bars where the local market moved and volatility clusters at market level
   — hedging against the native index (the metric most favourable to native) narrows
   t −4.42→−3.36 but does not invert it.
   - ~~**2W is the one that matters and has 0 matured SPY rows**… earliest ~2026-08-27.~~
     **RESOLVED on schedule 2026-08-27 — see the verdict above.** Note 39 of 102 SPY-only
     and 102 of 273 native-only 2W rows were still immature at the read, so the verdict
     rests on resolved rows only and will firm further; it will not change sign.
   - Caveat, stated in the script: this scores DETECTION QUALITY, not P&L. The
     native-only bars never entered the pipeline, so no prediction or P&L exists for
     them and none can be reconstructed.
   - **Decision: DO NOT SWITCH. `LIVE_BENCHMARK_MODE` stays `spy`. Item closed** — no
     further re-runs needed unless the detection logic itself changes.
5. **Pots ignore the trend-opposition downgrade** *(found 2026-08-13, no gate — decide
   and fix)*
   Spotted from a ledger line that reads as a contradiction: `pot 33 BUY COR … HOLD`.
   It is not a logging typo. `getRecommendation` (`LiveInferenceService.ts:997-1000`)
   applies a downgrade the pots never see — when the anomaly OPPOSES the recent trend
   with strength > 0.6, STRONG_BUY→BUY and BUY→HOLD. `resolveHorizonSignal`
   (`PotService.ts:437`) resolves its tier from the *same* `HORIZON_TIER_CONFIG`
   cutoffs but **without that overlay**, so a symbol the canonical basis has demoted to
   HOLD can still clear a pot's entry gate on the undowngraded BUY. Pot 33 is
   patience 3.5 → 2W, i.e. the *same head* as the canonical recommendation — so this is
   a genuine behavioural divergence between two consumers of one model, not a
   horizon-mismatch artefact.
   Two separate defects fall out of it:
   - **Behaviour — MEASURED 2026-08-13, and the answer points the other way. Change
     nothing yet.** Rate first: recomputing the raw tier with the real production
     resolver across all 4,157 rows since the v9.3 cutoff recalibration, the downgrade
     fires on **260 rows (6.3%)** — STRONG_BUY→BUY 156, BUY→HOLD 104 — and **4 of 59
     entry trades (6.8%)** were taken on a de-rated row (pots 5, 9, 17). My "1 of 18"
     anecdote was representative after all. Sanity check passes exactly: divergence is
     19.7% of OPPOSING rows and **0.0%** of NEUTRAL and ALIGNED, so the recomputation is
     capturing the overlay and nothing else.

     Then the question that actually decides it — is the overlay *informative*? Held
     within raw tier (so the model's own view is identical across arms) against matured
     2W outcomes from `outcome_results`:

     | | n | mean | median |
     |---|---|---|---|
     | de-rated | 51 | **+6.26%** | +4.52% |
     | kept | 441 | +1.39% | +1.06% |

     **De-rated rows do BETTER, not worse** — pooled Welch t=3.65, and it survives both
     outlier checks (medians show the same gap; trimming the best and worst row leaves
     t=3.76). Widening to alignment rather than the 0.6 threshold: OPPOSING rows return
     4.95% mean / 4.41% median vs 1.16% / 0.99% for NEUTRAL+ALIGNED, pooled t=3.91. The
     reading is that **the overlay has the wrong SIGN** — trend-opposing signals are the
     best ones at 2W, and the canonical basis both downgrades them AND haircuts their
     position size 25–50%.

     **But it does NOT survive day-clustering: t=1.59 over 8 days, OPPOSING winning
     5/8.** This project already moved its IC anchors to `TEST_IC_DAILY` for exactly this
     reason, and the pooled t=3.91 is the overstatement clustering exists to catch. So:
     **do not route the pots through the overlay, and do not flip it.** Re-run
     `scratch_trendDowngradeValue.ts` at ≥20 clustered days. If it holds, the fix is in
     `getRecommendation`, not `PotService` — and the pots ignoring it will have been
     accidentally right. Related to `notifications-2w-only-by-design`: same root shape,
     alerts and trades on different bases.
   - ~~**Audit trail:** `PotService.ts:880/949` writes `tradeReason: result.recommendation`~~
     **✅ DONE — verified in code 2026-08-16.** `tradeReasonFor(gatingTier, canonical)`
     (`PotService.ts:459`) is called at `:906` and `:975`: it records the tier that actually
     GATED the trade, appending `(canon:X)` only when the two disagree, so the common case
     keeps the historical bare-tier shape and divergences stay greppable via `canon:`. The
     record changed; no decision did. This item's text described the pre-fix state and was
     stale — the behavioural question below remains genuinely open.
   `scratch_potReasonCheck.ts` reproduces the count.

6. **Low-ambition pots can barely use the BUY tier** *(noticed 2026-08-13 while building
   the trade-reason fixture; no gate — a config question, not a bug)*
   `ambitionTier(≤3.0)` requires `minReturn` **0.03**, but D5's BUY band is
   **[0.024743, 0.031582)**. The two constraints overlap on a **~0.0016-wide sliver**, so a
   cautious pot can essentially only enter on STRONG_BUY — the BUY tier is nearly
   unreachable for it. That inverts the intended trait semantics: low ambition is supposed
   to mean *less* demanding, and here it means the pot skips an entire tier that
   higher-ambition pots (minReturn 0.12) cannot reach either, but for the opposite reason.
   Compounded by the live-cutoff miscalibration in item 1 (21.3% of live rows are already
   STRONG_BUY), the practical effect is that ambition mostly stops discriminating.
   Re-check when the cutoffs are refitted at ~08-21 — the sliver is a property of the
   cutoffs, so refitting them may dissolve or worsen it. Decide then whether
   `ambitionTier`'s `minReturn` ladder needs rescaling to the refitted distribution.

7. **✅ DONE 2026-08-16 — costModel's tax table: 11 missing exchanges filled, India
   corrected 10×, and the `BRK.B` suffix bug fixed.**
   `taxRate()` was falling through to `{ buy: 0, sell: 0, note: '… (REVIEW)' }` for
   `.SS .OL .BR .BO .HE .WA .MX .AS .SZ .TW .BK` — **27 of 105 closed pot positions**.
   All eleven now carry verified rates and the readout reports zero uncovered suffixes.

   - **⚠ THE BIGGEST FIND WAS IN A ROW THAT ALREADY EXISTED.** `.NS` read `buy: 0.0001,
     sell: 0.0001` while its own note said "India STT ~0.1% delivery both sides". **0.1%
     is `0.001`; the value was out by 10× and had understated every Indian trade since the
     table was written.** Corrected, and `.BO` added at the same rate. A wrong constant
     sitting next to a correct comment survives review indefinitely — worth a grep for
     other note/value mismatches in that file.
   - **Non-zero added:** `.SS`/`.SZ` China stamp 0.05% sell-only (halved 2023-08-28),
     `.TW` Taiwan STT 0.3% sell-only (the 0.15% day-trade rate is deliberately not
     modelled — pots hold overnight), `.BO` India STT 0.1% both sides.
   - **⚠ ZERO, and the REASON matters — do not "correct" these upward.** `.BR`, `.HE` and
     `.WA` all have headline statutory rates that **do not reach this account**: Belgium's
     TOB 0.35% attaches to Belgian *residents* or to non-residents holding via a *Belgian
     intermediary*; Finland exempts listed shares bought through a foreign remote
     intermediary; Poland's PCC 1% exempts trades executed through a brokerage in
     organised trading. `.AS`/`.OL`/`.BK` levy nothing. `.MX` levies no *transaction* tax —
     its 10% BMV withholding is a tax on GAINS and out of scope for a field that
     multiplies position value. **What is modelled is what a UK-resident IBKR account
     pays, not what the venue's jurisdiction levies.** If residence or broker domicile
     changes, revisit `.BR`/`.HE`/`.WA`.
   - **`suffixOf` fixed** (`costModel.ts`): it split on the last `.`, reading **`BRK.B` as
     exchange `.B`**. Now the known-suffix lookup runs first (length cannot discriminate —
     `.L`/`.T`/`.F` are one-letter *exchanges*), and only an otherwise-unknown single
     trailing letter is treated as a US share class. Multi-character unknowns stay on the
     loud REVIEW path.
   - **Blast radius beyond the pots:** `outcomeScoreboard`, `readoutHarness`,
     `topBuysReport`, `dsrPboAudit` and `dumpPotCosts` all share this cost model, so every
     net figure any of them has previously reported was understated. Re-run before quoting
     any of them.

## Housekeeping

- **`npm run lint` was red all day and is now green** (fixed 2026-08-13). 12 errors, all in
  `scratch_expandedScanHealth.ts`: its select list is built by string concatenation, so
  supabase-js could not infer the row shape and widened `data` to its error union, making
  every field access a type error. Fixed with an explicit cast. Worth noting because a
  permanently-red typecheck cannot be used as a gate — it trains you to ignore it, and the
  next real error hides in the noise.

## CI verification 2026-08-11 — done, and it found two live bugs

Hand-triggered `pit-snapshot.yml` (run #2, first dispatch ever; run #1 was the
2026-08-09 cron and predated all three new capture scripts). Result: **all nine capture
steps passed** — FINRA short volume, Form 4 and the new-listings watcher all work in CI.
Two defects in the plumbing around them did not:

1. **The commit step failed and discarded everything the run captured** (fixed).
   `git add -- <11 paths>` exits 128 when ANY pathspec matches nothing, before staging
   anything — so one absent file threw away the other ten. `src/autoListings.json` is
   only written when the watcher ADMITS a listing, and admitting nothing is its normal
   post-baseline state, so this would have failed every Sunday until some future
   admission happened to create the file. Introduced in `defe2ad`; run #1 passed because
   that path was not in the list yet. Now stages only paths that exist, via
   `if [ -e "$f" ]; then …; fi` — **not** `[ -e "$f" ] && …`, which under Actions'
   `bash -e` fails the step whenever the last iteration's test is false.
2. **The fail-loudly step was itself skipped** (fixed). Actions skips remaining steps
   after a failure, so the step added this week to name the broken source never ran —
   precisely when something had broken. Now `if: always()`.

**Rule this establishes: a CI-reachable script must open `market_cache.db` READONLY, or
not at all.** Sharper than the old "no CI script may touch that DB". `new Database(p)`
read-write CREATES an empty file (this is what `db.ts` does on import), whereas
`{ readonly: true }` throws on a missing file. `buildClinicalTrials` branched on
`existsSync(dbPath)`, so a sibling that imported `db.ts` first left it an empty-but-valid
DB, it queried zero rows, and it overwrote the TRACKED roster with 0 candidates —
after which every later run reads the empty roster and writes an empty snapshot, exit 0,
green, forever. Only step ordering prevents this today (the watcher runs five steps after
ClinicalTrials). Hardened `21d861c`-style at the builder instead: a zero-row query no
longer overwrites the cache, and a zero-length roster is now fatal (existence was never
the real guard). Verified both ways in a worktree replica of `actions/checkout`.

**`SEC_CONTACT` is configured** — confirmed from run #1's commit (`8f5e6aa`), which
contains `cik_ticker_map.json` + `symbol_delistings.json` stamped
`_built 2026-08-09T07:08:2xZ` against a 07:08:29 commit. Both are produced only by
`buildDelistings.ts`, which is gated behind that secret, so the Form 4 and new-listings
steps (same gate) will run. `COMPANIES_HOUSE_API_KEY` likewise. Note the gated steps
report `success` whether they run or skip, so artifact `_built` stamps — not step
conclusions — are the way to tell.

**Minor, open:** `buildDelistings` reads the local DB only to set `inUniverse`, so every
delisting captured in CI is flagged `inUniverse: false` ([buildDelistings.ts:159](src/scripts/buildDelistings.ts#L159)).
It degrades loudly and non-destructively — the delisting records themselves are captured,
which is the irreplaceable part — but the artifact is append-only merged on accession, so
CI-written records likely keep the wrong flag even after a later local run. Recomputable
from the symbol at wiring time.

## New capture builds — DONE 2026-08-10, wiring stays retrain-gated

- ~~FINRA daily short-sale volume~~ **built** (`buildShortVolume.ts`, weekly): 1,421 US
  symbols, 1d/5d/20d off-exchange short ratios. FINRA archives raw files to 2009 →
  full training backfill possible at wiring time.
- ~~SEC Form 4 insider transactions~~ **built** (`buildInsiderForm4.ts`, weekly):
  daily-index diff → issuer-confirmed XML parse; 45d rolling ledger + 30d aggregates
  (all-codes net + open-market P−S). First run: 442 filings, 1,006 txns, 210 symbols.
  Replaces stale-frozen FMP `insider_net_shares_30d` at the retrain.

## Pot ledger: FX residue repair — APPLIED (2026-08-12), verified 2026-08-13

**Status: done.** The repair and the snapshot correction were both applied. The phantom
£11,995 is gone and the real result is slightly negative — consistent with the trial log's
negative live Sharpe.

**⚠ The figures once recorded here (n=84, £−43, −0.448%/trade, 40% win, 2026-08-13) are
STALE — the ledger keeps moving, three live scans a day.** As of **2026-08-16**: **105
closed trades**, of which **91 are sizing-reliable** (see the resolved top-of-queue item);
on that admissible basis **gross −0.479%/trade, 42% win, gross P&L £−115.05**, and
**net of costs −0.971%/trade**. All-105 gross P&L is £−111.73. Any figure quoted from this
section must carry its date and its basis. `potLedgerNet.ts` regenerates all of it.
**⚠ `scratch_potSnapshotFxOnly.ts --apply` is NOT idempotent — never re-run it**; it would
double-apply the deltas.

Original finding, kept for the record:

**~96% of live pot P&L is an artefact.** Four pre-F8 `.NS`/`.BO` positions closed
2026-07-15/16 with a native-INR exit price against a GBP-converted entry, giving
~12,000-14,000% phantom returns worth **£10,844 of the £11,995 total**. Cleaned, the real
result is **£446 over 73 trades, pooled mean +0.008%/trade, 42% win** — indistinguishable
from zero and consistent with the trial log's negative live Sharpe.

**The CODE IS CORRECT** — `potResults` are converted at `LiveInferenceService.ts:1612`
and the fetch path converts at `PotService.ts:1256`. F8 (`934a36e`, 2026-07-14) repaired
open positions and the 10 that closed on 07-14; it missed these 4. No position entered
post-F8 is broken and no open position is affected — but note there have been NO INR
closes since 07-16, so that is absence of evidence, not proof the exit path is exercised.

Repair is data-only: `scratch_potFxRepairPreview.ts` (dry run by default, `--apply` to
write). Verified against siblings — `500510.BO` repairs to exit 30.8463, byte-identical to
the same stock's 07-14 closes; all three pots return to ~£10,000 starting balance.
**BLOCKED: the write needs a human to run it (permission classifier denies live-DB writes).**

**Second half — snapshots. NOT cosmetic:** `realised_pnl_cumulative` is a running
accumulator (`PotService.ts:819` = prev + thisRun) that never recomputes, and
`portfolioValue = starting_balance + totalRealisedPnl` (`:822`) feeds
`positionGBP = portfolioValue / focus` (`:850`) — so until corrected, pots 3/10/13 size
every new position off phantom profit (~37% / 48% / 23% too large). Fix = 140 rows via
`scratch_potSnapshotFxOnly.ts --apply` (deltas −£3,677 / −£4,834 / −£2,333 from 07-15/16).
**Still pending as of 2026-08-12.**

**⚠ DO NOT "repair" snapshots by recomputing cumulative from positions.** That was the
first approach and it was wrong in the dangerous direction — it flagged 691 rows across 11
pots and would have silently undone a deliberate reset while looking authoritative.
Investigated (`scratch_potDriftInvestigation.ts`, `scratch_potDeletionCheck.ts`,
`scratch_potDrift0707.ts`): only **14 days** ever disagree, in three mechanisms:
  1. the FX bug itself (4 days, pots 3/10/13) — what the targeted fix addresses;
  2. the F8 backfill repairing positions out-of-band without touching the accumulator
     (pots 15/5/17 `manual_correction` days + pot 2's 06-17 close, ~£30 net) — below the
     noise floor;
  3. **2026-07-07: the accumulator was REBASED TO 0.00** for every pot (pot 2 £380.95→0,
     pot 3 −£350.88→0, pot 4 −£189.73→0, pot 19 £267.33→0). That is the v9.2 retrain date
     (`14a3417`, D3/D4/D5 relabelled) and pots trade those signals, so resetting the P&L
     clock on a model change is defensible. `pot_positions` keeps full history, so the two
     measure different windows BY DESIGN.
After the targeted FX fix everything reconciles — pot 3's £351 residual is exactly its
pre-rebase 3968.HK stop-loss, pots 10/13's are rounding. **There is no accumulator defect.**
Consequence to remember: pot cumulative = "since the 2026-07-07 rebase", position-sum =
all-time. Do not compare them without saying which.

~~**Also found:** `Glass Hands` / `The Stoic` clone symptom~~ **RESOLVED 2026-08-13 —
benign** (`scratch_potCloneCheck.ts`). They hold **12 identical positions** (same symbol,
entry date, direction) differing only in SIZE: `positionGBP = portfolioValue / focus`, so
focus 8 sizes at 1/8 and focus 10 at 1/10. Pot 8 holds 2 extra (TGT, CTAS) purely because
its focus cap is higher. Identical % returns follow necessarily from identical instruments
over identical windows, and £ P&L differs by exactly the sizing ratio. Not the P1 clone
defect; traits ARE influencing behaviour, there just were not enough qualifying signals to
exceed either pot's focus cap, so both took everything on offer.

**But it confirms the roster-overlap limit empirically.** Only **30 distinct symbols across
17 pots** with open positions, and the top names are held very widely — TRV by 7 pots,
SHEL and O by 5, AVB and PLD by 4. Pots trade the SAME signals, so extra pots buy
resolution on settings, not extra independent market observations. Treat pot-level results
as heavily correlated: N pots is nothing like N independent samples, and any significance
test across pots must not assume it is.

### Which live pots to keep as the comparison arm
Selected on **evidence value, not measured success** — after cleaning, 9 of 20 pots have
never closed a trade, only 3 have n>=8, and no pot's t-stat is meaningful. Ranking on this
is the same selection-on-noise trap as the 770k sweep with a far worse sample.

| keep | n | horizon | boldness | why |
|---|---|---|---|---|
| The Scattergun | 20 | 2W | 8.5 | most data |
| The Scanner | 14 | 2W | 8.5 | most data |
| The Reckless Flipper | 13 | 2W | 8.5 | most data |
| The Monk | 7 | 2D | 1.5 | only 2D pot with data; low-boldness end |
| The Hedgehog | 6 | 1M | 3.5 | 1M = the horizon the sim calls harmful — negative control |
| Glass Hands | 3 | 3M | 5 | 3M coverage (drop `The Stoic`, its clone) |

All three data-rich pots are boldness 8.5 with ratio <1, so they cannot test boldness or
the ambition/reactivity ratio — which is exactly what the new roster's one-factor-at-a-time
design is for.

## Re-extraction source — RESOLVED 2026-08-13: keep `event_features`, do not change line 301

Framed for weeks as "which table should `feature_extractor.ts:301` SELECT FROM". Measured,
and **the framing was wrong — it was never a FROM-clause swap.**

| table | rows | what it holds |
|---|---|---|
| `event_features` | 66,883 (66,834 usable) | **the only table with `features_json` + `signal_snapshot_json`**, i.e. every enrichment feature |
| `event_features_daily` | 303,159 | price/technical columns only — no enrichment, no `cache_key`, no `primaryCategory` |
| `training_events_v11` | 338,099 | same, plus provenance (`price_source`, `reproduced`, `legacy_only`, `has_premium`) |

1. **The alternatives are not drop-in.** Both lack `features_json`, `signal_snapshot_json`,
   `primaryCategory`, `cache_key` and the pre-event lookback columns. Pointing line 301 at
   either does not compile, and if forced through it would turn the model **purely
   technical** — dropping news, insider, price-target, short-interest, GDELT, options and
   every other enrichment feature at once.
2. **The join that would combine both does not work, for a structural reason.** Enrichment
   is already stored and needs no re-fetching (FMP premium expired 2026-07-06 and must
   never be re-run), so joining `event_features` enrichment onto clean `training_events_v11`
   prices on (symbol, date) looks like the obvious fix. It retains **633 of 16,435 enriched
   pre-2021 rows — 3.9%** — despite 235,227 pre-2021 `daily_reextract` rows existing. The
   keys do not meet: an event detected from a MONTHLY bar sits on a different date than
   events detected from daily bars, so **the corrupt rows are corrupt in their identity,
   not just their values.** Better prices cannot be joined onto a date that should not
   exist. (Post-2021 retention is 62%, but post-2021 was never the corrupt era.)
3. **The two remaining options were already measured against an honest baseline** (v13,
   `ae6c919`): dropping pre-2021 rows costs **−0.0060**; the union costs **−0.0111**. Status
   quo wins both. Note the union arm is a *confounded* test of clean bars — its own comment
   says pre-2021 rows carried "premium NaN", so it changed bar granularity AND deleted all
   enrichment on those rows simultaneously. That confound no longer matters, because (2)
   shows the unconfounded version is not constructible.

**Decision: line 301 stays.** The committed null-label fix (`02c0929`) is inert but correct
and applies whenever extraction next runs. What the retrain bundle should actually carry is
the leakage-free `EXCLUDE_COLS`, not a source change. Scripts: `scratch_sourceCompare.ts`,
`scratch_joinViability.ts`.

### `event_features` staleness — CHASED DOWN 2026-08-13. Not maturity gating, and the refresh is UNSAFE.

Both candidate causes are now settled, and the answer is worse than either.

- **Not maturity gating.** The table plainly accepts immature rows — `forward_return_12m`
  is NULL for every row after 2025-06. Daily counts through June are a **cliff, not a
  taper**: 55, 27, 21, 27, 29 per day to 06-05, then 1–5/day, then nothing after 06-18.
- **The writer is manual.** `setEventFeatures` (`db.ts:1086`) has exactly three callers —
  `HistoricalEngine.ts:676`, `EnrichBackfillService.ts:357`, `server.ts:474`. **No
  workflow runs any of them** (the five are keep-alive, live-inference, outcome-tracker,
  pit-snapshot, watchlist-pulse). The training table was only ever fed by hand, and the
  last run was ~2026-06-18. Nothing is broken; nothing was ever scheduled.
- **⚠ REFRESHING IT WOULD DESTROY THE PREMIUM DATA.** `HistoricalEngine.ts:1549` calls
  `getFullCompanyContext()` — the exact call the standing constraint forbids — and
  `setEventFeatures` is `ON CONFLICT(cache_key) DO UPDATE SET features_json =
  excluded.features_json`. On the free tier that call returns nulls, so a re-run would
  **overwrite irreplaceable premium enrichment with empty values** on every cache_key it
  touches. FMP premium expired 2026-07-06 and cannot be repurchased retroactively.
  **Do not re-run HistoricalEngine to refresh training data.** Any future refresh needs a
  new writer that adds rows without calling the premium path, and never UPDATEs an
  existing cache_key. Not built; not urgent (see below).
- **Cost of the staleness is smaller than it looks.** Labels need maturity anyway, so the
  usable training frontier always trails: ~2 weeks for D5, a year for E. An event table
  ending 06-18 costs roughly six weeks of short-horizon rows, not eight weeks of
  everything.

## v14 retrain on corrected labels — RUN 2026-08-13. DO NOT DEPLOY. v9.4 stays.

Re-extracted `features.csv` with the null-label fix (`02c0929`) and retrained under the
production protocol, 4 folds × 5 heads × 3 arms = 60 models
(`scratch_v14_nulllabels.py`, results in `src/ml/scratch/v14_nulllabels_results.csv`).
Row alignment asserted identical between old and new CSVs, so "corrected labels" cannot
smuggle in "different sample".

Mean day-clustered IC, corrected test basis:

| head | v94-old | honest-old | honest-new |
|---|---|---|---|
| B 1M | 0.1321 | 0.1351 | 0.1334 |
| D1 3M | 0.1025 | 0.1025 | 0.1008 |
| D2 6M | 0.0607 | 0.0629 | **0.0684** |
| D3 2D | 0.1777 | 0.1756 | 0.1713 |
| D5 2W | 0.2809 | 0.2745 | **0.2629** |

**`honest-new` vs `honest-old`: −0.0028 mean, wins 10/20 head-folds.** A coin flip. The
one coherent signal is that **D2 — the most contaminated head (57.9% fabricated test
labels in the last fold) — is the one that improves (+0.0055)**, while D5, barely
contaminated at 1.2%, degrades. That is the direction the mechanism predicts, but it does
not add up to a deployable gain.

**⚠ AND IT CORRECTS MY OWN ALARM.** I called the fabricated-label discovery "the most
consequential thing found today" on the strength of the contamination percentages. The
measurement says otherwise: scoring `v94-old` on both bases, **the anchor shift is
≤0.0055 everywhere and ~0.002 typically** — including in the 57.9%-fabricated D2 fold
(−0.0020) and the 98.7%-fabricated E case. The reason is mechanical: day-clustered IC is
a *rank* correlation, so a block of rows all sharing exactly 0.0 is a tie that
contributes almost nothing, and `daily_ic` skips any day where `y.nunique() < 2`
outright. **The rank metric absorbed the contamination.** The bug was real in the data
and nearly invisible in the measurement.

**Keep the fix anyway** — training a model to predict a fabricated zero is wrong on its
own terms, and it costs nothing. Just do not expect performance from it, and do not
re-run the extraction expecting the anchors to move.

**Untested and worth one follow-up:** IC is rank-based, but `HORIZON_TIER_CONFIG`'s
cutoffs are *absolute* values. A model trained on ~9,858 fabricated zeros could carry a
different prediction distribution even at identical IC, which would shift where the
STRONG_BUY/BUY/SELL breakpoints land. That is a calibration question this run did not ask.

## v17 calibration check — ANSWERED 2026-08-13: label fix is immaterial, cutoffs are not

The question v14 could not answer. Day-clustered IC is a *rank* correlation and therefore
rank-invariant: a model whose predictions are uniformly shifted scores identically. Every
tier decision is the opposite — `HORIZON_TIER_CONFIG`'s cutoffs are **absolute**. Training
on ~9,858 rows asserting "outcome exactly 0%" is a systematic pull toward zero, exactly
the change IC cannot see and thresholds are maximally exposed to.

**Answer: no.** Tier occupancy barely moves between old and corrected training —
D5 +2.4pp STRONG_BUY, D3 −1.1pp, D1 +0.2pp, D2 +0.0pp. The null-label fix is confirmed
immaterial for routing as well as for IC. That closes the last open thread on it.

**Two things the check turned up that matter more, and one caution about my own harness:**

1. **The deployed cutoffs are badly miscalibrated live** — folded into near-term item 1
   above, since it shares a cause and a fix with the Model C breakpoint refit.
2. **Fold-trained models and the live model produce very different distributions.** My
   protocol-trained D5 has median **−0.0205** and puts 86.6% of the fold below the SELL
   cutoff; the deployed model live has median **+0.0261** and 3.6% SELL. Opposite ends.
   Some of that is population (live scores only detected, unquarantined anomalies in one
   4-day window; the fold is the last 15% of 2021-2026), but the size of the gap is a
   standing warning: **cutoffs derived from a fold are not transferable to live**, which
   is the same lesson as `live-vs-fold-distribution-gap` and the pinned drawdown term.
   Any refit must be fitted on live output, never on fold percentiles.

Script: `scratch_v17_calibration.py` + `scratch_liveTierOccupancy.ts`.

## Power budget — what actually buys statistical power (measured 2026-08-13)

`scratch_powerBudget.ts`. If sample size is the binding constraint, the question is which
lever moves it. `t = IC / (sd/√D)`, and `var(daily IC)` splits into **sampling noise**
(how badly one day's IC is estimated from n symbols, ≈1/(n−1)) and **genuine day-to-day
variation** (the market actually differing). Measured live:

| horizon | days | sym/day | sampling | genuine |
|---|---|---|---|---|
| 2D | 26 | 100 | 45.4% | **54.6%** |
| 2W | 19 | 87 | 33.5% | **66.5%** |

**Breadth is real but capped.** Two-thirds of 2W's daily-IC variance is genuine variation
that no amount of scanning touches. Days-to-t=3 for 2W: 31 at today's breadth, 26 at 2×,
**21 at infinite** — a 32% ceiling on the entire lever. The 1.7× universe expansion buys
perhaps 10–15%. Worth having; does not change the timeline.

**IC enters quadratically, so raising IC beats gathering data.** days ∝ (sd/IC)², so
+10% IC ⇒ −17% days, +20% ⇒ −31%, +30% ⇒ −41%. **A 20% better IC is worth roughly the
same as infinite breadth.**

**⚠ DEMOTED 2026-08-16 — this was written as "the highest-leverage item on the backlog and
it is not gated on any date", and its own follow-up experiments have since overtaken it.**
The principle stands; the two concrete levers it pointed at do not. The `top-of-book-rank-
stability` ensembling lead was tested in v15 and nets **+0.0043 on 12/20** against the
production baseline — averaging does beat its own members (+0.0055, 15/20) but the members
are individually worse (−0.0011), so the ensemble spends its gain climbing back to par. The
D5 subsampling lead that came out of the same run was **refuted outright** by the
pre-registered v16 confirmatory test (mean Δ −0.0108, 2/6 folds, sign test p=0.89).
**This is no longer a shovel-ready item — it needs a NEW idea, not another run.** Do not
re-read the sentence above as an instruction to re-try ensembling.

**⚠ AND THE HONEST NUMBER IS WORSE THAN ALL OF THESE.** Day-clustering fixed correlation
*within* a day and does nothing about correlation *across* days: consecutive run_dates'
2W outcomes share 13 of their 14 days, so D days is nowhere near D independent
observations. **Every "days for t=3" above is an optimistic floor**, and more so at longer
horizons. Fixing it needs Newey-West at lag = horizon, or non-overlapping sampling; 19
days is far too few to estimate the autocorrelation, so it is flagged, not applied.
Re-check once post-parity data accumulates — and note this applies to the recorded
`TEST_IC_DAILY` anchors too.

Measurement caveat: matured live outcomes are **entirely pre-parity** (2W needs 14 days;
parity landed 08-09, so nothing post-parity has matured — 0 days for 2W, 1 for 2D). The
split above is therefore measured on the known-broken regime. The *sampling* term is
purely combinatorial in n and robust to that; the *genuine* term may move. `outcome_results`
holds only 2D/1M/2W — 3M and 6M simply have not matured yet (live inference starts ~July
2026), which is expected, not a gap.

## v15 ensemble — RUN 2026-08-13. The ensemble is weak; the SUBSAMPLING is the finding.

`scratch_v15_ensemble.py`, 4 folds × 5 heads × 7 fits = 140 models, day-clustered,
leakage-free features, corrected labels. **Validity check passed first**: production
params are `subsample=1.0, colsample_bytree=1.0`, which makes XGBoost deterministic, so
members differing only by seed would have been byte-identical and any null result
meaningless. Diversity was introduced (0.8/0.8) and then *verified* — mean pairwise
prediction correlation **0.700**.

vs the production baseline (mean Δ, head-folds won):

| arm | Δ | won |
|---|---|---|
| `bag1` (one bagged member) | +0.0006 | 11/20 |
| `ens3` | +0.0026 | 10/20 |
| `ens5` | **+0.0043** | 12/20 |
| `best_member` (hindsight, not deployable) | +0.0133 | 16/20 |

**Averaging does beat its own members: +0.0055, 15/20.** The variance-reduction mechanism
is real and replicates `top-of-book-rank-stability`. But **against the production baseline
the whole ensemble is only +0.0043 on 12/20 — barely better than a coin flip**, because
the members are individually *worse* than the production fit (`member_mean` −0.0011). The
ensemble spends its gain climbing back to par.

**The actual finding is head-specific and is not about ensembling at all.** Mean IC by
head shows the effect is concentrated:

| head | prod | bag1 | ens5 |
|---|---|---|---|
| B 1M | 0.1334 | 0.1132 | 0.1264 |
| D1 3M | 0.1008 | 0.1033 | 0.1138 |
| D2 6M | 0.0684 | 0.0671 | 0.0545 |
| D3 2D | 0.1713 | 0.1646 | 0.1705 |
| **D5 2W** | **0.2629** | **0.2915** | **0.2933** |

**For D5 — the live recommendation basis — simply adding subsampling gains +0.0286 (bag1
vs prod), in 4 of 4 folds** (+0.0177, +0.0216, +0.0065, +0.0686). `ens5` adds almost
nothing on top of `bag1`, so this is a **hyperparameter result, not an ensemble result**:
`subsample=1.0` is simply the wrong setting for D5. That is ~+11% relative IC, worth
roughly −19% days-to-significance under the quadratic rule. It **hurts B (−0.0202) and
D2 (−0.0013)**, so it is not a global config change.

**REFUTED 2026-08-13 by the pre-registered confirmatory test (v16). Do not deploy.**
`scratch_v16_confirm_d5subsample.py`, pre-registration committed at `e02fe56` *before*
the run, on six fold windows entirely before 2023-06-01 — disjoint from every v15 test
row.

| fold | train | prod | bag (mean of 5 seeds) | Δ |
|---|---|---|---|---|
| 2021-07-01 | 16,139 | +0.0935 | +0.0552 | **−0.0383** |
| 2021-11-01 | 16,484 | +0.0680 | +0.0551 | −0.0129 |
| 2022-03-01 | 25,500 | +0.1902 | +0.1871 | −0.0031 |
| 2022-07-01 | 33,165 | +0.2955 | +0.2709 | −0.0246 |
| 2022-11-01 | 37,450 | +0.2189 | +0.2296 | +0.0108 |
| 2023-03-01 | 39,902 | +0.2107 | +0.2139 | +0.0032 |

**Mean Δ −0.0108, bagging wins 2/6, sign test p=0.89.** Not merely absent — the sign
*reverses* against v15's +0.0286. The pre-registered rule required >0 mean and ≥75% of
folds; it got a negative mean and 33%. **The v15 result is best explained as the
best-of-five selection effect**, which is exactly what the confirmatory test was built to
detect. Without it, a +11% D5 IC improvement that does not exist would have gone into the
retrain bundle.

**A lead, explicitly NOT a rescue of the original claim:** Δ correlates with training-set
size (Spearman ρ≈0.77 over these six folds; the two largest training sets are the only
two positive ones, and v15's folds all had 42k–56k training rows). A plausible mechanism
is that `subsample=0.8` costs effective data when data is scarce and helps once it is
plentiful. **This is a post-hoc story generated after seeing the refutation, ρ is not
significant at n=6, and it is the precise species of reasoning that produced the false
result in the first place.** It is recorded as a hypothesis needing its own
pre-registered test, not as a finding, and the standing verdict remains: production
params stay.

Caveat worth chasing: `member_corr` is exactly **1.000** for D1 and D2 in fold 4, i.e.
subsampling produced identical members there despite 0.8/0.8. Probably early stopping
after very few rounds. It makes those two cells uninformative rather than wrong.

## October checkpoint / v-next retrain bundle
*(gate: the 2W checkpoint verdict, ~October — nothing here ships alone; one retrain
batches all of it, then the checkpoint clock restarts once)*

- v12 async-close fix (the one POSITIVE replicated arm: +0.0011 mean, D1/D5 strongest).
  Do NOT bundle the VIX fix arm — it dragged the combined arm down.
- Sector one-hot fix: every CI row serves `sector_Other` (enrichment sector never
  reaches the vector; local-DB lookup is empty in CI). Measured cost ~free except
  D3 −0.022 (ns) — but fix at retrain so live matches training.
- primaryCategory fix: every CI row serves `market_structure`. Measured ~free
  (B/C never split on it; D1/D2/D5 ≤0.005). Needs the category mirrored into
  Supabase snapshots or a live classifier port.
- ~~**THE 2026-08-01 RE-EXTRACTION WAS NEVER WIRED INTO TRAINING**~~ **RESOLVED
  2026-08-13 — see the "Re-extraction source" section above. Line 301 stays; the join that
  would have made a source swap meaningful retains only 3.9% of the rows it exists to
  repair, because the corrupt rows' event DATES are themselves artefacts of monthly bars.
  `features.csv` has since been regenerated (2026-08-13) with the null-label fix applied.
  The text below is the original framing, kept because the reasoning is still the
  reason the answer is "no".**
  `reextractDailyEvents.ts` (`1e4071a`) rebuilt every event from true daily bars into
  `event_features_daily` (303,159 rows, 1,429 symbols, to 2026-07-31) and
  `buildUnifiedTrainingSet.ts` merged it into `training_events_v11` (338,099 rows). But
  **`feature_extractor.ts:301` still reads `FROM event_features`** — the original table.
  Proof: `features.csv` was last written 2026-07-07, ends 2026-06-18 (= `event_features`'s
  max date, NOT `event_features_daily`'s 2026-07-31), and is still **24.6% pre-2021**
  (16,435 of 66,834 rows) — the corrupt monthly/quarterly-bar era. So v9.4/v9.5 train on
  the corruption the re-extraction exists to remove. Same shape as the FINRA/ClinicalTrials
  failures: the work was done and never connected.
  **NOT a one-line change — it is a decision.** `event_features` (28 cols) carries the
  irreplaceable FMP premium fields; `event_features_daily` (32 cols) has none;
  `training_events_v11` (36 cols) is the union with `legacy_cache_key` to reach premium by
  join. And the v11 evaluation REJECTED adopting the union wholesale (no scheme won a
  majority; union helps B, hurts D1/D3) — but "use clean bars" is a different question from
  "add the extra rows", and the surviving v11 result was that **B is rescued by removing
  the corrupt rows.** Decide the source explicitly at the retrain; do not silently swap.
- ~~**Immature forward labels are stored as 0.0**~~ **FIXED 2026-08-13** in
  `feature_extractor.ts` — null targets now serialise as EMPTY, not 0, so pandas reads NaN
  and `train_all_models_v9.py:308`'s `dropna(subset=[label_col])` drops them for EVERY
  head. Takes effect when `features.csv` is regenerated (see the wiring item above).
  Evidence that made it conclusive: inside each horizon's maturity window the exact-zero
  rate was **100%** (1M 12/12, 3M 1189/1189, 6M 3830/3830, 12M 7115/7115) — impossible for
  a continuous series — and 6,782 of 6,863 zero-valued 6M labels already carried
  `forward_return_6m_is_null = 1` with no flagged row holding a non-zero value.
  Short horizons were RE-SCOPED: 2D/2W/1d/3d/1w have **zero rows inside their maturity
  windows**, so their exact-zeros (2D 8.1%, 2W 1.6%) are genuine flat closes on illiquid
  names, not the defect. The earlier "12.2% of 6M, 1.6% of 2W" framing overstated the
  short horizons. `*_is_null` columns are already excluded from the feature set
  (`train_all_models_v9.py:383` drops them), so there is no leakage and no downstream
  feature-set change.
  *(superseded detail below, kept for provenance)*
  `feature_extractor.ts:426` serialised targets with `v === null ? 0 : v` —
  the zero-fill convention used for features, which on a LABEL turns "outcome not yet
  known" into "the outcome was exactly 0%". `train_all_models_v9.py:308`'s
  `dropna(subset=[label_col])` cannot catch `0.0`, so the rows are kept. Scope: 6M 12.2%
  (5,528 rows), 2D 9.1%, 3M 7.5%, 1M 4.5%, **2W only 1.6%** (rec basis, least affected).
  Fix = write empty rather than 0 for null targets, then re-extract. Test at the same
  time whether the 12% fake-zero mass in D2/6M contributes to Phenomenon-2 leaf
  convergence — D2 is both the worst-affected head and the most convergent one.
- **Horizon conventions are inconsistent across the codebase** (surfaced by the same
  work): `calculate_forward_returns.ts` uses CALENDAR-day offsets (2D=+2, 2W=+10,
  3M=+91, 6M=+182) while `reextractDailyEvents.ts` uses 21 TRADING BARS for 1M. Not
  wrong per se, but any new code touching horizons must match per-horizon rather than
  assume a uniform rule (2W is 10 days, not 14).
- **HORIZON EVIDENCE from the historic-pots study (2026-08-11) — inputs, not actions.**
  Three independent methods agree 2W carries the signal, which independently validates
  `getRecommendation`'s hardcoded D5/2W basis: benchmark-neutral alpha (2W +0.630% vs
  1M +0.195%, 2D −0.092%), P&L per trade (2W £894 vs 1M £127, 2D £89), and the fact that
  the best trait configurations are the ones routing capital into 2W. Long horizons are
  mostly BETA — at 3M, 5.65 of 5.78 points is market drift. **1M is actively harmful as a
  home horizon (−0.145%).** If the October verdict prompts any basis change, this is the
  evidence base; do NOT widen to multi-horizon selection (see next item).
- **Do NOT build dynamic horizon selection.** The `opportunistic` trait (chase the
  best-predicted horizon vs stay at the patience-native one) was tested four independent
  ways — per-event covariance, bootstrap CIs over events, net-of-cost, and a permutation
  null inside a capital-constrained backtest — and chasing destroys the edge every time.
  At full resolution it is a CLIFF: w_chase 0.0/0.1/0.2 are bit-identical (+0.242%), decay
  starts at 0.4, negative by 0.6. Mechanism: chasing dumps ~87% of trades into 1M, the
  worst horizon. An automated broker should trade ONE committed horizon.
- **⚠ RESULT 2026-08-13: removing the stamped features COSTS IC. Do not ship it alone.**
  Six-arm, 4-fold, production protocol, anchor-reproducing control (120 models,
  `scratch_v11_candidate.py --folds`, results in `scratch/v11_candidate_folds.csv`):

  | arm | mean delta | head-folds won | B | D1 | D5 (live) |
  |---|---|---|---|---|---|
  | `v94-control` | — | — | +0.0064 | +0.0787 | **+0.0962** |
  | `v94-nostamp` (leakage removed) | **−0.0060** | 7/20 | −0.0112 | +0.0785 | +0.0936 |
  | `v11-rowsonly` (drop corrupt pre-2021) | **+0.0005** | **9/20** | **+0.0238** | **+0.0870** | +0.0834 |
  | `v11-cand` (both) | −0.0101 | 4/20 | +0.0115 | +0.0768 | +0.0764 |
  | `v11-cand-ne` (both + non-events) | −0.0091 | 9/20 | +0.0166 | +0.0653 | +0.0810 |
  | `v11-union` (replace pre-2021) | −0.0063 | 7/20 | +0.0114 | +0.0738 | +0.0985 |

  **⚠ THAT `v94-nostamp` NUMBER IS CONFOUNDED — superseded by the v13 run.** The harness's
  `STAMPED` list was `['stocktwits_virality_z', 'price_target_consensus']`, so the arm
  removed **one genuine leak plus one feature that is not stamped at all** (measured 1.5%
  constant) while leaving **five genuine leaks in place**. And `gdelt_tone_z`, though
  stamped at 97.2%, never reaches the model (already in `ZERO_FILL_COLS`), so the true
  leakage set that the model actually receives is **six**: `price_target_upside_pct`,
  `insider_net_shares_30d`, `price_target_consensus`, `eps_surprise_pct`,
  `revenue_surprise_pct`, `vix_close`. The −0.0060 therefore does not measure "the cost of
  removing leakage". Re-run properly as `scratch_v13_leakagefree.py`, which also carries a
  `honest-nodead` arm as a harness validity check (dropping 7 provably-inert columns must
  change nothing — confirmed byte-identical to `honest-control`).

  ### ✅ v13 VERDICT 2026-08-13 — removing the six real leaks is nearly FREE (−0.0007)

  | arm | mean delta vs v9.4 | vs honest-control | B | D1 | D2 | D3 | D5 (live) |
  |---|---|---|---|---|---|---|---|
  | `v94-control` | — | +0.0007 | 0.0064 | 0.0787 | 0.0612 | 0.0725 | **0.0962** |
  | **`honest-control`** (6 leaks gone) | **−0.0007** | — | 0.0045 | **0.0860** | 0.0520 | 0.0730 | **0.0958** |
  | `honest-nodead` (validity check) | −0.0007 | 0.0000 | 0.0045 | 0.0860 | 0.0520 | 0.0730 | 0.0958 |
  | `honest-rowsonly` | −0.0067 | **−0.0060** | 0.0146 | 0.0782 | 0.0360 | 0.0653 | 0.0875 |
  | `honest-union` | −0.0118 | −0.0111 | 0.0109 | 0.0672 | 0.0370 | 0.0467 | 0.0940 |
  | `honest-rows-ne` | −0.0169 | −0.0162 | 0.0069 | 0.0585 | 0.0303 | 0.0549 | 0.0796 |

  **HARNESS VALIDITY CONFIRMED:** `honest-nodead` is identical to `honest-control` to four
  decimals on every head, every fold, same iteration counts. Dropping seven provably-inert
  columns changed nothing, as it must. The harness does nothing when it should do nothing.

  **⚠ THIS REFUTES THIS MORNING'S HEADLINE.** I reported that removing leakage costs
  −0.0060 and that "Model B's entire 1M signal is memorisation". **Both were artefacts of
  the mis-specified arm.** With the correct six features removed: the cost is −0.0007
  (noise), **D5 — the live recommendation basis — barely moves (0.0962 → 0.0958)**, and
  **D1 actually IMPROVES (0.0787 → 0.0860)**. B drops 0.0064 → 0.0045, a small decline, not
  a sign flip. **The measured edge is NOT substantially leakage-driven.**
  Root cause of the false alarm: the old list dropped `stocktwits_virality_z`, which is a
  genuinely useful NON-leaked feature — removing it is what cost the IC.

  **ACTIONS THIS SETTLES.**
  1. **Adopt the leakage-free feature set at the retrain.** It costs ~nothing (−0.0007),
     removes real lookahead + symbol-identity leakage, and makes the anchors defensible for
     a capital decision. Add the six to `EXCLUDE_COLS`; do NOT add `stocktwits_virality_z`.
  2. **The pre-2021 row drop is NOT a win.** Against the honest baseline it costs −0.0060
     (D5 0.0958 → 0.0875, D2 0.0520 → 0.0360). This morning's "+0.0005, only arm beating
     control" was an artefact of scoring it against an INFLATED control. Judged honestly,
     every data-change arm loses. Consistent with the standing v11 no-deployment verdict.
  3. **The go-live anchor is essentially unchanged**, so the edge is what the checkpoint
     says it is — no better, but no worse either. The leakage worry is closed.

  **Interpretation of the CONFOUNDED v11 numbers below — the cost is the POINT.** A stamped feature
  is constant per symbol, so the model memorises "symbol X returns Y". That still
  generalises across a TEMPORAL split because the test fold holds the same symbols, so it
  raises measured IC while being worthless forward. **Purging/embargo (López de Prado) —
  which this project already does with a 21-day embargo — defends against TEMPORAL leakage
  only and is blind to cross-sectional symbol-identity leakage.** That is exactly why these
  survived every existing control. The −0.0060 is therefore an estimate of **how much of
  the measured edge is memorisation**, and it is large relative to the whole edge: B is
  +0.0064 and goes NEGATIVE (−0.0112) once the leakage is removed, i.e. Model B's entire
  1M signal on this protocol is attributable to it.
  **Consequence for trading real money: the honest edge is smaller than the anchors say.**
  Before any capital decision, the anchors should be re-derived on a leakage-free feature
  set, and any go-live case built on that number, not the current one.

  **`v11-rowsonly` is the only arm that beats control** (+0.0005 mean, 9/20 head-folds,
  B +0.0238 and D1 +0.0870 both best-in-table). It is small and it costs D5 (0.0962 →
  0.0834), which is the live basis — so it is not a clean win either. Consistent with the
  standing v11 verdict: nothing here justifies deployment on its own.
  **Next test (not yet run): rows-only PLUS the stamped removal measured against a
  leakage-free control**, so the row fix is not judged against an inflated baseline.

- **⚠ FEATURE AUDIT 2026-08-13 — 7 stamped, 11 DEAD, and one recorded belief refuted.**
  Systematic within-symbol constancy scan over every numeric feature the model receives
  (`scratchpad/stamped_scan2.py`), separating three causes that look identical:

  **(a) STAMPED — present-day value written onto every historical row.** Varies widely
  ACROSS symbols, never WITHIN one, so the model memorises "symbol X scores Y" — which
  still generalises across a TEMPORAL split because the test fold holds the same symbols.
  Inflates backtest IC without being forward-predictive.
  | feature | const-within-symbol | distinct globally |
  |---|---|---|
  | `gdelt_tone_z` | 97.2% | 765 |
  | `price_target_upside_pct` | 93.7% | 1,549 |
  | `insider_net_shares_30d` | 92.9% | 204 |
  | `price_target_consensus` | 91.5% | 411 |
  | `eps_surprise_pct` | 67.3% | 2,932 |
  | `revenue_surprise_pct` | 67.3% | 2,366 |
  | `vix_close` | 55.0% | 1,503 |
  Only `price_target_consensus` was previously known. **`vix_close` at exactly 55.0%
  independently confirms the VIX defect** (4 of 7 regional vol tickers dead on Yahoo →
  55% of rows carry vix=0) from a completely different direction.

  **⚠ CORRECTION: `stocktwits_virality_z` is NOT stamped.** Measured 1.5% constant within
  symbol, 30 distinct values, 60.5% non-zero. The recorded "95.9% constant" claim does not
  hold against the current `features.csv` — do not drop it on that basis. See
  [[stamped-symbol-constant-features]], which is wrong on this point.

  **(b) DEAD — globally constant, all-zero, carrying zero information (11):**
  `news_relevance_z`, `short_interest_pct_float`, `put_call_ratio_t_minus_1`,
  `dark_pool_index`, `ctb_velocity_7d`, `iv_crush_pct`, `congressional_net_flow_30d`,
  `institutional_ownership_pct`, `av_news_sentiment`, plus two one-hot levels that never
  fire (`primaryCategory_technical`, `confidence_tier_low`). Harmless to accuracy (XGBoost
  ignores them) but the feature count is inflated and several sources believed to be
  contributing are not.
  **NOT a wiring break — checked and the caches are genuinely empty of signal:**
  `congressional_trades_cache` has 66,841 rows, all non-null, and **not one non-zero
  `net_flow`**; `fmp_institutional_ownership_cache` has 337 rows and **zero non-null**
  `ownership_pct`; `alphavantage_news_sentiment_cache` has 24 rows, 7 usable. The features
  are correctly zero given their inputs.
  **The real defect is one level upstream: the congressional fetch wrote 66,841 cache rows
  every one of which is 0.0, and reported success.** A cache that persists 66k rows of
  nothing looks identical to a cache that is working — the same silent-failure family as
  ClinicalTrials and the FINRA capture, just before the feature rather than after. Decide
  whether that source is fixable or should be retired; do not carry a dead feature into
  the retrain on the assumption its data will show up.

  **(c) structural (18)** — sector one-hots and similar, legitimately fixed per symbol.
- **D4 (3d head): retire or retrain.** v9.2, dead-wired for decisions, and its live
  output collapses to ~82 distinct values over 261 rows (30-symbol identical buckets —
  the "static bucketing" a 2026-08-10 external audit flagged; `scratch_dupeCheck.ts`).
  Either upgrade it in the bundle or stop displaying it.
- **POT ROSTER RE-SPEC — ✅ DEPLOYED. Verified live 2026-08-16 (`scratch_potRosterList.ts`).**
  **44 pots exist: the legacy 20 plus `R2 *` at pot_id 21–44.** The R2 cohort holds **30
  open positions and 0 closed** — so it is accruing exactly the 2W data October needs, and
  nothing it holds is readable yet. (12 of the 24 hold nothing at all so far, which is
  expected this early and not evidence about their traits.) The deployed set is wider than
  the 12-row table below: it adds `Bold-3/6/8`, `Ratio-0.5/1.5/2.5/3.5`, `Fast-Bold-5/7/9`
  and `Wide-Ratio-1/3`, i.e. the one-factor ladders were filled in rather than sampled.
  **Do not re-run `scratch_potRosterDeploy.ts --apply`** — the roster is already in place
  and a second run would duplicate it.

  *(analysis 2026-08-12; `historic_pots_ranges*.py`, `historic_pots_shrinkage.py`. Gate was
  corrected the same day — deploy NOW, not in October — because pots are paper-traded and
  touch no model, so adding them cannot reset the checkpoint or affect inference. The
  October gate belongs to retrain-COUPLED items only. That reasoning is what made the
  deployment right, and is kept because it applies to any future roster change.)

  *Out-of-sample first, because picking the best of 770,000 configs is selection on noise.*
  Selecting on the first half of events and measuring on the second retained **~75%**
  (+0.0196 → +0.0146; 91% in reverse). Real effect — but only **4 of 7 traits survived**:

  | trait | keep | survives h1→h2? |
  |---|---|---|
  | boldness | **7** (4–7 workable; 1–3 firmly negative) | ✅ |
  | opportunistic | **low — i.e. do not add it at all** | ✅ strongest effect |
  | focus | 6–10 | ✅ weak |
  | reactivity | via the RATIO below | ✅ weak |
  | ambition | no independent effect | ❌ |
  | conviction | no independent effect | ❌ |
  | patience | **fails at 10/6M** — that corner was the overfit | ❌ at 10 |

  **`ambition` and `reactivity` are ONE knob, not two:** the engine uses only the ratio
  (`threshold = H_BASE × ambition/reactivity`). Ratio <1.0 is negative; **1.2–3.5 is the
  good band**. This is why the marginal said reactivity 2 and the conditional said 7 —
  both artefacts of holding the other fixed.

  **The published horizon ranking is a units artefact.** `cov_alpha` carries the units of
  the return, and σ runs 0.046 (2D) → 0.277 (6M), so long horizons score high for betting
  on a noisier variable. Normalised, the order reverses: **2W is best on skill-per-unit-risk
  (cov/σ 0.129)**, then 3M 0.109, 2D 0.081, 6M 0.075, 1M 0.024 (worst). 2D's high
  annualised figure is unreachable — negative net of costs at the turnover it needs.
  This independently re-confirms the hardcoded D5/2W basis.

  *Audit of the live 20-pot roster against that:* only **3 pots (#5, #9, #19) sit in the 2W
  band**, **5 sit at 1M** (the harmful one), **6 have boldness < 4** (negative range), and
  all three 2W pots carry ratio < 1.0 (0.79 / 0.82 / 0.67 — the negative band). The roster
  is close to uncorrelated with the findings.

  *Proposed replacement roster — one core at the measured optimum, then ONE-FACTOR-AT-A-TIME
  variants pushed 1–2 outside each range so coverage stays attributable rather than a grid.*
  `patience` → horizon: ≤2.5=2D, ≤4.5=2W, ≤6.5=1M, ≤8.5=3M, >8.5=6M.

  | # | name | bold | amb | pat | conv | focus | react | ratio | home | probes |
  |---|---|---|---|---|---|---|---|---|---|---|
  | C | Core | 7 | 6 | 3.5 | 5 | 8 | 3 | 2.00 | 2W | the optimum |
  | 1 | Core−bold | 5 | 6 | 3.5 | 5 | 8 | 3 | 2.00 | 2W | low edge of good |
  | 2 | Core+bold | 9 | 6 | 3.5 | 5 | 8 | 3 | 2.00 | 2W | beyond (8–10 ≠ 7 live) |
  | 3 | Fast | 7 | 6 | 2.0 | 5 | 8 | 3 | 2.00 | 2D | 1 band out |
  | 4 | Slow | 7 | 6 | 5.5 | 5 | 8 | 3 | 2.00 | 1M | the harmful band |
  | 5 | Slowest | 7 | 6 | 7.5 | 5 | 8 | 3 | 2.00 | 3M | 2 bands out |
  | 6 | Loose | 7 | 6 | 3.5 | 5 | 5 | 3 | 2.00 | 2W | below focus range |
  | 7 | Tight | 7 | 6 | 3.5 | 5 | 10 | 3 | 2.00 | 2W | top of range |
  | 8 | Ratio-low | 7 | 6 | 3.5 | 5 | 8 | 6 | 1.00 | 2W | just under band |
  | 9 | Ratio-high | 7 | 6 | 3.5 | 5 | 8 | 1.5 | 4.00 | 2W | just over band |
  | 10 | Conv-low | 7 | 6 | 3.5 | 2 | 8 | 3 | 2.00 | 2W | no-effect trait |
  | 11 | Conv-high | 7 | 6 | 3.5 | 8 | 8 | 3 | 2.00 | 2W | no-effect trait |

  **Explicit non-goal: do NOT add an `opportunistic` characteristic.** Its optimum is the
  low end = "do not chase the best-predicted horizon", which is exactly what fixed-horizon
  pots already do. The knob only buys the ability to be worse. See the standing note below.

  **Caveat to carry into the decision:** the MEDIAN configuration loses at every horizon
  (2W −0.003%, 1M −0.187%). The edge lives in a minority of settings, so this re-spec is
  worth doing *and* is a reminder that most pots are dead weight.
- D5 ensemble (top-of-book memory: ensemble beats every member at k=3; the cheap win).
- Meta-labeling / conformal gate on D5 (recheck against checkpoint verdict first).
- VIX regime encoder vocabulary fix + dead regional vol tickers (retrain-gated set).
- Stamped symbol-constant features (stocktwits_virality_z, price_target_consensus) removal.
- Pre-2021 bar-granularity corruption: re-extract, don't repair (B/C labels corrupt).
- Mislabeled non-events (~5,000 rows below the 1.80 z-floor flagged as real).
- AU/NZ UTC date-shift fix (leave Gulf Sunday rows alone — legitimate).
- secStd epsilon floor (targeted Yahoo-only recompute; explicitly "when a retrain
  happens anyway").
- Stage-3 source wiring (FIGI map, FINRA short interest, FCA/AMF shorts, clinical
  trials — all captured weekly, none wired).
- Fresh liquidity features (Amihud etc. computed live from bars instead of
  snapshot-frozen).

## Dashboard polish — DONE 2026-08-10

All four shipped: expired 2D/3D now show the greyed value + "expired" tag; D4 column
de-emphasised with tooltip; pre-2026-08-09 rows carry a "pre-fix regime" badge; pots
now send ONE aggregated ntfy per run for opens/closes (`POT_NOTIFICATIONS=off` to
disable).

## Deferred / blocked (do not start without new information)

- FMP premium restore + everything gated on it (577-symbol re-scan, stale-premium
  refresh, snapshot recadence) — Lewis's 2026-07-30 decision.
- Norgate/QuantRocket survivorship data (measured inflation ~10-25bps — not justified).
- CBOE put/call, Bundesanzeiger/FI short registers, BSE scrip codes in OpenFIGI
  (verified blocked).
