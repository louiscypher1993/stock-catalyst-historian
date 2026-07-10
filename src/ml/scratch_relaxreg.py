#!/usr/bin/env python3
"""
Scratch experiment (NOT part of the real training pipeline), third and final
test of the D1/D2/D3/D5 compression investigation: relax regularization
(max_depth 5->8, subsample 0.8->1.0, colsample_bytree 0.8->1.0) to test
whether per-round capacity, not early stopping, is capping compression.
early_stopping_rounds=50 and eval_metric='rmse' restored to original (both
already ruled out) to isolate regularization as the sole new variable.
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

REG_PARAMS_ORIG = dict(
    objective='reg:squarederror',
    max_depth=5, eta=0.05, subsample=0.8, colsample_bytree=0.8,
    eval_metric='rmse', seed=RANDOM_STATE,
)
REG_PARAMS_RELAXED = dict(
    objective='reg:squarederror',
    max_depth=8, eta=0.05, subsample=1.0, colsample_bytree=1.0,
    eval_metric='rmse', seed=RANDOM_STATE,
)
ASYMMETRIC_ALPHA = 2.5
ASYMMETRIC_BETA = 1.0

HEADS = {
    'B':  ('forward_return_1m', 'model_b_v9.1.json'),
    'D1': ('forward_return_3m', 'model_d1_v9.1.json'),
    'D2': ('forward_return_6m', 'model_d2_v9.1.json'),
    'D3': ('forward_return_2d', 'model_d3_v9.2.json'),
    'D5': ('forward_return_2w', 'model_d5_v9.2.json'),
}

ORIGINAL_BEST_ITER = {'B': 68, 'D1': 37, 'D2': 15, 'D3': 64, 'D5': 23}
PATIENCE150_BEST_ITER = {'B': 296, 'D1': 37, 'D2': 15, 'D3': 64, 'D5': 23}
ASYMEVAL_BEST_ITER = {'B': 35, 'D1': 37, 'D2': 15, 'D3': 64, 'D5': 23}
PATIENCE150_COMPR = {'B': 3.2, 'D1': 108.6, 'D2': 53.4, 'D3': 34.2, 'D5': 84.3}
ASYMEVAL_COMPR = {'B': 22.6, 'D1': 108.6, 'D2': 53.4, 'D3': 34.2, 'D5': 84.3}
PATIENCE150_IC = {'B': 0.0216, 'D1': 0.1114, 'D2': 0.0537, 'D3': 0.0930, 'D5': 0.2113}
ASYMEVAL_IC = {'B': -0.0208, 'D1': 0.1114, 'D2': 0.0537, 'D3': 0.0930, 'D5': 0.2113}


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


def train_scratch_regressor(name, label_col, file_name, df, feature_cols, reg_params, early_stopping_rounds=50):
    sub = df.dropna(subset=[label_col])
    X = sub[feature_cols]
    y = sub[label_col]
    sub_dates = pd.to_datetime(sub['date'])
    X_train, X_val, X_test, y_train, y_val, y_test = split_train_val_test_temporal(sub_dates, X, y)

    sw_train = compute_sample_weights(sub.loc[X_train.index])
    dtrain = xgb.DMatrix(X_train, label=y_train, weight=sw_train, feature_names=feature_cols)
    dval = xgb.DMatrix(X_val, label=y_val, feature_names=feature_cols)
    dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_cols)

    booster = xgb.train(
        reg_params, dtrain, num_boost_round=1000,
        obj=asymmetric_mse(alpha=ASYMMETRIC_ALPHA, beta=ASYMMETRIC_BETA),
        evals=[(dval, 'val')],
        early_stopping_rounds=early_stopping_rounds,
        verbose_eval=100,
    )
    best_iter = booster.best_iteration
    booster.save_model(str(SCRATCH_DIR / file_name))

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

    print(f"[{name}] best_iter={best_iter} (orig={ORIGINAL_BEST_ITER[name]}) RMSE={r:.4f} MAE={mae:.4f} "
          f"IC_test={ic_test:.4f} IC_train={ic_train:.4f} train_val_IC_gap={ic_train - ic_test:.4f} "
          f"label_IQR_val={label_iqr_val:.4f} pred_IQR_val={pred_iqr_val:.6f} compression={compression:.1f}x")

    return {
        'name': name, 'best_iter': int(best_iter), 'orig_best_iter': ORIGINAL_BEST_ITER[name],
        'rmse': r, 'mae': mae, 'ic_test': float(ic_test), 'ic_train': float(ic_train),
        'label_iqr_val': float(label_iqr_val), 'pred_iqr_val': float(pred_iqr_val),
        'compression': float(compression), 'test_rows': len(X_test), 'val_rows': len(X_val),
    }


def eval_deployed_model(name, label_col, deployed_file, df, feature_cols):
    sub = df.dropna(subset=[label_col])
    X = sub[feature_cols]
    y = sub[label_col]
    sub_dates = pd.to_datetime(sub['date'])
    X_train, X_val, X_test, y_train, y_val, y_test = split_train_val_test_temporal(sub_dates, X, y)

    booster = xgb.Booster()
    booster.load_model(str(ML_DIR / deployed_file))
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

    print(f"[{name}-DEPLOYED] file={deployed_file} best_iter={best_iter} IC_test={ic_test:.4f} "
          f"IC_train={ic_train:.4f} train_val_IC_gap={ic_train - ic_test:.4f} "
          f"label_IQR_val={label_iqr_val:.4f} pred_IQR_val={pred_iqr_val:.6f} compression={compression:.1f}x")

    return {
        'name': name, 'best_iter': best_iter, 'ic_test': float(ic_test), 'ic_train': float(ic_train),
        'label_iqr_val': float(label_iqr_val), 'pred_iqr_val': float(pred_iqr_val),
        'compression': float(compression),
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
    model_bcde_cols = [c for c in df.columns if c not in drop_cols]
    print(f"model_bcde_cols: {len(model_bcde_cols)} features")

    print("\n=== BASELINE SANITY CHECK: deployed models, same methodology as all prior experiments ===")
    baseline_results = {}
    for name, (label_col, deployed_file) in HEADS.items():
        baseline_results[name] = eval_deployed_model(name, label_col, deployed_file, df, model_bcde_cols)

    print("\n=== SCRATCH: relaxed regularization (max_depth=8, subsample=1.0, colsample_bytree=1.0), esr=50, eval_metric=rmse ===")
    scratch_results = {}
    for name, (label_col, _deployed_file) in HEADS.items():
        file_name = f"model_{name.lower()}_scratch_relaxreg.json"
        scratch_results[name] = train_scratch_regressor(name, label_col, file_name, df, model_bcde_cols, REG_PARAMS_RELAXED, early_stopping_rounds=50)

    with open(SCRATCH_DIR / 'scratch_relaxreg_results.json', 'w') as f:
        json.dump({'baseline': baseline_results, 'scratch': scratch_results}, f, indent=2)

    print("\n=== FOUR-WAY SUMMARY ===")
    print(f"{'Head':<5}{'orig_iter':<10}{'p150_iter':<10}{'asym_iter':<10}{'reg_iter':<10}"
          f"{'orig_IC':<9}{'p150_IC':<9}{'asym_IC':<9}{'reg_IC':<9}"
          f"{'orig_cmp':<10}{'p150_cmp':<10}{'asym_cmp':<10}{'reg_cmp':<10}")
    for name in HEADS:
        b = baseline_results[name]
        s = scratch_results[name]
        print(f"{name:<5}{b['best_iter']:<10}{PATIENCE150_BEST_ITER[name]:<10}{ASYMEVAL_BEST_ITER[name]:<10}{s['best_iter']:<10}"
              f"{b['ic_test']:<9.4f}{PATIENCE150_IC[name]:<9.4f}{ASYMEVAL_IC[name]:<9.4f}{s['ic_test']:<9.4f}"
              f"{b['compression']:<10.1f}{PATIENCE150_COMPR[name]:<10.1f}{ASYMEVAL_COMPR[name]:<10.1f}{s['compression']:<10.1f}")

    print("\n=== TRAIN/VAL IC GAP (overfitting check) ===")
    for name in HEADS:
        b = baseline_results[name]
        s = scratch_results[name]
        print(f"{name}: baseline train_IC={b['ic_train']:.4f} test_IC={b['ic_test']:.4f} gap={b['ic_train']-b['ic_test']:.4f}   "
              f"relaxed train_IC={s['ic_train']:.4f} test_IC={s['ic_test']:.4f} gap={s['ic_train']-s['ic_test']:.4f}")


if __name__ == '__main__':
    main()
