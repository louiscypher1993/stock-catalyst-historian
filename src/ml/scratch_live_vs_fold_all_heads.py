#!/usr/bin/env python3
"""Is the offline/live distribution gap a Model C problem, or is it every head?

Model C turned out to sit at +0.077 median on the held-out fold and -0.098 live. If that
is peculiar to C it is a curiosity. If every head shows it, then the TEST_IC_DAILY anchors
the September checkpoint is measured against describe a population the live system never
sees -- and the persistent live-below-anchor gap would be train/serve skew rather than the
sample-size story it has been attributed to.

That distinction is worth settling BEFORE the checkpoint matures, because the two have
opposite remedies: sample size resolves by waiting, skew does not resolve by waiting at
all.

Live medians observed in inference_results, 2026-07-27..2026-08-07 (scratch_allheads.ts):
    model_a_confidence     1.0000   <- saturated at the ceiling
    model_b_return_1m      0.3000   <- exactly B's clamp ceiling (+30% in a month)
    model_c_max_drawdown  -0.0979 (v9.1) / -0.2717 (v9.5)
    model_d5_return_2w     0.0237
    model_d3_return_2d     0.0383

This predicts the DEPLOYED models on the held-out test fold and puts the two side by side.
Reads only; deploys nothing.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

ML_DIR = Path(__file__).parent

# deployed artefacts, per infer.py::load_models
HEADS = [
    ('model_a_confidence',    'model_a_v9.1.json',  'clf',  1.0000),
    ('model_b_return_1m',     'model_b_v9.4.json',  'reg',  0.3000),
    ('model_c_max_drawdown',  'model_c_v9.1.json',  'reg', -0.0979),
    ('model_d3_return_2d',    'model_d3_v9.4.json', 'reg',  0.0383),
    ('model_d5_return_2w',    'model_d5_v9.4.json', 'reg',  0.0237),
]
# LiveInferenceService clamps before storing, so the fold side must clamp identically or
# the comparison is between a clamped and an unclamped distribution.
CLAMPS = {'model_b_return_1m': 0.30, 'model_d3_return_2d': 0.20, 'model_d5_return_2w': 0.35}


def main():
    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)

    # the same held-out fold the anchors were measured on
    lbl = 'forward_return_2w'
    base = df.dropna(subset=[lbl])
    d = pd.to_datetime(base['date'])
    test_all = base[d >= d.sort_values().iloc[int(len(base) * 0.85)]]

    # THE CONFOUND, controlled. features.csv mixes real events with injected NON-events
    # (is_null_sample=1), but live only ever scores symbols that tripped the z-threshold.
    # Comparing live against the mixed fold would find a "gap" that is really just the
    # non-events dragging the fold's distribution. Restricting to real events is the
    # apples-to-apples comparison; both are reported so the confound is visible rather
    # than assumed away. Live also applies a 2.15 z-floor, so the strictest comparison
    # additionally requires |z| >= 2.15.
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else 'events'
    if mode == 'all':
        test, desc = test_all, 'ALL fold rows (events + injected non-events)'
    elif mode == 'zfloor':
        test = test_all[(test_all['is_null_sample'] == 0) & (test_all['z_score'].abs() >= 2.15)]
        desc = 'real events with |z| >= 2.15 (live detection threshold)'
    else:
        test = test_all[test_all['is_null_sample'] == 0]
        desc = 'real events only (is_null_sample = 0)'
    print(f'held-out fold: {len(test):,} of {len(test_all):,} rows — {desc}')
    print(f'  {test["date"].min()} -> {test["date"].max()}\n')

    print(f"{'head':<24}{'fold median':>13}{'live median':>13}{'gap':>10}"
          f"{'fold p10':>10}{'fold p90':>10}{'live in fold range?':>21}")
    print('-' * 101)

    for col, fname, kind, live_med in HEADS:
        path = ML_DIR / fname
        if not path.exists():
            print(f'{col:<24}  MISSING {fname}')
            continue
        feats = json.load(open(path))['learner']['feature_names']
        bst = xgb.Booster(); bst.load_model(str(path))
        dm = xgb.DMatrix(test[feats], feature_names=feats)
        attrs = json.load(open(path))['learner'].get('attributes', {})
        rng = (0, int(attrs['best_iteration']) + 1) if 'best_iteration' in attrs else None
        p = bst.predict(dm, iteration_range=rng) if rng else bst.predict(dm)
        # NO sigmoid here. binary:logistic already returns a probability from
        # Booster.predict; applying one on top mapped ~0.99 to 0.729 and produced a
        # spurious "model A is out of distribution" reading on the first pass.
        # Then calibrate exactly as infer.py:213-215 does before serving.
        if kind == 'clf':
            cal_path = ML_DIR / 'calibrator_a_v9.1.pkl'
            if cal_path.exists():
                import pickle
                with open(cal_path, 'rb') as fh:
                    p = np.asarray(pickle.load(fh).transform(p))
        if col in CLAMPS:
            p = np.clip(p, -CLAMPS[col], CLAMPS[col])
        fmed, p10, p90 = np.median(p), np.percentile(p, 10), np.percentile(p, 90)
        inside = 'yes' if p10 <= live_med <= p90 else '** NO **'
        print(f'{col:<24}{fmed:>13.4f}{live_med:>13.4f}{live_med - fmed:>+10.4f}'
              f'{p10:>10.4f}{p90:>10.4f}{inside:>21}')

    print('\nReading: "NO" means the live median falls outside the middle 80% of what the')
    print('same model produces on the fold its anchor was measured on -- i.e. live and')
    print('test are not the same population, and the anchor is not a bar live can reach.')


if __name__ == '__main__':
    main()
