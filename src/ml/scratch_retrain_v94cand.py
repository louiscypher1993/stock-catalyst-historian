#!/usr/bin/env python3
"""
CANDIDATE retrain (v9.4-candidate) -- row-exclusion outlier hygiene ONLY.
Exact copy of train_regression_heads_v9_3.py's training logic (REG_PARAMS,
split, sample weighting, asymmetric-MSE, early stopping) with ONE change:
the 51 physically-impossible price-discontinuity rows are excluded before
the split (|overnight_gap_pct| >= 1.0 OR |excess_return| > 10).

Writes CANDIDATE files under src/ml/scratch/ -- does NOT overwrite any
deployed model. Nothing here deploys.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error

ML_DIR = Path(__file__).parent
OUT_DIR = ML_DIR / 'scratch'
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
REG_PARAMS = dict(
    objective='reg:squarederror',
    max_depth=8, eta=0.05, subsample=1.0, colsample_bytree=1.0,
    eval_metric='rmse', seed=RANDOM_STATE,
)
ASYMMETRIC_ALPHA = 2.5
ASYMMETRIC_BETA = 1.0
HEADS = {
    'B':  ('forward_return_1m', 'model_b_v9.4cand.json'),
    'D1': ('forward_return_3m', 'model_d1_v9.4cand.json'),
    'D2': ('forward_return_6m', 'model_d2_v9.4cand.json'),
    'D3': ('forward_return_2d', 'model_d3_v9.4cand.json'),
    'D5': ('forward_return_2w', 'model_d5_v9.4cand.json'),
}
results = []


def compute_sample_weights(df):
    vix_col = next((c for c in df.columns if 'vix' in c.lower()), None)
    vix = df[vix_col].fillna(20.0) if vix_col else pd.Series(20.0, index=df.index)
    vix_weight = 1.0 / vix.clip(lower=5.0); vix_weight = vix_weight / vix_weight.mean()
    liq = df.get('volume_ratio', pd.Series(1.0, index=df.index)).fillna(1.0)
    liq_weight = liq.clip(0.1, 10.0); liq_weight = liq_weight / liq_weight.mean()
    weight = vix_weight * liq_weight
    return (weight / weight.mean()).values


def asymmetric_mse(alpha=2.5, beta=1.0):
    def objective(y_pred, dtrain):
        y_true = dtrain.get_label(); error = y_pred - y_true
        grad = np.where(error > 0, alpha * error, beta * error)
        hess = np.where(error > 0, np.full_like(error, alpha), np.full_like(error, beta))
        return grad, hess
    return objective


def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def split_train_val_test_temporal(dates_series, X, y, embargo_days=21):
    dates = pd.to_datetime(dates_series.loc[X.index]); n = len(dates)
    sorted_dates = dates.sort_values()
    cutoff_train = sorted_dates.iloc[int(n * 0.70)]
    cutoff_val = sorted_dates.iloc[int(n * 0.85)]
    embargo = pd.Timedelta(days=embargo_days)
    train_mask = dates < (cutoff_train - embargo)
    val_mask = (dates >= cutoff_train) & (dates < (cutoff_val - embargo))
    test_mask = dates >= cutoff_val
    print(f"  Temporal split: train={train_mask.sum()} val={val_mask.sum()} test={test_mask.sum()}")
    return (X[train_mask], X[val_mask], X[test_mask], y[train_mask], y[val_mask], y[test_mask])


def train_regressor(name, file_name, df, feature_cols, label_col, embargo_days=21):
    sub = df.dropna(subset=[label_col])
    X = sub[feature_cols]; y = sub[label_col]; sub_dates = pd.to_datetime(sub['date'])
    X_train, X_val, X_test, y_train, y_val, y_test = split_train_val_test_temporal(sub_dates, X, y, embargo_days)
    sw_train = compute_sample_weights(sub.loc[X_train.index])
    dtrain = xgb.DMatrix(X_train, label=y_train, weight=sw_train, feature_names=feature_cols)
    dval = xgb.DMatrix(X_val, label=y_val, feature_names=feature_cols)
    dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_cols)
    booster = xgb.train(REG_PARAMS, dtrain, num_boost_round=1000,
                        obj=asymmetric_mse(ASYMMETRIC_ALPHA, ASYMMETRIC_BETA),
                        evals=[(dval, 'val')], early_stopping_rounds=50, verbose_eval=False)
    best_iter = booster.best_iteration
    preds = booster.predict(dtest, iteration_range=(0, best_iter + 1))
    r = rmse(y_test, preds); mae = mean_absolute_error(y_test, preds)
    booster.save_model(str(OUT_DIR / file_name))
    results.append({'model': name, 'file': file_name, 'label': label_col,
                    'train_rows': len(X_train), 'val_rows': len(X_val), 'test_rows': len(X_test),
                    'best_iter': int(best_iter), 'rmse': r, 'mae': mae})
    print(f"[{name}] label={label_col} train={len(X_train)} val={len(X_val)} test={len(X_test)} "
          f"best_iter={best_iter} RMSE={r:.4f} MAE={mae:.4f} -> scratch/{file_name}")


def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    print(f"Loaded features.csv: {len(df)} rows")
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0
    ).astype(int)

    # --- THE ONLY DIFFERENCE vs v9.3: row-exclusion outlier hygiene ---
    excl = (df['overnight_gap_pct'].abs() >= 1.0) | (df['excess_return'].abs() > 10)
    print(f"Excluding {int(excl.sum())} physically-impossible discontinuity rows "
          f"(|ogp|>=1.0 OR |exret|>10); {int((~excl).sum())} rows remain")
    df = df[~excl].reset_index(drop=True)

    null_indicator_cols = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(EXCLUDE_COLS) | set(null_indicator_cols) | set(ZERO_FILL_COLS)
                 | set(PRE_RETURN_COLS) | set(object_cols))
    feature_cols = [c for c in df.columns if c not in drop_cols]
    print(f"feature_cols: {len(feature_cols)} features")

    for name, (label_col, file_name) in HEADS.items():
        train_regressor(name, file_name, df, feature_cols, label_col)

    meta = {'version': 'v9.4-candidate', 'scope': 'row-exclusion outlier hygiene (51 rows) on top of v9.3',
            'full_feature_cols': feature_cols, 'n_training_rows': len(df),
            'reg_params': REG_PARAMS, 'exclusion_filter': '|overnight_gap_pct|>=1.0 OR |excess_return|>10'}
    with open(OUT_DIR / 'feature_metadata_v9.4cand.json', 'w') as f:
        json.dump(meta, f, indent=2)
    print("\nWrote scratch/feature_metadata_v9.4cand.json")
    print("\nModel | best_iter | test_rows | RMSE | MAE")
    for r in results:
        print(f"{r['model']} | {r['best_iter']} | {r['test_rows']} | {r['rmse']:.4f} | {r['mae']:.4f}")


if __name__ == '__main__':
    main()
