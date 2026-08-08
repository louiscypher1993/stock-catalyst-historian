#!/usr/bin/env python3
"""Which features CAUSE the live/fold output gap? One-at-a-time substitution.

Distribution diffing found competitor_event_density (dd6b4e6) but left C and D3 unexplained.
This is the causal version: take the training fold, replace ONE feature column with the
value live actually supplies, re-predict, and measure how much of that head's fold->live
gap the substitution closes. Ranked, so the features that matter surface regardless of
whether their distributions looked odd.

Uses live_anomaly_vectors.json -- vectors reconstructed for symbol/dates the live scanner
itself flagged at |z| >= 2.15, so the populations are z-matched. The earlier quiet-day
sample (|z| median 0.31) is what produced the kinetic_energy false lead.

Substituting a constant (the live median) understates features whose live SPREAD matters
and can overstate a feature the model reads interactively, so treat the ranking as a
shortlist to verify, not a decomposition that must sum to 100%.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

ML_DIR = Path(__file__).parent

TARGETS = {                       # head: (artefact, clamp, observed live median)
    'model_c_max_drawdown':  ('model_c_v9.1.json',  None,  -0.0980),
    'model_d3_return_2d':    ('model_d3_v9.4.json', 0.20,   0.0357),
    'model_b_return_1m':     ('model_b_v9.4.json',  0.30,   0.3000),
    'model_d5_return_2w':    ('model_d5_v9.4.json', 0.35,   0.0231),
}


def main():
    blob = json.loads((ML_DIR / 'scratch' / 'live_anomaly_vectors.json').read_text())
    vectors = blob['vectors']
    zs = [abs(c['rebuilt_z']) for c in blob['context'].values()]
    print(f'live vectors: {len(vectors)}, |z| median {np.median(zs):.2f}')

    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    ev = df[(df['is_null_sample'] == 0) & (df['z_score'].abs() >= 2.15)
            & (df['date'] >= '2025-02-13')]
    print(f'fold rows: {len(ev):,}\n')

    for head, (fname, clamp, live_med) in TARGETS.items():
        feats = json.load(open(ML_DIR / fname))['learner']['feature_names']
        bst = xgb.Booster(); bst.load_model(str(ML_DIR / fname))
        attrs = json.load(open(ML_DIR / fname))['learner'].get('attributes', {})
        rng = (0, int(attrs['best_iteration']) + 1) if 'best_iteration' in attrs else None
        X = ev[feats].copy()

        def med_pred(frame):
            p = (bst.predict(xgb.DMatrix(frame, feature_names=feats), iteration_range=rng)
                 if rng else bst.predict(xgb.DMatrix(frame, feature_names=feats)))
            if clamp:
                p = np.clip(p, -clamp, clamp)
            return float(np.median(p))

        base = med_pred(X)
        gap = live_med - base
        rows = []
        for f in feats:
            live_vals = [v.get(f) for v in vectors.values()]
            live_vals = [x for x in live_vals if isinstance(x, (int, float))]
            if not live_vals:
                continue
            lv = float(np.median(live_vals))
            if np.isclose(lv, float(X[f].median()), rtol=1e-6, atol=1e-9):
                continue
            Xm = X.copy(); Xm[f] = lv
            rows.append((f, lv, float(X[f].median()), med_pred(Xm)))

        r = pd.DataFrame(rows, columns=['feature', 'live', 'fold', 'pred'])
        r['closed'] = (r['pred'] - base) / gap if gap else np.nan
        r = r.reindex(r['closed'].abs().sort_values(ascending=False).index)

        print(f'=== {head} ===  fold median {base:+.4f} -> live {live_med:+.4f} '
              f'(gap {gap:+.4f})')
        print(f"  {'feature':<32}{'live':>12}{'fold':>12}{'pred':>10}{'gap closed':>13}")
        print('  ' + '-' * 77)
        for _, x in r.head(7).iterrows():
            print(f'  {x.feature:<32}{x.live:>12.4f}{x.fold:>12.4f}{x.pred:>10.4f}'
                  f'{x.closed:>12.1%}')
        print()


if __name__ == '__main__':
    main()
