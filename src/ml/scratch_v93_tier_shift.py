#!/usr/bin/env python3
"""
P1b of DEEP_DIVE_BRIEFING.md: v9.3 deployment vs HORIZON_TIER_CONFIG /
short-gate calibration interaction.

HORIZON_TIER_CONFIG's absolute tier thresholds (src/PotService.ts) and
MODEL_C_PERCENTILE_BREAKPOINTS were calibrated from the 2026-07-08
historical_inference_results fold -- i.e. predictions from the OLD
(v9.1/v9.2, compressed) models. F5's "0 shorts pass the corrected gate"
verification (commit bc950c9, Jul 11 13:07) also used old-model predictions.
v9.3 (deployed Jul 11 evening) decompressed B/D1/D2/D3/D5 predictions
(val-IQR widened ~5x), which can move those fixed thresholds to entirely
different percentiles of the live prediction distribution.

This script quantifies, on each head's real temporal-test-split rows from
features.csv, per head (D3/D5/D1/D2 -- the ones with tier configs; B is
deliberately empty):
  - tier occupancy (STRONG_BUY/BUY/SELL/HOLD %) under OLD (deployed backup)
    vs v9.3 predictions
  - the F5 short-gate numbers under v9.3: min/p1/p5 of D5 predictions,
    fraction with signed downside (-pred) >= 0.03/0.12/0.21/0.27
    (ambitionTier minReturns), same for D3
  - the prediction percentile at which each threshold now sits, old vs new

Read-only against models/CSV; writes results JSON to src/ml/scratch/ only.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

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
    'D3': ('forward_return_2d', 'model_d3_v9.2_pre_regularization_backup.json', 'model_d3_v9.3.json'),
    'D5': ('forward_return_2w', 'model_d5_v9.2_pre_regularization_backup.json', 'model_d5_v9.3.json'),
    'D1': ('forward_return_3m', 'model_d1_v9.1_pre_regularization_backup.json', 'model_d1_v9.3.json'),
    'D2': ('forward_return_6m', 'model_d2_v9.1_pre_regularization_backup.json', 'model_d2_v9.3.json'),
}

# HORIZON_TIER_CONFIG, src/PotService.ts (calibrated on OLD-model predictions)
def tiers_for(name, v):
    if name == 'D3':
        return 'STRONG_BUY' if v >= 0.0187 else ('SELL' if v <= 0.0096 else 'HOLD')
    if name == 'D5':
        if v >= 0.1575: return 'STRONG_BUY'
        if v >= 0.1489: return 'BUY'
        if v <= 0.1341: return 'SELL'
        return 'HOLD'
    if name == 'D1':
        return 'STRONG_BUY' if v >= 0.0682 else 'HOLD'
    if name == 'D2':
        return 'BUY' if v > 0.2206 else 'HOLD'

THRESHOLDS = {
    'D3': {'strongBuy>=': 0.0187, 'sell<=': 0.0096},
    'D5': {'strongBuy>=': 0.1575, 'buy>=': 0.1489, 'sell<=': 0.1341},
    'D1': {'strongBuy>=': 0.0682},
    'D2': {'buy>': 0.2206},
}
# ambitionTier minReturns (longs use +pred, shorts use -pred after F5 fix)
MIN_RETURNS = [0.03, 0.12, 0.21, 0.27]

# Live-side clamps applied in runLiveInference before writing/decidePot
CLAMPS = {'D3': (-0.20, 0.20), 'D5': (-0.35, 0.35), 'D1': (-0.50, 0.50), 'D2': (-0.40, 0.40)}


def split_test(dates_series, X, y, embargo_days=21):
    dates = pd.to_datetime(dates_series.loc[X.index])
    n = len(dates)
    sorted_dates = dates.sort_values()
    cutoff_val = sorted_dates.iloc[int(n * 0.85)]
    test_mask = dates >= cutoff_val
    return X[test_mask], y[test_mask]


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

    results = {}
    for name, (label_col, old_file, new_file) in HEADS.items():
        sub = df.dropna(subset=[label_col])
        X = sub[feature_cols]
        y = sub[label_col]
        X_test, y_test = split_test(sub['date'], X, y)

        preds = {}
        for tag, mfile in (('old', old_file), ('v93', new_file)):
            m = xgb.XGBRegressor()
            m.load_model(ML_DIR / mfile)
            p = m.predict(X_test)
            lo, hi = CLAMPS[name]
            preds[tag] = np.clip(p, lo, hi)  # live path clamps before decidePot sees them

        head = {'test_rows': len(X_test)}
        for tag in ('old', 'v93'):
            p = preds[tag]
            tiers = pd.Series([tiers_for(name, v) for v in p])
            head[f'{tag}_tier_occupancy'] = (tiers.value_counts(normalize=True)).round(4).to_dict()
            head[f'{tag}_pred_percentiles'] = {q: float(np.percentile(p, q)) for q in (0, 1, 5, 25, 50, 75, 95, 99, 100)}
            head[f'{tag}_long_gate_pass'] = {  # long entry: pred >= minReturn AND tier >= minRec
                str(mr): float(np.mean(p >= mr)) for mr in MIN_RETURNS}
            head[f'{tag}_short_downside_pass'] = {  # F5-corrected short gate: -pred >= minReturn
                str(mr): float(np.mean(-p >= mr)) for mr in MIN_RETURNS}
            # where does each fixed threshold sit in this prediction distribution?
            head[f'{tag}_threshold_percentile'] = {
                lbl: float(np.mean(p <= thr)) for lbl, thr in THRESHOLDS[name].items()}
        # convenience deltas
        head['tier_occupancy_delta'] = {
            t: round(head['v93_tier_occupancy'].get(t, 0.0) - head['old_tier_occupancy'].get(t, 0.0), 4)
            for t in set(head['v93_tier_occupancy']) | set(head['old_tier_occupancy'])}
        results[name] = head
        print(f"[{name}] rows={len(X_test)}")
        print(f"  old tiers: {head['old_tier_occupancy']}")
        print(f"  v93 tiers: {head['v93_tier_occupancy']}")
        print(f"  old pred pctiles: {head['old_pred_percentiles']}")
        print(f"  v93 pred pctiles: {head['v93_pred_percentiles']}")
        print(f"  short-gate pass (downside>=0.12): old={head['old_short_downside_pass']['0.12']:.4f} "
              f"v93={head['v93_short_downside_pass']['0.12']:.4f}")

    with open(ML_DIR / 'scratch' / 'scratch_v93_tier_shift_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    print("\nWrote scratch/scratch_v93_tier_shift_results.json")


if __name__ == '__main__':
    main()
