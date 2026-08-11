#!/usr/bin/env python3
"""Is the measured decision skill BROAD, or is it a handful of extreme events?

The headline (+0.276% mean direction skill, median t=+4.61) is a MEAN. This project has
been burned by outliers before (the 51 rows with ~1000x price discontinuities; the III.L
GBp/GBP row with MAE +113.54), so a mean over 8,948 events can be carried by five of them.

Per-event contribution to Cov(decision, realized return) is
    x_i = (u_i - mean(u)) * (a_i - mean(a))
and the covariance is exactly mean(x). So the question is simply: how concentrated is x?

Reports, on the TEST FOLD, for three pots (best-t, median-t, and the low-opportunistic
archetype the trait analysis favoured):
  - share of total skill from the top 1/5/10/50 events
  - the covariance recomputed with the top 1% of |x| events REMOVED (does it survive?)
  - a winsorised (1%/99%) covariance and its t-stat
  - the biggest individual contributors, so they can be eyeballed for data defects
"""
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']


def main():
    ds = pd.read_csv(OUT / 'direction_skill.csv')
    ev = pd.read_csv(OUT / 'events.csv')
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    hor = np.load(OUT / 'horizon.npy', mmap_mode='r')
    actual = ev[[f'actual_{h}' for h in ['2D', '2W', '1M', '3M', '6M']]].to_numpy(dtype=np.float64)
    tf = (ev['cohort'] == 'testfold').to_numpy()
    evtf = ev[tf].reset_index(drop=True)
    n = int(tf.sum())

    med_t = ds['t'].median()
    picks = {
        'best-t': int(ds['t'].idxmax()),
        'median-t': int((ds['t'] - med_t).abs().idxmin()),
        'low-opportunistic archetype': int(
            ds[(ds['opportunistic'] == 1) & (ds['boldness'] == 7) & (ds['patience'] == 4)]['t'].idxmax()),
    }

    for label, pid in picks.items():
        row = ds.loc[pid]
        a = np.asarray(act[pid])[tf]
        h = np.asarray(hor[pid]).astype(np.int64)[tf]
        u = np.where(a == 1, 1.0, np.where(a == 2, -1.0, 0.0))
        aH = actual[tf][np.arange(n), h]
        x = (u - u.mean()) * (aH - aH.mean())
        cov = x.mean()
        order = np.argsort(-np.abs(x))
        tot = x.sum()

        print('=' * 78)
        print(f'{label}  (pot {pid})  ' + ', '.join(f'{t}={int(row[t])}' for t in TRAITS))
        print(f'  covariance {cov:+.4%}   t {row["t"]:+.2f}   trades {(u != 0).mean():.1%}')
        for k in (1, 5, 10, 50):
            print(f'  top {k:>2} events by |contribution|: {100 * x[order[:k]].sum() / tot:6.1f}% of total skill')

        keep = order[int(0.01 * n):]                      # drop top 1% by |x|
        c2 = x[keep].mean(); t2 = c2 / (x[keep].std(ddof=1) / np.sqrt(len(keep)))
        print(f'  EXCLUDING top 1% |x| ({int(0.01 * n)} events): cov {c2:+.4%}  t {t2:+.2f}')

        lo, hi = np.percentile(x, [1, 99])
        xw = np.clip(x, lo, hi)
        tw = xw.mean() / (xw.std(ddof=1) / np.sqrt(n))
        print(f'  winsorised 1/99:                       cov {xw.mean():+.4%}  t {tw:+.2f}')

        print('  largest contributors:')
        for i in order[:5]:
            print(f'    {evtf.loc[i, "symbol"]:<12} {evtf.loc[i, "date"]}  decision={int(u[i]):+d}  '
                  f'actual={aH[i]:+.2%}  contribution={x[i]:+.4f}')
        print()


if __name__ == '__main__':
    main()
