#!/usr/bin/env python3
"""HISTORIC POTS — does any of it reflect SKILL, or only leverage and horizon scale?

Raw mean P&L conflates three things:
  1. LEVERAGE      — conviction/boldness/reactivity make pots deploy more capital, and the
                     event population's mean forward return is POSITIVE, so more capital
                     mechanically means more P&L. (Proof: conviction's action mix is
                     identical across levels 1/4/7/10 yet P&L rises in exact £2,271 steps.)
  2. HORIZON SCALE — patience pushes pots to longer horizons; a 6M return is mechanically
                     bigger than a 2D return regardless of any forecasting ability.
  3. SKILL         — sizing UP when the realized return is actually better.

Only (3) is a claim about the models. Decompose per pot:

  pnl        = (100k + amt) * actual_H
  hold-only  = 100k * actual_H                     (same horizon, no trade)
  trade edge = mean(amt * actual_H)                (value added by trading at all)
  TIMING SKILL = Cov(amt, actual_H)
             = mean(amt*actual_H) - mean(amt)*mean(actual_H)
    i.e. the trade edge MINUS what the same average position earns by drifting with a
    positive-mean population. Zero => the pot's buy/sell decisions carry no information;
    it is a leveraged index. Positive => it genuinely sizes up into better outcomes.

  HORIZON SKILL = mean(daily return of chosen horizon) - mean(daily return averaged over
    all eligible horizons), per event. Zero => horizon choice is uninformed.

Reported on the TESTFOLD cohort (date >= 2025-02-13) separately, since the models were
trained on the in-sample events and its levels are optimistic by construction.
"""
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
H_DAYS = np.array([2, 14, 30, 91, 182], dtype=np.float64)
CAPITAL = 100_000.0
ROW_CHUNK = 512


def main():
    pots = pd.read_csv(OUT / 'pots.csv')
    grid = pots[pots['control'].isna() | (pots['control'] == '')].reset_index(drop=True)
    n_pots = len(grid)
    ev = pd.read_csv(OUT / 'events.csv')
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    hor = np.load(OUT / 'horizon.npy', mmap_mode='r')
    pnl = np.load(OUT / 'pnl.npy', mmap_mode='r')

    actual = ev[[f'actual_{h}' for h in ['2D', '2W', '1M', '3M', '6M']]].to_numpy(dtype=np.float64)
    tf = (ev['cohort'] == 'testfold').to_numpy()
    conviction = grid['conviction'].to_numpy(dtype=np.float64)
    daily = actual / H_DAYS[None, :]
    daily_mean_all = daily.mean(axis=1)                    # per event, avg over horizons

    print(f'events {len(ev):,}  (testfold {tf.sum():,})   grid pots {n_pots:,}')
    print(f'population mean actual 2W return: {actual[:, 1].mean():+.4%} '
          f'(insample {actual[~tf, 1].mean():+.4%}, testfold {actual[tf, 1].mean():+.4%})')
    print('-> a positive-mean population is why "buy more" mechanically wins.\n')

    cols = {k: np.zeros(n_pots) for k in
            ['timing_all', 'timing_tf', 'horizon_all', 'horizon_tf',
             'roc_tf', 'meanpnl_tf', 'deployed_tf']}
    for lo in range(0, n_pots, ROW_CHUNK):
        hi = min(lo + ROW_CHUNK, n_pots)
        a = np.asarray(act[lo:hi]); h = np.asarray(hor[lo:hi]).astype(np.int64)
        size = (conviction[lo:hi] / 10 * CAPITAL)[:, None]
        amt = np.where(a == 1, size, np.where(a == 2, -size, 0.0))
        aH = np.take_along_axis(np.broadcast_to(actual[None], (hi - lo,) + actual.shape), h[:, :, None], 2)[:, :, 0]
        dH = np.take_along_axis(np.broadcast_to(daily[None], (hi - lo,) + daily.shape), h[:, :, None], 2)[:, :, 0]
        for key, m in (('all', slice(None)), ('tf', tf)):
            am, aHm, dHm = amt[:, m], aH[:, m], dH[:, m]
            cols[f'timing_{key}'][lo:hi] = (am * aHm).mean(1) - am.mean(1) * aHm.mean(1)
            cols[f'horizon_{key}'][lo:hi] = dHm.mean(1) - daily_mean_all[m].mean()
        dep = CAPITAL + amt[:, tf]
        cols['deployed_tf'][lo:hi] = dep.mean(1)
        cols['meanpnl_tf'][lo:hi] = np.asarray(pnl[lo:hi][:, tf], dtype=np.float64).mean(1)
        cols['roc_tf'][lo:hi] = cols['meanpnl_tf'][lo:hi] / cols['deployed_tf'][lo:hi]

    res = grid[TRAITS].copy()
    for k, v in cols.items():
        res[k] = v
    res.to_csv(OUT / 'skill.csv', index=False)

    print('=== TIMING SKILL — Cov(position size, realized return), £ per event ===')
    print('    zero => buy/sell decisions carry no information (pot is a leveraged index)')
    print(f'  all events : mean £{res["timing_all"].mean():+,.2f}   '
          f'best £{res["timing_all"].max():+,.2f}   worst £{res["timing_all"].min():+,.2f}   '
          f'share>0 {(res["timing_all"] > 0).mean():.1%}')
    print(f'  testfold   : mean £{res["timing_tf"].mean():+,.2f}   '
          f'best £{res["timing_tf"].max():+,.2f}   worst £{res["timing_tf"].min():+,.2f}   '
          f'share>0 {(res["timing_tf"] > 0).mean():.1%}')

    print('\n=== HORIZON SKILL — chosen-horizon daily return minus all-horizon average ===')
    print(f'  all events : mean {res["horizon_all"].mean():+.6%}/day   share>0 {(res["horizon_all"] > 0).mean():.1%}')
    print(f'  testfold   : mean {res["horizon_tf"].mean():+.6%}/day   share>0 {(res["horizon_tf"] > 0).mean():.1%}')

    print('\n=== RETURN ON DEPLOYED CAPITAL (testfold) — removes the leverage effect ===')
    base = actual[tf, 1].mean()
    print(f'  ALWAYS_HOLD baseline (2W): {base:+.4%}')
    print(f'  grid pots: best {res["roc_tf"].max():+.4%}   median {res["roc_tf"].median():+.4%}   '
          f'worst {res["roc_tf"].min():+.4%}')
    print(f'  pots beating the passive baseline on return-on-capital: '
          f'{(res["roc_tf"] > base).mean():.1%}')

    print('\n=== TRAIT EFFECT ON TIMING SKILL (testfold £/event) ===')
    for t in TRAITS:
        g = res.groupby(t)['timing_tf'].mean()
        print(f'  {t:<15} ' + '  '.join(f'{lvl}:£{v:+,.0f}' for lvl, v in g.items()))
    print('\nwrote skill.csv')


if __name__ == '__main__':
    main()
