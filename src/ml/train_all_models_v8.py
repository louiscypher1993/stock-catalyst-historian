#!/usr/bin/env python3
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, roc_auc_score
from sklearn.model_selection import train_test_split

ML_DIR = Path(__file__).parent

MODEL_A_COLS = [
    'z_score',
    'excess_return',
    'volume_ratio',
    'relative_volume_30d',
    'seismic_magnitude_mw',
    'pre_return_3d',
    'pre_return_5d',
    'pre_return_10d',
    'pre_return_21d',
    'pre_vol_ratio_5d',
    'pre_vol_ratio_10d',
]

EXCLUDE_COLS = [
    'cache_key', 'symbol', 'date', 'is_null_sample', 'label',
    'forward_return_1d', 'forward_return_1w', 'forward_return_1m',
    'forward_return_2d', 'forward_return_3d', 'forward_return_2w',
    'forward_return_3m', 'forward_return_6m', 'forward_return_12m',
    'max_favorable_excursion_1m', 'max_adverse_excursion_1m',
    'outperform_12m', 'is_event', 'sector_excess_return',
    'short_interest_ratio', 'options_put_call_ratio',
]

ZERO_FILL_COLS = [
    'digital_exhaust_velocity_14d', 'gdelt_tone_z', 'dark_pool_index',
    'institutional_ownership_pct', 'put_call_ratio_t_minus_1',
]

PRE_RETURN_COLS = [
    'pre_return_3d', 'pre_return_5d', 'pre_return_10d', 'pre_return_21d',
    'pre_vol_ratio_5d', 'pre_vol_ratio_10d',
]

CLF_PARAMS = dict(
    n_estimators=400, max_depth=5, learning_rate=0.05,
    subsample=0.8, colsample_bytree=0.8, eval_metric='logloss',
    random_state=42,
)

REG_PARAMS = dict(
    n_estimators=400, max_depth=5, learning_rate=0.05,
    subsample=0.8, colsample_bytree=0.8, random_state=42,
)

results = []
script_warnings = []


def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def train_regressor(name, file_name, df, feature_cols, label_col):
    if label_col not in df.columns:
        script_warnings.append(f"Model {name}: label '{label_col}' not in features.csv, skipped")
        print(f"[{name}] label={label_col} -> SKIPPED (column not in features.csv)")
        return

    sub = df.dropna(subset=[label_col])
    if sub[label_col].notna().sum() == 0 or len(sub) < 10:
        script_warnings.append(f"Model {name}: label '{label_col}' has no usable rows, skipped")
        print(f"[{name}] label={label_col} -> SKIPPED (no usable rows)")
        return

    X = sub[feature_cols]
    y = sub[label_col]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )
    model = xgb.XGBRegressor(**REG_PARAMS)
    model.fit(X_train, y_train)
    preds = model.predict(X_test)
    r = rmse(y_test, preds)
    mae = mean_absolute_error(y_test, preds)
    model.save_model(str(ML_DIR / file_name))
    results.append({
        'model': name, 'file': file_name, 'label': label_col,
        'train_rows': len(X_train), 'test_rows': len(X_test),
        'metric': 'RMSE / MAE', 'score': f'{r:.4f} / {mae:.4f}',
    })
    print(f"[{name}] label={label_col} train={len(X_train)} test={len(X_test)} "
          f"RMSE={r:.4f} MAE={mae:.4f} -> {file_name}")


