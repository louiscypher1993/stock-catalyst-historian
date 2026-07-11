#!/usr/bin/env python3
"""
v9.3 retrain -- B/D1/D2/D3/D5 ONLY, with regularization relaxed per memory
#26's confirmed recommendation (validated in src/ml/scratch_relaxreg.py and
src/ml/scratch_d3_milder.py across 2 temporal splits: fixes prediction
compression on every head, IC flat-or-improved on every head including D3,
where the earlier-flagged train-val IC gap widening was confirmed to be a
training-fit artifact, not a real generalization loss).

This is a REAL retrain on the current, real features.csv/training pipeline
-- NOT a scratch experiment -- but it deliberately does NOT touch anything
deployed:
  - Does not retrain Model A, C, or E (out of scope for this fix).
  - Does not write SHAP/feature-importance plots to docs/ (those feed the
    live dashboard).
  - Writes candidate files under a new v9.3 name; does not overwrite the
    currently-deployed v9.1/v9.2 files.
  - Does not touch infer.py's wiring.

Column-selection logic (EXCLUDE_COLS/ZERO_FILL_COLS/PRE_RETURN_COLS/object
drop), sample weighting, asymmetric-MSE objective, temporal split, and
early-stopping are copied verbatim from train_all_models_v9.py (the real,
currently-deployed training script) -- the ONLY parameter that differs from
the real deployed training run is REG_PARAMS (max_depth 5->8, subsample
0.8->1.0, colsample_bytree 0.8->1.0). eta, eval_metric, objective, and
early_stopping_rounds are unchanged, matching memory #26's validated config
exactly -- no new untested parameters.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error

ML_DIR = Path(__file__).parent
RANDOM_STATE = 42

# --- verbatim from train_all_models_v9.py ---
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

# --- ONLY CHANGE vs train_all_models_v9.py's REG_PARAMS: relaxed capacity,
# validated in scratch_relaxreg.py / scratch_d3_milder.py. eta, eval_metric,
# objective, seed unchanged. ---
REG_PARAMS = dict(
    objective='reg:squarederror',
    max_depth=8, eta=0.05, subsample=1.0, colsample_bytree=1.0,
    eval_metric='rmse', seed=RANDOM_STATE,
)
ASYMMETRIC_ALPHA = 2.5
ASYMMETRIC_BETA = 1.0

HEADS = {
    'B':  ('forward_return_1m', 'model_b_v9.3.json'),
    'D1': ('forward_return_3m', 'model_d1_v9.3.json'),
    'D2': ('forward_return_6m', 'model_d2_v9.3.json'),
    'D3': ('forward_return_2d', 'model_d3_v9.3.json'),
    'D5': ('forward_return_2w', 'model_d5_v9.3.json'),
}

results = []
script_warnings = []


def compute_sample_weights(df):
    vix_col = next((c for c in df.columns if 'vix' in c.lower()), None)
    if vix_col:
        vix = df[vix_col].fillna(20.0)
    else:
        print("[WARN] No VIX column found in dataframe — instance weighting uses flat VIX=20")
        vix = pd.Series(20.0, index=df.index)
    vix_weight = 1.0 / vix.clip(lower=5.0)
    vix_weight = vix_weight / vix_weight.mean()

    liq = df.get('volume_ratio', pd.Series(1.0, index=df.index)).fillna(1.0)
    liq_weight = liq.clip(0.1, 10.0)
    liq_weight = liq_weight / liq_weight.mean()

    weight = vix_weight * liq_weight
    weight = weight / weight.mean()
    return weight.values


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


def split_train_val_test_temporal(dates_series, X, y, embargo_days=21):
    dates = pd.to_datetime(dates_series.loc[X.index])
    n = len(dates)
    sorted_dates = dates.sort_values()

    cutoff_train = sorted_dates.iloc[int(n * 0.70)]
    cutoff_val   = sorted_dates.iloc[int(n * 0.85)]
    embargo      = pd.Timedelta(days=embargo_days)

    train_mask = dates < (cutoff_train - embargo)
    val_mask   = (dates >= cutoff_train) & (dates < (cutoff_val - embargo))
    test_mask  = dates >= cutoff_val

    print(f"  Temporal split: train={train_mask.sum()} val={val_mask.sum()} "
          f"test={test_mask.sum()} (embargo={embargo_days}d, "
          f"dropped={n - train_mask.sum() - val_mask.sum() - test_mask.sum()} rows near boundaries)")

    return (X[train_mask], X[val_mask], X[test_mask], y[train_mask], y[val_mask], y[test_mask])


def train_regressor(name, file_name, df, feature_cols, label_col, embargo_days=21):
    sub = df.dropna(subset=[label_col])
    X = sub[feature_cols]
    y = sub[label_col]
    sub_dates = pd.to_datetime(sub['date'])
    X_train, X_val, X_test, y_train, y_val, y_test = split_train_val_test_temporal(
        sub_dates, X, y, embargo_days=embargo_days
    )

    sw_train = compute_sample_weights(sub.loc[X_train.index])

    dtrain = xgb.DMatrix(X_train, label=y_train, weight=sw_train, feature_names=feature_cols)
    dval = xgb.DMatrix(X_val, label=y_val, feature_names=feature_cols)
    dtest = xgb.DMatrix(X_test, label=y_test, feature_names=feature_cols)

    booster = xgb.train(
        REG_PARAMS,
        dtrain,
        num_boost_round=1000,
        obj=asymmetric_mse(alpha=ASYMMETRIC_ALPHA, beta=ASYMMETRIC_BETA),
        evals=[(dval, 'val')],
        early_stopping_rounds=50,
        verbose_eval=100,
    )

    best_iter = booster.best_iteration
    preds = booster.predict(dtest, iteration_range=(0, best_iter + 1))
    r = rmse(y_test, preds)
    mae = mean_absolute_error(y_test, preds)
    booster.save_model(str(ML_DIR / file_name))

    results.append({
        'model': name, 'file': file_name, 'label': label_col,
        'train_rows': len(X_train), 'val_rows': len(X_val), 'test_rows': len(X_test),
        'best_iter': int(best_iter), 'rmse': r, 'mae': mae,
    })
    print(f"[{name}] label={label_col} train={len(X_train)} val={len(X_val)} test={len(X_test)} "
          f"best_iter={best_iter} RMSE={r:.4f} MAE={mae:.4f} -> {file_name}")


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
    drop_cols = (
        set(EXCLUDE_COLS) | set(null_indicator_cols) | set(ZERO_FILL_COLS)
        | set(PRE_RETURN_COLS) | set(object_cols)
    )
    model_bcde_cols = [c for c in df.columns if c not in drop_cols]
    print(f"model_bcde_cols: {len(model_bcde_cols)} features")

    print(f"\n=== v9.3 retrain: relaxed REG_PARAMS {REG_PARAMS} ===")
    for name, (label_col, file_name) in HEADS.items():
        train_regressor(name, file_name, df, model_bcde_cols, label_col)

    metadata = {
        'version': 'v9.3',
        'trained_at': datetime.now(timezone.utc).isoformat(),
        'scope': 'B/D1/D2/D3/D5 only -- A/C/E untouched, this version does not exist for them',
        'full_feature_cols': model_bcde_cols,
        'n_training_rows': len(df),
        'reg_params': REG_PARAMS,
        'change_vs_v9.1_v9.2': 'max_depth 5->8, subsample 0.8->1.0, colsample_bytree 0.8->1.0 (memory #26)',
        'instance_weighting': True,
        'asymmetric_loss': {'alpha': ASYMMETRIC_ALPHA, 'beta': ASYMMETRIC_BETA},
    }
    with open(ML_DIR / 'feature_metadata_v9.3.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    print("\nWrote feature_metadata_v9.3.json")

    print("\nModel | File | Label | Train rows | Val rows | Test rows | best_iter | RMSE | MAE")
    for r in results:
        print(f"{r['model']} | {r['file']} | {r['label']} | {r['train_rows']} | "
              f"{r['val_rows']} | {r['test_rows']} | {r['best_iter']} | {r['rmse']:.4f} | {r['mae']:.4f}")

    print("\nWarnings:")
    if script_warnings:
        for w in script_warnings:
            print(f"- {w}")
    else:
        print("- none")


if __name__ == '__main__':
    main()
