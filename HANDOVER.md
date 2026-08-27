# Session handover — updated 2026-08-27

Written so the next session starts from the written record rather than from recollection.
**Deliberately short. It does not restate `TODO.md`, which is the canonical backlog and was
updated throughout.** Read `TODO.md` first; this only covers what that file can't tell you.

> **Three sessions are folded into this file; the latest wins on any conflict.** Session 1
> ran 2026-08-13 → 08-16 (~22 commits, `94d9ab9` → `23a36bc`). Session 2 ran the evening of
> 2026-08-16 (5 commits, `eff487a` → `00a19f5`) and closed the top of the queue. Session 3 ran
> 2026-08-20: re-measured the expansion gate. Session 4 ran 2026-08-24: **executed the
> pre-registered refit, closed the 2D expansion gate, and persisted the Model C rank.**
> Session 5 ran 2026-08-27: **closed the benchmark adjudication (stay on SPY) and
> retracted a premature 2W expansion read.**

---

## State

- Working tree **clean** except `trading-rules/` (untracked, yours) and
  `src/scripts/scratch_refitReadiness.ts`. Everything else **pushed** to
  `feature/local-development`. Check `git log -1` for the tip rather than trusting a hash
  written here — the commit that updates this file always post-dates the line describing it.
- `npm run lint` (`tsc --noEmit`) **green**.
- Live system runs in **GitHub Actions** and needs nothing local. Scans fire 07:00 / 15:30 /
  20:00 UTC (currently ~40–55 min late).
- **`main` is a genuine orphan** — last commit 2026-06-05, no `PotService.ts`, no workflows,
  250+ commits behind. Never merge to it.

---

## Start here

**⚠ STILL NEEDS A HUMAN: apply `src/db/supabase_model_c_rank_migration.sql` in the Supabase
SQL editor.** Checked 2026-08-27 — not yet applied. **The fail-soft path is VERIFIED working
in production**: the write change shipped 08-24 and rows kept landing normally (143 / 135 /
123 on 08-24/25/26), so nothing is broken and the migration can land whenever suits. Until it
does, `model_c_percentile_rank` is not stored and every analysis keeps falling back to a v9.1
breakpoint table production has not used since v9.5.

**The 08-21 refit is DONE (2026-08-24) and both halves changed the plan. Read AMENDMENT 1 at
the top of `PREREG_2026-08-21_riskscore_refit.md` before touching riskScore or the tier
cutoffs.** In brief:

1. **A1 passed** (Model C has 525 distinct live values — it is NOT degenerate; A has 16, B
   has 51). **A2 was cancelled anyway**: the "drawdown term pinned at 37-40" defect was
   measuring the v9.1 FALLBACK. In production the term is healthy — ≥37/40 on 0.6% of rows,
   not 91.7%, a 22.3-point mean difference. The fix was persistence, not calibration.
2. **C1 passed its occupancy criterion and half the result is incoherent.** Refitting to a
   10% SELL tier puts D5's cutoff at **+0.0147** — calling a predicted +1.47% GAIN a SELL —
   because only 3.5% of live D5 predictions are negative (D2: 0.0%). **Adopt the upper tiers,
   leave SELL sign-anchored.** Nothing has been applied to `HORIZON_TIER_CONFIG`; the
   proposed constants are printed in the amendment, not deployed.
3. **Part B (the dead confidence term) survives untouched** — `model_a_confidence` IS stored,
   so it was measured on real production values. Gated on matured 2W outcomes.

**Next real work is ~2026-09-03** (Part B + C2). Both need ≥10 run_dates of matured
post-parity 2W outcomes; there were **5** on 08-27, accruing ~1 per trading day.

**⚠ GATE DATES ARE COUNTS, NOT DATES**, and **⚠ DO NOT READ A PARTIAL COUNT DIRECTIONALLY.**
Both lessons were learned the hard way this month — the 2D gate slipped twice on the first,
and on 2026-08-24 a 4-day expansion read of +0.0604 (t=0.86) was written up as "points the
other way" and was −0.0037 three days later. Re-measure before quoting; say "undecided"
until the count is met.

Gate calendar (2026-08-27): 2D expansion **CLOSED — no signal** · benchmark adjudication
**CLOSED — stay on SPY** · Part B + C2 **~09-03** (5 of 10 days) · 2W expansion
**mid-September** (5 of 10 days) · trend overlay ~early Sept · **checkpoint October**.

---

## What session 5 established (2026-08-27)

- **Benchmark adjudication CLOSED: stay on SPY.** 2W, hedged (the metric that favours
  native): SPY-only eventfulness **1.231** (n=63) vs native-only **0.926** (n=171),
  native−SPY −0.304, **Welch t=−2.65**; raw agrees at t=−3.12. The decisive number is
  native-only's **0.926 — below 1.000**, i.e. its exclusive detections flag bars that move
  LESS than that symbol's average. Anti-informative, not merely worse. `LIVE_BENCHMARK_MODE`
  stays `spy`; no further re-runs unless detection logic changes.
