#!/usr/bin/env python3
"""Model C v9.5 — retrain without the corrupt pre-2021 rows, + matching breakpoints.

EVIDENCE (src/ml/scratch_c_corrupt_target.py, 2026-08-04). Dropping the 16,435 pre-2021
rows whose max_adverse_excursion_1m was built from MONTHLY/QUARTERLY bars raises C's
day-clustered rank correlation from +0.3333 to +0.3543 — 4/4 folds, and paired across the
765 shared test days +0.0237, t=+5.43, p=7.4e-08 (Wilcoxon p=5.5e-08). First result in
this project to clear the Harvey-Liu-Zhu t>3.0 hurdle.

WHY THE ROWS-ONLY ARM AND NOT c-cand. c-cand (rows + dropping the two stamped leakage
features) scored identically inside noise: +0.0213 vs +0.0210, t=5.37 vs 5.43. But
infer.py builds ONE `bcde_df` from `model_bcde_cols` and feeds it to B, C, D1-D5 and E
alike. Giving C a 70-column schema while its siblings keep 72 would fracture that shared
frame for no measured gain. v9.5 keeps all 72 columns and is a drop-in replacement.

PROTOCOL IS v9.1, NOT v9.4. C has never been retrained past v9.1, so this matches
train_all_models_v9.py::train_regressor exactly — REG_PARAMS max_depth=5, subsample=0.8,
colsample_bytree=0.8; asymmetric MSE (2.5/1.0); VIX x liquidity weights on train only;
chronological 70/15/15 with a 21-day embargo; 1000 rounds, early stopping 50 — and does
NOT apply v9.4's row-exclusion hygiene, which shipped for B/D1/D2/D3/D5 only. The single
change from v9.1 is the training rows.

BREAKPOINTS SHIP WITH THE MODEL. C is consumed as a PERCENTILE
(modelCPercentileRank -> riskScore -> position size), and MODEL_C_PERCENTILE_BREAKPOINTS
in PotService.ts were fitted to the v9.1 model's own output distribution. Pushing a
differently-levelled model through the v9.1 breakpoints is the 18.46-riskScore-point
artefact measured in scratch_c_decision_impact.py — pure recalibration debt. So this
script emits the v9.5 breakpoints from the same held-out fold, in the same format, and
they are non-optional: model and breakpoints move together or neither moves.

Writes model_c_v9.5.json + model_c_breakpoints_v9.5.json. Changes no default: infer.py
stays on v9.1 until MODEL_C_VERSION=9.5 is set.

Usage:
  python src/ml/train_model_c_v9_5.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr
from sklearn.metrics import mean_absolute_error, mean_squared_error

import scratch_c_corrupt_target as C

ML_DIR = Path(__file__).parent
MODEL_OUT = ML_DIR / 'model_c_v9.5.json'
BREAKPOINTS_OUT = ML_DIR / 'model_c_breakpoints_v9.5.json'
# the percentile grid PotService.ts:350-368 already uses — kept identical so the new
# table is a drop-in for the old one and the two can be diffed row by row
PCTS = [0.00, 0.01, 0.02, 0.05, 0.10, 0.20, 0.30, 0.40, 0.50,
        0.60, 0.70, 0.80, 0.90, 0.95, 0.98, 0.99, 1.00]


def main():
    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)

    null_ind = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(C.EXCLUDE_COLS) | set(null_ind) | set(C.ZERO_FILL_COLS)
                 | set(C.PRE_RETURN_COLS) | set(object_cols))
    feats = [c for c in df.columns if c not in drop_cols]

    # the schema must stay byte-identical to what the other heads are served
    deployed_feats = json.load(open(ML_DIR / 'model_c_v9.1.json'))['learner']['feature_names']
    if feats != deployed_feats:
        raise SystemExit(f'FEATURE SCHEMA DRIFT — v9.5 would be served a different frame '
                         f'than v9.1.\n  only in new: {set(feats) - set(deployed_feats)}\n'
                         f'  only in old: {set(deployed_feats) - set(feats)}\n'
                         f'  order differs: {feats != deployed_feats}')
    print(f'feature schema matches deployed v9.1 exactly ({len(feats)} cols)')

    pre21 = df['date'] < '2021-01-01'
    fixed = df[~pre21]
    print(f'training rows {len(df):,} -> {len(fixed):,} '
          f'(dropped {int(pre21.sum()):,} corrupt pre-2021)')

    # LABEL OUTLIER CLIP. A max adverse excursion is (min_low - close)/close: bounded
    # below by -1, positive only when the low never went under the entry. |y| > 1 implies
    # the 21-bar MINIMUM low was more than 2x the entry inside a month — a data error, not
    # a market move. One row qualifies post-2021 (III.L 2023-12-01, +113.54, a GBp/GBP
    # scale artefact) and it drags the label std from 0.102 to 0.516. v9.4's row-exclusion
    # cannot catch it: that filter keys on overnight_gap_pct (0.004 here) and
    # excess_return (-0.99), never on the label.
    #
    # This is not cosmetic. RMSE-based early stopping is precisely what an outlier of that
    # size destabilises: measured over 4 folds the clip lets training run 52 -> 64 rounds,
    # takes "no downside" predictions from 19.4% to 0.0%, and cuts calibration error
    # 0.0747 -> 0.0641 while holding the rank gain (paired t vs deployed 5.43 -> 5.15).
    # scratch_c_calibration_arms.py also tested base_score = label mean, the obvious other
    # candidate: it HURTS (rank -0.0105, paired t -3.30, training collapses to ~11 rounds
    # and one fold stops at iteration 0). Not adopted.
    outl = fixed[C.LABEL].abs() > 1.0
    fixed = fixed[~outl]
    print(f'  minus {int(outl.sum())} label-outlier row(s) |y|>1 -> {len(fixed):,}')

    sub = fixed.dropna(subset=[C.LABEL])
    dates = pd.to_datetime(sub['date'])
    sorted_d = dates.sort_values()
    n = len(sub)
    emb = pd.Timedelta(days=C.EMBARGO_DAYS)
    cut_tr, cut_va = sorted_d.iloc[int(n * 0.70)], sorted_d.iloc[int(n * 0.85)]
    tr = sub[dates < (cut_tr - emb)]
    va = sub[(dates >= cut_tr) & (dates < (cut_va - emb))]
    te = sub[dates >= cut_va]
    print(f'temporal split: train={len(tr):,} val={len(va):,} test={len(te):,} '
          f'(embargo {C.EMBARGO_DAYS}d)')
    print(f'  test fold {te["date"].min()} -> {te["date"].max()}')

    dtr = xgb.DMatrix(tr[feats], label=tr[C.LABEL],
                      weight=C.compute_sample_weights(tr), feature_names=feats)
    dva = xgb.DMatrix(va[feats], label=va[C.LABEL], feature_names=feats)
    bst = xgb.train(C.REG_PARAMS_V91, dtr, num_boost_round=1000, obj=C.asymmetric_mse(),
                    evals=[(dva, 'val')], early_stopping_rounds=50, verbose_eval=False)
    print(f'best_iteration {bst.best_iteration} (v9.1 stopped at 24 — a model that never '
          f'descended from base_score=0.5)')

    # Predict the way infer.py will: XGBRegressor.predict truncates at best_iteration+1.
    pred = bst.predict(xgb.DMatrix(te[feats], feature_names=feats),
                       iteration_range=(0, bst.best_iteration + 1))
    y = te[C.LABEL].values
    ic, sd, nd, t, _ = C.daily_ic(te['date'].values, y, pred)
    print(f'\nheld-out test fold, {len(te):,} rows')
    print(f'  day-clustered IC   {ic:+.4f}  t={t:+.2f} ({nd} days)')
    print(f'  pooled Spearman    {spearmanr(y, pred).statistic:+.4f}')
    print(f'  RMSE {np.sqrt(mean_squared_error(y, pred)):.4f}  '
          f'MAE {mean_absolute_error(y, pred):.4f}')
    print(f'  CALIBRATION  predicted mean {pred.mean():+.4f} vs realized {y.mean():+.4f}'
          f'   |  predicted median {np.median(pred):+.4f} vs realized {np.median(y):+.4f}')
    print(f'  says "no downside" (pred > 0) on {np.mean(pred > 0):.1%} of rows '
          f'(v9.1 served path: 84.3%)')

    bst.save_model(str(MODEL_OUT))

    # Breakpoints from THIS model's held-out distribution — same construction as the
    # v9.1 table, so the two are directly comparable and the mapping stays a percentile
    # rank rather than a stale absolute scale.
    bps = [[p, round(float(np.quantile(pred, p)), 4)] for p in PCTS]
    meta = {
        'version': '9.5',
        'model_file': MODEL_OUT.name,
        'derived_from': {
            'fold_rows': int(len(te)),
            'fold_start': str(te['date'].min()), 'fold_end': str(te['date'].max()),
            'best_iteration': int(bst.best_iteration),
        },
        'sign_convention': 'higher modelC = safer (shallower drawdown); '
                           'low percentile = historically riskiest tail',
        'note': 'Fitted to model_c_v9.5 outputs. NOT interchangeable with the v9.1 table '
                'in PotService.ts — pairing a model with the other version\'s breakpoints '
                'shifts the riskScore drawdown term by ~18 points.',
        'breakpoints': bps,
    }
    BREAKPOINTS_OUT.write_text(json.dumps(meta, indent=2))

    print(f'\nwrote {MODEL_OUT.name} and {BREAKPOINTS_OUT.name}')
    print('\nv9.5 breakpoints (pct, value)  — compare with PotService.ts:350-368')
    old = dict(C.MODEL_C_BREAKPOINTS)
    print(f"  {'pct':>6}{'v9.1':>10}{'v9.5':>10}")
    for p, v in bps:
        print(f'  {p:>6.2f}{old.get(p, float("nan")):>10.4f}{v:>10.4f}')


if __name__ == '__main__':
    main()
