#!/usr/bin/env python3
"""
Recon (read-only, no implementation): are the D3(2D)/D4(3D) clamp ceilings
in LiveInferenceService.ts (~lines 1193-1194: model_d3_return_2d clamped to
+-0.20, model_d4_return_3d clamped to +-0.25) now hit much more often under
v9.3's wider prediction spread than under the pre-v9.3 compressed models --
same root pattern as the just-fixed HORIZON_TIER_CONFIG miscalibration.

IMPORTANT ASYMMETRY, confirmed before writing this script: D3 WAS part of
the v9.3 retrain (B/D1/D2/D3/D5, commit 5efd794) -- its real "old vs new"
comparison is model_d3_v9.2_pre_regularization_backup.json (deployed
immediately pre-v9.3) vs model_d3_v9.3.json (currently deployed). D4 was
NOT part of v9.3 -- infer.py still loads model_d4_v9.2.json, unchanged
since the earlier v9.2 relabeling retrain (14a3417), well before this
session's v9.3 work. So there is no "v9.3 changed D4's distribution" event
to test for D4 -- this script measures D4's CURRENT (v9.2, unchanged)
clamp-hit rate for context, and separately checks v9.1->v9.2 (the actual
retrain D4 underwent) as a secondary, clearly-labeled comparison.

Uses the same 10,051-row temporal test fold as every other verification
script in this investigation.

Read-only; writes src/ml/scratch/scratch_clamp_ceiling_recon_results.json.
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

CLAMP_D3 = (-0.20, 0.20)
CLAMP_D4 = (-0.25, 0.25)

# Suffix -> rough exchange/region grouping, for the concentration check.
# US-listed = no suffix or .NYSE/.NASDAQ (matches is_us_listed convention
# used throughout this investigation).
SUFFIX_GROUP = {
    '.L': 'UK (LSE)', '.PA': 'France', '.AS': 'Netherlands', '.BR': 'Belgium',
    '.DE': 'Germany', '.F': 'Germany', '.HK': 'Hong Kong', '.SS': 'China (SSE)',
    '.SZ': 'China (SZSE)', '.T': 'Japan', '.TO': 'Canada', '.AX': 'Australia',
    '.NS': 'India', '.BO': 'India', '.KS': 'South Korea', '.TW': 'Taiwan',
    '.SW': 'Switzerland', '.ST': 'Sweden', '.OL': 'Norway', '.CO': 'Denmark',
    '.ME': 'Russia', '.SA': 'Brazil', '.BA': 'Argentina', '.MX': 'Mexico',
    '.IS': 'Turkey', '.NZ': 'New Zealand', '.WA': 'Poland', '.MI': 'Italy',
    '.SI': 'Singapore', '.RO': 'Romania', '.AT': 'Greece', '.VN': 'Vietnam',
    '.KL': 'Malaysia', '.BK': 'Thailand',
}


def exchange_group(symbol):
    s = str(symbol)
    if '.' not in s or s.endswith('.NYSE') or s.endswith('.NASDAQ'):
        return 'US'
    suffix = s[s.rfind('.'):]
    return SUFFIX_GROUP.get(suffix, f'Other ({suffix})')


def split_test(dates_series, X, y, embargo_days=21):
    dates = pd.to_datetime(dates_series.loc[X.index])
    n = len(dates)
    cutoff_val = dates.sort_values().iloc[int(n * 0.85)]
    m = dates >= cutoff_val
    return X[m], y[m], X.index[m]


def analyze_head(name, label_col, model_file, clamp, feature_cols, df, tag):
    sub = df.dropna(subset=[label_col])
    X, y, idx = split_test(sub['date'], sub[feature_cols], sub[label_col])
    rows = sub.loc[idx]
    m = xgb.XGBRegressor()
    m.load_model(ML_DIR / model_file)
    raw = m.predict(X)  # RAW, unclamped -- need this to know if it would have exceeded the bound
    lo, hi = clamp
    hit_lo = raw <= lo
    hit_hi = raw >= hi
    hit_any = hit_lo | hit_hi
    n = len(raw)
    result = {
        'tag': tag, 'model_file': model_file, 'test_rows': int(n),
        'clamp': [lo, hi],
        'hit_lo_count': int(hit_lo.sum()), 'hit_lo_rate': round(float(hit_lo.mean()), 4),
        'hit_hi_count': int(hit_hi.sum()), 'hit_hi_rate': round(float(hit_hi.mean()), 4),
        'hit_any_count': int(hit_any.sum()), 'hit_any_rate': round(float(hit_any.mean()), 4),
        'raw_pred_percentiles': {q: round(float(np.percentile(raw, q)), 5) for q in (0, 1, 5, 95, 99, 100)},
    }
    print(f"[{tag}] {name} ({model_file}): n={n}  hit_lo={hit_lo.sum()} ({hit_lo.mean():.2%})  "
          f"hit_hi={hit_hi.sum()} ({hit_hi.mean():.2%})  hit_any={hit_any.mean():.2%}")
    return result, raw, hit_any, rows


def concentration_check(rows, hit_mask, label):
    hit_rows = rows[hit_mask]
    total_groups = rows['symbol'].apply(exchange_group).value_counts(normalize=True)
    hit_groups = hit_rows['symbol'].apply(exchange_group).value_counts(normalize=True)
    hit_counts = hit_rows['symbol'].apply(exchange_group).value_counts()
    us_share_population = float(total_groups.get('US', 0.0))
    us_share_hits = float(hit_groups.get('US', 0.0))
    print(f"\n[{label}] concentration check: {len(hit_rows)} ceiling-hitting rows")
    print(f"   US share of WHOLE population: {us_share_population:.1%}  |  US share of CEILING-HITTING rows: {us_share_hits:.1%}")
    print(f"   Top exchange groups among ceiling-hitters: {hit_counts.head(8).to_dict()}")
    us_hit_symbols = sorted(hit_rows[hit_rows['symbol'].apply(exchange_group) == 'US']['symbol'].unique())
    print(f"   Sample US symbols that hit the ceiling ({len(us_hit_symbols)} distinct): {us_hit_symbols[:20]}")
    return {
        'n_hit_rows': int(len(hit_rows)),
        'us_share_of_population': round(us_share_population, 4),
        'us_share_of_hits': round(us_share_hits, 4),
        'hit_group_counts': {k: int(v) for k, v in hit_counts.to_dict().items()},
        'us_hit_symbols_distinct': us_hit_symbols,
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

    print("=== D3 (2D) -- WAS part of v9.3 retrain: real old-vs-new comparison ===")
    d3_old, _, d3_old_hit, d3_old_rows = analyze_head(
        'D3', 'forward_return_2d', 'model_d3_v9.2_pre_regularization_backup.json', CLAMP_D3,
        feature_cols, df, 'D3_OLD_pre_v9.3')
    d3_new, _, d3_new_hit, d3_new_rows = analyze_head(
        'D3', 'forward_return_2d', 'model_d3_v9.3.json', CLAMP_D3,
        feature_cols, df, 'D3_NEW_v9.3_current')
    d3_conc = concentration_check(d3_new_rows, d3_new_hit, 'D3 v9.3 (current, deployed)')
    out['D3'] = {'old_pre_v9.3': d3_old, 'new_v9.3_current': d3_new, 'concentration_new': d3_conc}

    print("\n=== D4 (3D) -- NOT part of v9.3 retrain (still on v9.2, unchanged by this session's work) ===")
    d4_current, _, d4_current_hit, d4_current_rows = analyze_head(
        'D4', 'forward_return_3d', 'model_d4_v9.2.json', CLAMP_D4,
        feature_cols, df, 'D4_CURRENT_v9.2_deployed')
    d4_conc = concentration_check(d4_current_rows, d4_current_hit, 'D4 v9.2 (current, deployed)')
    out['D4'] = {'current_v9.2_deployed': d4_current, 'concentration_current': d4_conc}

    # secondary, clearly-separate context: D4's actual retrain event (v9.1->v9.2)
    print("\n=== D4 secondary context (NOT the v9.3 story): v9.1 -> v9.2, D4's real retrain event ===")
    d4_v91, _, _, _ = analyze_head(
        'D4', 'forward_return_3d', 'model_d4_v9.1.json', CLAMP_D4, feature_cols, df, 'D4_v9.1_pre_relabel')
    out['D4']['v9.1_pre_relabel_context'] = d4_v91

    (ML_DIR / 'scratch').mkdir(exist_ok=True)
    with open(ML_DIR / 'scratch' / 'scratch_clamp_ceiling_recon_results.json', 'w') as f:
        json.dump(out, f, indent=2)
    print("\nWrote scratch/scratch_clamp_ceiling_recon_results.json")


if __name__ == '__main__':
    main()
