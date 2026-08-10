#!/usr/bin/env python3
"""Universe expansion pre-measurement (method rule: measure BEFORE enabling).

Q1  How far do the deployed heads move when the SAME live anomaly is scored with no
    enrichment (what every newly-added symbol gets)?  -> paired deltas on the 33
    verified reconstruction pairs from scratch_expansionPair.ts.

Q2  How much ACCURACY does that cost?  -> fold ablation: apply the no-snapshot
    transformation to the held-out test fold and compare day-clustered IC against
    realized labels, per head.

Q3  How much of that is the PRE-EXISTING primaryCategory defect (every live row is
    one-hot'd market_structure because CI has no local event_features)?  -> a
    category-forcing-only arm, which applies to ALL live rows today, not just
    expansion symbols.

CI-faithfulness fix baked in here rather than in the TS dump: the local `without`
arm resolved sector via the 2.7GB local profiles DB, which does not exist in CI.
CI gives an unknown symbol sector_Other=1 (normaliseSector(null) -> 'Other'), so
that is what the without arm gets here.

Reads only. Enables nothing.
"""
import json
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr, ttest_rel

ML_DIR = Path(__file__).parent
HEADS = {  # head: (artefact, clamp, label column)
    'model_b_return_1m':    ('model_b_v9.4.json',  0.30, 'forward_return_1m'),
    'model_c_max_drawdown': ('model_c_v9.5.json',  None, 'max_adverse_excursion_1m'),
    'model_d1_return_3m':   ('model_d1_v9.4.json', 0.50, 'forward_return_3m'),
    'model_d2_return_6m':   ('model_d2_v9.4.json', 0.40, 'forward_return_6m'),
    'model_d3_return_2d':   ('model_d3_v9.4.json', 0.20, 'forward_return_2d'),
    'model_d5_return_2w':   ('model_d5_v9.4.json', 0.35, 'forward_return_2w'),
}


def load(fname):
    path = ML_DIR / fname
    j = json.load(open(path))
    feats = j['learner']['feature_names']
    bst = xgb.Booster(); bst.load_model(str(path))
    attrs = j['learner'].get('attributes', {})
    rng = (0, int(attrs['best_iteration']) + 1) if 'best_iteration' in attrs else None
    return feats, bst, rng


def predict(feats, bst, rng, frame, clamp):
    p = (bst.predict(xgb.DMatrix(frame, feature_names=feats), iteration_range=rng)
         if rng else bst.predict(xgb.DMatrix(frame, feature_names=feats)))
    return np.clip(p, -clamp, clamp) if clamp is not None else p


def day_ic(pred, label, dates):
    out = []
    f = pd.DataFrame({'p': pred, 'y': label, 'd': dates}).dropna()
    for _, g in f.groupby('d'):
        if len(g) >= 5 and g['p'].nunique() > 1 and g['y'].nunique() > 1:
            out.append(spearmanr(g['p'], g['y'])[0])
    return np.array(out)


