#!/usr/bin/env python3
"""
Phenomenon 2 re-investigation (2026-07-23) — the raw-prediction cross-check the
07-13 recon never ran, plus the mechanism probe (leaf-insensitivity /
shared-macro dominance) that was never done.

Scores the 8 reconstructed live vectors (7 P2 blue-chips + DVN) through the
DEPLOYED v9.4 heads and reports, per head:
  1. RAW (unclamped) predictions        -> pathological (Phenomenon-1-like) or sane?
  2. spread across the 7 P2 symbols      -> do they actually cluster?
  3. leaf-assignment agreement (pred_leaf) -> can the trees distinguish them?
  4. feature contributions (pred_contribs) -> shared-macro vs symbol-specific driver?
Read-only. Writes a JSON summary to scratch/.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb

ML_DIR = Path(__file__).parent
SP = Path('C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad')
VEC = json.loads((SP / 'p2_vectors.json').read_text())
COLS = json.loads((ML_DIR / 'feature_metadata_v9.4.json').read_text())['full_feature_cols']

P2 = ['AXP', 'CVX', 'O', 'PLD', 'TSLA', 'META', 'BCE']
HEADS = {'B': 'model_b_v9.4.json', 'D1': 'model_d1_v9.4.json', 'D2': 'model_d2_v9.4.json',
         'D3': 'model_d3_v9.4.json', 'D5': 'model_d5_v9.4.json'}
# shared/market-wide features (not symbol-specific) — for the dominance test
MACRO = {'vix_close', 'vix_regime', 'trend_regime', 'yield_curve_spread', 'credit_spread',
         'economic_policy_uncertainty', 'primaryCategory_macro'}

syms = list(VEC['vectors'].keys())
X = pd.DataFrame([{c: VEC['vectors'][s].get(c, 0) for c in COLS} for s in syms], columns=COLS)
dm = xgb.DMatrix(X, feature_names=COLS)

out = {}
print(f"symbols: {syms}\n")
raw_table = {}
for name, fn in HEADS.items():
    m = xgb.XGBRegressor(); m.load_model(ML_DIR / fn)
    bst = m.get_booster()
    bi = int(m.best_iteration) if getattr(m, 'best_iteration', None) is not None else 0
    rng = (0, bi + 1) if bi else (0, 0)
    raw = bst.predict(dm, iteration_range=rng)
    leaf = bst.predict(dm, pred_leaf=True, iteration_range=rng)          # (n_sym, n_trees)
    contrib = bst.predict(dm, pred_contribs=True, iteration_range=rng)   # (n_sym, n_feat+1)
    raw_table[name] = {s: float(raw[i]) for i, s in enumerate(syms)}

    # leaf agreement: mean fraction of trees where a pair lands in the same leaf
    n_trees = leaf.shape[1]
    idx = {s: i for i, s in enumerate(syms)}
    p2i = [idx[s] for s in P2 if s in idx]
    def pair_agree(a, b):
        return float(np.mean(leaf[a] == leaf[b]))
    p2_pairs = [pair_agree(a, b) for k, a in enumerate(p2i) for b in p2i[k+1:]]
    # baseline: agreement of each P2 symbol vs DVN (a non-cluster reference)
    dvn = idx.get('DVN')
    dvn_pairs = [pair_agree(a, dvn) for a in p2i] if dvn is not None else []

    # contribution dominance: for each symbol, share of |contrib| from MACRO feats
    macro_idx = [COLS.index(c) for c in MACRO if c in COLS]
    dom = {}
    top_feat = {}
    for i, s in enumerate(syms):
        cvec = np.abs(contrib[i, :len(COLS)])
        tot = cvec.sum() or 1.0
        dom[s] = float(cvec[macro_idx].sum() / tot)
        order = np.argsort(-cvec)[:4]
        top_feat[s] = [(COLS[j], round(float(contrib[i, j]), 4)) for j in order]

    out[name] = {
        'raw': raw_table[name],
        'p2_spread_std': float(np.std([raw_table[name][s] for s in P2 if s in raw_table[name]])),
        'p2_range': [float(min(raw_table[name][s] for s in P2 if s in raw_table[name])),
                     float(max(raw_table[name][s] for s in P2 if s in raw_table[name]))],
        'n_trees': int(n_trees),
        'p2_leaf_agreement_mean': float(np.mean(p2_pairs)) if p2_pairs else None,
        'p2_vs_dvn_leaf_agreement_mean': float(np.mean(dvn_pairs)) if dvn_pairs else None,
        'macro_contrib_share': dom,
        'top_features': top_feat,
    }

# ── report ──
print("=== RAW (unclamped) predictions per head — pathological vs sane ===")
print(f"{'sym':<6}" + "".join(f"{h:>10}" for h in HEADS))
for s in syms:
    tag = '' if s in P2 else '  <- DVN ref'
    print(f"{s:<6}" + "".join(f"{raw_table[h][s]*100:>9.2f}%" for h in HEADS) + tag)

print("\n=== Clustering: do the 7 P2 symbols cluster? (std across P2, per head) ===")
for h in HEADS:
    o = out[h]
    print(f"  {h}: P2 raw range [{o['p2_range'][0]*100:.2f}%, {o['p2_range'][1]*100:.2f}%]  std={o['p2_spread_std']*100:.2f}pp")

print("\n=== Leaf-insensitivity: mean pairwise leaf agreement (frac of trees, same leaf) ===")
print("   (high P2-agreement AND P2>>P2-vs-DVN => trees can't distinguish the blue-chips)")
for h in HEADS:
    o = out[h]
    print(f"  {h}: P2-vs-P2={o['p2_leaf_agreement_mean']:.3f}   P2-vs-DVN={o['p2_vs_dvn_leaf_agreement_mean']:.3f}   ({o['n_trees']} trees)")

print("\n=== Shared-macro dominance: share of |contribution| from macro/market-wide feats ===")
for h in HEADS:
    shares = [out[h]['macro_contrib_share'][s] for s in P2 if s in out[h]['macro_contrib_share']]
    print(f"  {h}: P2 macro-share mean={np.mean(shares)*100:.1f}%  (per-symbol: " +
          ", ".join(f"{s} {out[h]['macro_contrib_share'][s]*100:.0f}%" for s in P2 if s in out[h]['macro_contrib_share']) + ")")

(SP / 'p2_score_results.json').write_text(json.dumps(out, indent=2))
print(f"\nWrote {SP / 'p2_score_results.json'}")
