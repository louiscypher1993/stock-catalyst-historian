#!/usr/bin/env python3
"""
Phenomenon 2 — the definitive specificity test. All 26 symbols reconstructed
through the IDENTICAL live path (same-path, apples-to-apples). Measures mean
pairwise leaf-agreement WITHIN and ACROSS groups:
  P2 (the 7)  vs  CTRL_LARGE (other large-caps)  vs  CTRL_OTHER (mid/smaller).
Resolves: is the 0.81 convergence specific to these 7, general to large-caps,
or a live-path artifact affecting ANY calm symbol?
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb
from itertools import combinations, product

ML_DIR = Path(__file__).parent
SP = Path('C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad')
data = json.loads((SP / 'p2_vectors.json').read_text())
VEC, META = data['vectors'], data['meta']
COLS = json.loads((ML_DIR / 'feature_metadata_v9.4.json').read_text())['full_feature_cols']
HEADS = {'B': 'model_b_v9.4.json', 'D1': 'model_d1_v9.4.json', 'D2': 'model_d2_v9.4.json',
         'D3': 'model_d3_v9.4.json', 'D5': 'model_d5_v9.4.json'}

syms = list(VEC.keys())
grp = {s: META[s]['group'] for s in syms}
groups = {'P2': [s for s in syms if grp[s] == 'P2'],
          'CTRL_LARGE': [s for s in syms if grp[s] == 'CTRL_LARGE'],
          'CTRL_OTHER': [s for s in syms if grp[s] == 'CTRL_OTHER']}
idx = {s: i for i, s in enumerate(syms)}
X = pd.DataFrame([{c: VEC[s].get(c, 0) for c in COLS} for s in syms], columns=COLS)
dm = xgb.DMatrix(X, feature_names=COLS)

print("group sizes:", {k: len(v) for k, v in groups.items()}, "\n")

def within(leaf, members):
    ii = [idx[s] for s in members]
    ps = [float(np.mean(leaf[a] == leaf[b])) for a, b in combinations(ii, 2)]
    return float(np.mean(ps)) if ps else float('nan')

def across(leaf, g1, g2):
    ps = [float(np.mean(leaf[idx[a]] == leaf[idx[b]])) for a, b in product(g1, g2)]
    return float(np.mean(ps)) if ps else float('nan')

for name, fn in HEADS.items():
    m = xgb.XGBRegressor(); m.load_model(ML_DIR / fn)
    bst = m.get_booster()
    bi = int(m.best_iteration) if getattr(m, 'best_iteration', None) is not None else 0
    rng = (0, bi + 1) if bi else (0, 0)
    leaf = bst.predict(dm, pred_leaf=True, iteration_range=rng)
    wP2 = within(leaf, groups['P2'])
    wL = within(leaf, groups['CTRL_LARGE'])
    wO = within(leaf, groups['CTRL_OTHER'])
    aP2L = across(leaf, groups['P2'], groups['CTRL_LARGE'])
    print(f"{name}:  within P2={wP2:.3f}   within CTRL_LARGE={wL:.3f}   within CTRL_OTHER={wO:.3f}   "
          f"P2xLARGE={aP2L:.3f}")
