#!/usr/bin/env python3
"""
v9 training script.

Adds on top of v8 (train_all_models_v8.py):
  - Instance weighting (VIX-inverse x liquidity) applied to all 9 models
  - Asymmetric MSE objective for regression models B/C/D1-D5
    (penalises overestimation more than underestimation)
  - Isotonic calibration of Model A's probability outputs
  - 70/15/15 train/val/test split (stratified for classifiers)
  - SHAP summary / feature importance / confusion matrix plots,
    written to both src/ml/ and docs/ so the dashboard updates on retrain
  - A handful of new optional signal columns for models B/C/D/E

v8's model files, metadata, etc. are left untouched.
"""

import importlib.util
import sys

_PIP_NAMES = {
    'xgboost': 'xgboost',
    'sklearn': 'scikit-learn',
    'shap': 'shap',
    'pandas': 'pandas',
    'numpy': 'numpy',
    'matplotlib': 'matplotlib',
}
_missing = [pip for mod, pip in _PIP_NAMES.items() if importlib.util.find_spec(mod) is None]
if _missing:
    sys.exit(
        f"Missing required packages: {', '.join(_missing)}\n"
        f"Install with: pip install {' '.join(_missing)}"
    )

import json
import pickle
from datetime import datetime, timezone
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    matthews_corrcoef,
    mean_absolute_error,
    mean_squared_error,
    roc_auc_score,
)

ML_DIR = Path(__file__).parent
DOCS_DIR = ML_DIR.parent.parent / 'docs'
OUT_DIRS = (ML_DIR, DOCS_DIR)

RANDOM_STATE = 42
TOP_N_IMPORTANCE = 15
TOP_N_SHAP = 20
SHAP_SAMPLE_SIZE = 2000

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
# CRITICAL: Model A's feature set must never include *_is_null indicator
# columns -- they correlate with the label and inflate AUC.
assert not any(c.endswith('_is_null') for c in MODEL_A_COLS)

EXCLUDE_COLS = [
    'cache_key', 'symbol', 'date', 'is_null_sample', 'label',
    'forward_return_1d', 'forward_return_1w', 'forward_return_1m',
    'forward_return_2d', 'forward_return_3d', 'forward_return_2w',
    'forward_return_3m', 'forward_return_6m', 'forward_return_12m',
    'max_favorable_excursion_1m', 'max_adverse_excursion_1m',
    'outperform_12m', 'is_event', 'sector_excess_return',
    'options_put_call_ratio',
    # NOTE: short_interest_ratio was excluded in v8. v9 allows it into the
    # B/C/D/E feature set (see NUMERIC_FEATURES) when present.
]

ZERO_FILL_COLS = [
    'digital_exhaust_velocity_14d', 'gdelt_tone_z', 'dark_pool_index',
    'institutional_ownership_pct', 'put_call_ratio_t_minus_1',
    # short_interest_pct_float is 0% filled across every real source path
    # (confirmed permanent structural gap, not train/serve skew) — excluded
    # from the model feature set so it does not enter model_bcde_cols as a
    # dead constant column, same rationale as digital_exhaust_velocity_14d.
    'short_interest_pct_float',
]

PRE_RETURN_COLS = [
    'pre_return_1d', 'pre_return_3d', 'pre_return_5d', 'pre_return_10d',
    'pre_return_21d', 'pre_vol_ratio_5d', 'pre_vol_ratio_10d',
]

# New optional signal columns for models B/C/D/E (not used by Model A).
# Each is included automatically in model_bcde_cols when present in
# features.csv, and skipped gracefully (no error) when absent.
NUMERIC_FEATURES = [
    'competitor_event_density',
    'digital_exhaust_velocity',
    'short_interest_pct',
    'short_interest_ratio',
    'congressional_net_flow_30d',
    'management_confidence_score',
    'lunar_phase',
    'google_trends_z',
    'wikipedia_spike_z',
]

