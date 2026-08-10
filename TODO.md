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
- **D4 (3d head): retire or retrain.** v9.2, dead-wired for decisions, and its live
  output collapses to ~82 distinct values over 261 rows (30-symbol identical buckets —
  the "static bucketing" a 2026-08-10 external audit flagged; `scratch_dupeCheck.ts`).
  Either upgrade it in the bundle or stop displaying it.
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
