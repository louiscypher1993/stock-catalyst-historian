"""
Phenomenon 1 completeness-check sanity test: for the SAME 10,051-row temporal
test fold used throughout this investigation, compute per-row zero-count
across the model-input feature columns (excluding metadata/target columns),
for rows that ALL have real signal_snapshot_json coverage (features.csv's
WHERE clause guarantees this). This is the "legitimately covered" population
the proposed >40-zeros cutoff must NOT false-positive against.
"""
import json
import numpy as np
import pandas as pd
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

def split_test(dates_series, idx):
    dates = pd.to_datetime(dates_series.loc[idx])
    n = len(dates)
    cutoff_val = dates.sort_values().iloc[int(n * 0.85)]
    m = dates >= cutoff_val
    return idx[m]

def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    obj = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    feature_cols = [c for c in df.columns if c not in EXCLUDE_COLS and c not in obj]
    print(f"Feature column count used for zero-counting: {len(feature_cols)}")

    test_idx = split_test(df['date'], df.index)
    test_df = df.loc[test_idx, feature_cols]
    print(f"Test fold rows: {len(test_df)}")

    zero_counts = (test_df == 0).sum(axis=1)
    print(f"\nZero-count per row distribution (out of {len(feature_cols)} feature columns):")
    for q in [0, 10, 25, 50, 75, 90, 95, 99, 99.9, 100]:
        print(f"  p{q}: {np.percentile(zero_counts, q):.1f}")
    print(f"  mean: {zero_counts.mean():.2f}")

    for cutoff in [30, 35, 40, 45, 50, 55, 60]:
        n_over = int((zero_counts > cutoff).sum())
        print(f"Rows with zero-count > {cutoff}: {n_over} ({n_over/len(test_df):.4%})")

if __name__ == '__main__':
    main()