def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    print(f"Loaded features.csv: {len(df)} rows, {len(df.columns)} columns")

    null_indicator_cols = [c for c in df.columns if c.endswith('_is_null')]
    print(f"NULL_INDICATOR_COLS ({len(null_indicator_cols)}): {null_indicator_cols}")

    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    print(f"Dropping non-numeric (object/string) columns ({len(object_cols)}): {object_cols}")

    drop_cols = (
        set(EXCLUDE_COLS)
        | set(null_indicator_cols)
        | set(ZERO_FILL_COLS)
        | set(PRE_RETURN_COLS)
        | set(object_cols)
    )
    model_bcde_cols = [c for c in df.columns if c not in drop_cols]

    print(f"\nmodel_a_cols ({len(MODEL_A_COLS)} features):")
    print(MODEL_A_COLS)
    print(f"\nmodel_bcde_cols ({len(model_bcde_cols)} features):")
    print(model_bcde_cols)

    # --- Model A: event classifier ---
    df['is_event'] = (df['is_null_sample'] == 0).astype(int)
    a_df = df.dropna(subset=['is_event'])
    X = a_df[MODEL_A_COLS]
    y = a_df['is_event']
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    pos = int((y_train == 1).sum())
    neg = int((y_train == 0).sum())
    scale_pos_weight = neg / pos
    model_a = xgb.XGBClassifier(scale_pos_weight=scale_pos_weight, **CLF_PARAMS)
    model_a.fit(X_train, y_train)
    proba = model_a.predict_proba(X_test)[:, 1]
    auc_a = roc_auc_score(y_test, proba)
    model_a.save_model(str(ML_DIR / 'model_a_v8.json'))
    results.append({
        'model': 'A', 'file': 'model_a_v8.json', 'label': 'is_event',
        'train_rows': len(X_train), 'test_rows': len(X_test),
        'metric': 'AUC-ROC', 'score': f'{auc_a:.4f}',
    })
    print(f"\n[A] label=is_event train={len(X_train)} test={len(X_test)} "
          f"scale_pos_weight={scale_pos_weight:.4f} AUC={auc_a:.4f} -> model_a_v8.json")

    # --- Models B / C / D1-D5 ---
    train_regressor('B', 'model_b_v8.json', df, model_bcde_cols, 'forward_return_1m')
    train_regressor('C', 'model_c_v8.json', df, model_bcde_cols, 'max_adverse_excursion_1m')

    d1_label = 'forward_return_3m'
    if d1_label not in df.columns:
        script_warnings.append("forward_return_3m absent -> D1 falling back to forward_return_1m")
        d1_label = 'forward_return_1m'
    print(f"\n[D1] using label: {d1_label}")
    train_regressor('D1', 'model_d1_v8.json', df, model_bcde_cols, d1_label)

    train_regressor('D2', 'model_d2_v8.json', df, model_bcde_cols, 'forward_return_6m')
    train_regressor('D3', 'model_d3_v8.json', df, model_bcde_cols, 'forward_return_2d')
    train_regressor('D4', 'model_d4_v8.json', df, model_bcde_cols, 'forward_return_3d')
    train_regressor('D5', 'model_d5_v8.json', df, model_bcde_cols, 'forward_return_2w')

    # --- Model E: 12-month outperformer classifier ---
    if 'outperform_12m' in df.columns:
        e_df = df.dropna(subset=['outperform_12m']).copy()
        e_label = 'outperform_12m'
    elif 'forward_return_12m' in df.columns:
        script_warnings.append("outperform_12m absent -> derived from forward_return_12m > 0")
        e_df = df.dropna(subset=['forward_return_12m']).copy()
        e_df['outperform_12m'] = (e_df['forward_return_12m'] > 0).astype(int)
        e_label = 'outperform_12m'
    else:
        script_warnings.append("forward_return_12m absent -> Model E falling back to forward_return_1m (> 0.05)")
        e_df = df.dropna(subset=['forward_return_1m']).copy()
        e_df['outperform_12m'] = (e_df['forward_return_1m'] > 0.05).astype(int)
        e_label = 'outperform_12m'

    print(f"\n[E] using label: {e_label}")

    X = e_df[model_bcde_cols]
    y = e_df[e_label]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    model_e = xgb.XGBClassifier(**CLF_PARAMS)
    model_e.fit(X_train, y_train)
    proba = model_e.predict_proba(X_test)[:, 1]
    auc_e = roc_auc_score(y_test, proba)
    model_e.save_model(str(ML_DIR / 'model_e_v8.json'))
    results.append({
        'model': 'E', 'file': 'model_e_v8.json', 'label': e_label,
        'train_rows': len(X_train), 'test_rows': len(X_test),
        'metric': 'AUC-ROC', 'score': f'{auc_e:.4f}',
    })
    print(f"[E] label={e_label} train={len(X_train)} test={len(X_test)} AUC={auc_e:.4f} -> model_e_v8.json")

    # --- Feature metadata ---
    metadata = {
        'model_a_cols': MODEL_A_COLS,
        'model_bcde_cols': model_bcde_cols,
        'trained_at': datetime.now(timezone.utc).isoformat(),
        'rows_used': len(df),
        'features_csv_columns': len(df.columns),
    }
    with open(ML_DIR / 'feature_metadata_v8.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    print("\nWrote feature_metadata_v8.json")

    # --- Summary ---
    print("\nModel | File | Label | Train rows | Test rows | Metric | Score")
    for r in results:
        print(f"{r['model']} | {r['file']} | {r['label']} | {r['train_rows']} | {r['test_rows']} | {r['metric']} | {r['score']}")

    print(f"\nModel A final feature count: {len(MODEL_A_COLS)}")
    print("Model A final feature list:")
    print(MODEL_A_COLS)

    print("\nWarnings:")
    if script_warnings:
        for w in script_warnings:
            print(f"- {w}")
    else:
        print("- none")


if __name__ == '__main__':
    main()