CLF_PARAMS = dict(
    n_estimators=400, max_depth=5, learning_rate=0.05,
    subsample=0.8, colsample_bytree=0.8, eval_metric='logloss',
    random_state=RANDOM_STATE,
)

# Native xgb.train params for regressors (used with a custom objective).
REG_PARAMS = dict(
    objective='reg:squarederror',
    max_depth=5, eta=0.05, subsample=0.8, colsample_bytree=0.8,
    eval_metric='rmse', seed=RANDOM_STATE,
)

ASYMMETRIC_ALPHA = 2.5
ASYMMETRIC_BETA = 1.0

results = []
script_warnings = []


def compute_sample_weights(df):
    """VIX-inverse x liquidity instance weights, normalised to mean=1."""
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
    """
    Penalise overestimating positive returns more than underestimating --
    false positives destroy capital, false negatives are missed
    opportunities.
    alpha: penalty for overestimation (prediction > actual)
    beta:  penalty for underestimation (prediction < actual)
    """
    def objective(y_pred, dtrain):
        y_true = dtrain.get_label()
        error = y_pred - y_true
        grad = np.where(error > 0, alpha * error, beta * error)
        hess = np.where(error > 0, np.full_like(error, alpha), np.full_like(error, beta))
        return grad, hess
    return objective


def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def split_train_val_test(X, y, stratify=False):
    """
    DEPRECATED — retained so any accidental call raises immediately.
    All splits must go through split_train_val_test_temporal.
    """
    raise RuntimeError(
        "split_train_val_test: random splits are invalid for time-series financial data. "
        "Use split_train_val_test_temporal instead."
    )


def split_train_val_test_temporal(dates_series, X, y, embargo_days=21):
    """
    Chronological 70/15/15 split with embargo gaps between folds.

    dates_series: pd.Series of date strings/datetimes, indexed identically to X and y.
    embargo_days: rows within this many days of each boundary are dropped from
                  the earlier fold to prevent forward leakage (label overlap).

    Returns: X_train, X_val, X_test, y_train, y_val, y_test
    Note: stratification is intentionally absent — chronological order takes
    priority. Check class balance in the test fold after splitting.
    """
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

    return (
        X[train_mask], X[val_mask], X[test_mask],
        y[train_mask], y[val_mask], y[test_mask],
    )


def get_importances(model, feature_cols):
    """feature_importances_ for sklearn models, get_score(gain) for native Boosters."""
    if hasattr(model, 'feature_importances_'):
        return np.asarray(model.feature_importances_)
    score = model.get_score(importance_type='gain')
    return np.array([score.get(f, 0.0) for f in feature_cols])


def save_fig(fig, filename):
    for out_dir in OUT_DIRS:
        fig.savefig(out_dir / filename, dpi=150, bbox_inches='tight')


def plot_feature_importance(models, model_feature_cols, filename):
    fig, axes = plt.subplots(1, len(models), figsize=(7 * len(models), 8))
    if len(models) == 1:
        axes = [axes]
    for ax, (name, model) in zip(axes, models.items()):
        feature_cols = model_feature_cols[name]
        importances = get_importances(model, feature_cols)
        order = np.argsort(importances)[::-1][:TOP_N_IMPORTANCE]
        top_features = np.array(feature_cols)[order]
        top_values = importances[order]
        ax.barh(range(len(top_features)), top_values[::-1])
        ax.set_yticks(range(len(top_features)))
        ax.set_yticklabels(top_features[::-1], fontsize=8)
        ax.set_title(f"{name} - top {TOP_N_IMPORTANCE} features (gain)")
        ax.set_xlabel("Gain")
    fig.tight_layout()
    save_fig(fig, filename)
    plt.close(fig)


def plot_confusion_matrix_a(y_true, y_pred, filename):
    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
    fig, ax = plt.subplots(figsize=(5, 4.5))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks([0, 1])
    ax.set_yticks([0, 1])
    ax.set_xticklabels(["non-event (0)", "event (1)"])
    ax.set_yticklabels(["non-event (0)", "event (1)"])
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title("Model A confusion matrix (test set)")
    for i in range(2):
        for j in range(2):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black")
    fig.colorbar(im, ax=ax)
    fig.tight_layout()
    save_fig(fig, filename)
    plt.close(fig)


