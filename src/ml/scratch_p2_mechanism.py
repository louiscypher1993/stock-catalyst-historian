#!/usr/bin/env python3
"""
Phenomenon 2 — what routes the 7 blue-chips into the same D2 leaf? Compares
their reconstructed feature values against the population distribution to find
the features on which the 7 are (a) unusually homogeneous AND (b) sit in a
distinctive region — i.e. the features the D2 trees would use to isolate them.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd

ML_DIR = Path(__file__).parent
SP = Path('C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad')
COLS = json.loads((ML_DIR / 'feature_metadata_v9.4.json').read_text())['full_feature_cols']
VEC = json.loads((SP / 'p2_vectors.json').read_text())['vectors']
P2 = ['AXP', 'CVX', 'O', 'PLD', 'TSLA', 'META', 'BCE']

pv = pd.DataFrame([{c: VEC[s].get(c, 0) for c in COLS} for s in P2], index=P2, columns=COLS)

df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
df['is_us_listed'] = df['symbol'].apply(
    lambda s: 1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0).astype(int)
pop = df[(df['is_null_sample'] == 0) & (df['date'] >= '2016-01-01')]

rows = []
for c in COLS:
    if c not in pop.columns:
        continue
    p2vals = pv[c].values.astype(float)
    popvals = pop[c].dropna().astype(float)
    if len(popvals) < 100:
        continue
    p2_std = float(np.std(p2vals))
    pop_std = float(np.std(popvals)) or 1e-9
    p2_med = float(np.median(p2vals))
    # percentile of the P2 median within the population
    pctile = float((popvals < p2_med).mean() * 100)
    # homogeneity: how tight the 7 are vs the population spread
    homogeneity = p2_std / pop_std
    rows.append({'feature': c, 'p2_median': round(p2_med, 4), 'pop_pctile_of_p2med': round(pctile, 1),
                 'p2_std_over_pop_std': round(homogeneity, 3)})

r = pd.DataFrame(rows)
# The routing features: 7 are TIGHT (low homogeneity ratio) AND sit far from pop center (extreme pctile)
r['extremeness'] = (r['pop_pctile_of_p2med'] - 50).abs()
cand = r[(r['p2_std_over_pop_std'] < 0.25)].sort_values('extremeness', ascending=False)
print("=== Features where the 7 blue-chips are TIGHT (std < 0.25x pop) AND distinctive ===")
print("   (these are what a tree would split on to isolate the cluster)\n")
print(f"{'feature':<34}{'p2_median':>11}{'pop_pctile':>11}{'tightness':>11}")
for _, x in cand.head(18).iterrows():
    print(f"{x['feature']:<34}{x['p2_median']:>11.4f}{x['pop_pctile_of_p2med']:>10.1f}%{x['p2_std_over_pop_std']:>11.3f}")

print("\n=== Per-symbol values on the most distinctive tight features ===")
top = cand.head(8)['feature'].tolist()
print(f"{'sym':<6}" + "".join(f"{c[:12]:>13}" for c in top))
for s in P2:
    print(f"{s:<6}" + "".join(f"{pv.loc[s, c]:>13.3f}" for c in top))
