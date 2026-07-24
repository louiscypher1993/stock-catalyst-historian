#!/usr/bin/env python3
"""
Phenomenon 2 — population control. The 7 blue-chips show 0.80/0.81 pairwise
leaf-agreement on B/D2 (trees can't distinguish them). Is that BLUE-CHIP-SPECIFIC,
or does v9.4 lump ANY calm-signal symbol into the same leaf (a general
low-resolution property of the dense region)? Scores features.csv through the
deployed heads and measures mean pairwise leaf-agreement within random groups
binned by |z_score|, to compare against the 0.80/0.81 blue-chip figure.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb

ML_DIR = Path(__file__).parent
COLS = json.loads((ML_DIR / 'feature_metadata_v9.4.json').read_text())['full_feature_cols']
HEADS = {'B': 'model_b_v9.4.json', 'D2': 'model_d2_v9.4.json', 'D5': 'model_d5_v9.4.json'}
RNG = np.random.default_rng(42)

df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
df['is_us_listed'] = df['symbol'].apply(
    lambda s: 1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0).astype(int)
df = df[(df['is_null_sample'] == 0) & (df['date'] >= '2016-01-01')].reset_index(drop=True)
print(f"population: {len(df)} real post-2016 events")

def prep(sub):
    return xgb.DMatrix(pd.DataFrame({c: sub[c] if c in sub else 0 for c in COLS}, columns=COLS).fillna(0),
                       feature_names=COLS)

def mean_pair_agreement(leaf, n_pairs=4000):
    n = leaf.shape[0]
    a = RNG.integers(0, n, n_pairs); b = RNG.integers(0, n, n_pairs)
    keep = a != b
    return float(np.mean(np.mean(leaf[a[keep]] == leaf[b[keep]], axis=1)))

# |z| bins: calm (<1.5), mid (1.5-3), extreme (>3)
absz = df['z_score'].abs()
bins = {'calm |z|<1.5': df[absz < 1.5], 'mid 1.5-3': df[(absz >= 1.5) & (absz <= 3)],
        'extreme |z|>3': df[absz > 3]}

results = {}
for name, fn in HEADS.items():
    m = xgb.XGBRegressor(); m.load_model(ML_DIR / fn)
    bst = m.get_booster()
    bi = int(m.best_iteration) if getattr(m, 'best_iteration', None) is not None else 0
    rng = (0, bi + 1) if bi else (0, 0)
    row = {}
    for bname, sub in bins.items():
        s = sub.sample(min(1500, len(sub)), random_state=1) if len(sub) > 1500 else sub
        if len(s) < 20:
            row[bname] = None; continue
        leaf = bst.predict(prep(s), pred_leaf=True, iteration_range=rng)
        # effective resolution: distinct full leaf-vectors as frac of rows
        uniq = len(set(map(tuple, leaf))) / len(leaf)
        row[bname] = {'n': int(len(s)), 'mean_pair_leaf_agreement': mean_pair_agreement(leaf),
                      'distinct_leaf_vec_frac': float(uniq)}
    results[name] = row

print("\n=== Mean pairwise leaf-agreement by |z| bin (frac of trees, same leaf) ===")
print("   blue-chip P2 reference: B=0.801  D2=0.811  D5=0.498")
for h in HEADS:
    print(f"\n  {h}:")
    for bname, r in results[h].items():
        if r is None: print(f"    {bname:<16} (too few)"); continue
        print(f"    {bname:<16} n={r['n']:<5} pair-agreement={r['mean_pair_leaf_agreement']:.3f}   "
              f"distinct-leaf-vectors={r['distinct_leaf_vec_frac']*100:.1f}% of rows")

Path('C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/p2_population_results.json').write_text(json.dumps(results, indent=2))
print("\nInterpretation key:")
print("  If calm-bin agreement ≈ blue-chip 0.80 => general low-resolution in the dense/calm region (NOT blue-chip-specific).")
print("  If blue-chip 0.80 >> calm-bin agreement => the 7 blue-chips are anomalously convergent (specific).")