- **⚠ 2D benchmark weakened as n grew** — −0.736 (t=−3.36) at 51/137 rows, −0.261
  (t=−1.79) at 101/267. Same sign, no longer significant. Do not quote the 08-13 2D figure;
  the decision rests on 2W.
- **A premature read was retracted.** The expansion cohort's 2W went +0.0604 (t=0.86, 4 days)
  → −0.0037 (t=−0.07, 5 days). It now resembles 2D's no-signal result rather than
  contradicting it.
- **The fail-soft Supabase write is verified in production** — three full scan days since the
  08-24 deploy with no gap, while the migration remains unapplied.

---

## What session 4 established (2026-08-24)

- **The pre-registered refit ran, and both tests passed while being the wrong thing to act
  on.** Details in AMENDMENT 1. The reusable lesson is at the bottom of it: pre-registration
  fixes the decision rule against hindsight, but **does not certify that the rule measures
  what you think it measures**. Neither of today's problems was caught by any criterion in
  the file — both were caught by asking what the number would mean if it came out fine.
- **2D expansion gate CLOSED with a no-signal verdict.** day-IC −0.0023 (t=−0.03) over 10
  days. The trajectory matters more than the endpoint: −0.1391 → −0.0395 → −0.0023 across
  three measurements is convergence to **zero**, never toward the +0.083 anchor. No
  information, as distinct from negative information — nothing to invert or salvage.
- **2W expansion points the other way and is now the live question**: +0.0604 (t=0.86) on 4
  of 10 days against a +0.107 anchor. Same sign, within 2×, early. Mid-September.
- **`model_c_percentile_rank` + `model_c_version` are now written to Supabase**, fail-soft
  (PGRST204 → one warning, retry without, remember for the process). Deploy order is
  therefore safe in both directions — which matters, because sending an unknown column makes
  PostgREST reject the WHOLE row, and doing that unguarded would have silently stopped
  persisting every inference result.
- **The £50 reporting hazard is fixed**, finally. `outcomeScoreboard`'s verdict now reads
  "loses to cost ✗ **AT £50**" plus an explicit below-the-floor warning, and `dsrPboAudit`
  refuses to let its absolute Sharpes be read bare at that size. Both name £1,250 as the
  re-run.

## What session 2 established

- **The pot ledger reads NET now.** `src/potLedgerCosts.ts` + `src/scripts/potLedgerNet.ts`.
  Honest figure **−0.971%/trade** on the admissible basis (91 sizing-reliable of 105 closed);
  −1.034% with the slippage bound; worse still once the un-modelled signal decay is allowed
  for. `PotService.ts:701` is deliberately **untouched** — deducting cost there would change
  how every future position is sized.
- **⚠ THE PLANNED SIZE REPAIR WAS REFUTED. Do not redo it.** `TODO.md` had said to repair 14
  `.NS`/`.BO` rows carrying £4–16 sizes. The invariant `position_size_gbp === shares ×
  entry_price` **holds on 185 of 185 rows**. The wrong input was the sizing *budget*
  (~£78.63 against a recorded £10,000, a uniform 127.2×), proven by a same-day control inside
  pot 13. They are honest records of tiny trades; rewriting them would have broken the
  invariant and required inventing `shares` and `realised_pnl`.
- **costModel's tax table was wrong in a way that had nothing to do with the missing rows.**
  `.NS` read `0.0001` while its own note said "~0.1%" — **out by 10×** since it was written.
  Eleven missing exchanges added, `.BO` added, `BRK.B` suffix-parsing fixed. Consequence
  beyond the pots: `outcomeScoreboard`, `readoutHarness`, `topBuysReport`, `dsrPboAudit` and
  `dumpPotCosts` all share this model, so any net figure they reported before `f19dc35` was
  understated.
- **⚠ AT REALISTIC SIZE, TIER SELECTION SUBTRACTS VALUE.** `dsrPboAudit --position 1250`, 29
  run_dates: the unselective baseline is the **only positive variant** (+0.466%, Sharpe
  +0.240) against STRONG_BUY −0.976%, actionable −1.128%, top-10/day −1.232%, top-3/day
  −2.267%. Pre-parity and overlapping, so not a verdict — but it raised the bar in the prereg
  from "occupancy is correct" to "must beat picking nothing."
- **The `£50` default is doing real damage to how reports read.** At £50 the fixed IBKR floors
  are ~930–975bps. `readoutHarness` and `topBuysReport` document this; `outcomeScoreboard`
  prints "**loses to cost ✗**" with no size caveat where £1,250 gives "**clears cost ✓**" on
  the same 641 rows, and `dsrPboAudit` prints absolute Sharpes at that size. Not fixed.
- **Four `TODO.md` items were stale against live state** — ledger figures frozen at 08-13
  (105 closed now, not 84), the R2 pot roster listed as un-deployed (it is live: 44 pots,
  R2 at 21–44, 30 open / 0 closed), item 5's audit trail already fixed in code, and the
  power-budget "highest-leverage, not gated" claim overtaken by its own follow-ups.
  **Grep or query before trusting a dated claim in that file.**

