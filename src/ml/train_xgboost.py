"""
Prompt 12 -- XGBoost training pipeline.

Trains models from src/ml/features.csv:
  Model A  - binary classifier: event vs non-event (is_null_sample)
  Model B  - regression: 1-month forward return (forward_return_1m)
  Model C  - regression: max adverse excursion (max_adverse_excursion_1m)
  Model D1 - regression: 3-month forward return (forward_return_3m)
  Model D2 - regression: 6-month forward return (forward_return_6m)
  Model E  - binary classifier: 12-month outperformance (forward_return_12m > 0.10)
"""

import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import shap
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, KFold, StratifiedKFold, TimeSeriesSplit
from xgboost import XGBClassifier, XGBRegressor

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FEATURES_CSV = os.path.join(SCRIPT_DIR, "features.csv")

NON_FEATURE_COLS = ["cache_key", "symbol", "date"]
TARGET_COLS = [
    "is_null_sample",
    "forward_return_1d",
    "forward_return_1w",
    "forward_return_1m",
    "max_favorable_excursion_1m",
    "max_adverse_excursion_1m",
    "forward_return_3m",
    "forward_return_6m",
    "forward_return_12m",
    "forward_return_12m_is_null",
]

TARGET_A = "is_null_sample"
TARGET_B = "forward_return_1m"
TARGET_C = "max_adverse_excursion_1m"
TARGET_D1 = "forward_return_3m"
TARGET_D2 = "forward_return_6m"

RANDOM_STATE = 42
SHAP_SAMPLE_SIZE = 2000
TOP_N_IMPORTANCE = 15
TOP_N_SHAP = 20

BASE_PARAMS = dict(
    n_estimators=500,
    max_depth=6,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=5,
    importance_type="gain",
    random_state=RANDOM_STATE,
)

PARAM_GRID = {"max_depth": [4, 6, 8], "learning_rate": [0.03, 0.05, 0.1]}
SEARCH_N_ESTIMATORS = 100


def temporal_stratified_split(df, strat_col, train_frac=0.7, val_frac=0.15):
    """Split preserving temporal order within each class of strat_col.

    For each value of strat_col, rows are sorted by date and the earliest
    train_frac/val_frac/remainder are assigned to train/val/test, so the
    test set always holds the most recent dates for each class.
    """
    train_parts, val_parts, test_parts = [], [], []
    for _, group in df.groupby(strat_col):
        group = group.sort_values("date")
        n = len(group)
        n_train = int(n * train_frac)
        n_val = int(n * val_frac)
        train_parts.append(group.iloc[:n_train])
        val_parts.append(group.iloc[n_train:n_train + n_val])
        test_parts.append(group.iloc[n_train + n_val:])

    train_df = pd.concat(train_parts).sort_values("date").reset_index(drop=True)
    val_df = pd.concat(val_parts).sort_values("date").reset_index(drop=True)
    test_df = pd.concat(test_parts).sort_values("date").reset_index(drop=True)
    return train_df, val_df, test_df


def hyperparam_search(estimator_cls, X, y, scoring, cv, extra_params=None):
    """Small grid search over max_depth/learning_rate at reduced n_estimators."""
    extra_params = extra_params or {}
    params = {**BASE_PARAMS, **extra_params, "n_estimators": SEARCH_N_ESTIMATORS, "n_jobs": 1}
    grid = GridSearchCV(
        estimator=estimator_cls(**params),
        param_grid=PARAM_GRID,
        scoring=scoring,
        cv=cv,
        n_jobs=-1,
        refit=False,
    )
    grid.fit(X, y)
    return grid.best_params_, grid.best_score_


def train_final(estimator_cls, X_train, y_train, best_params, extra_params=None):
    extra_params = extra_params or {}
    params = {**BASE_PARAMS, **extra_params, **best_params, "n_jobs": -1}
    model = estimator_cls(**params)
    model.fit(X_train, y_train)
    return model


def evaluate_classifier(model, X, y):
    proba = model.predict_proba(X)[:, 1]
    pred = model.predict(X)
    return {
        "auc_roc": roc_auc_score(y, proba),
        "precision": precision_score(y, pred, zero_division=0),
        "recall": recall_score(y, pred, zero_division=0),
        "f1": f1_score(y, pred, zero_division=0),
        "accuracy": accuracy_score(y, pred),
    }


