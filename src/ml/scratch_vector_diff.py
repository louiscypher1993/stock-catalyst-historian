#!/usr/bin/env python3
"""Field-by-field: where does a REAL live feature vector sit in the training distribution?

Six indirect explanations for the live/fold output gap have failed (3e6ed25), so this
compares the vectors themselves. scratch_dumpLiveVectors.ts captures live vectors using the
production functions; this places each field against the distribution of that same field
across training rows, and ranks by how far out it sits.

The ranking metric is the two-sided tail position: for each feature, what fraction of
training rows fall below the live value. 0.00 or 1.00 means every live sample is outside
the entire training range for that feature -- those are the ones that would push a
tree-ensemble into a region it never fit, and the candidates for the output gap.

Reports the MEDIAN across the sampled live symbols so a single odd name cannot dominate.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ML_DIR = Path(__file__).parent


def main():
    blob = json.loads((ML_DIR / 'scratch' / 'live_vectors.json').read_text())
    vectors, context = blob['vectors'], blob['context']
    print(f'live vectors: {len(vectors)} ({", ".join(vectors)})')

    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    feats = json.load(open(ML_DIR / 'model_c_v9.1.json'))['learner']['feature_names']

    # training comparison set: real events in the held-out fold window, live's own z-floor
    ev = df[(df['is_null_sample'] == 0) & (df['z_score'].abs() >= 2.15)
            & (df['date'] >= '2025-02-13')]
    print(f'training comparison rows: {len(ev):,}\n')

    rows = []
    for f in feats:
        if f not in ev.columns:
            rows.append((f, np.nan, np.nan, np.nan, np.nan, 'NOT IN features.csv'))
            continue
        train = ev[f].dropna().values
        if len(train) == 0:
            continue
        live_vals = [v.get(f) for v in vectors.values()]
        live_vals = [x for x in live_vals if isinstance(x, (int, float))]
        if not live_vals:
            rows.append((f, np.nan, np.nan, np.nan, np.nan, 'ABSENT from live vector'))
            continue
        # MID-RANK percentile, not a strict-less-than fraction. These features are heavily
        # zero-inflated, and `(train < 0).mean()` returns 0.000 whenever the training MODE
        # is zero -- i.e. it scores perfect agreement as maximal disagreement. A first cut
        # using that flagged 34 of 72 features and was almost entirely artefact.
        pos = [float(((train < x).mean() + (train <= x).mean()) / 2) for x in live_vals]
        med_pos = float(np.median(pos))
        # Separately: is live pinned at zero for something training usually has? That is
        # the "live cannot compute this feature" class, invisible to a percentile.
        zero_gap = (float(np.median(live_vals)) == 0.0) and (float((train != 0).mean()) > 0.5)
        rows.append((f, float(np.median(live_vals)), float(np.median(train)),
                     med_pos, min(med_pos, 1 - med_pos), 'ZERO-LIVE' if zero_gap else ''))

    res = pd.DataFrame(rows, columns=['feature', 'live_med', 'train_med', 'tail_pos',
                                      'extremity', 'note'])
    missing = res[res['note'].isin(['NOT IN features.csv', 'ABSENT from live vector'])]
    if len(missing):
        print(f'--- {len(missing)} feature(s) missing on one side entirely ---')
        for _, r in missing.iterrows():
            print(f'   {r.feature:<34} {r.note}')
        print()

    zl = res[res['note'] == 'ZERO-LIVE'].sort_values('train_med', key=abs, ascending=False)
    print(f'--- ZERO LIVE, but populated in training ({len(zl)} features) ---')
    print('    live sends 0.0 while >50% of training rows carry a real value')
    print(f"{'feature':<34}{'live med':>11}{'train med':>12}{'train nonzero':>15}")
    print('-' * 72)
    for _, r in zl.iterrows():
        nz = (ev[r.feature] != 0).mean()
        print(f'{r.feature:<34}{r.live_med:>11.4f}{r.train_med:>12.4f}{nz:>14.1%}')

    ok = res[res['note'] == ''].sort_values('extremity')
    print('\n--- genuinely tail-positioned live values (mid-rank percentile) ---')
    print(f"{'feature':<34}{'live med':>12}{'train med':>12}{'pctile':>9}")
    print('-' * 67)
    for _, r in ok.head(10).iterrows():
        print(f'{r.feature:<34}{r.live_med:>12.4f}{r.train_med:>12.4f}{r.tail_pos:>9.3f}')
    n_out = int((ok['extremity'] <= 0.02).sum())
    print(f'\n{n_out} of {len(ok)} comparable features sit beyond the outer 2% of training.')


if __name__ == '__main__':
    main()