---

## Things we got wrong — don't re-derive them

**Session 2:**

1. **"The measurement refutes my prediction."** It did not — **the instrument was broken.** I
   predicted `.NS`/`.BO` would cost more than the blend, measured the opposite (0.376% vs
   0.488%), and recorded the prediction as refuted. The 10× India error was the cause;
   corrected, it is 0.564% vs 0.493% and the original prediction was right. **A measurement
   that contradicts a well-reasoned prior is a reason to audit the instrument, not only the
   prior.**
2. **Near-miss worth remembering:** I first proposed baking the 14-row exclusion in as a
   hardcoded predicate. That is the same shape as this project's recurring failure mode —
   the empty ClinicalTrials roster, the query truncated at 1,000 rows, CI failures swallowed
   into warnings. Changed to a reported flag emitting *both* bases. Prefer visible over tidy.
3. Said the R2 roster held 24 open positions; it holds **30**.

**Session 1** (still worth not re-deriving):

4. **"Removing leakage costs −0.0060 / Model B is memorisation."** False — mis-specified arm
   that dropped a *good* feature (`stocktwits_virality_z`) while leaving five real leaks in.
5. **"D5 prediction diversity collapsed 58.9%→36.1%."** Measurement artefact: distinct-share
   is not scale-invariant and the *n* were unmatched. At matched n=91 it is 80%. Healthy.
6. **"Fabricated labels are the most consequential finding."** Overstated — day-clustered IC
   is rank-based, so tied blocks at 0.0 barely move it. Anchor shift ~0.002.
7. **"§13.2 broker/cost is the unanswered critical path."** Wrong — `costModel.ts` answered it
   on 2026-07-24. **Grep before asserting something doesn't exist.**

**The methodological through-line:** the v15 D5 result looked clean at 4/4 folds and was a
best-of-five selection effect, caught **only** because the hypothesis was committed
(`e02fe56`) before the confirmatory run (`f5ff036`). That is why the 08-21 refit is
pre-registered. Keep doing this.

---

## `trading-rules/` — reviewed, not implemented

> **PARKED — do not lead with this.** Your words on 2026-08-16: *"not too fussed about trading
> rules atm, I just wanted to get it to a good point for now."* Raise it only if asked.
> `trading-rules/` is still **untracked** — yours to commit, not the assistant's.

Review verdict, recorded so it needn't be redone: genuinely good work (§1.4 friction wall,
§1.3.3/§1.3.4 HWM arithmetic, §6.3.4 suspension ring-fencing, §4.6.2 limit-in/stop-market-out
are all correct and non-obvious). **The container is not the binding constraint — §13.4, the
signal, is**, and the spec says so itself. Concrete gaps: no stop-loss *level* in §4.6, no
time-based exit, no signal-reversal exit — all three already exist in `PotService`, so the
spec is behind the code. `LOSS_STREAK_HALT = 4` at the measured 40% win rate fires ~13% of
four-trade windows. §2.6.4 uses mean/mean and should be median or trimmed. §13.1's
stamp-duty analysis targets the wrong cost — the universe is only 34% US and the dominant
cost is the **£3.20 FX minimum**, not stamp.

---

## Standing constraints (violating any of these is expensive)

- **Never re-run `HistoricalEngine` to refresh training data.** It calls
  `getFullCompanyContext()` and `setEventFeatures` is `ON CONFLICT DO UPDATE` — on the free
  tier it overwrites irreplaceable FMP premium enrichment with nulls. Premium expired
  2026-07-06. See memory `fmp-premium-data-preservation`.
- **Never re-run `scratch_potSnapshotFxOnly.ts --apply`** — not idempotent, double-applies.
- **Never re-run `scratch_potRosterDeploy.ts --apply`** — the R2 roster is already live; a
  second run would duplicate it.
- No commits, deploys or live-DB writes without explicit sign-off. Preview-then-apply is the
  house pattern for any ledger repair.
- No `--no-verify`, no force push, no amends; new commits only.
- `market_cache.db` is 2.7 GB, gitignored, local-only. A CI-reachable script must open it
  **readonly or not at all** — `new Database(p)` read-write CREATES an empty file.
  `MAX(date)` on `daily_prices` does not return inside 180 s; use Supabase or Yahoo.

---

## Where things live

| what | where |
|---|---|
| Canonical backlog, every open item + its gate | `TODO.md` |
| The 08-21 refit's fixed acceptance criteria | `PREREG_2026-08-21_riskscore_refit.md` |
| Net-of-cost pot ledger | `npx tsx src/scripts/potLedgerNet.ts` |
| Durable cross-session facts | `~/.claude/projects/.../memory/` + `MEMORY.md` index |
| Evidence and reasoning for any finding | the commit message that introduced it |
| Model experiment results | `src/ml/scratch/*.csv` (gitignored; numbers are in commits) |
