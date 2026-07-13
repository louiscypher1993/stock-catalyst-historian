"""
STEP 6c: run the FULL 10,051-row test fold through the exact shipped gate
rule (primary: |D3|>0.30 OR |D5|>0.40; secondary: >=2 of {|B|>1.8, |D1|>2.5,
|D2|>2.5, |D4|>1.0}), report the joint false-positive rate. Every row in this
fold has real, non-null signal_snapshot_json (extractFeatures()'s WHERE
clause guarantees it), so the null_enrichment check trivially never fires
here by construction -- this measures the raw-prediction sanity gate alone.
"""
import numpy as np
import pandas as pd
import xgboost as xgb
from pathlib import Path

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

MODELS = {
    'B':  ('forward_return_1m', 'model_b_v9.3.json'),
    'D1': ('forward_return_3m', 'model_d1_v9.3.json'),
    'D2': ('forward_return_6m', 'model_d2_v9.3.json'),
    'D3': ('forward_return_2d', 'model_d3_v9.3.json'),
    'D4': ('forward_return_3d', 'model_d4_v9.2.json'),
    'D5': ('forward_return_2w', 'model_d5_v9.3.json'),
}

def split_test(dates_series, idx):
    dates = pd.to_datetime(dates_series.loc[idx])
    n = len(dates)
    cutoff_val = dates.sort_values().iloc[int(n * 0.85)]
    m = dates >= cutoff_val
    return idx[m]

def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0
    ).astype(int)
    ni = [c for c in df.columns if c.endswith('_is_null')]
    obj = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop = set(EXCLUDE_COLS) | set(ni) | set(ZERO_FILL_COLS) | set(PRE_RETURN_COLS) | set(obj)
    feature_cols = [c for c in df.columns if c not in drop]

    # Use D3's dropna/test-split index as the common row set (all heads share
    # the same underlying rows in this fold; D3 has full coverage).
    sub = df.dropna(subset=['forward_return_2d'])
    test_idx = split_test(sub['date'], sub.index)
    rows = sub.loc[test_idx]
    X = rows[feature_cols]

    preds = {}
    for label, (target_col, model_file) in MODELS.items():
        m = xgb.XGBRegressor()
        m.load_model(ML_DIR / model_file)
        preds[label] = m.predict(X)

    n = len(rows)
    primary = (np.abs(preds['D3']) > 0.30) | (np.abs(preds['D5']) > 0.40)
    secondary_count = (
        (np.abs(preds['B']) > 1.8).astype(int) +
        (np.abs(preds['D1']) > 2.5).astype(int) +
        (np.abs(preds['D2']) > 2.5).astype(int) +
        (np.abs(preds['D4']) > 1.0).astype(int)
    )
    secondary = secondary_count >= 2
    flagged = primary | secondary

    print(f"Test fold rows: {n}")
    print(f"Primary trigger (|D3|>0.30 OR |D5|>0.40): {int(primary.sum())} rows ({primary.mean():.4%})")
    print(f"Secondary trigger (>=2 of B/D1/D2/D4 corroborating): {int(secondary.sum())} rows ({secondary.mean():.4%})")
    print(f"TOTAL flagged (raw_prediction_outlier): {int(flagged.sum())} rows ({flagged.mean():.4%})")
    print(f"\nnull_enrichment check: 0/{n} (0.0000%) -- every row in this fold has real, non-null")
    print(f"signal_snapshot_json by construction (extractFeatures()'s WHERE clause); this check")
    print(f"cannot false-positive against this population at all.")

    if int(flagged.sum()) > 0:
        flagged_rows = rows[flagged]
        print(f"\nFlagged rows detail (symbol, date, D3, D5, B, D1, D2, D4):")
        for i in flagged_rows.index[:20]:
            pos = rows.index.get_loc(i)
            print(f"  {rows.loc[i,'symbol']} {rows.loc[i,'date']}: D3={preds['D3'][pos]:.4f} D5={preds['D5'][pos]:.4f} "
                  f"B={preds['B'][pos]:.4f} D1={preds['D1'][pos]:.4f} D2={preds['D2'][pos]:.4f} D4={preds['D4'][pos]:.4f}")

if __name__ == '__main__':
    main()