def evaluate_regressor(model, X, y):
    pred = model.predict(X)
    rmse = float(np.sqrt(mean_squared_error(y, pred)))
    mae = float(mean_absolute_error(y, pred))
    return {"rmse": rmse, "mae": mae}


def plot_feature_importance(models, model_feature_cols, out_path):
    fig, axes = plt.subplots(1, 3, figsize=(20, 8))
    for ax, (name, model) in zip(axes, models.items()):
        feature_cols = model_feature_cols[name]
        importances = model.feature_importances_
        order = np.argsort(importances)[::-1][:TOP_N_IMPORTANCE]
        top_features = np.array(feature_cols)[order]
        top_values = importances[order]
        ax.barh(range(len(top_features)), top_values[::-1])
        ax.set_yticks(range(len(top_features)))
        ax.set_yticklabels(top_features[::-1], fontsize=8)
        ax.set_title(f"{name} - top {TOP_N_IMPORTANCE} features (gain)")
        ax.set_xlabel("Gain")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def plot_confusion_matrix(y_true, y_pred, out_path):
    cm = confusion_matrix(y_true, y_pred)
    fig, ax = plt.subplots(figsize=(5, 4.5))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks([0, 1])
    ax.set_yticks([0, 1])
    ax.set_xticklabels(["event (0)", "non-event (1)"])
    ax.set_yticklabels(["event (0)", "non-event (1)"])
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title("Model A confusion matrix (test set)")
    for i in range(2):
        for j in range(2):
            ax.text(j, i, str(cm[i, j]), ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black")
    fig.colorbar(im, ax=ax)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def plot_shap_summary(model, X_sample, out_path, title):
    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_sample)
    if isinstance(shap_values, list):
        shap_values = shap_values[1]
    fig = plt.figure(figsize=(10, 8))
    shap.summary_plot(shap_values, X_sample, max_display=TOP_N_SHAP, show=False)
    plt.title(title)
    plt.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def fmt_params(params):
    return ", ".join(f"{k}={v}" for k, v in sorted(params.items()))


def top_n_features(model, feature_cols, n=5):
    """Return the top-n (feature_name, importance) pairs sorted by gain, descending."""
    importances = model.feature_importances_
    order = np.argsort(importances)[::-1][:n]
    return [(feature_cols[i], float(importances[i])) for i in order]


