# PRE-REGISTRATION — risk-score + tier-cutoff refit (~2026-08-21)

**Written 2026-08-16 and committed BEFORE any refit is fitted or any result is seen.**

This exists because the refit's middle part is a *best-of-N selection on live data*, which is
the exact shape that produced this project's worst false positive. The v15 D5-subsampling
result looked clean at 4/4 folds and was a best-of-five selection effect; it was caught only
because the hypothesis was committed at `e02fe56` **before** the confirmatory run at
`f5ff036`. Without that, a +11% D5 IC improvement that does not exist would have entered the
retrain bundle. Pre-registration is only possible before the data matures — on the 21st it is
already too late, which is why this is being written on the 16th.

Amendments are permitted but must be a **separate, later commit** stating what changed and
why. Editing this file in place before the run defeats its only purpose.

---

# AMENDMENT 1 — 2026-08-24, written AFTER running A1 and C1

**Per this file's own protocol, amendments are a separate later commit stating what changed
and why. The original text below is left intact so the record shows what was pre-registered
versus what reality forced.**

Run on 2026-08-24 (gate was ~08-21; three days late, no data was harmed — the criteria were
frozen on 08-16 either way). Readiness at run time: **1,101 clean post-parity rows over 14
run_dates**, both gates met.

## A1 RESULT: **PASS** — and Part A is nonetheless VOID

`model_c_max_drawdown` has **525 distinct values** over 1,101 clean post-parity rows, against
the ≥50 / ≥400 thresholds. **Model C is not degenerate.** For contrast on the same rows,
Model A emits **16** distinct values and Model B **51** — the degeneracy belongs to A and B.

By the letter of A1, this says "proceed to A2". **A2 must not run, because its premise is
false.** Verified end to end:

- The live workflows set `MODEL_C_VERSION=9.5`, so `infer.py` loads
  `model_c_breakpoints_v9.5.json` and emits `model_c_percentile_rank` against **v9.5's own**
  table (`infer.py:243`).
- That field survives `clampedScores` (object spread; it is not in the override list) into the
  pot payload, and `PotService.ts:475` **prefers it**:
  `result.model_c_percentile_rank ?? modelCPercentileRank(modelC)`.
- `MODEL_C_PERCENTILE_BREAKPOINTS` in `PotService.ts` is **v9.1's** and is only the FALLBACK.
- The rank is **never written to Supabase** (already noted in `scratch_checkModelCLive.ts`),
  so every Supabase-based analysis silently falls back to the v9.1 table.

Same 1,101 live rows, drawdownTerm computed both ways:

| drawdownTerm (0–40) | v9.1 fallback — what the analyses saw | v9.5 — what production uses |
|---|---|---|
| median | 38.7 | **16.3** |
| distinct rounded values | 4 | **38** |
| rows ≥37/40 | 1,010 (**91.7%**) | 7 (**0.6%**) |

Mean difference **−22.3 points**, matching the ~18-point warning written into
`model_c_breakpoints_v9.5.json` itself.

**The drawdown term is NOT pinned in production. It is healthy.** The "37–38 spike = pinned
by stale breakpoints" finding measured the fallback, not the deployed path.

**Therefore:**
- **A2 is CANCELLED.** Refitting the local table would only change the fallback, making the
  analyses accidentally right while leaving the real gap in place.
- **The real fix is persistence, not calibration:** write `model_c_percentile_rank` into
  `inference_results` (ALTER TABLE first — silent-write-failure hazard, see
  `supabase-schema-drift-hazard`) so analyses stop measuring a table production does not use.
- **Part B is unaffected** — `model_a_confidence` IS stored, so the dead-confidence-term
  finding was measured on real production values. Its candidate list and decision rule stand.

## C1 RESULT: occupancy criterion PASSES, and the SELL half of it is INCOHERENT

Refitted on post-parity clean live percentiles, occupancy lands on target as predicted —
which the original text already warned proves nothing, being self-fulfilling by construction:

