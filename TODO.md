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
   - replace or recalibrate the dead confidence term (measure Model A's live raw
     distribution first — saturation may be clamp/calibration, not the model);
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

## New capture builds (from the 2026-08-10 external-practice review)

5. **FINRA daily short-sale volume capture** — free, daily, per-symbol off-exchange
   short ratio; the only institutional-grade free flow dataset we don't collect.
   Fits the pit-snapshot capture-now-wire-later pattern; every uncaptured week is
   unrecoverable. Wire as a feature only at a retrain.
6. **SEC Form 4 insider-transaction capture** — free EDGAR source to eventually
   replace the stale-frozen FMP `insider_net_shares_30d` (dead since premium expiry).
   Capture now so the October retrain has months of history; EDGAR plumbing +
   `SEC_CONTACT` already exist.

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

## Dashboard polish (product decisions — Lewis's call, all cheap)

- Expired 2D/3D: show greyed "expired: was +x.x%" instead of `—` (current behaviour is
  deliberate but reads as data loss; flagged by the external audit).
- Hide or de-emphasise D4's column while it remains dead-wired (see above).
- Regime banner: rows with run_date < 2026-08-09 carry pre-parity predictions and are
  not comparable with newer rows (the +30% 1M wall of old signals is this).
- Pot-action notifications: pots trade all horizons silently; ntfy only covers 2W
  recommendations. Alerts and trades run on different bases.

## Deferred / blocked (do not start without new information)

- FMP premium restore + everything gated on it (577-symbol re-scan, stale-premium
  refresh, snapshot recadence) — Lewis's 2026-07-30 decision.
- Norgate/QuantRocket survivorship data (measured inflation ~10-25bps — not justified).
- CBOE put/call, Bundesanzeiger/FI short registers, BSE scrip codes in OpenFIGI
  (verified blocked).
