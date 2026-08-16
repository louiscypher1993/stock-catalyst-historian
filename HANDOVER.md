# Session handover — updated 2026-08-16 (evening)

Written so the next session starts from the written record rather than from recollection.
**Deliberately short. It does not restate `TODO.md`, which is the canonical backlog and was
updated throughout.** Read `TODO.md` first; this only covers what that file can't tell you.

> **Two sessions are folded into this file.** Session 1 ran 2026-08-13 → 08-16 (~22 commits,
> `94d9ab9` → `23a36bc`). Session 2 ran the evening of 2026-08-16 (4 commits,
> `eff487a` → `770a435`) and closed the top of the queue. Where they conflict, session 2 wins.

---

## State

- Working tree **clean** except `trading-rules/` (untracked, yours). Everything **pushed** to
  `feature/local-development`, currently at **`770a435`**.
- `npm run lint` (`tsc --noEmit`) **green**.
- Live system runs in **GitHub Actions** and needs nothing local. Scans fire 07:00 / 15:30 /
  20:00 UTC (currently ~40–55 min late).
- **`main` is a genuine orphan** — last commit 2026-06-05, no `PotService.ts`, no workflows,
  250+ commits behind. Never merge to it.

---

## Start here

**Everything unblocked is done. The next real item is the risk-score + tier-cutoff refit,
gated ~2026-08-21 — and it is PRE-REGISTERED.**

> **Read `PREREG_2026-08-21_riskscore_refit.md` before running any part of it.** Acceptance
> criteria, the frozen candidate list and the abandon-conditions are fixed there ahead of the
> data, deliberately, because the middle part is a best-of-N selection on live data — the
> exact shape that produced the v15 false positive. Do not amend that file in place; an
> amendment must be a separate later commit stating what changed and why.

Two things it settles that are **not** obvious from `TODO.md`:

1. **The obvious success test cannot fail.** Refitting percentiles on live output makes the
   result uniform *by construction*. The real gate is whether live Model C has ≥50 distinct
   values at all — Model A has 12 across 684 rows, Model B has 69.
2. **Only A1/A2/C1 can honestly be decided on 08-21.** Post-parity maturity is **n=0 on every
   horizon**; 2W first matures ~08-23, so the confidence-term and beat-the-baseline decisions
   land in **early September**.

Small unblocked leftovers, none urgent: the `£50` default in `outcomeScoreboard` /
`dsrPboAudit` (see below), and a re-run of `expansionReadout.ts` (more informative nearer its
~08-20 gate).

Gate calendar: 2D expansion ~08-20 · **refit ~08-21** · 2W expansion ~08-23 · benchmark 2W
~08-27 · trend overlay ~early Sept · **checkpoint October**.

---

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
