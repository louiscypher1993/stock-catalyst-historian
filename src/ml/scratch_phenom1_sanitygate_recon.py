"""
Phenomenon 1 sanity-gate scoping recon (read-only): raw (pre-clamp) prediction
percentile distributions for every currently-deployed regression head (B, D1,
D2, D3, D4, D5), on the same 10,051-row temporal test fold used throughout
this investigation. Gives the real population range needed to propose a
degenerate-input threshold, rather than eyeballing it.
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
    'B (1M)':  ('forward_return_1m', 'model_b_v9.3.json', (-0.30, 0.30)),
    'D1 (3M)': ('forward_return_3m', 'model_d1_v9.3.json', (-0.50, 0.50)),
    'D2 (6M)': ('forward_return_6m', 'model_d2_v9.3.json', (-0.40, 0.40)),
    'D3 (2D)': ('forward_return_2d', 'model_d3_v9.3.json', (-0.20, 0.20)),
    'D4 (3D)': ('forward_return_3d', 'model_d4_v9.2.json', (-0.25, 0.25)),
    'D5 (2W)': ('forward_return_2w', 'model_d5_v9.3.json', (-0.35, 0.35)),
    'C (drawdown, uncla mped)'.replace(' ', ''): ('max_adverse_excursion_1m', 'model_c_v9.1.json', None),
}

def split_test(dates_series, X, y, embargo_days=21):
    dates = pd.to_datetime(dates_series.loc[X.index])
    n = len(dates)
    cutoff_val = dates.sort_values().iloc[int(n * 0.85)]
    m = dates >= cutoff_val
    return X[m], y[m], X.index[m]

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
    for label, (target_col, model_file, clamp) in HEADS.items():
        sub = df.dropna(subset=[target_col])
        X, y, idx = split_test(sub['date'], sub[feature_cols], sub[target_col])
        m = xgb.XGBRegressor()
        m.load_model(ML_DIR / model_file)
        raw = m.predict(X)
        pcts = {q: round(float(np.percentile(raw, q)), 5) for q in (0, 0.1, 1, 5, 25, 50, 75, 95, 99, 99.9, 100)}
        n_gt_1 = int((np.abs(raw) > 1.0).sum())
        n_gt_0_5 = int((np.abs(raw) > 0.5).sum())
        print(f"{label} ({model_file}, n={len(raw)}): p0={pcts[0]} p1={pcts[1]} p5={pcts[5]} "
              f"p50={pcts[50]} p95={pcts[95]} p99={pcts[99]} p99.9={pcts[99.9]} p100={pcts[100]}  "
              f"|raw|>50%={n_gt_0_5} ({n_gt_0_5/len(raw):.4%})  |raw|>100%={n_gt_1} ({n_gt_1/len(raw):.4%})")
        out[label] = {
            'model_file': model_file, 'clamp': clamp, 'n': len(raw),
            'percentiles': pcts,
            'count_abs_gt_0.5': n_gt_0_5, 'rate_abs_gt_0.5': round(n_gt_0_5/len(raw), 6),
            'count_abs_gt_1.0': n_gt_1, 'rate_abs_gt_1.0': round(n_gt_1/len(raw), 6),
        }

    (ML_DIR / 'scratch').mkdir(exist_ok=True)
    with open(ML_DIR / 'scratch' / 'scratch_phenom1_sanitygate_recon_results.json', 'w') as f:
        json.dump(out, f, indent=2)
    print("\nWrote scratch/scratch_phenom1_sanitygate_recon_results.json")

if __name__ == '__main__':
    main()
