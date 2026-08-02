# Trial Log

**Purpose.** `dsrPboAudit.ts` deflates the observed Sharpe by the number of trials *N*.
It currently prints a sensitivity table across *N* precisely because nobody could say
what *N* was. This log is the record that lets *N* be stated rather than guessed.

From the research report, Stage 1.2: *"Bound it with DSR/PBO, a t-stat hurdle of ~3.0
(Harvey-Liu-Zhu), and a pre-registered feature/hypothesis log so you can count your true
number of trials."*

## What counts as a trial

**One trial = one distinct configuration you chose between**, not one model fit.

This distinction is the whole point and it is easy to get wrong. The 2026-08-01/02
investigation produced **445 model fits** but only **21 distinct configurations** —
because every configuration was fit across 5 heads and up to 4 folds. Heads and folds are
*evaluations* of a configuration, not separate bets on the data. Counting fits would
inflate *N* by ~20x and deflate the Sharpe into meaninglessness.

Conversely, do NOT undercount: a configuration tried, rejected, and never written up is
still a trial. Selection bias comes from what you *looked at*, not what you *published*.

## Ledger

| # | date | configuration | what it changed | protocol | outcome |
|---|---|---|---|---|---|
| — | pre-2026-07 | v1 – v9 | model architecture/feature iterations (9 versions) | various | superseded |
| — | 2026-07 | v9.1, v9.2, v9.3 | regularisation + tier-threshold recalibrations | production | superseded |
| 1 | 2026-07-22 | v9.4cand | row-exclusion outlier hygiene (51 rows) | production, 3 temporal splits | **ADOPTED → v9.4 (deployed)** |
| 2 | 2026-07-23 | v10drop16cand | drop 16 dead/stale premium features | production | rejected (costs IC on all heads) |
| 3 | 2026-08-01 | v11-clean | re-extracted rows, price-only features | fixed-400 | rejected (feature-count confound) |
| 4 | 2026-08-01 | v94-nostamp | drop 2 stamped leakage features | fixed-400 + production | inert (kept as hygiene, no gain) |
| 5 | 2026-08-01 | v11-union | replace pre-2021 with re-extracted rows | fixed-400 + production | rejected (hurts D1) |
| 6 | 2026-08-01 | union, flat weighting | era weighting sweep | fixed-400, 4 windows | rejected (0/4 windows) |
| 7 | 2026-08-01 | union, half-life 10y | " | " | rejected |
| 8 | 2026-08-01 | union, half-life 5y | " | " | rejected |
| 9 | 2026-08-01 | union, half-life 3y | " | " | rejected |
| 10 | 2026-08-01 | union, ≥2010 cutoff | " | " | rejected |
| 11 | 2026-08-01 | A −pre2021 | drop corrupt pre-2021 rows | fixed-400, 4 windows | **retracted** — won 4/4 then failed to replicate |
| 12 | 2026-08-01 | A −nonevent | drop ~5k mislabelled non-events | fixed-400, 4 windows | rejected (mean +0.0000) |
| 13 | 2026-08-01 | A −both | both subtractions | fixed-400, 4 windows | rejected on replication |
| 14 | 2026-08-02 | v11-rowsonly | pre-2021 drop only | production, 4 folds | rejected (+0.0005, 9/20) |
| 15 | 2026-08-02 | v11-cand | −pre2021 −stamped | production, 4 folds | rejected (−0.0101) |
| 16 | 2026-08-02 | v11-cand-ne | + drop non-events | production, 4 folds | rejected (−0.0091) |
| 17 | 2026-08-02 | v11-premium | re-extracted + premium features | production | rejected (era-confounded) |
| 18 | 2026-08-02 | v94-samerows | control for #17 | production | control, not a candidate |
| 19 | 2026-08-02 | asyncfix | async-close benchmark correction | production, 4 folds | **only positive arm** (+0.0011, 11/20); not deployed |
| 20 | 2026-08-02 | vixfix | flag missing VIX instead of encoding "low" | production, 4 folds | rejected (−0.0010) |
| 21 | 2026-08-02 | bothfix | asyncfix + vixfix | production, 4 folds | rejected (−0.0014, worse than asyncfix alone) |

Not counted as trials: `v94-control` (the baseline being compared against, re-run in every
experiment as a correctness check), and smoke runs on subsampled data used only to prove a
script executed.

## Current N for DSR

| scope | N | note |
|---|---|---|
| 2026-08 v11/v12 investigation | **19** | ledger rows 3–21, minus the 2 controls |
| including 2026-07 (v9.4cand, v10drop16) | **21** | |
| including all prior model versions v1–v9.3 | **~33** | versions were iterative development, not clean independent trials — treat as an upper bound |

**Recommended N to report: 21**, with 33 as the conservative upper bound. Both are far
below the 445 model fits, and stating which one is used matters more than the choice.

## Standing rule

Add a row **when the configuration is run**, not when it succeeds. A log that only records
winners reproduces exactly the selection bias DSR exists to correct.

## Caveats

- Pre-2026-07 versions (v1–v9.3) are reconstructed from retained model files, not from a
  contemporaneous record. Treat that block as approximate.
- Threshold/config sweeps inside PotService (pot trait sweeps, the 40k walk-forward sweep)
  are a *separate* trial family against a different objective and are not merged here;
  PBO in `dsrPboAudit.ts` covers the selection-rule family directly.
- The fixed-400-round protocol rows (#3–13) produced a conclusion that did NOT replicate
  under the production protocol. They are still trials — they were looked at — but their
  outcomes should not be read as evidence about the data.