| head | deployed | refitted |
|---|---|---|
| D3 2D | SB **48.5%** / SELL 3.8% / HOLD 47.7% | SB 10.2% / SELL 10.2% / HOLD 79.7% |
| D5 2W | SB 18.3% / BUY **43.2%** / SELL 3.5% / HOLD 35.0% | SB 10.4% / BUY 9.9% / SELL 10.1% / HOLD 69.7% |
| D1 3M | SB 11.9% / HOLD 88.1% | SB 10.1% / HOLD 89.9% |
| D2 6M | BUY **39.0%** / HOLD 61.0% | BUY 10.1% / HOLD 89.9% |

**But the live distribution is almost entirely positive**, so a 10% SELL tier can only be
manufactured by putting the cutoff above zero:

| head | % of live predictions negative | refitted SELL cutoff |
|---|---|---|
| D3 2D | 6.2% | **v ≤ +0.0036** |
| D5 2W | **3.5%** | **v ≤ +0.0147** |
| D1 3M | 1.0% | (no SELL tier) |
| D2 6M | **0.0%** | (no SELL tier) |

**A refitted D5 SELL would classify a predicted +1.47% GAIN as SELL.** That is not a
threshold, it is a renaming of "least positive". Concrete harm: `tailRiskTerm =
cfg.sell?.(value) ? 30 : 0`, so 10% of rows would take a 30-point riskScore penalty for a
positive predicted return, and riskScore gates entry (`riskScore > boldness × 10`). Shorts
themselves are protected by the F5 fix (`downside < tier.minReturn` filters positive-return
SELLs), so the damage is to riskScore and entry gating, not to short selection.

**AMENDED C1 DECISION RULE, replacing the flat ±5pp-of-10% target:**

1. **Adopt the refit for the UPPER tiers only** (`strongBuy`, `buy`). Those are genuine
   percentile cuts on a region where the distribution has mass, and they fix the real defect:
   D3 calling **48.5%** of everything STRONG_BUY, D5's BUY at 43.2%, D2's BUY at 39.0%.
2. **Do NOT force SELL to 10%.** SELL must stay sign-meaningful. Keep it anchored at or below
   zero and let its occupancy be whatever the data supports (~3–6%). An occupancy target is
   the wrong instrument for a tier defined by the sign of a prediction.
3. D1 3M moved 11.9% → 10.1% and was already well calibrated; adopting it is near-inert and
   is fine either way.

**Unchanged: C2 still governs.** Correct occupancy remains insufficient — the refitted
cutoffs must still beat the unselective baseline on matured 2W outcomes (early September),
and if they do not, the pre-committed response is to report that tier selection has no
demonstrable live edge rather than tune a third time.

## The through-line, for the third time this month

A1 and C1 both went the same way: the pre-registered test passed on its literal terms and was
still the wrong thing to act on. In A's case the measuring instrument was reading a table
production does not use; in C's case the target metric (occupancy) was indifferent to whether
the resulting tier means anything. **Pre-registration fixes the decision rule against
hindsight. It does not certify that the rule measures what you think it measures.** Both
failures were caught by asking what the number would mean if it came out fine — not by any
criterion written into this file.

---

## Standing rules (apply to every part below)

1. **Fit on LIVE output. Never on fold percentiles.** This is the single most-repeated lesson
   in the project's record — `live-vs-fold-distribution-gap`, the pinned drawdown term, and
   the v17 finding that a protocol-trained D5 has median −0.0205 with 86.6% below the SELL
   cutoff while the deployed model live has median +0.0261 and 3.6% SELL. Opposite ends of
   the distribution. Any cutoff derived from a fold is not transferable.
2. **Post-parity rows only.** Parity landed 2026-08-09 12:07 UTC (`fcbcaab`). Rows before it
   are a different regime and must not be blended.
3. **Exclude quarantined rows** (`unreliable_reason` non-null) and the +1,183-symbol
   expansion cohort, which remains quarantined pending its own readout.
4. **Day-clustered statistics only.** A pooled t-statistic is not admissible evidence here.
   The project moved its IC anchors to `TEST_IC_DAILY` for exactly this reason, and the
   trend-overlay result (pooled t=3.91, clustered t=1.59) is the standing example of what
   pooling hides.
