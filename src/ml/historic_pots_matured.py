#!/usr/bin/env python3
"""HISTORIC POTS — corrected: exclude IMMATURE labels, then re-test decision skill.

FOUND 2026-08-11: feature_extractor.ts:426 writes targets as `v === null ? 0 : v`, so a
forward return that had not matured when features.csv was built is stored as EXACTLY 0.0,
not NaN. The trainer's `df.dropna(subset=[label_col])` cannot catch 0.0, so those rows are
both TRAINED ON and, until now, scored in this simulation as "the outcome was 0%".

Detection here uses the MATURITY RULE rather than `== 0.0`, so genuine zero returns are
not thrown away: a label is immature iff event_date + horizon_days > last date in the
dataset (2026-06-18).

Every pot decision whose CHOSEN horizon has an immature label is dropped from the
statistics (the pot still made the decision; we simply do not know the outcome, so it
cannot count as evidence either way).

Re-reports, on matured test-fold events only:
  - direction skill Cov(decision, realized return), size-neutral, with t
  - the outlier-robustness check (does it survive dropping the top 1% |contribution|)
  - the opportunistic gradient, which was the headline trait finding
"""
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
H_DAYS = np.array([2, 14, 30, 91, 182])
ROW_CHUNK = 512


def main():
    ds = pd.read_csv(OUT / 'direction_skill.csv')
    grid = pd.read_csv(OUT / 'pots.csv')
    grid = grid[grid['control'].isna() | (grid['control'] == '')].reset_index(drop=True)
    ev = pd.read_csv(OUT / 'events.csv')
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    hor = np.load(OUT / 'horizon.npy', mmap_mode='r')
    actual = ev[[f'actual_{h}' for h in ['2D', '2W', '1M', '3M', '6M']]].to_numpy(dtype=np.float64)

    dates = pd.to_datetime(ev['date'])
    data_end = dates.max()
    # matured[i, h] : does event i's horizon-h label describe a real outcome?
    matured = np.stack([(dates + pd.to_timedelta(d, unit='D') <= data_end).to_numpy()
                        for d in H_DAYS], axis=1)
    tf = (ev['cohort'] == 'testfold').to_numpy()
    print(f'data ends {data_end.date()}   test-fold events {tf.sum():,}')
    print('matured share of test-fold labels, by horizon:')
    for i, h in enumerate(['2D', '2W', '1M', '3M', '6M']):
        print(f'  {h:<3} {matured[tf, i].mean():6.1%}')
    print()

    n_pots = len(grid)
    cov = np.zeros(n_pots); tstat = np.zeros(n_pots); nused = np.zeros(n_pots)
    cov_rob = np.zeros(n_pots); t_rob = np.zeros(n_pots)
    for lo in range(0, n_pots, ROW_CHUNK):
        hi = min(lo + ROW_CHUNK, n_pots)
        a = np.asarray(act[lo:hi])[:, tf]
        h = np.asarray(hor[lo:hi]).astype(np.int64)[:, tf]
        u = np.where(a == 1, 1.0, np.where(a == 2, -1.0, 0.0))
        idx = np.arange(tf.sum())
        aH = actual[tf][idx, h]
        okH = matured[tf][idx, h]                      # chosen horizon matured?
        for r in range(hi - lo):
            m = okH[r]
            if m.sum() < 100:
                continue
            uu, aa = u[r, m], aH[r, m]
            x = (uu - uu.mean()) * (aa - aa.mean())
            c = x.mean(); sd = x.std(ddof=1); n = len(x)
            cov[lo + r] = c; nused[lo + r] = n
            tstat[lo + r] = c / (sd / np.sqrt(n)) if sd > 0 else 0.0
            keep = np.argsort(-np.abs(x))[int(0.01 * n):]
            xr = x[keep]
            cov_rob[lo + r] = xr.mean()
            t_rob[lo + r] = xr.mean() / (xr.std(ddof=1) / np.sqrt(len(xr))) if xr.std(ddof=1) > 0 else 0.0

    res = grid[TRAITS].copy()
    res['cov_matured'] = cov; res['t_matured'] = tstat; res['n_used'] = nused
    res['cov_robust'] = cov_rob; res['t_robust'] = t_rob
    res['cov_before'] = ds['dir_skill'].to_numpy(); res['t_before'] = ds['t'].to_numpy()
    res.to_csv(OUT / 'matured_skill.csv', index=False)

    print('=== DIRECTION SKILL on MATURED test-fold labels only ===')
    print(f'  events used per pot: median {np.median(nused):,.0f} (was 8,948)')
    print(f'  cov: mean {cov.mean():+.4%}  best {cov.max():+.4%}  worst {cov.min():+.4%}')
    print(f'  t  : median {np.median(tstat):+.2f}  best {tstat.max():+.2f}')
    print(f'  pots t>3: {(tstat > 3).mean():.1%}   (before maturity filter: {(ds["t"] > 3).mean():.1%})')
    print(f'  AFTER also dropping top 1% |contribution|: pots t>3: {(t_rob > 3).mean():.1%}')

    print('\n=== OPPORTUNISTIC GRADIENT (the headline trait finding) ===')
    print(f'{"level":>6}{"cov before":>13}{"cov matured":>14}{"t matured":>11}{"t robust":>10}')
    for lvl in [1, 4, 7, 10]:
        m = res['opportunistic'] == lvl
        print(f'{lvl:>6}{res.loc[m, "cov_before"].mean():>12.3%}{res.loc[m, "cov_matured"].mean():>14.3%}'
              f'{res.loc[m, "t_matured"].mean():>11.2f}{res.loc[m, "t_robust"].mean():>10.2f}')

    print('\n=== ALL TRAITS on matured labels (cov, robust-t) ===')
    for t in TRAITS:
        g = res.groupby(t)[['cov_matured', 't_robust']].mean()
        print(f'  {t:<15} ' + '  '.join(f'{lvl}:{r["cov_matured"]:+.3%}(t{r["t_robust"]:+.1f})'
                                        for lvl, r in g.iterrows()))
    print('\nwrote matured_skill.csv')


if __name__ == '__main__':
    main()
