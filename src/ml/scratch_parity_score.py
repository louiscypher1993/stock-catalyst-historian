#!/usr/bin/env python3
"""Do the parity fixes bring live model OUTPUTS back into the validated distribution?

scratch_parityImpact.ts rebuilds real live vectors under each LIVE_FEATURE_PARITY setting.
This scores them: each head's median prediction per mode, against the middle 80% of what
the same deployed model produces on the held-out fold its TEST_IC_DAILY anchor came from.

The bar is not "does the number move" but "does live land inside the band the anchors
describe". A head outside that band is being scored on a population its anchor does not
cover, which is what makes the September checkpoint a measurement of the wrong thing.

Reads only. Enables nothing.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

ML_DIR = Path(__file__).parent
MODES = ['off', 'atr', 'ced', 'all']
HEADS = {                      # head: (deployed artefact, live clamp)
    'model_b_return_1m':    ('model_b_v9.4.json',  0.30),
    'model_c_max_drawdown': ('model_c_v9.5.json',  None),   # v9.5 is what serves now
    'model_d3_return_2d':   ('model_d3_v9.4.json', 0.20),
    'model_d5_return_2w':   ('model_d5_v9.4.json', 0.35),
}


def load(head):
    path = ML_DIR / HEADS[head][0]
    feats = json.load(open(path))['learner']['feature_names']
    bst = xgb.Booster(); bst.load_model(str(path))
    attrs = json.load(open(path))['learner'].get('attributes', {})
    rng = (0, int(attrs['best_iteration']) + 1) if 'best_iteration' in attrs else None
    return feats, bst, rng


def predict(feats, bst, rng, frame, clamp):
    p = (bst.predict(xgb.DMatrix(frame, feature_names=feats), iteration_range=rng)
         if rng else bst.predict(xgb.DMatrix(frame, feature_names=feats)))
    return np.clip(p, -clamp, clamp) if clamp else p


def main():
    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    ev = df[(df['is_null_sample'] == 0) & (df['z_score'].abs() >= 2.15)
            & (df['date'] >= '2025-02-13')]

    blobs = {}
    for m in MODES:
        p = ML_DIR / 'scratch' / f'parity_{m}.json'
        if p.exists():
            blobs[m] = list(json.loads(p.read_text())['vectors'].values())
    print(f'fold rows {len(ev):,}; live vectors per mode '
          f'{ {m: len(v) for m, v in blobs.items()} }\n')

    for head, (fname, clamp) in HEADS.items():
        feats, bst, rng = load(head)
        fold = predict(feats, bst, rng, ev[feats], clamp)
        p10, p50, p90 = np.percentile(fold, [10, 50, 90])
        print(f'=== {head}   ({fname})')
        print(f'    fold median {p50:+.4f}   band p10..p90 [{p10:+.4f}, {p90:+.4f}]')
        for m in MODES:
            if m not in blobs:
                continue
            X = pd.DataFrame([{c: v.get(c, 0) for c in feats} for v in blobs[m]], columns=feats)
            live = predict(feats, bst, rng, X, clamp)
            lm = float(np.median(live))
            inside = p10 <= lm <= p90
            print(f'      {m:<4} live median {lm:+.4f}   {"IN band" if inside else "** OUT **":<10}'
                  f' dist-to-band {0.0 if inside else min(abs(lm - p10), abs(lm - p90)):.4f}')
        print()


if __name__ == '__main__':
    main()
