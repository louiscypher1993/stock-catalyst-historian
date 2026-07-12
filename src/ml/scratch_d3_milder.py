#!/usr/bin/env python3
"""
Scratch experiment (NOT part of the real training pipeline) -- D3-specific
follow-up to scratch_relaxreg.py's finding: full regularization relaxation
(max_depth 5->8, subsample/colsample_bytree 0.8->1.0) fixed compression for
all of B/D1/D2/D3/D5, but D3 alone showed the train-val IC gap more than
double (0.114->0.252) while test IC stayed flat, i.e. a real overfitting-risk
signature not seen on the other heads.

Two checks, both D3-only:
  1. Milder max_depth (6, 7) at subsample=colsample_bytree=1.0, compared
     against the original baseline (depth=5) and full relaxation (depth=8)
     already on disk in scratch/scratch_relaxreg_results.json.
  2. A second temporal split (val/test boundary shifted earlier) to check
     whether the compression-fix-with-flat-IC direction is split-fragile.

Writes to src/ml/scratch/ -- never touches deployed v9.1/v9.2 files.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error
from scipy.stats import spearmanr

ML_DIR = Path(__file__).parent
SCRATCH_DIR = ML_DIR / 'scratch'
SCRATCH_DIR.mkdir(exist_ok=True)

RANDOM_STATE = 42

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

LABEL_COL = 'forward_return_2d'
ASYMMETRIC_ALPHA = 2.5
ASYMMETRIC_BETA = 1.0

# From scratch_relaxreg.py's already-run results (scratch/scratch_relaxreg_results.json),
# reported here for the side-by-side summary -- not re-run.
D3_BASELINE = {'best_iter': 64, 'ic_test': 0.09298438657706543, 'ic_train': 0.20691054408178658,
               'label_iqr_val': 0.036970686869414196, 'pred_iqr_val': 0.0010814033448696136,
               'compression': 34.18769420754086}
D3_FULL_RELAX = {'best_iter': 73, 'ic_test': 0.09144808987975292, 'ic_train': 0.34301454859950936,
                  'label_iqr_val': 0.036970686869414196, 'pred_iqr_val': 0.0051380692748352885,
                  'compression': 7.195443442245018}

REG_PARAMS_BASE = dict(objective='reg:squarederror', eta=0.05, eval_metric='rmse', seed=RANDOM_STATE)


def asymmetric_mse(alpha=2.5, beta=1.0):
    def objective(y_pred, dtrain):
        y_true = dtrain.get_label()
        error = y_pred - y_true
        grad = np.where(error > 0, alpha * error, beta * error)
        hess = np.where(error > 0, np.full_like(error, alpha), np.full_like(error, beta))
        return grad, hess
    return objective


def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def compute_sample_weights(df):
    vix_col = next((c for c in df.columns if 'vix' in c.lower()), None)
    vix = df[vix_col].fillna(20.0) if vix_col else pd.Series(20.0, index=df.index)
    vix_weight = 1.0 / vix.clip(lower=5.0)
    vix_weight = vix_weight / vix_weight.mean()
    liq = df.get('volume_ratio', pd.Series(1.0, index=df.index)).fillna(1.0)
    liq_weight = liq.clip(0.1, 10.0)
    liq_weight = liq_weight / liq_weight.mean()
    weight = vix_weight * liq_weight
    weight = weight / weight.mean()
    return weight.values


def split_train_val_test_temporal(dates_series, X, y, train_pct=0.70, val_pct=0.85, embargo_days=21):
    dates = pd.to_datetime(dates_series.loc[X.index])
    n = len(dates)
    sorted_dates = dates.sort_values()
    cutoff_train = sorted_dates.iloc[int(n * train_pct)]
    cutoff_val = sorted_dates.iloc[int(n * val_pct)]
    embargo = pd.Timedelta(days=embargo_days)
    train_mask = dates < (cutoff_train - embargo)
    val_mask = (dates >= cutoff_train) & (dates < (cutoff_val - embargo))
    test_mask = dates >= cutoff_val
    return (X[train_mask], X[val_mask], X[test_mask], y[train_mask], y[val_mask], y[test_mask],
            cutoff_train, cutoff_val)


def iqr(arr):
    q75, q25 = np.percentile(arr, [75, 25])
    return q75 - q25


def train_d3(label, df, feature_cols, reg_params, train_pct=0.70, val_pct=0.85, early_stopping_rounds=50):
    sub = df.dropna(subset=[LABEL_COL])
    X = sub[feature_cols]
    y = sub[LABEL_COL]
    sub_dates = pd.to_datetime(sub['date'])
    X_train, X_val, X_test, y_train, y_val, y_test, cutoff_train, cutoff_val = \
        split_train_val_test_temporal(sub_dates, X, y, train_pct, val_pct)

    sw_train = compute_sample_weights(sub.loc[X_train.index])
    dtrain = xgb.DMatrix(X_train, label=y_train, weight=sw_train, feature_names=feature_cols)
    dval = xgb.DMatrix(X_val, label=y_val, feature_names=feature_cols)
    dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_cols)

    booster = xgb.train(
        reg_params, dtrain, num_boost_round=1000,
        obj=asymmetric_mse(alpha=ASYMMETRIC_ALPHA, beta=ASYMMETRIC_BETA),
        evals=[(dval, 'val')],
        early_stopping_rounds=early_stopping_rounds,
        verbose_eval=False,
    )
    best_iter = booster.best_iteration

    pred_train = booster.predict(dtrain, iteration_range=(0, best_iter + 1))
    pred_val = booster.predict(dval, iteration_range=(0, best_iter + 1))
    pred_test = booster.predict(dtest, iteration_range=(0, best_iter + 1))

    r = rmse(y_test, pred_test)
    mae = mean_absolute_error(y_test, pred_test)
    ic_test, _ = spearmanr(pred_test, y_test)
    ic_train, _ = spearmanr(pred_train, y_train)

    label_iqr_val = iqr(y_val.values)
    pred_iqr_val = iqr(pred_val)
    compression = label_iqr_val / pred_iqr_val if pred_iqr_val > 0 else float('inf')

    result = {
        'label': label, 'best_iter': int(best_iter),
        'rmse': r, 'mae': mae, 'ic_test': float(ic_test), 'ic_train': float(ic_train),
        'train_val_ic_gap': float(ic_train - ic_test),
        'label_iqr_val': float(label_iqr_val), 'pred_iqr_val': float(pred_iqr_val),
        'compression': float(compression),
        'train_rows': len(X_train), 'val_rows': len(X_val), 'test_rows': len(X_test),
        'cutoff_train': str(cutoff_train.date()), 'cutoff_val': str(cutoff_val.date()),
    }
    print(f"[{label}] best_iter={best_iter} IC_test={ic_test:.4f} IC_train={ic_train:.4f} "
          f"gap={ic_train-ic_test:.4f} compression={compression:.1f}x "
          f"(train/val/test rows={len(X_train)}/{len(X_val)}/{len(X_test)}, "
          f"split={cutoff_train.date()}/{cutoff_val.date()})")
    return result


def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    print(f"Loaded features.csv: {len(df)} rows, {len(df.columns)} columns")

    null_indicator_cols = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(EXCLUDE_COLS) | set(null_indicator_cols) | set(ZERO_FILL_COLS)
                 | set(PRE_RETURN_COLS) | set(object_cols))
    feature_cols = [c for c in df.columns if c not in drop_cols]
    print(f"feature_cols: {len(feature_cols)} features")

    results = {}

    print("\n=== STEP 1: D3-only, milder max_depth (6, 7), subsample=colsample_bytree=1.0, original split ===")
    for depth in (6, 7):
        params = dict(REG_PARAMS_BASE, max_depth=depth, subsample=1.0, colsample_bytree=1.0)
        results[f'depth{depth}_origsplit'] = train_d3(f'D3-depth{depth}', df, feature_cols, params)

    print("\n=== STEP 2: split-sensitivity check -- alternate temporal split (boundary shifted earlier) ===")
    ALT_TRAIN_PCT, ALT_VAL_PCT = 0.62, 0.80
    for depth, tag in ((5, 'baseline'), (7, 'milder'), (8, 'full_relax')):
        params = dict(REG_PARAMS_BASE, max_depth=depth,
                       subsample=(0.8 if depth == 5 else 1.0),
                       colsample_bytree=(0.8 if depth == 5 else 1.0))
        results[f'depth{depth}_altsplit'] = train_d3(f'D3-depth{depth}-alt', df, feature_cols, params,
                                                        train_pct=ALT_TRAIN_PCT, val_pct=ALT_VAL_PCT)

    with open(SCRATCH_DIR / 'scratch_d3_milder_results.json', 'w') as f:
        json.dump({'baseline_orig_full_relax_ref': {'baseline': D3_BASELINE, 'full_relax': D3_FULL_RELAX},
                    'new_results': results}, f, indent=2)

    print("\n=== SUMMARY (original split): baseline(depth5) vs depth6 vs depth7 vs full-relax(depth8) ===")
    print(f"{'config':<14}{'best_iter':<10}{'IC_test':<9}{'IC_train':<9}{'gap':<8}{'compression':<12}")
    print(f"{'baseline(d5)':<14}{D3_BASELINE['best_iter']:<10}{D3_BASELINE['ic_test']:<9.4f}"
          f"{D3_BASELINE['ic_train']:<9.4f}{D3_BASELINE['ic_train']-D3_BASELINE['ic_test']:<8.4f}"
          f"{D3_BASELINE['compression']:<12.1f}")
    for depth in (6, 7):
        r = results[f'depth{depth}_origsplit']
        print(f"{'depth'+str(depth):<14}{r['best_iter']:<10}{r['ic_test']:<9.4f}{r['ic_train']:<9.4f}"
              f"{r['train_val_ic_gap']:<8.4f}{r['compression']:<12.1f}")
    print(f"{'full_relax(d8)':<14}{D3_FULL_RELAX['best_iter']:<10}{D3_FULL_RELAX['ic_test']:<9.4f}"
          f"{D3_FULL_RELAX['ic_train']:<9.4f}{D3_FULL_RELAX['ic_train']-D3_FULL_RELAX['ic_test']:<8.4f}"
          f"{D3_FULL_RELAX['compression']:<12.1f}")

    print("\n=== SUMMARY (alternate split): baseline(depth5) vs milder(depth7) vs full-relax(depth8) ===")
    for depth in (5, 7, 8):
        r = results[f'depth{depth}_altsplit']
        print(f"depth{depth}: IC_test={r['ic_test']:.4f} IC_train={r['ic_train']:.4f} "
              f"gap={r['train_val_ic_gap']:.4f} compression={r['compression']:.1f}x")


if __name__ == '__main__':
    main()
