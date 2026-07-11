#!/usr/bin/env python3
"""
Verification harness for the v9.3 real retrain (train_regression_heads_v9_3.py).
Read-only against model files -- does not train or write anything.

Compares, per head (B/D1/D2/D3/D5), on the SAME real features.csv and the
SAME temporal split used by both the deployed models and the v9.3 retrain:
  - currently-deployed model (loaded from the *_pre_regularization_backup.json
    copies, confirmed byte-identical to the live deployed files)
  - new v9.3 candidate model
  - the numbers memory #26's scratch experiments predicted for full
    relaxation (hardcoded below, from scratch/scratch_relaxreg_results.json)

Metrics: Spearman IC (test + train), train-val IC gap, and compression
ratio (val label IQR / val prediction IQR).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr

ML_DIR = Path(__file__).parent

EXCLUDE_COLS = [
    'cache_key', 'symbol', 'date', 'is_null_sample', 'label',
    'forward_return_1d', 'forward_return_1w', 'forward_return_1m',
    'forward_return_2d', 'forward_return_3d', 'forward_return_2w',
    'forward_return_3m', 'forward_return_6m', 'forward_return_12m',
    'max_favorable_excursion_1m', 'max_adverse_excursion_1m',
    'outperform_12m', 'is_event', 'sector_excess_return',
    'options_put_call_ratio',
]
ZERO_FILL_COLS = [
    'digital_exhaust_velocity_14d', 'gdelt_tone_z', 'dark_pool_index',
    'institutional_ownership_pct', 'put_call_ratio_t_minus_1',
    'short_interest_pct_float',
]
PRE_RETURN_COLS = [
    'pre_return_1d', 'pre_return_3d', 'pre_return_5d', 'pre_return_10d',
    'pre_return_21d', 'pre_vol_ratio_5d', 'pre_vol_ratio_10d',
]

HEADS = {
    'B':  ('forward_return_1m', 'model_b_v9.1_pre_regularization_backup.json', 'model_b_v9.3.json'),
    'D1': ('forward_return_3m', 'model_d1_v9.1_pre_regularization_backup.json', 'model_d1_v9.3.json'),
    'D2': ('forward_return_6m', 'model_d2_v9.1_pre_regularization_backup.json', 'model_d2_v9.3.json'),
    'D3': ('forward_return_2d', 'model_d3_v9.2_pre_regularization_backup.json', 'model_d3_v9.3.json'),
    'D5': ('forward_return_2w', 'model_d5_v9.2_pre_regularization_backup.json', 'model_d5_v9.3.json'),
}

# From src/ml/scratch/scratch_relaxreg_results.json's 'scratch' block
# (memory #26's original full-relaxation prediction, same REG_PARAMS).
SCRATCH_PREDICTED = {
    'B':  {'ic_test': 0.07096813894792524, 'ic_train': 0.4060687642659612, 'compression': 7.400454352357937},
    'D1': {'ic_test': 0.1197844958637739,  'ic_train': 0.47474092268976203, 'compression': 20.46864154505225},
    'D2': {'ic_test': 0.09858760870275912, 'ic_train': 0.4324873566207176,  'compression': 9.594927047911153},
    'D3': {'ic_test': 0.09144808987975292, 'ic_train': 0.34301454859950936, 'compression': 7.195443442245018},
    'D5': {'ic_test': 0.25594166746701946, 'ic_train': 0.48873232477011075, 'compression': 12.835174411452098},
}


def split_train_val_test_temporal(dates_series, X, y, embargo_days=21):
    dates = pd.to_datetime(dates_series.loc[X.index])
    n = len(dates)
    sorted_dates = dates.sort_values()
    cutoff_train = sorted_dates.iloc[int(n * 0.70)]
    cutoff_val = sorted_dates.iloc[int(n * 0.85)]
    embargo = pd.Timedelta(days=embargo_days)
    train_mask = dates < (cutoff_train - embargo)
    val_mask = (dates >= cutoff_train) & (dates < (cutoff_val - embargo))
    test_mask = dates >= cutoff_val
    return (X[train_mask], X[val_mask], X[test_mask], y[train_mask], y[val_mask], y[test_mask])


def iqr(arr):
    q75, q25 = np.percentile(arr, [75, 25])
    return q75 - q25


def eval_model(file_name, df, feature_cols, label_col):
    sub = df.dropna(subset=[label_col])
    X = sub[feature_cols]
    y = sub[label_col]
    sub_dates = pd.to_datetime(sub['date'])
    X_train, X_val, X_test, y_train, y_val, y_test = split_train_val_test_temporal(sub_dates, X, y)

    booster = xgb.Booster()
    booster.load_model(str(ML_DIR / file_name))
    best_iter = int(booster.attributes().get('best_iteration', -1))

    dtrain = xgb.DMatrix(X_train, feature_names=feature_cols)
    dval = xgb.DMatrix(X_val, feature_names=feature_cols)
    dtest = xgb.DMatrix(X_test, feature_names=feature_cols)

    iter_range = (0, best_iter + 1) if best_iter >= 0 else None
    if iter_range:
        pred_train = booster.predict(dtrain, iteration_range=iter_range)
        pred_val = booster.predict(dval, iteration_range=iter_range)
        pred_test = booster.predict(dtest, iteration_range=iter_range)
    else:
        pred_train = booster.predict(dtrain)
        pred_val = booster.predict(dval)
        pred_test = booster.predict(dtest)

    ic_test, _ = spearmanr(pred_test, y_test)
    ic_train, _ = spearmanr(pred_train, y_train)
    label_iqr_val = iqr(y_val.values)
    pred_iqr_val = iqr(pred_val)
    compression = label_iqr_val / pred_iqr_val if pred_iqr_val > 0 else float('inf')

    return {
        'file': file_name, 'best_iter': best_iter,
        'ic_test': float(ic_test), 'ic_train': float(ic_train),
        'gap': float(ic_train - ic_test),
        'compression': float(compression),
        'test_rows': len(X_test), 'val_rows': len(X_val), 'train_rows': len(X_train),
    }


def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    print(f"Loaded features.csv: {len(df)} rows, {len(df.columns)} columns")

    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s))
        or str(s).endswith('.NYSE')
        or str(s).endswith('.NASDAQ')
        else 0
    ).astype(int)

    null_indicator_cols = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(EXCLUDE_COLS) | set(null_indicator_cols) | set(ZERO_FILL_COLS)
                 | set(PRE_RETURN_COLS) | set(object_cols))
    feature_cols = [c for c in df.columns if c not in drop_cols]
    print(f"feature_cols: {len(feature_cols)} features\n")

    all_results = {}
    for name, (label_col, deployed_file, v93_file) in HEADS.items():
        print(f"=== {name} (label={label_col}) ===")
        deployed = eval_model(deployed_file, df, feature_cols, label_col)
        v93 = eval_model(v93_file, df, feature_cols, label_col)
        all_results[name] = {'deployed': deployed, 'v9_3': v93}

        print(f"  DEPLOYED ({deployed_file}): best_iter={deployed['best_iter']} "
              f"IC_test={deployed['ic_test']:.4f} IC_train={deployed['ic_train']:.4f} "
              f"gap={deployed['gap']:.4f} compression={deployed['compression']:.1f}x")
        print(f"  V9.3     ({v93_file}): best_iter={v93['best_iter']} "
              f"IC_test={v93['ic_test']:.4f} IC_train={v93['ic_train']:.4f} "
              f"gap={v93['gap']:.4f} compression={v93['compression']:.1f}x")

        pred = SCRATCH_PREDICTED.get(name)
        if pred:
            d_ic = v93['ic_test'] - pred['ic_test']
            d_cmp = v93['compression'] - pred['compression']
            print(f"  SCRATCH-PREDICTED (memory #26): IC_test={pred['ic_test']:.4f} "
                  f"IC_train={pred['ic_train']:.4f} compression={pred['compression']:.1f}x")
            print(f"  v9.3 vs scratch-predicted: dIC_test={d_ic:+.4f} dCompression={d_cmp:+.1f}x")
        else:
            print("  SCRATCH-PREDICTED: n/a (not recorded for this head)")
        print()

    with open(ML_DIR / 'scratch' / 'verify_v9_3_results.json', 'w') as f:
        json.dump(all_results, f, indent=2)
    print("Wrote scratch/verify_v9_3_results.json")

    print("\n=== SUMMARY: deployed -> v9.3 ===")
    print(f"{'Head':<5}{'dep_IC_test':<13}{'v93_IC_test':<13}{'dep_compr':<12}{'v93_compr':<12}{'dep_gap':<10}{'v93_gap':<10}")
    for name, r in all_results.items():
        d, v = r['deployed'], r['v9_3']
        print(f"{name:<5}{d['ic_test']:<13.4f}{v['ic_test']:<13.4f}{d['compression']:<12.1f}"
              f"{v['compression']:<12.1f}{d['gap']:<10.4f}{v['gap']:<10.4f}")


if __name__ == '__main__':
    main()
