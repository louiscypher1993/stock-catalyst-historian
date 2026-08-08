#!/usr/bin/env python3
"""Does Model C degrade under LIVE-shaped inputs, and does v9.5 degrade WORSE?

Live inference_results since the v9.5 flip show mean model_c_max_drawdown = -0.2728,
against ~-0.098 for v9.1 on the days before and a realized max-adverse-excursion of
about -0.08. That is the opposite of the offline result, where v9.5 landed at -0.0982
against realized -0.0806 while v9.1 sat at +0.0569. Something differs between the rows
this was validated on and the rows it is served.

THE HYPOTHESIS: train/serve skew via missing-value encoding. infer.py builds its frame as

    row = {c: remapped.get(c, 0) for c in cols}          # infer.py, build_df

so any feature absent from the live vector arrives as **0.0**. In training those same
features are **NaN**, and XGBoost learns an explicit default direction for NaN at every
split. Zero is a real number that takes whichever branch the threshold dictates — a
different path through the tree entirely.

WHY IT WOULD HIT v9.5 HARDER: v9.1 stopped at 24 boosting rounds, v9.5 runs to 65. More
trees means a sharper fit to the training feature space, so the same out-of-distribution
input is extrapolated more aggressively. A shallow model is accidentally robust to skew;
a better-fit one is not. If that is what is happening, v9.5 is the better model on
correctly-shaped inputs and the worse one on what production actually sends.

*** RESULT: HYPOTHESIS REFUTED. Both of them. ***

features.csv carries 0.0% NaN cells in the test fold — they were filled upstream — so
NaN->0 is a no-op and both models predict identically under either encoding (per-row
shift 0.0000). Zeroing the 20 FMP/premium columns instead (live has sent 0 for those
since premium expired 2026-07-06) moves v9.1 +0.0569 -> +0.0299 and v9.5 -0.0956 ->
-0.1011: real, but nowhere near enough. Production shows v9.1 at -0.098 median and v9.5
at -0.272.

So the offline fold does NOT reproduce live inputs, and this file does not explain why.
What it does establish is that the gap is NOT missing-value encoding and NOT the expired
premium block — worth keeping, because both are the obvious suspects and both are now
eliminated.

THE ACTUAL FINDING came from the percentile mapping, not the predictions. Live C values
land at p0.01 (v9.1) and p0.07 (v9.5) of the breakpoint distributions, whose medians sit
at p0.50 by construction. So riskScore's drawdown term is pinned at 37-40 of 40 on
essentially every live row, under BOTH versions and long before v9.5 — 40% of the risk
score is a near-constant carrying no information. That is the defect worth fixing, and
it needs breakpoints refitted to LIVE output rather than to a training fold.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

import scratch_c_corrupt_target as C

ML_DIR = Path(__file__).parent


def main():
    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    feats = json.load(open(ML_DIR / 'model_c_v9.1.json'))['learner']['feature_names']

    # the held-out fold both models were judged on
    base = df.dropna(subset=[C.LABEL])
    d = pd.to_datetime(base['date'])
    test = base[d >= d.sort_values().iloc[int(len(base) * 0.85)]]
    y = test[C.LABEL].values
    X = test[feats]

    nan_share = X.isna().mean().mean()
    print(f'test fold {len(test):,} rows; mean share of NaN feature cells: {nan_share:.1%}')
    per_col = X.isna().mean().sort_values(ascending=False)
    print('\nfeatures most often missing (these are the ones live sends as 0.0):')
    for c, v in per_col.head(8).items():
        print(f'  {c:<34} {v:>6.1%}')

    models = {}
    for v in ('9.1', '9.5'):
        b = xgb.Booster(); b.load_model(str(ML_DIR / f'model_c_v{v}.json'))
        n = json.load(open(ML_DIR / f'model_c_v{v}.json'))['learner']['attributes']['best_iteration']
        models[v] = (b, int(n) + 1)

    print(f'\n{"model":<8}{"encoding":<14}{"mean":>10}{"median":>10}{"% > 0":>9}'
          f'{"|cal err|":>11}{"vs realized":>13}')
    print('-' * 76)
    print(f'{"realized":<8}{"—":<14}{y.mean():>+10.4f}{np.median(y):>+10.4f}'
          f'{np.mean(y > 0) * 100:>8.1f}%{"—":>11}{"—":>13}')

    out = {}
    for v, (b, ntree) in models.items():
        for enc, Xe in (('training (NaN)', X), ('live (NaN->0)', X.fillna(0.0))):
            p = b.predict(xgb.DMatrix(Xe, feature_names=feats), iteration_range=(0, ntree))
            out[(v, enc)] = p
            print(f'{"v" + v:<8}{enc:<14}{p.mean():>+10.4f}{np.median(p):>+10.4f}'
                  f'{np.mean(p > 0) * 100:>8.1f}%{np.abs(p - y).mean():>11.4f}'
                  f'{p.mean() - y.mean():>+13.4f}')

    print('\nSHIFT CAUSED BY THE ENCODING ALONE (same model, same rows):')
    for v in ('9.1', '9.5'):
        a, b_ = out[(v, 'training (NaN)')], out[(v, 'live (NaN->0)')]
        print(f'  v{v}: mean {a.mean():+.4f} -> {b_.mean():+.4f}  '
              f'(shift {b_.mean() - a.mean():+.4f}, |per-row| {np.abs(b_ - a).mean():.4f})')

    print('\nLIVE COMPARISON — what production actually computes:')
    for v in ('9.1', '9.5'):
        p = out[(v, 'live (NaN->0)')]
        print(f'  v{v}: mean {p.mean():+.4f} vs realized {y.mean():+.4f}, '
              f'calibration error {np.abs(p - y).mean():.4f}')
    print('\nObserved in production: v9.1 ~-0.098 median, v9.5 ~-0.272 median.')


if __name__ == '__main__':
    main()