def main():
    df = pd.read_csv(FEATURES_CSV)
    feature_cols = [c for c in df.columns if c not in NON_FEATURE_COLS + TARGET_COLS]

    train_df, val_df, test_df = temporal_stratified_split(df, TARGET_A)

    X_train, X_val, X_test = train_df[feature_cols], val_df[feature_cols], test_df[feature_cols]

    print(f"Rows -> train: {len(train_df)}, val: {len(val_df)}, test: {len(test_df)}")
    print(f"Date ranges -> train: {train_df['date'].min()}..{train_df['date'].max()}, "
          f"val: {val_df['date'].min()}..{val_df['date'].max()}, "
          f"test: {test_df['date'].min()}..{test_df['date'].max()}")

    report = []
    report.append("XGBoost Training Pipeline - Evaluation Report")
    report.append("=" * 50)
    report.append("")
    report.append(f"Total rows: {len(df)}  Feature columns: {len(feature_cols)}")
    report.append(f"Train rows: {len(train_df)} ({train_df['date'].min()} to {train_df['date'].max()})")
    report.append(f"Val rows:   {len(val_df)} ({val_df['date'].min()} to {val_df['date'].max()})")
    report.append(f"Test rows:  {len(test_df)} ({test_df['date'].min()} to {test_df['date'].max()})")
    report.append(f"Base hyperparameters: {fmt_params(BASE_PARAMS)}")
    report.append(f"Hyperparameter search grid: {PARAM_GRID} (search n_estimators={SEARCH_N_ESTIMATORS})")
    report.append("")

    models = {}
    model_feature_cols = {}

    # --- Model A: binary classifier (is_null_sample) ---
    print("\n=== Model A: event vs non-event classifier ===")
    y_train_a = train_df[TARGET_A]
    y_val_a = val_df[TARGET_A]
    y_test_a = test_df[TARGET_A]

    neg, pos = (y_train_a == 0).sum(), (y_train_a == 1).sum()
    scale_pos_weight = neg / pos
    print(f"scale_pos_weight (train neg/pos = {neg}/{pos}) = {scale_pos_weight:.4f}")

    # Drop _is_null indicator columns for Model A only -- these leak data-availability
    # patterns rather than genuine market signal (previously inflated AUC to 0.996).
    is_null_cols = [c for c in X_train.columns if c.endswith('_is_null')]
    X_train_A = X_train.drop(columns=is_null_cols)
    X_val_A = X_val.drop(columns=is_null_cols)
    X_test_A = X_test.drop(columns=is_null_cols)
    feature_cols_a = [c for c in feature_cols if c not in is_null_cols]

    cv_a = StratifiedKFold(n_splits=3, shuffle=True, random_state=RANDOM_STATE)
    best_params_a, best_score_a = hyperparam_search(
        XGBClassifier, X_train_A, y_train_a, scoring="roc_auc", cv=cv_a,
        extra_params={"scale_pos_weight": scale_pos_weight, "eval_metric": "logloss"},
    )
    print(f"Best params A: {best_params_a} (cv roc_auc={best_score_a:.4f})")

    model_a = train_final(
        XGBClassifier, X_train_A, y_train_a, best_params_a,
        extra_params={"scale_pos_weight": scale_pos_weight, "eval_metric": "logloss"},
    )
    models["Model A (classifier)"] = model_a
    model_feature_cols["Model A (classifier)"] = feature_cols_a

    metrics_a_val = evaluate_classifier(model_a, X_val_A, y_val_a)
    metrics_a_test = evaluate_classifier(model_a, X_test_A, y_test_a)
    print(f"Model A val:  {metrics_a_val}")
    print(f"Model A test: {metrics_a_test}")

    test_pred_a = model_a.predict(X_test_A)
    plot_confusion_matrix(y_test_a, test_pred_a, os.path.join(SCRIPT_DIR, "confusion_matrix_a.png"))

    report.append("Model A - Binary Classifier (is_null_sample: 0=event, 1=non-event)")
    report.append("-" * 50)
    report.append(f"Dropped {len(is_null_cols)} '_is_null' indicator columns from Model A's feature set "
                   f"({len(feature_cols_a)} features used vs {len(feature_cols)} for Models B/C)")
    report.append(f"scale_pos_weight: {scale_pos_weight:.4f} (train neg={neg}, pos={pos})")
    report.append(f"Best hyperparameters from CV search: {best_params_a} (cv roc_auc={best_score_a:.4f})")
    report.append(f"Validation -> AUC-ROC: {metrics_a_val['auc_roc']:.4f}, "
                   f"Precision: {metrics_a_val['precision']:.4f}, "
                   f"Recall: {metrics_a_val['recall']:.4f}, "
                   f"F1: {metrics_a_val['f1']:.4f}, "
                   f"Accuracy: {metrics_a_val['accuracy']:.4f}")
    report.append(f"Test       -> AUC-ROC: {metrics_a_test['auc_roc']:.4f}, "
                   f"Precision: {metrics_a_test['precision']:.4f}, "
                   f"Recall: {metrics_a_test['recall']:.4f}, "
                   f"F1: {metrics_a_test['f1']:.4f}, "
                   f"Accuracy: {metrics_a_test['accuracy']:.4f}")
    top5_a = top_n_features(model_a, feature_cols_a, n=5)
    report.append("Top 5 features by importance (gain):")
    for fname, imp in top5_a:
        report.append(f"  {fname}: {imp:.4f}")
    report.append("Confusion matrix (test): saved to confusion_matrix_a.png")
    report.append("")

    # Drop temporal cyclical columns for Models B and C only.
    temporal_cols = ['day_sin', 'day_cos', 'month_sin', 'month_cos']
    X_train_BC = X_train.drop(columns=[c for c in temporal_cols if c in X_train.columns])
    X_val_BC = X_val.drop(columns=[c for c in temporal_cols if c in X_val.columns])
    X_test_BC = X_test.drop(columns=[c for c in temporal_cols if c in X_test.columns])
    feature_cols_bc = [c for c in feature_cols if c not in temporal_cols]

    # --- Model B: regression (forward_return_1m) ---
    print("\n=== Model B: 1-month forward return regressor ===")
    y_train_b = train_df[TARGET_B]
    y_val_b = val_df[TARGET_B]
    y_test_b = test_df[TARGET_B]

    cv_reg = KFold(n_splits=3, shuffle=True, random_state=RANDOM_STATE)
    best_params_b, best_score_b = hyperparam_search(
        XGBRegressor, X_train_BC, y_train_b, scoring="neg_root_mean_squared_error", cv=cv_reg,
    )
    print(f"Best params B: {best_params_b} (cv rmse={-best_score_b:.4f})")

    model_b = train_final(XGBRegressor, X_train_BC, y_train_b, best_params_b)
    models["Model B (forward_return_1m)"] = model_b
    model_feature_cols["Model B (forward_return_1m)"] = feature_cols_bc

    metrics_b_val = evaluate_regressor(model_b, X_val_BC, y_val_b)
    metrics_b_test = evaluate_regressor(model_b, X_test_BC, y_test_b)
    print(f"Model B val:  {metrics_b_val}")
    print(f"Model B test: {metrics_b_test}")

    report.append("Model B - Regression (forward_return_1m)")
    report.append("-" * 50)
    report.append(f"Dropped temporal columns {temporal_cols} from Models B/C feature set "
                   f"({len(feature_cols_bc)} features used vs {len(feature_cols)} for Model A's base set)")
    report.append(f"Best hyperparameters from CV search: {best_params_b} (cv rmse={-best_score_b:.4f})")
    report.append(f"Validation -> RMSE: {metrics_b_val['rmse']:.6f}, MAE: {metrics_b_val['mae']:.6f}")
    report.append(f"Test       -> RMSE: {metrics_b_test['rmse']:.6f}, MAE: {metrics_b_test['mae']:.6f}")
    top5_b = top_n_features(model_b, feature_cols_bc, n=5)
    report.append("Top 5 features by importance (gain):")
    for fname, imp in top5_b:
        report.append(f"  {fname}: {imp:.4f}")
    report.append("")

    # --- Model D1: regression (forward_return_3m) ---
    print("\n=== Model D1: 3-month forward return regressor ===")
    # forward_return_3m has no _is_null indicator (null rate < 10% threshold) and
    # nulls are written to features.csv as 0.0; treat exact-zero as "outcome not
    # yet observed" (event too recent) and exclude from training/eval.
    train_mask_d1 = train_df[TARGET_D1] != 0
    val_mask_d1 = val_df[TARGET_D1] != 0
    test_mask_d1 = test_df[TARGET_D1] != 0

    X_train_d1 = X_train_BC[train_mask_d1]
    y_train_d1 = train_df.loc[train_mask_d1, TARGET_D1]
    X_val_d1 = X_val_BC[val_mask_d1]
    y_val_d1 = val_df.loc[val_mask_d1, TARGET_D1]
    X_test_d1 = X_test_BC[test_mask_d1]
    y_test_d1 = test_df.loc[test_mask_d1, TARGET_D1]

    best_params_d1, best_score_d1 = hyperparam_search(
        XGBRegressor, X_train_d1, y_train_d1, scoring="neg_root_mean_squared_error", cv=cv_reg,
    )
    print(f"Best params D1: {best_params_d1} (cv rmse={-best_score_d1:.4f})")

    model_d1 = train_final(XGBRegressor, X_train_d1, y_train_d1, best_params_d1)

    metrics_d1_val = evaluate_regressor(model_d1, X_val_d1, y_val_d1)
    metrics_d1_test = evaluate_regressor(model_d1, X_test_d1, y_test_d1)
    print(f"Model D1 val:  {metrics_d1_val}")
    print(f"Model D1 test: {metrics_d1_test}")

    report.append("Model D1 - Regression (forward_return_3m)")
    report.append("-" * 50)
    report.append(f"Same feature set as Model B ({len(feature_cols_bc)} features); "
                   f"rows with non-null target -> train: {len(X_train_d1)}, "
                   f"val: {len(X_val_d1)}, test: {len(X_test_d1)}")
    report.append(f"Best hyperparameters from CV search: {best_params_d1} (cv rmse={-best_score_d1:.4f})")
    report.append(f"Validation -> RMSE: {metrics_d1_val['rmse']:.6f}, MAE: {metrics_d1_val['mae']:.6f}")
    report.append(f"Test       -> RMSE: {metrics_d1_test['rmse']:.6f}, MAE: {metrics_d1_test['mae']:.6f}")
    top5_d1 = top_n_features(model_d1, feature_cols_bc, n=5)
    report.append("Top 5 features by importance (gain):")
    for fname, imp in top5_d1:
        report.append(f"  {fname}: {imp:.4f}")
    report.append("")

    # --- Model D2: regression (forward_return_6m) ---
    print("\n=== Model D2: 6-month forward return regressor ===")
    train_mask_d2 = train_df[TARGET_D2] != 0
    val_mask_d2 = val_df[TARGET_D2] != 0
    test_mask_d2 = test_df[TARGET_D2] != 0

    X_train_d2 = X_train_BC[train_mask_d2]
    y_train_d2 = train_df.loc[train_mask_d2, TARGET_D2]
    X_val_d2 = X_val_BC[val_mask_d2]
    y_val_d2 = val_df.loc[val_mask_d2, TARGET_D2]
    X_test_d2 = X_test_BC[test_mask_d2]
    y_test_d2 = test_df.loc[test_mask_d2, TARGET_D2]

    CLIP_6M = 0.60  # ±60% winsorisation for 6-month target
    y_train_d2 = y_train_d2.clip(-CLIP_6M, CLIP_6M)
    y_val_d2 = y_val_d2.clip(-CLIP_6M, CLIP_6M)
    y_test_d2 = y_test_d2.clip(-CLIP_6M, CLIP_6M)

    best_params_d2, best_score_d2 = hyperparam_search(
        XGBRegressor, X_train_d2, y_train_d2, scoring="neg_root_mean_squared_error", cv=cv_reg,
        extra_params={"reg_lambda": 2.0},
    )
    print(f"Best params D2: {best_params_d2} (cv rmse={-best_score_d2:.4f})")

    model_d2 = train_final(XGBRegressor, X_train_d2, y_train_d2, best_params_d2, extra_params={"reg_lambda": 2.0})

    metrics_d2_val = evaluate_regressor(model_d2, X_val_d2, y_val_d2)
    metrics_d2_test = evaluate_regressor(model_d2, X_test_d2, y_test_d2)
    print(f"Model D2 val:  {metrics_d2_val}")
    print(f"Model D2 test: {metrics_d2_test}")

    report.append("Model D2 - Regression (forward_return_6m)")
    report.append("-" * 50)
    report.append(f"Same feature set as Model B ({len(feature_cols_bc)} features); "
                   f"rows with non-null target -> train: {len(X_train_d2)}, "
                   f"val: {len(X_val_d2)}, test: {len(X_test_d2)}")
    report.append(f"Best hyperparameters from CV search: {best_params_d2} (cv rmse={-best_score_d2:.4f})")
    report.append(f"Validation -> RMSE: {metrics_d2_val['rmse']:.6f}, MAE: {metrics_d2_val['mae']:.6f}")
    report.append(f"Test       -> RMSE: {metrics_d2_test['rmse']:.6f}, MAE: {metrics_d2_test['mae']:.6f}")
    top5_d2 = top_n_features(model_d2, feature_cols_bc, n=5)
    report.append("Top 5 features by importance (gain):")
    for fname, imp in top5_d2:
        report.append(f"  {fname}: {imp:.4f}")
    report.append("")

    # --- Model E: binary classifier (12-month outperformance) ---
    print("\n=== Model E: 12-month outperformance classifier ===")
    # forward_return_12m_is_null marks rows where the 12m outcome isn't observed yet
    # (event too recent); restrict to rows with a real forward_return_12m value.
    df_e = df[df["forward_return_12m_is_null"] == 0].copy()
    df_e["target_12m_outperform"] = (df_e["forward_return_12m"] > 0.10).astype(int)
    df_e = df_e.sort_values("date").reset_index(drop=True)

    macro_features = [
        'vix_close', 'vix_regime', 'trend_regime', 'yield_curve_spread',
        'credit_spread', 'z_score', 'excess_return', 'volume_ratio',
        'shannon_entropy_30d', 'amihud_illiquidity_30d', 'fractal_efficiency_ratio_10d',
        'sector_relative_z_score', 'primaryCategory_corporate',
        'primaryCategory_market_structure', 'primaryCategory_macro',
        'fmp_news_sentiment_avg', 'analyst_upgrades_30d', 'eps_surprise_pct',
        'kinetic_energy', 'seismic_magnitude_mw',
    ]
    macro_features = [f for f in macro_features if f in df_e.columns]

    X_e = df_e[macro_features]
    y_e = df_e["target_12m_outperform"]

    n_pos_e, n_neg_e = int(y_e.sum()), int((y_e == 0).sum())
    scale_pos_weight_e = n_neg_e / n_pos_e
    print(f"Class distribution (1=outperform/0=underperform): {n_pos_e}/{n_neg_e}, "
          f"scale_pos_weight={scale_pos_weight_e:.4f}")

    # gap=365 is a row count (not a calendar-day count) per sklearn's TimeSeriesSplit,
    # but with this event-ordered data it approximates a ~1y purge between folds.
    tscv = TimeSeriesSplit(n_splits=5, gap=365)

    best_params_e, best_score_e = hyperparam_search(
        XGBClassifier, X_e, y_e, scoring="roc_auc", cv=tscv,
        extra_params={"scale_pos_weight": scale_pos_weight_e, "eval_metric": "logloss"},
    )
    print(f"Best params E: {best_params_e} (cv roc_auc={best_score_e:.4f})")

    # Purged CV scoring (out-of-fold metrics) for the report.
    cv_metrics_e = []
    for train_idx, test_idx in tscv.split(X_e):
        fold_model = train_final(
            XGBClassifier, X_e.iloc[train_idx], y_e.iloc[train_idx], best_params_e,
            extra_params={"scale_pos_weight": scale_pos_weight_e, "eval_metric": "logloss"},
        )
        cv_metrics_e.append(evaluate_classifier(fold_model, X_e.iloc[test_idx], y_e.iloc[test_idx]))
    cv_means_e = {k: float(np.mean([m[k] for m in cv_metrics_e])) for k in cv_metrics_e[0]}
    print(f"Model E purged-CV (mean over {len(cv_metrics_e)} folds): {cv_means_e}")

    # Final model trained on the full target-available dataset.
    model_e = train_final(
        XGBClassifier, X_e, y_e, best_params_e,
        extra_params={"scale_pos_weight": scale_pos_weight_e, "eval_metric": "logloss"},
    )

    report.append("Model E - Binary Classifier (target_12m_outperform: forward_return_12m > 0.10)")
    report.append("-" * 50)
    report.append(f"Macro/structural feature set ({len(macro_features)} features): {', '.join(macro_features)}")
    report.append(f"Class distribution -> outperform (1): {n_pos_e}, underperform (0): {n_neg_e} "
                   f"(scale_pos_weight={scale_pos_weight_e:.4f})")
    report.append(f"Best hyperparameters from CV search: {best_params_e} (cv roc_auc={best_score_e:.4f})")
    report.append(f"Purged TimeSeriesSplit CV (5 folds, gap=365) mean -> "
                   f"AUC-ROC: {cv_means_e['auc_roc']:.4f}, "
                   f"Precision: {cv_means_e['precision']:.4f}, "
                   f"Recall: {cv_means_e['recall']:.4f}, "
                   f"F1: {cv_means_e['f1']:.4f}, "
                   f"Accuracy: {cv_means_e['accuracy']:.4f}")
    report.append(f"Final model trained on full target-available dataset: {len(df_e)} rows")
    top5_e = top_n_features(model_e, macro_features, n=5)
    report.append("Top 5 features by importance (gain):")
    for fname, imp in top5_e:
        report.append(f"  {fname}: {imp:.4f}")
    report.append("")

    # --- Model C: regression (max_adverse_excursion_1m) ---
    print("\n=== Model C: max adverse excursion regressor ===")
    y_train_c = train_df[TARGET_C]
    y_val_c = val_df[TARGET_C]
    y_test_c = test_df[TARGET_C]

    best_params_c, best_score_c = hyperparam_search(
        XGBRegressor, X_train_BC, y_train_c, scoring="neg_root_mean_squared_error", cv=cv_reg,
    )
    print(f"Best params C: {best_params_c} (cv rmse={-best_score_c:.4f})")

    model_c = train_final(XGBRegressor, X_train_BC, y_train_c, best_params_c)
    models["Model C (max_adverse_excursion_1m)"] = model_c
    model_feature_cols["Model C (max_adverse_excursion_1m)"] = feature_cols_bc

    metrics_c_val = evaluate_regressor(model_c, X_val_BC, y_val_c)
    metrics_c_test = evaluate_regressor(model_c, X_test_BC, y_test_c)
    print(f"Model C val:  {metrics_c_val}")
    print(f"Model C test: {metrics_c_test}")

    report.append("Model C - Regression (max_adverse_excursion_1m)")
    report.append("-" * 50)
    report.append(f"Best hyperparameters from CV search: {best_params_c} (cv rmse={-best_score_c:.4f})")
    report.append(f"Validation -> RMSE: {metrics_c_val['rmse']:.6f}, MAE: {metrics_c_val['mae']:.6f}")
    report.append(f"Test       -> RMSE: {metrics_c_test['rmse']:.6f}, MAE: {metrics_c_test['mae']:.6f}")
    top5_c = top_n_features(model_c, feature_cols_bc, n=5)
    report.append("Top 5 features by importance (gain):")
    for fname, imp in top5_c:
        report.append(f"  {fname}: {imp:.4f}")
    report.append("")

    # --- Feature importance plot (all 3 models) ---
    print("\nWriting feature_importance.png ...")
    plot_feature_importance(models, model_feature_cols, os.path.join(SCRIPT_DIR, "feature_importance.png"))

    # --- SHAP summary plots (top 20 features, sampled test rows) ---
    print("Computing SHAP summary plots ...")
    shap_sample = X_test.sample(n=min(SHAP_SAMPLE_SIZE, len(X_test)), random_state=RANDOM_STATE)
    shap_sample_a = X_test_A.loc[shap_sample.index]
    shap_sample_bc = X_test_BC.loc[shap_sample.index]
    plot_shap_summary(model_a, shap_sample_a, os.path.join(SCRIPT_DIR, "shap_summary_a.png"),
                       "Model A SHAP summary (top 20 features)")
    plot_shap_summary(model_b, shap_sample_bc, os.path.join(SCRIPT_DIR, "shap_summary_b.png"),
                       "Model B SHAP summary (top 20 features)")
    plot_shap_summary(model_c, shap_sample_bc, os.path.join(SCRIPT_DIR, "shap_summary_c.png"),
                       "Model C SHAP summary (top 20 features)")

    # --- Save models ---
    print("Saving model files ...")
    model_a.save_model(os.path.join(SCRIPT_DIR, "model_a_v3.json"))
    model_b.save_model(os.path.join(SCRIPT_DIR, "model_b_v3.json"))
    model_c.save_model(os.path.join(SCRIPT_DIR, "model_c_v3.json"))
    model_d1.save_model(os.path.join(SCRIPT_DIR, "model_d1_v1.json"))
    model_d2.save_model(os.path.join(SCRIPT_DIR, "model_d2_v2.json"))
    model_e.save_model(os.path.join(SCRIPT_DIR, "model_e_v1.json"))

    # --- Write evaluation report ---
    report.append("Outputs")
    report.append("-" * 50)
    report.append("feature_importance.png - top feature gains for models A/B/C")
    report.append("confusion_matrix_a.png - Model A confusion matrix (test set)")
    report.append("shap_summary_a.png / shap_summary_b.png / shap_summary_c.png - "
                   f"SHAP summaries (top {TOP_N_SHAP} features, "
                   f"{len(shap_sample)} sampled test rows)")
    report.append("model_a_v3.json / model_b_v3.json / model_c_v3.json - trained XGBoost models "
                   "(Model A trained without _is_null indicator columns; "
                   "Models B/C trained without temporal cyclical columns)")
    report.append("model_d1_v1.json / model_d2_v2.json - trained XGBoost regressors "
                   "(forward_return_3m / forward_return_6m, same feature set as Model B)")
    report.append("model_e_v1.json - trained XGBoost classifier "
                   "(target_12m_outperform: forward_return_12m > 0.10, macro/structural features only, "
                   "purged TimeSeriesSplit CV)")

    report_path = os.path.join(SCRIPT_DIR, "evaluation_report_v4.txt")
    with open(report_path, "w") as f:
        f.write("\n".join(report) + "\n")

    print(f"\nDone. Report written to {report_path}")


if __name__ == "__main__":
    main()
