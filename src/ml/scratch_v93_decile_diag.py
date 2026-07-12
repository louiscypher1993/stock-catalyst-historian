#!/usr/bin/env python3
"""
P4 of DEEP_DIVE_BRIEFING.md: extended v9.3 verification, focused on the
decision Lewis actually has to make (recalibrate HORIZON_TIER_CONFIG for
v9.3, or revert v9.3): does v9.3 rank-order forward returns at least as well
as the old models at the tier-relevant tails?

Per head (D3/D5/D1/D2 + B), on the same 10,051-row temporal test fold used
for both the original threshold calibration and P1b's tier-shift measurement:
  1. Decile diagnostic (the original HORIZON_TIER_CONFIG methodology):
     mean realized forward return in the top/bottom prediction decile vs
     population, in population-std units -- old model vs v9.3.
  2. Proposed percentile-equivalent thresholds: each existing threshold's
     percentile under OLD predictions, mapped to the same percentile of the
     v9.3 prediction distribution. These are the candidate numbers for a
     recalibrated HORIZON_TIER_CONFIG (need sign-off + their own decile
     re-validation before any code change).

Read-only; writes src/ml/scratch/scratch_v93_decile_diag_results.json.
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
    'D3': ('forward_return_2d', 'model_d3_v9.2_pre_regularization_backup.json', 'model_d3_v9.3.json'),
    'D5': ('forward_return_2w', 'model_d5_v9.2_pre_regularization_backup.json', 'model_d5_v9.3.json'),
    'D1': ('forward_return_3m', 'model_d1_v9.1_pre_regularization_backup.json', 'model_d1_v9.3.json'),
    'D2': ('forward_return_6m', 'model_d2_v9.1_pre_regularization_backup.json', 'model_d2_v9.3.json'),
    'B':  ('forward_return_1m', 'model_b_v9.1_pre_regularization_backup.json', 'model_b_v9.3.json'),
}

# existing HORIZON_TIER_CONFIG thresholds to remap (label -> value)
EXISTING_THRESHOLDS = {
    'D3': {'strongBuy': 0.0187, 'sell': 0.0096},
    'D5': {'strongBuy': 0.1575, 'buy': 0.1489, 'sell': 0.1341},
    'D1': {'strongBuy': 0.0682},
    'D2': {'buy': 0.220613},  # true degenerate-tie value, not the truncated 0.2206 (P1b Finding 2)
}
CLAMPS = {'D3': (-0.20, 0.20), 'D5': (-0.35, 0.35), 'D1': (-0.50, 0.50), 'D2': (-0.40, 0.40), 'B': (-0.30, 0.30)}


def split_test(dates_series, X, y, embargo_days=21):
    dates = pd.to_datetime(dates_series.loc[X.index])
    n = len(dates)
    cutoff_val = dates.sort_values().iloc[int(n * 0.85)]
    m = dates >= cutoff_val
    return X[m], y[m]


def decile_diag(preds, y):
    y = np.asarray(y, dtype=float)
    pop_mean, pop_std = float(np.mean(y)), float(np.std(y))
    lo, hi = np.percentile(preds, 10), np.percentile(preds, 90)
    top = y[preds >= hi]
    bot = y[preds <= lo]
    z = lambda m: (m - pop_mean) / pop_std if pop_std > 0 else 0.0
    return {
        'pop_mean': pop_mean, 'pop_std': pop_std,
        'top_decile_mean': float(np.mean(top)), 'top_decile_z': float(z(np.mean(top))), 'top_n': int(len(top)),
        'bottom_decile_mean': float(np.mean(bot)), 'bottom_decile_z': float(z(np.mean(bot))), 'bot_n': int(len(bot)),
        'top_minus_bottom': float(np.mean(top) - np.mean(bot)),
    }


def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0
    ).astype(int)
    ni = [c for c in df.columns if c.endswith('_is_null')]
    obj = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop = set(EXCLUDE_COLS) | set(ni) | set(ZERO_FILL_COLS) | set(PRE_RETURN_COLS) | set(obj)
    feature_cols = [c for c in df.columns if c not in drop]

    out = {}
    for name, (label_col, old_file, new_file) in HEADS.items():
        sub = df.dropna(subset=[label_col])
        X_test, y_test = split_test(sub['date'], sub[feature_cols], sub[label_col])
        lo, hi = CLAMPS[name]
        preds = {}
        for tag, f in (('old', old_file), ('v93', new_file)):
            m = xgb.XGBRegressor()
            m.load_model(ML_DIR / f)
            preds[tag] = np.clip(m.predict(X_test), lo, hi)

        head = {'test_rows': int(len(X_test))}
        for tag in ('old', 'v93'):
            head[f'{tag}_ic'] = float(spearmanr(preds[tag], y_test)[0])
            head[f'{tag}_decile'] = decile_diag(preds[tag], y_test.to_numpy())
        # percentile-equivalent threshold remap
        remap = {}
        for lbl, thr in EXISTING_THRESHOLDS.get(name, {}).items():
            pct = float(np.mean(preds['old'] <= thr))
            new_thr = float(np.percentile(preds['v93'], pct * 100))
            remap[lbl] = {'old_threshold': thr, 'old_percentile': round(pct, 4),
                          'proposed_v93_threshold': round(new_thr, 6)}
        head['threshold_remap'] = remap
        out[name] = head

        d_o, d_v = head['old_decile'], head['v93_decile']
        print(f"[{name}] n={len(X_test)}  IC old={head['old_ic']:.4f} v93={head['v93_ic']:.4f}")
        print(f"   top-decile z: old={d_o['top_decile_z']:+.2f} v93={d_v['top_decile_z']:+.2f}   "
              f"bottom-decile z: old={d_o['bottom_decile_z']:+.2f} v93={d_v['bottom_decile_z']:+.2f}   "
              f"top-bot spread: old={d_o['top_minus_bottom']:+.4f} v93={d_v['top_minus_bottom']:+.4f}")
        for lbl, r in remap.items():
            print(f"   remap {lbl}: {r['old_threshold']} (p{r['old_percentile']*100:.1f}) -> {r['proposed_v93_threshold']}")

    with open(ML_DIR / 'scratch' / 'scratch_v93_decile_diag_results.json', 'w') as f:
        json.dump(out, f, indent=2)
    print("\nWrote scratch/scratch_v93_decile_diag_results.json")


if __name__ == '__main__':
    main()
