# Session handover — 2026-08-13

Written at the end of a long session so the next one starts from the written record rather
than from recollection. **This file is deliberately short. It does not restate `TODO.md`,
which is the canonical backlog and was updated throughout.** Read `TODO.md` first; this
only covers what that file can't tell you.

---

## State

- Working tree **clean**, everything **pushed** to `feature/local-development`.
- `npm run lint` is **green** (it had been red all day with 12 pre-existing errors).
- ~20 commits today, `94d9ab9` → `3fea102`.
- Live system runs in **GitHub Actions** and needs nothing local. Scans fire 07:00 / 15:30 /
  20:00 UTC (currently ~40–55 min late).
- `origin/HEAD` was a stale clone-time cache pointing at `main`; corrected to
  `feature/local-development`. **`main` is a genuine orphan** — last commit 2026-06-05, no
  `PotService.ts`, no workflows, 252 commits behind. Never merge to it.

---

## Start here

**The pot ledger is gross of trading costs** — top section of `TODO.md`. `PotService.ts`
never imports `costModel.ts`, so the recorded −0.35%/−0.45% per trade is pre-cost and the
honest number is ~**−0.9%/trade**. But **14 `.NS`/`.BO` positions carry impossible sizes
(£4–£16 against a ~£1,250 rule)** and must be repaired first or the net figure inherits the
artefact. Sequence and evidence are in `TODO.md`.

Everything else on the backlog is **date-gated**: 2D expansion ~08-20, risk-score + tier-cutoff
refit ~08-21, 2W expansion ~08-23, benchmark 2W ~08-27, trend overlay ~early Sept, checkpoint
October.

---

## What today established (detail in `TODO.md` / commit messages)

Four data-driven claims tested, **all four negative** — leakage removal −0.0007, pre-2021 row
drop −0.0060, corrected labels −0.0028, D5 subsampling −0.0108. **v9.4 stays.** The consistent
lesson is that data hygiene is not what's binding; elapsed time is.

Closed decisions: re-extraction source (**line 301 stays** — the join retains only 3.9% of the
rows it exists to repair, because corrupt rows' event *dates* are artefacts of monthly bars);
benchmark mode (**stay on SPY**, 2D t=−3.36); expanded-scan health (**fine**).

New live findings: **tier cutoffs are miscalibrated live** (56.9% of rows resolve BUY-or-better
against a ~20% design target — folded into the 08-21 refit); **pots ignore the trend-opposition
downgrade** (audit trail fixed, behavioural decision deferred); **Model A emits 12 distinct
values across 684 live rows**, Model B 69.

---

## Things I got wrong today — don't re-derive them

1. **"Removing leakage costs −0.0060 / Model B is memorisation."** False. Caused by a
   mis-specified arm that dropped `stocktwits_virality_z` (a *good* feature) while leaving
   five real leaks in. Corrected in memory.
2. **"D5 prediction diversity collapsed 58.9%→36.1%."** Measurement artefact — distinct-share
   is not scale-invariant and I compared unmatched *n*. At matched n=91 it's 80%. Healthy.
3. **"Fabricated labels are the most consequential finding today."** Overstated. Day-clustered
   IC is rank-based, so tied blocks at 0.0 barely move it — the anchor shift is ~0.002.
4. **"§13.2 broker/cost is the project's unanswered critical path"** (in the trading-rules
   review). Wrong — `costModel.ts` answered it on 2026-07-24. **Grep before asserting
   something doesn't exist.**

**The methodological win:** the D5 subsampling result looked clean at 4/4 folds and was a
best-of-five selection effect. It was caught **only** because the hypothesis was pre-registered
and committed (`e02fe56`) before the confirmatory run (`f5ff036`). Keep doing that.

---

## `trading-rules/` — reviewed, not implemented

User added a spec for a future live-trading accounting engine (`SPEC.md`, `CLAUDE.md`,
`BUILD-PHASE-1.md`) and asked for a review only. **No code was written and none should be
without an explicit instruction.** Review verdict:

- Genuinely good work. §1.4 friction wall, §1.3.3/§1.3.4 HWM arithmetic, §6.3.4 suspension
  ring-fencing and §4.6.2 limit-in/stop-market-out are all correct and non-obvious.
- **The container is not the binding constraint — §13.4 (the signal) is**, and the spec says so
  itself. `E[G]` in pounds does not exist; §2.6.4's calibration guard would likely halt on
  contact with today's model.
- Concrete gaps: no stop-loss *level* in §4.6, no time-based exit, no signal-reversal exit
  (all three exist already in `PotService` — `HORIZON_STOP_FLOOR`, `patienceHorizon`,
  reactivity exits — so the spec is behind the code).
- `LOSS_STREAK_HALT = 4` at the measured 40% win rate fires ~13% of four-trade windows.
- §2.6.4 uses mean/mean; should be median or trimmed, given this project's history of
  outlier-driven results (t +4.61 → −0.42 on dropping the top 1%).
- §13.1's stamp-duty-avoidance analysis is aimed at a smaller problem than assumed: the
  universe is only **34% US** (471/1,397) but the dominant cost is the **£3.20 FX minimum**,
  not stamp.

---

## Standing constraints (violating any of these is expensive)

- **Never re-run `HistoricalEngine` to refresh training data.** It calls
  `getFullCompanyContext()` and `setEventFeatures` is `ON CONFLICT DO UPDATE` — on the free
  tier it overwrites irreplaceable FMP premium enrichment with nulls. Premium expired
  2026-07-06. See memory `fmp-premium-data-preservation`.
- **Never re-run `scratch_potSnapshotFxOnly.ts --apply`** — not idempotent, double-applies.
- No commits, deploys or live-DB writes without explicit sign-off. Preview-then-apply is the
  house pattern for any ledger repair.
- No `--no-verify`, no force push, no amends; new commits only.
- `market_cache.db` is 2.7 GB, gitignored, local-only, and **no CI script may touch it**.
  `MAX(date)` on `daily_prices` does not return inside 180 s — use Supabase or Yahoo instead.

---

## Where things live

| what | where |
|---|---|
| Canonical backlog, every open item + its gate | `TODO.md` |
| Durable cross-session facts | `~/.claude/projects/.../memory/` + `MEMORY.md` index |
| Evidence and reasoning for any finding | the commit message that introduced it |
| Model experiment results | `src/ml/scratch/*.csv` (gitignored; numbers are in commits) |
