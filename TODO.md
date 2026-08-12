# TODO — active backlog

Canonical to-do list, consolidated 2026-08-10. Ordering within sections is priority.
Items carry their gate (what must happen first) because most of this backlog is
time-gated, not effort-gated. History/evidence lives in the memory files and
`DEEP_DIVE_PROGRESS.md`; this file is only what is still OPEN.

## Near-term (this week / next)

1. **Risk-score re-evaluation** *(gate: ~10 trading days of post-parity data, ~2026-08-21)*
   Decomposed on 2,471 live rows (`scratch_riskDecompose.ts`, `defe2ad`): the 37-38
   spike is the drawdown term pinned by stale Model C breakpoints; `model_a_confidence`
   is ≥0.9999 on ~92% of rows so the 30-point confidence term is dead; 64-69 cluster =
   pinned term + binary 30-pt sell term. One change, three parts:
   - refit `MODEL_C_PERCENTILE_BREAKPOINTS` on post-parity live C output (NOT on n=4);
   - **REPLACE the confidence term — measured 2026-08-10: the isotonic calibrator maps
     97.1% of fold EVENTS to exactly 1.0 (raw A: 41% ≥0.9999). A separates events from
     non-events; every row reaching riskScore IS an event, so the term never had
     discriminating power. Candidate replacements: signal_completeness, |z| percentile,
     or reweight the drawdown term. Do NOT recalibrate A — wrong tool for this term;**
   - switch riskScore to 1-2dp display THEN (decimals before the refit = false precision).
2. **Expansion cohort readouts** (`expansionReadout.ts`)
   - 2D: first post-parity maturities ~2026-08-11.
   - 2W: ~2026-08-23 → the un-quarantine decision for the +1,183 expansion symbols.
     Positive day-IC over ≥10 days = open pots/notifications to the cohort; anything
     else = stays display-only. Pre-parity cohort IC was NEGATIVE (broken regime) —
     do not blend regimes.
3. **First expanded-scan health check** — runtime, Yahoo error rate, row volume at
   2,906 symbols (first full runs 2026-08-10 15:30/20:00 UTC).
4. **Native-vs-SPY benchmark adjudication** *(gate: ~2 weeks of shadow data, ~2026-08-16)*
   `LIVE_BENCHMARK_MODE=shadow` has logged divergences since 2026-08-02; 33% of
   detections would change under `native`. Needs its own readout script + decision.

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
- **Immature forward labels are stored as 0.0 and ARE trained on** (found 2026-08-11,
  `0a683f2`). `feature_extractor.ts:426` serialises targets with `v === null ? 0 : v` —
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
- **D4 (3d head): retire or retrain.** v9.2, dead-wired for decisions, and its live
  output collapses to ~82 distinct values over 261 rows (30-symbol identical buckets —
  the "static bucketing" a 2026-08-10 external audit flagged; `scratch_dupeCheck.ts`).
  Either upgrade it in the bundle or stop displaying it.
- **POT ROSTER RE-SPEC (analysis done 2026-08-12; `historic_pots_ranges*.py`,
  `historic_pots_shrinkage.py`). Config change only — no model, no retrain — but gated to
  the bundle because live pots now run a post-parity regime + 40% larger universe than the
  study's events, and the v9.4 checkpoint that would justify trading any of it is open.**

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