5. **No candidate may be added after results are seen.** The lists below are frozen.
6. **Report the failure branch as a result.** "The refit did not achieve X" is a finding, not
   a reason to re-tune until it does.

---

## Starting state, recorded now so it cannot be misremembered later

Measured 2026-08-13 unless noted (`scratch_riskDecompose.ts` on 2,471 live rows,
`scratch_liveTierOccupancy.ts` on 418 post-parity clean rows, `scratch_headDegeneracy.ts`):

- `model_a_confidence` ≥ 0.9999 on **~92%** of live rows; **A emits 12 distinct values across
  684 live rows**. The isotonic calibrator maps 97.1% of fold *events* to exactly 1.0.
- Model B emits **69** distinct values over the same window.
- riskScore's 37–38 spike is the **drawdown term pinned** by stale v9.3 breakpoints; the
  64–69 cluster is that pinned term plus the binary 30-point sell term.
- Live tier occupancy against a design target of ~10/10/10/70
  (STRONG_BUY / BUY / SELL / HOLD): **D5 2W 21.3 / 35.6 / 3.6 / 39.5**;
  **D3 2D 48.3 / — / 3.6 / 48.1**; D1 3M 12.9 / — / — / 87.1; D2 6M — / 35.6 / — / 64.4.
  **56.9% of live rows resolve BUY-or-better against a ~20% target.**
- **Added 2026-08-16 (`dsrPboAudit --position 1250`, 29 run_dates, pre-parity):** every
  tier-selective variant *loses* and the unselective baseline is the only positive one —
  ALL-scored +0.466% (Sharpe +0.240), STRONG_BUY −0.976%, actionable −1.128%, top-10/day
  −1.232%, top-3/day −2.267%. **Selection currently subtracts value.**

---

## PART A — refit `MODEL_C_PERCENTILE_BREAKPOINTS` (`PotService.ts:356`)

**The pre-registered gate is not "does the refit spread the term" — that criterion cannot
fail.** Refitting percentile breakpoints on the live distribution makes the percentile rank
uniform *by construction*, so a distributional success test would be tautological. The real
question is whether live Model C carries enough resolution for percentile ranking to mean
anything at all, given that Model A does not (12 distinct values) and Model B barely does (69).

**Test first, refit second:**

> **A1.** Count distinct `model_c_max_drawdown` values on post-parity clean live rows.
> **Pre-registered threshold: ≥ 50 distinct values over ≥ 400 rows.**
> - **≥ 50** → refitting is meaningful. Proceed to A2.
> - **< 50** → the 40-point drawdown term is a degeneracy dressed as a percentile.
>   **Do NOT refit.** Retire the term or fold its weight into the others, and record C
>   alongside A and B in the retrain bundle as a degenerate head.

**A2** (only if A1 passes): refit all 17 breakpoints on the post-parity live distribution,
preserving the existing interpolation shape and sign convention (higher `modelC` = safer,
confirmed at Spearman +0.285 against realised `max_adverse_excursion_1m`).

**A2 is expected to succeed by construction and therefore proves nothing on its own.** Its
value is only realised through Part B's predictive test.

---

## PART B — replace the dead Model-A confidence term ⚠ THE DANGEROUS PART

The 30-point confidence term never had discriminating power: A separates events from
non-events, and *every row reaching riskScore is already an event*. This is not a calibration
problem, so **do not recalibrate A** — wrong tool for this term.

**FROZEN candidate list (three, plus the null — no additions after results are seen):**

| arm | description |
|---|---|
| **NULL** | **Remove the term; rescale the remaining two to 100 points.** |
| B1 | `signal_completeness` |
| B2 | `|z|` percentile rank |
| B3 | reweight the drawdown term to absorb the 30 points |

**The NULL is the default action, not a control.** Removing a term that provably does not
discriminate is the honest baseline. A replacement must *earn* its place.

**Decision metric** — day-clustered Spearman correlation of `riskScore` against realised
maximum adverse excursion at the pot's horizon. This is the metric riskScore was built and
previously validated against (`PotService.ts:399-409`: the original formula scored −0.131 on
it, which is what motivated the current version), so it is not a metric chosen to suit the
answer.