def main():
    blob = json.loads((ML_DIR / 'scratch' / 'expansion_pairs.json').read_text())
    pairs, changed = blob['pairs'], blob['changedColumns']

    # Modal without-arm value per changed column = the data-driven fill (0 for nulled
    # numerics, 1 for _is_null indicators, whatever build_df actually produced).
    fill = {}
    for c in changed:
        vals = Counter(p['without'].get(c, 0) for p in pairs.values())
        fill[c] = vals.most_common(1)[0][0]
    sector_cols_all0 = None  # resolved per model feature list below

    def apply_without(frame, feats, force_category=False):
        f = frame.copy()
        for c, v in fill.items():
            if c in f.columns:
                f[c] = v
        for c in [c for c in feats if c.startswith('sector_')]:
            f[c] = 1.0 if c == 'sector_Other' else 0.0
        if force_category:
            for c in [c for c in feats if c.startswith('primaryCategory_')]:
                f[c] = 1.0 if c == 'primaryCategory_market_structure' else 0.0
        return f

    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    ev = df[(df['is_null_sample'] == 0) & (df['z_score'].abs() >= 2.15)
            & (df['date'] >= '2025-02-13')].reset_index(drop=True)
    print(f'test-fold event rows: {len(ev):,}  ({ev["date"].nunique()} dates)')
    print(f'changed columns: {len(changed)};  pairs: {len(pairs)}\n')

    print('=' * 100)
    print('Q1  PAIRED LIVE DELTAS (33 verified reconstructions, with-enrichment vs none)')
    print('=' * 100)
    for head, (fname, clamp, _) in HEADS.items():
        feats, bst, rng = load(fname)
        Xw = pd.DataFrame([{c: p['with'].get(c, 0) for c in feats} for p in pairs.values()], columns=feats)
        Xo0 = pd.DataFrame([{c: p['without'].get(c, 0) for c in feats} for p in pairs.values()], columns=feats)
        # CI-faithful sector for the without arm (see docstring)
        for c in [c for c in feats if c.startswith('sector_')]:
            Xo0[c] = 1.0 if c == 'sector_Other' else 0.0
        pw = predict(feats, bst, rng, Xw, clamp)
        po = predict(feats, bst, rng, Xo0, clamp)
        d = po - pw
        fold = predict(feats, bst, rng, ev[feats], clamp)
        p10, p50, p90 = np.percentile(fold, [10, 50, 90])
        mo = float(np.median(po))
        print(f'{head:<24} with med {np.median(pw):+.4f} -> without med {mo:+.4f}   '
              f'delta med {np.median(d):+.4f} (IQR {np.percentile(d,25):+.4f}..{np.percentile(d,75):+.4f})   '
              f'without {"IN" if p10 <= mo <= p90 else "**OUT**"} fold band [{p10:+.4f},{p90:+.4f}]')

    print()
    print('=' * 100)
    print('Q2/Q3  FOLD ACCURACY COST (day-clustered IC vs realized labels, same fold as anchors)')
    print('=' * 100)
    print(f'{"head":<24} {"base IC":>9} {"nosnap IC":>10} {"delta":>8} {"t":>6}   '
          f'{"cat-only IC":>11} {"delta":>8} {"t":>6}')
    for head, (fname, clamp, label) in HEADS.items():
        feats, bst, rng = load(fname)
        sub = ev.dropna(subset=[label])
        base = predict(feats, bst, rng, sub[feats], clamp)
        nosnap = predict(feats, bst, rng, apply_without(sub[feats], feats, force_category=True), clamp)
        catonly_f = sub[feats].copy()
        for c in [c for c in feats if c.startswith('primaryCategory_')]:
            catonly_f[c] = 1.0 if c == 'primaryCategory_market_structure' else 0.0
        catonly = predict(feats, bst, rng, catonly_f, clamp)

        y, dts = sub[label].values, sub['date'].values
        ic_b, ic_n, ic_c = (day_ic(base, y, dts), day_ic(nosnap, y, dts), day_ic(catonly, y, dts))
        n = min(len(ic_b), len(ic_n), len(ic_c))
        tb_n = ttest_rel(ic_n[:n], ic_b[:n])
        tb_c = ttest_rel(ic_c[:n], ic_b[:n])
        print(f'{head:<24} {np.mean(ic_b):>+9.4f} {np.mean(ic_n):>+10.4f} '
              f'{np.mean(ic_n)-np.mean(ic_b):>+8.4f} {tb_n.statistic:>6.2f}   '
              f'{np.mean(ic_c):>+11.4f} {np.mean(ic_c)-np.mean(ic_b):>+8.4f} {tb_c.statistic:>6.2f}')

    print('\nNote: "nosnap" = every snapshot-sourced feature nulled + sector_Other + '
          'market_structure category — the full newly-added-symbol condition. "cat-only" '
          'isolates the primaryCategory defect that ALREADY applies to every live row.')


if __name__ == '__main__':
    main()
