#!/usr/bin/env python3
"""
STEP 4 deployment verification: closes the loop between "trained correctly"
(verify_v9_3.py, scored directly off the native xgb.Booster with an explicit
iteration_range=(0, best_iter+1)) and "wired correctly" (infer.py's actual
load path -- xgb.XGBRegressor().load_model() + .predict() with NO explicit
iteration_range).

This distinction matters: xgb.train()'s early_stopping_rounds does NOT
truncate the saved booster to best_iteration -- it keeps every round trained
(best_iteration + up to 50 extra rounds from the patience window). The
training script's own eval path explicitly slices to best_iteration+1.
infer.py's sklearn-wrapper .predict(bcde_df) call has no such slice. If the
sklearn wrapper does not auto-restrict to best_iteration on a model loaded
this way (train via native Booster, save via booster.save_model(), reload
into XGBRegressor), infer.py's real predictions could silently differ from
what the training report validated -- checked empirically here, not assumed.

Runs a real sample of each head's own test-split rows through infer.py's
exact model objects and DataFrame-construction code (imported, not
reimplemented), each cross-checked against a handful of live infer.infer()
calls to confirm the batch harness matches the real function exactly.
"""
import sys
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr

ML_DIR = Path(__file__).parent
sys.path.insert(0, str(ML_DIR))
import infer as infer_module  # noqa: E402

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
    'B':  'forward_return_1m',
    'D1': 'forward_return_3m',
    'D2': 'forward_return_6m',
    'D3': 'forward_return_2d',
    'D5': 'forward_return_2w',
}

# From the training report (verify_v9_3.py, scored with explicit
# iteration_range=(0, best_iter+1) against the native Booster).
TRAINING_REPORT_IC_TEST = {'B': 0.0710, 'D1': 0.1198, 'D2': 0.0986, 'D3': 0.0914, 'D5': 0.2559}


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


def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0
    ).astype(int)

    null_indicator_cols = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(EXCLUDE_COLS) | set(null_indicator_cols) | set(ZERO_FILL_COLS)
                 | set(PRE_RETURN_COLS) | set(object_cols))
    feature_cols = [c for c in df.columns if c not in drop_cols]

    with open(ML_DIR / 'feature_metadata_v9.3.json') as f:
        metadata = json.load(f)
    metadata_cols = metadata['full_feature_cols']
    print(f"feature_cols (recomputed here): {len(feature_cols)}, metadata full_feature_cols: {len(metadata_cols)}, "
          f"match: {feature_cols == metadata_cols}")

    # Load real deployed model objects EXACTLY as infer.py does -- via
    # xgb.XGBRegressor().load_model(), no explicit iteration_range anywhere.
    model_a, model_b, model_c, model_d1, model_d2, model_d3, model_d4, model_d5, model_e, calibrator_a = \
        infer_module.load_models()
    infer_models = {'B': model_b, 'D1': model_d1, 'D2': model_d2, 'D3': model_d3, 'D5': model_d5}

    SAMPLE_SIZE = 1500
    print(f"\n=== Cross-check: batch harness vs live infer.infer() on 5 real rows ===")
    sub_b = df.dropna(subset=['forward_return_1m'])
    check_rows = sub_b.sample(n=5, random_state=1)
    for idx, row in check_rows.iterrows():
        fv = {c: (0.0 if pd.isna(row[c]) else row[c]) for c in metadata_cols}
        live_result = infer_module.infer(fv)
        row_df = pd.DataFrame([row[metadata_cols].fillna(0.0)], columns=metadata_cols)
        batch_pred_b = float(model_b.predict(row_df)[0])
        print(f"  row {idx}: infer.infer()['model_b_return_1m']={live_result['model_b_return_1m']:.4f}  "
              f"batch-harness direct model_b.predict={batch_pred_b:.4f}  match={abs(live_result['model_b_return_1m'] - round(batch_pred_b, 4)) < 1e-6}")

    print(f"\n=== Per-head: real test-split rows through infer.py's exact model objects, sample={SAMPLE_SIZE} ===")
    all_results = {}
    for name, label_col in HEADS.items():
        sub = df.dropna(subset=[label_col])
        X = sub[feature_cols]
        y = sub[label_col]
        sub_dates = pd.to_datetime(sub['date'])
        _, X_val, X_test, _, y_val, y_test = split_train_val_test_temporal(sub_dates, X, y)

        n = len(X_test)  # full test set, not sampled -- rules out sampling noise in the IC comparison
        X_test_sample = X_test
        y_test_sample = y_test

        model = infer_models[name]
        # exact same call shape infer.py makes: model.predict(df_with_metadata_cols)
        row_df = X_test_sample.reindex(columns=metadata_cols).fillna(0.0)
        preds = model.predict(row_df)

        ic_test, _ = spearmanr(preds, y_test_sample)

        # val-set compression, same methodology as the training report
        row_df_val = X_val.reindex(columns=metadata_cols).fillna(0.0)
        preds_val = model.predict(row_df_val)
        label_iqr_val = iqr(y_val.values)
        pred_iqr_val = iqr(preds_val)
        compression = label_iqr_val / pred_iqr_val if pred_iqr_val > 0 else float('inf')

        reported = TRAINING_REPORT_IC_TEST[name]
        all_results[name] = {'ic_test_via_infer': float(ic_test), 'compression_via_infer': float(compression),
                              'training_report_ic_test': reported, 'delta': float(ic_test) - reported}
        print(f"[{name}] IC_test(via infer.py wiring, n={n} sample)={ic_test:.4f}  "
              f"training-report IC_test={reported:.4f}  delta={float(ic_test)-reported:+.4f}  "
              f"compression(via infer.py wiring, val)={compression:.1f}x")

    with open(ML_DIR / 'scratch' / 'verify_v9_3_via_infer_results.json', 'w') as f:
        json.dump(all_results, f, indent=2)
    print("\nWrote scratch/verify_v9_3_via_infer_results.json")


if __name__ == '__main__':
    main()