def plot_shap_summary(model, X_sample, filename, title):
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_sample)
    if isinstance(shap_values, list):
        shap_values = shap_values[1]
    elif isinstance(shap_values, np.ndarray) and shap_values.ndim == 3:
        shap_values = shap_values[:, :, 1]
    fig = plt.figure(figsize=(10, 8))
    shap.summary_plot(shap_values, X_sample, max_display=TOP_N_SHAP, show=False)
    plt.title(title)
    plt.tight_layout()
    save_fig(fig, filename)
    plt.close(fig)


def train_regressor(name, file_name, df, feature_cols, label_col, shap_store=None, embargo_days=21):
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
        'metric': 'RMSE / MAE', 'score': f'{r:.4f} / {mae:.4f}',
    })
    print(f"[{name}] label={label_col} train={len(X_train)} val={len(X_val)} test={len(X_test)} "
          f"best_iter={best_iter} RMSE={r:.4f} MAE={mae:.4f} -> {file_name}")

    if shap_store is not None:
        shap_store[name] = (booster, X_test, feature_cols)


def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    print(f"Loaded features.csv: {len(df)} rows, {len(df.columns)} columns")

    # Explicit US-listed flag — FMP fundamentals are structurally absent for
    # non-US symbols. XGBoost handles NaN natively but benefits from knowing
    # WHY fundamentals are missing, not just that they are.
    # Derivation MUST match EnrichBackfillService.ts (the flag that gated which
    # US-only fields got populated), otherwise is_us_listed would contradict the
    # nullness of the fundamentals: US-listed iff the symbol has no dot, or ends
    # with '.NYSE' / '.NASDAQ'.
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s))
        or str(s).endswith('.NYSE')
        or str(s).endswith('.NASDAQ')
        else 0
    ).astype(int)
    us_count = int(df['is_us_listed'].sum())
    intl_count = len(df) - us_count
    print(f"is_us_listed: {us_count} US rows, {intl_count} international rows")

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

    present_new = [c for c in NUMERIC_FEATURES if c in model_bcde_cols]
    missing_new = [c for c in NUMERIC_FEATURES if c not in df.columns]
    print(f"\nNew v9 optional features present ({len(present_new)}): {present_new}")
    print(f"New v9 optional features missing, skipped gracefully ({len(missing_new)}): {missing_new}")

    print(f"\nmodel_a_cols ({len(MODEL_A_COLS)} features):")
    print(MODEL_A_COLS)
    print(f"\nmodel_bcde_cols ({len(model_bcde_cols)} features):")
    print(model_bcde_cols)

    # --- Model A: event classifier (with isotonic calibration) ---
    df['is_event'] = (df['is_null_sample'] == 0).astype(int)
    a_df = df.dropna(subset=['is_event'])
    X_a = a_df[MODEL_A_COLS]
    y_a = a_df['is_event']

    a_dates = pd.to_datetime(a_df['date'])
    X_train_a, X_val_a, X_test_a, y_train_a, y_val_a, y_test_a = split_train_val_test_temporal(
        a_dates, X_a, y_a
    )
    print(f"[A] Test set class balance: {y_test_a.mean():.3f} positive rate")
    sw_train_a = compute_sample_weights(a_df.loc[X_train_a.index])

    pos = int((y_train_a == 1).sum())
    neg = int((y_train_a == 0).sum())
    scale_pos_weight = neg / pos
    model_a = xgb.XGBClassifier(scale_pos_weight=scale_pos_weight, **CLF_PARAMS)
    model_a.fit(X_train_a, y_train_a, sample_weight=sw_train_a)

    # Isotonic calibration on the validation fold
    val_probs = model_a.predict_proba(X_val_a)[:, 1]
    val_labels = y_val_a.values
    calibrator = IsotonicRegression(out_of_bounds='clip')
    calibrator.fit(val_probs, val_labels)
    with open(ML_DIR / 'calibrator_a_v9.1.pkl', 'wb') as f:
        pickle.dump(calibrator, f)

    test_probs = model_a.predict_proba(X_test_a)[:, 1]
    test_pred_a = model_a.predict(X_test_a)
    cal_probs = calibrator.transform(test_probs)
    brier_raw = brier_score_loss(y_test_a, test_probs)
    brier_cal = brier_score_loss(y_test_a, cal_probs)
    auc_a = roc_auc_score(y_test_a, test_probs)
    pr_auc_a = average_precision_score(y_test_a, test_probs)
    mcc_a    = matthews_corrcoef(y_test_a, test_pred_a)
    print(f"[A] ROC-AUC: {auc_a:.4f}  PR-AUC: {pr_auc_a:.4f}  MCC: {mcc_a:.4f}")

    model_a.save_model(str(ML_DIR / 'model_a_v9.1.json'))
    results.append({
        'model': 'A', 'file': 'model_a_v9.1.json', 'label': 'is_event',
        'train_rows': len(X_train_a), 'val_rows': len(X_val_a), 'test_rows': len(X_test_a),
        'metric': 'ROC-AUC / PR-AUC / MCC',
        'score': f'{auc_a:.4f} / {pr_auc_a:.4f} / {mcc_a:.4f}',
    })
    print(f"\n[A] label=is_event train={len(X_train_a)} val={len(X_val_a)} test={len(X_test_a)} "
          f"scale_pos_weight={scale_pos_weight:.4f} AUC={auc_a:.4f} -> model_a_v9.1.json")
    print(f"[A] Brier score (raw):        {brier_raw:.4f}")
    print(f"[A] Brier score (calibrated): {brier_cal:.4f} -> calibrator_a_v9.1.pkl")

    plot_confusion_matrix_a(y_test_a, test_pred_a, 'confusion_matrix_a.png')

    # --- Models B / C / D1-D5 ---
    shap_store = {}
    train_regressor('B', 'model_b_v9.1.json', df, model_bcde_cols, 'forward_return_1m', shap_store)
    train_regressor('C', 'model_c_v9.1.json', df, model_bcde_cols, 'max_adverse_excursion_1m', shap_store)

    d1_label = 'forward_return_3m'
    if d1_label not in df.columns:
        script_warnings.append("forward_return_3m absent -> D1 falling back to forward_return_1m")
        d1_label = 'forward_return_1m'
    print(f"\n[D1] using label: {d1_label}")
    train_regressor('D1', 'model_d1_v9.1.json', df, model_bcde_cols, d1_label)

    train_regressor('D2', 'model_d2_v9.1.json', df, model_bcde_cols, 'forward_return_6m')
    train_regressor('D3', 'model_d3_v9.1.json', df, model_bcde_cols, 'forward_return_2d')
    train_regressor('D4', 'model_d4_v9.1.json', df, model_bcde_cols, 'forward_return_3d')
    train_regressor('D5', 'model_d5_v9.1.json', df, model_bcde_cols, 'forward_return_2w')

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

    X_e = e_df[model_bcde_cols]
    y_e = e_df[e_label]
    e_dates = pd.to_datetime(e_df['date'])
    X_train_e, X_val_e, X_test_e, y_train_e, y_val_e, y_test_e = split_train_val_test_temporal(
        e_dates, X_e, y_e
    )
    print(f"[E] Test set class balance: {y_test_e.mean():.3f} positive rate")
    sw_train_e = compute_sample_weights(e_df.loc[X_train_e.index])

    model_e = xgb.XGBClassifier(**CLF_PARAMS)
    model_e.fit(X_train_e, y_train_e, sample_weight=sw_train_e)
    proba_e = model_e.predict_proba(X_test_e)[:, 1]
    auc_e = roc_auc_score(y_test_e, proba_e)
    model_e.save_model(str(ML_DIR / 'model_e_v9.1.json'))
    results.append({
        'model': 'E', 'file': 'model_e_v9.1.json', 'label': e_label,
        'train_rows': len(X_train_e), 'val_rows': len(X_val_e), 'test_rows': len(X_test_e),
        'metric': 'AUC-ROC', 'score': f'{auc_e:.4f}',
    })
    print(f"[E] label={e_label} train={len(X_train_e)} val={len(X_val_e)} test={len(X_test_e)} "
          f"AUC={auc_e:.4f} -> model_e_v9.1.json")

    # --- Feature importance + SHAP plots (Models A/B/C), to src/ml/ and docs/ ---
    print("\nWriting feature_importance.png ...")
    importance_models = {'Model A': model_a}
    importance_cols = {'Model A': MODEL_A_COLS}
    for name in ('B', 'C'):
        if name in shap_store:
            booster, _, feature_cols = shap_store[name]
            importance_models[f'Model {name}'] = booster
            importance_cols[f'Model {name}'] = feature_cols
    plot_feature_importance(importance_models, importance_cols, 'feature_importance.png')

    print("Computing SHAP summary plots ...")
    shap_sample_a = X_test_a.sample(n=min(SHAP_SAMPLE_SIZE, len(X_test_a)), random_state=RANDOM_STATE)
    plot_shap_summary(model_a, shap_sample_a, 'shap_summary_a.png',
                       "Model A SHAP summary (top 20 features)")
    for name, png in (('B', 'shap_summary_b.png'), ('C', 'shap_summary_c.png')):
        if name in shap_store:
            booster, X_test, feature_cols = shap_store[name]
            shap_sample = X_test.sample(n=min(SHAP_SAMPLE_SIZE, len(X_test)), random_state=RANDOM_STATE)
            plot_shap_summary(booster, shap_sample, png,
                               f"Model {name} SHAP summary (top 20 features)")

    # --- Feature metadata ---
    metadata = {
        'version': 'v9.1',
        'trained_at': datetime.now(timezone.utc).isoformat(),
        'model_a_features': MODEL_A_COLS,
        'full_feature_cols': model_bcde_cols,
        'n_training_rows': len(df),
        'brier_score_raw': float(brier_raw),
        'brier_score_calibrated': float(brier_cal),
        'roc_auc_a':  float(auc_a),
        'pr_auc_a':   float(pr_auc_a),
        'mcc_a':      float(mcc_a),
        'instance_weighting': True,
        'asymmetric_loss': {'alpha': ASYMMETRIC_ALPHA, 'beta': ASYMMETRIC_BETA},
    }
    with open(ML_DIR / 'feature_metadata_v9.1.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    print("\nWrote feature_metadata_v9.1.json")

    # --- Summary ---
    print("\nModel | File | Label | Train rows | Val rows | Test rows | Metric | Score")
    for r in results:
        print(f"{r['model']} | {r['file']} | {r['label']} | {r['train_rows']} | "
              f"{r['val_rows']} | {r['test_rows']} | {r['metric']} | {r['score']}")

    print(f"\nModel A final feature count: {len(MODEL_A_COLS)}")
    print("Model A final feature list:")
    print(MODEL_A_COLS)

    print(f"\nModel A Brier (raw / calibrated): {brier_raw:.4f} / {brier_cal:.4f}")
    print(f"Model A ROC-AUC / PR-AUC / MCC: {auc_a:.4f} / {pr_auc_a:.4f} / {mcc_a:.4f}")
    print("Instance weighting: enabled (mean_weight=1.0)")
    print(f"Asymmetric loss: alpha={ASYMMETRIC_ALPHA} beta={ASYMMETRIC_BETA}")

    print("\nWarnings:")
    if script_warnings:
        for w in script_warnings:
            print(f"- {w}")
    else:
        print("- none")


if __name__ == '__main__':
    main()
