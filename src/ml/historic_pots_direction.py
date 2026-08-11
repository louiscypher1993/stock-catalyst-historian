#!/usr/bin/env python3
"""HISTORIC POTS — decision quality with SIZE removed, plus significance.

historic_pots_skill.py measured Cov(amt, actual). That still scales linearly with
position size, so conviction (which only sets size) and boldness (which gates whether
a trade happens at all) inflate it arithmetically. Strip size out:

  u = sign(amt) in {-1, 0, +1}          (SELL / HOLD / BUY — the decision itself)
  DIRECTION SKILL = Cov(u, actual_H)     in return units
      = how much better the realized return is when the pot goes long vs short,
        independent of how much it staked.

Significance: the pot's per-event contribution is x_i = (u_i - mean(u)) * (a_i - mean(a));
Cov is its mean, so t = mean(x) / (sd(x)/sqrt(n_events)). Events are the unit of
independence, NOT pots — the 16,384 pots share one set of model predictions and are
massively correlated, so "74% of pots are positive" is roughly one observation, not
16,384. The t-stat below is the honest per-pot test.

Also reports the same on the ALWAYS-BUY-equivalent (u = +1 everywhere) as a floor:
a constant u has zero covariance by construction, so any positive value is decision
information rather than drift.
"""
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
ROW_CHUNK = 512


def main():
    pots = pd.read_csv(OUT / 'pots.csv')
    grid = pots[pots['control'].isna() | (pots['control'] == '')].reset_index(drop=True)
    n_pots = len(grid)
    ev = pd.read_csv(OUT / 'events.csv')
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    hor = np.load(OUT / 'horizon.npy', mmap_mode='r')
    actual = ev[[f'actual_{h}' for h in ['2D', '2W', '1M', '3M', '6M']]].to_numpy(dtype=np.float64)
    tf = (ev['cohort'] == 'testfold').to_numpy()
    n_tf = int(tf.sum())
    print(f'testfold events: {n_tf:,}   grid pots: {n_pots:,}\n')

    dir_skill = np.zeros(n_pots); tstat = np.zeros(n_pots); trade_rate = np.zeros(n_pots)
    for lo in range(0, n_pots, ROW_CHUNK):
        hi = min(lo + ROW_CHUNK, n_pots)
        a = np.asarray(act[lo:hi])[:, tf]
        h = np.asarray(hor[lo:hi]).astype(np.int64)[:, tf]
        u = np.where(a == 1, 1.0, np.where(a == 2, -1.0, 0.0))
        aH = np.take_along_axis(
            np.broadcast_to(actual[tf][None], (hi - lo, n_tf, 5)), h[:, :, None], 2)[:, :, 0]
        x = (u - u.mean(1, keepdims=True)) * (aH - aH.mean(1, keepdims=True))
        cov = x.mean(1)
        sd = x.std(1, ddof=1)
        dir_skill[lo:hi] = cov
        tstat[lo:hi] = np.where(sd > 0, cov / (sd / np.sqrt(n_tf)), 0.0)
        trade_rate[lo:hi] = (u != 0).mean(1)

    res = grid[TRAITS].copy()
    res['dir_skill'] = dir_skill
    res['t'] = tstat
    res['trade_rate'] = trade_rate
    res.to_csv(OUT / 'direction_skill.csv', index=False)

    print('=== DIRECTION SKILL (testfold): Cov(decision, realized return), size removed ===')
    print(f'  mean   {dir_skill.mean():+.4%}   best {dir_skill.max():+.4%}   worst {dir_skill.min():+.4%}')
    print(f'  share positive: {(dir_skill > 0).mean():.1%}   (pots are NOT independent — see header)')
    print(f'\n  per-pot t-stat: median {np.median(tstat):+.2f}   best {tstat.max():+.2f}   worst {tstat.min():+.2f}')
    for bar in (2.0, 3.0):
        print(f'  pots with t > {bar}: {(tstat > bar).mean():6.1%}   t < -{bar}: {(tstat < -bar).mean():.1%}')

    print('\n=== TRAIT EFFECT ON DIRECTION SKILL (testfold, size-neutral) ===')
    for t in TRAITS:
        g = res.groupby(t)['dir_skill'].mean()
        tt = res.groupby(t)['t'].mean()
        print(f'  {t:<15} ' + '  '.join(f'{lvl}:{v:+.3%}(t{tt[lvl]:+.1f})' for lvl, v in g.items()))

    best = res.loc[res['t'].idxmax()]
    print(f'\nbest-t pot: t={best["t"]:+.2f}  dir_skill={best["dir_skill"]:+.4%}  '
          f'trade_rate={best["trade_rate"]:.1%}')
    print('  traits: ' + ', '.join(f'{t}={int(best[t])}' for t in TRAITS))
    print('\nHLZ hurdle for a deployment claim is t>3.0 on an INDEPENDENT sample; the max')
    print('here is a best-of-16,384 selection on one shared signal, so it needs the same')
    print('multiple-testing discipline as any other sweep (see TRIAL_LOG.md).')
    print('\nwrote direction_skill.csv')


if __name__ == '__main__':
    main()
