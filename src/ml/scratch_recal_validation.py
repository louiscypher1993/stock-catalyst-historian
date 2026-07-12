#!/usr/bin/env python3
"""
STEP 4/5 validation for the v9.3 HORIZON_TIER_CONFIG recalibration
(src/PotService.ts, 2026-07-12). Fresh decile re-validation with the NEW
thresholds actually applied -- same 10,051-row temporal test fold and
methodology as the original derivation and the P4 analysis. Decisive checks:

  1. Tier occupancy per head under v9.3 predictions + NEW thresholds --
     must land close to the intended ~10% SB / ~10% BUY / ~10% SELL / ~70%
     HOLD shape (D1: SB only; D2: BUY only).
  2. Decile-quality of the selected tiers: mean realized forward return of
     each tier bucket vs population (the point of tiers is selection, not
     just occupancy).
  3. D2 point-mass check near the new 0.106656 threshold (the old bug class).
  4. F5 re-verification: D5/D3 short-gate pass rates (tier==SELL AND signed
     downside -pred >= ambitionTier minReturns) under new thresholds.

Read-only; writes src/ml/scratch/scratch_recal_validation_results.json.
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
    'D3': ('forward_return_2d', 'model_d3_v9.3.json'),
    'D5': ('forward_return_2w', 'model_d5_v9.3.json'),
    'D1': ('forward_return_3m', 'model_d1_v9.3.json'),
    'D2': ('forward_return_6m', 'model_d2_v9.3.json'),
}
CLAMPS = {'D3': (-0.20, 0.20), 'D5': (-0.35, 0.35), 'D1': (-0.50, 0.50), 'D2': (-0.40, 0.40)}


# EXACTLY the new HORIZON_TIER_CONFIG (src/PotService.ts, this change)
def tier_of(name, v):
    if name == 'D3':
        if v >= 0.010831: return 'STRONG_BUY'
        if v <= -0.004385: return 'SELL'
        return 'HOLD'
    if name == 'D5':
        if v >= 0.031582: return 'STRONG_BUY'
        if v >= 0.024743: return 'BUY'
        if v <= -0.001411: return 'SELL'
        return 'HOLD'
    if name == 'D1':
        return 'STRONG_BUY' if v >= 0.057568 else 'HOLD'
    if name == 'D2':
        return 'BUY' if v > 0.106656 else 'HOLD'


MIN_RETURNS = [0.03, 0.12, 0.21, 0.27]  # ambitionTier minReturn ladder


def split_test(dates_series, X, y, embargo_days=21):
    dates = pd.to_datetime(dates_series.loc[X.index])
    n = len(dates)
    cutoff_val = dates.sort_values().iloc[int(n * 0.85)]
    m = dates >= cutoff_val
    return X[m], y[m]


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
    for name, (label_col, mfile) in HEADS.items():
        sub = df.dropna(subset=[label_col])
        X_test, y_test = split_test(sub['date'], sub[feature_cols], sub[label_col])
        lo, hi = CLAMPS[name]
        m = xgb.XGBRegressor()
        m.load_model(ML_DIR / mfile)
        preds = np.clip(m.predict(X_test), lo, hi)
        y = y_test.to_numpy(dtype=float)
        tiers = np.array([tier_of(name, v) for v in preds])

        head = {'test_rows': int(len(preds))}
        occ, quality = {}, {}
        pop_mean, pop_std = float(np.mean(y)), float(np.std(y))
        for t in ('STRONG_BUY', 'BUY', 'SELL', 'HOLD'):
            mask = tiers == t
            occ[t] = round(float(mask.mean()), 4)
            if mask.any():
                tm = float(np.mean(y[mask]))
                quality[t] = {'mean_fwd_return': round(tm, 5),
                              'z_vs_pop': round((tm - pop_mean) / pop_std, 3) if pop_std > 0 else 0.0,
                              'n': int(mask.sum())}
        head['occupancy'] = occ
        head['tier_quality'] = quality
        head['pop_mean_fwd_return'] = round(pop_mean, 5)

        # short gate (F5-corrected): tier==SELL AND -pred >= minReturn
        sell_mask = tiers == 'SELL'
        head['short_gate_pass'] = {
            str(mr): {'rate': round(float(np.mean(sell_mask & (-preds >= mr))), 5),
                      'n': int(np.sum(sell_mask & (-preds >= mr)))}
            for mr in MIN_RETURNS}
        head['pred_percentiles'] = {q: round(float(np.percentile(preds, q)), 5) for q in (0, 1, 5, 50, 95, 99, 100)}

        if name == 'D2':
            # point-mass audit near the new threshold (the old 0.220613 bug class)
            vals, counts = np.unique(np.round(preds, 6), return_counts=True)
            top = sorted(zip(counts, vals), reverse=True)[:3]
            near = [(int(c), float(v)) for c, v in zip(counts, vals) if abs(v - 0.106656) < 0.002]
            head['d2_top_point_masses'] = [(int(c), float(v)) for c, v in top]
            head['d2_masses_within_0.002_of_threshold'] = near

        out[name] = head
        print(f"[{name}] n={len(preds)} occupancy={occ}")
        print(f"     quality={json.dumps(quality)}")
        print(f"     short-gate pass: " + ", ".join(f">={mr}: {head['short_gate_pass'][str(mr)]['n']}" for mr in MIN_RETURNS))

    with open(ML_DIR / 'scratch' / 'scratch_recal_validation_results.json', 'w') as f:
        json.dump(out, f, indent=2)
    print("\nWrote scratch/scratch_recal_validation_results.json")


if __name__ == '__main__':
    main()