**Pre-registered acceptance rule:**

> A candidate replaces the NULL only if it beats the NULL on **mean day-clustered Spearman**
> by **≥ 0.02**, and is positive on **≥ 70% of run_dates**, over **≥ 10 run_dates**.
> - If **no** candidate clears it → **adopt the NULL.** Ship the two-term riskScore.
> - If **more than one** clears it → take the one with **fewer inputs**; if still tied, take
>   the one that does not add a new data dependency. Stated now to prevent a post-hoc tiebreak.

**⚠ TIMING — Part B cannot be decided on 2026-08-21.** It requires *matured outcomes*, and
`readoutHarness` confirms post-parity maturity is **n=0 on every horizon** as of 2026-08-16,
with 2W first maturing ~2026-08-23. Ten clustered run_dates puts the earliest honest decision
in **early September**. Running B on 21 August would be running it on pre-parity data, which
rule 2 forbids. **Freeze the candidates now; decide in September.**

---

## PART C — refit `HORIZON_TIER_CONFIG` cutoffs

Same defect as Part A in a different component: cutoffs fitted to a v9.3 *fold* distribution
that live does not reproduce.

**C1 — occupancy (testable 2026-08-21, distributional).** Refit cutoffs on post-parity clean
live output percentiles.

> **Accept if:** STRONG_BUY, BUY and SELL each land within **±5pp of 10%**, and HOLD within
> **±10pp of 70%**, measured over **≥ 10 run_dates**.

Note this is largely self-fulfilling, as in A2 — fitting to live percentiles produces the
target occupancy almost by construction. C1 is a *sanity check that the fit was applied
correctly*, not evidence that it helps.

**C2 — the bar that actually matters (gated on 2W maturity, ~early September).** Today's
`dsrPboAudit` finding raised the stakes: it is no longer enough for the cutoffs to be
*occupied* correctly, because the current ones already lose to picking nothing at all.

> **Accept the refitted cutoffs only if the actionable tier (STRONG_BUY + BUY) beats the
> ALL-scored unselective baseline** on mean day-clustered net return over **≥ 10 run_dates**,
> at a realistic position size (**£1,250**, the sizing rule — not the £50 default, which puts
> fixed IBKR floors at ~930–975bps and inverts the verdict).
>
> **If the refitted cutoffs still lose to the baseline: report that tier selection has no
> demonstrable live edge, and do NOT re-tune.** A third round of threshold tuning against the
> same window is fishing. That result would be a genuine and reportable finding about the
> model, and it belongs in the October checkpoint as such.

---

## PART D — riskScore display precision *(gated: A and B both landed)*

Switch to 1–2dp only after the terms are fixed. Decimals on a pinned term are false precision.
No acceptance test; this is cosmetic and follows mechanically.

## PART E — `ambitionTier` minReturn ladder *(gated: C1 landed)*

`ambitionTier(≤3.0)` requires `minReturn` 0.03 (`PotService.ts:218`) while D5's BUY band is
[0.024743, 0.031582) — a **~0.0016-wide sliver**, so a cautious pot can effectively only enter
on STRONG_BUY. The sliver is a property of the cutoffs, so **re-measure it after C1 before
deciding anything** — the refit may dissolve it or widen it. Only then decide whether the
0.03 / 0.12 / 0.21 / 0.27 ladder needs rescaling to the refitted distribution.

---

## Summary of what is decided when

| part | earliest honest date | why |
|---|---|---|
| A1 distinct-value count | **2026-08-21** | needs live output only |
| A2 breakpoint refit | 2026-08-21 | conditional on A1 |
| C1 occupancy refit | 2026-08-21 | needs live output only |
| **B** confidence term | **~early September** | needs ≥10 days of matured 2W outcomes |
| **C2** beat-the-baseline | **~early September** | same |
| D, E | after their gates | mechanical follow-ons |

**Anything claimed on 2026-08-21 beyond A1 / A2 / C1 is being claimed on pre-parity or
immature data, and this document pre-commits to not making such a claim.**
