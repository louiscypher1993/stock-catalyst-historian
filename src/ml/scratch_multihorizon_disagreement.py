#!/usr/bin/env python3
"""
Recon (read-only, no implementation): does multi-horizon agreement/
disagreement carry real predictive information the current D5-only
HORIZON_TIER_CONFIG tier logic ignores?

Uses the CURRENT (post-recalibration, commit 6a13f12) D5 SELL threshold
(v <= -0.001411) applied to v9.3 model predictions on the same 10,051-row
temporal test fold used throughout this investigation. All 6 horizons are
scored with the exact deployed model files (B/D1/D2/D3/D5 on v9.3, D4 on
v9.2 -- matches infer.py's real wiring) and the exact live clamp bounds
from LiveInferenceService.ts (B+-0.30, D1+-0.50, D2+-0.40, D3+-0.20,
D4+-0.25, D5+-0.35).

For every row tiered SELL under D5 alone:
  1. count how many of the OTHER 5 horizons (2D/3D/1M/3M/6M) are positive
     vs negative, and how many sit near their own clamp ceiling (>=80% of
     the clamp bound)
  2. split into agree (other horizons mostly/all negative-or-weak) vs
     disagree (other horizons majority positive AND at least one near its
     own ceiling) groups
  3. compare REALIZED forward_return_2w between the two groups -- this is
     the decisive test, not model predictions
  4. report the disagreement group's share of the current (~10%) SELL
     population

Read-only; writes src/ml/scratch/scratch_multihorizon_disagreement_results.json.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import mannwhitneyu

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

# exact deployed wiring (infer.py) -- B/D1/D2/D3/D5 on v9.3, D4 on v9.2
HORIZON_MODELS = {
    'D3_2d':  ('forward_return_2d',  'model_d3_v9.3.json', (-0.20, 0.20)),
    'D4_3d':  ('forward_return_3d',  'model_d4_v9.2.json', (-0.25, 0.25)),
    'B_1m':   ('forward_return_1m',  'model_b_v9.3.json',  (-0.30, 0.30)),
    'D1_3m':  ('forward_return_3m',  'model_d1_v9.3.json', (-0.50, 0.50)),
    'D2_6m':  ('forward_return_6m',  'model_d2_v9.3.json', (-0.40, 0.40)),
    'D5_2w':  ('forward_return_2w',  'model_d5_v9.3.json', (-0.35, 0.35)),
}
OTHER_HORIZONS = ['D3_2d', 'D4_3d', 'B_1m', 'D1_3m', 'D2_6m']  # everything except D5 itself

D5_SELL_THRESHOLD = -0.001411  # CURRENT live HORIZON_TIER_CONFIG.model_d5_return_2w.sell (commit 6a13f12)
NEAR_CEILING_FRAC = 0.80        # "near own clamp ceiling" = >=80% of that horizon's clamp bound


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

    # Anchor the test fold on D5's own label (forward_return_2w) -- matches
    # every prior verification script's methodology (each head's own
    # dropna+split), so this reproduces the exact same 10,051-row D5 test
    # fold used throughout the deep-dive.
    label_col, mfile, clamp = HORIZON_MODELS['D5_2w']
    sub = df.dropna(subset=[label_col])
    X, y = sub[feature_cols], sub[label_col]
    X_test, y_test, idx = split_test(sub['date'], X, y)
    test_rows = sub.loc[idx]
    print(f"D5 test fold: {len(idx)} rows")

    # Score ALL horizons on this SAME row set (reindexing each horizon's
    # model onto the D5 test fold's rows, not each horizon's own dropna
    # split -- necessary to compare horizons row-for-row).
    preds = {}
    labels = {}
    for name, (lcol, mf, (lo, hi)) in HORIZON_MODELS.items():
        m = xgb.XGBRegressor()
        m.load_model(ML_DIR / mf)
        p = np.clip(m.predict(test_rows[feature_cols]), lo, hi)
        preds[name] = p
        labels[name] = test_rows[lcol].to_numpy(dtype=float)  # NaN where that horizon's real label is missing

    d5_pred = preds['D5_2w']
    d5_actual_2w = labels['D5_2w']  # == y_test, sanity-redundant

    sell_mask = d5_pred <= D5_SELL_THRESHOLD
    n_sell = int(sell_mask.sum())
    print(f"D5-SELL rows under CURRENT threshold ({D5_SELL_THRESHOLD}): {n_sell}/{len(d5_pred)} = {n_sell/len(d5_pred):.4f}")

    # STEP 1: for SELL rows, per-other-horizon positive/negative/near-ceiling counts
    step1 = {}
    for name in OTHER_HORIZONS:
        lo, hi = HORIZON_MODELS[name][2]
        p = preds[name][sell_mask]
        pos = int(np.sum(p > 0))
        neg = int(np.sum(p <= 0))
        near_ceiling = int(np.sum(p >= NEAR_CEILING_FRAC * hi))
        step1[name] = {'positive': pos, 'negative': neg, 'pos_rate': round(pos / n_sell, 4),
                        'near_own_ceiling_count': near_ceiling, 'near_own_ceiling_rate': round(near_ceiling / n_sell, 4),
                        'clamp': [lo, hi]}
        print(f"  [{name}] among SELL rows: positive={pos} ({pos/n_sell:.1%}) negative={neg}  "
              f"near_ceiling(>= {NEAR_CEILING_FRAC*hi:.4f})={near_ceiling} ({near_ceiling/n_sell:.1%})")

    def stats(arr):
        arr = arr[~np.isnan(arr)]
        if len(arr) == 0:
            return {'n': 0}
        return {'n': int(len(arr)), 'mean': round(float(np.mean(arr)), 5),
                'median': round(float(np.median(arr)), 5), 'std': round(float(np.std(arr)), 5),
                'win_rate_gt0': round(float(np.mean(arr > 0)), 4),
                'p10': round(float(np.percentile(arr, 10)), 5), 'p90': round(float(np.percentile(arr, 90)), 5)}

    y_sell = d5_actual_2w[sell_mask]
    pop_stats = stats(d5_actual_2w[~np.isnan(d5_actual_2w)])

    def run_split(horizon_set, label, require_near_ceiling=True):
        pm = np.column_stack([preds[n][sell_mask] for n in horizon_set])
        ceilings = np.array([HORIZON_MODELS[n][2][1] for n in horizon_set])
        n_pos = np.sum(pm > 0, axis=1)
        majority = len(horizon_set) // 2 + 1
        if require_near_ceiling:
            near_ceil = np.any(pm >= (NEAR_CEILING_FRAC * ceilings), axis=1)
            disagree_mask = (n_pos >= majority) & near_ceil
        else:
            disagree_mask = n_pos >= majority
        agree_mask = ~disagree_mask
        n_dis, n_agr = int(disagree_mask.sum()), int(agree_mask.sum())
        y_dis, y_agr = y_sell[disagree_mask], y_sell[agree_mask]
        d_stats, a_stats = stats(y_dis), stats(y_agr)
        mw = None
        if d_stats.get('n', 0) >= 5 and a_stats.get('n', 0) >= 5:
            dc, ac = y_dis[~np.isnan(y_dis)], y_agr[~np.isnan(y_agr)]
            u, p = mannwhitneyu(dc, ac, alternative='two-sided')
            mw = {'u_stat': float(u), 'p_value': float(p)}
        print(f"\n[{label}] disagree(>={majority}/{len(horizon_set)} positive AND >=1 near own ceiling)="
              f"{n_dis} ({n_dis/n_sell:.1%})  agree={n_agr} ({n_agr/n_sell:.1%})")
        print(f"  disagree realized_2w: {d_stats}")
        print(f"  agree realized_2w:    {a_stats}")
        if mw:
            print(f"  Mann-Whitney U: U={mw['u_stat']:.1f} p={mw['p_value']:.4f}")
        return {'horizons_used': horizon_set, 'majority_threshold': majority,
                'n_disagree': n_dis, 'disagree_share_of_sell': round(n_dis / n_sell, 4),
                'n_agree': n_agr, 'agree_share_of_sell': round(n_agr / n_sell, 4),
                'disagree_realized_2w': d_stats, 'agree_realized_2w': a_stats, 'mann_whitney': mw}

    print("\nSTEP 2 (primary, all 5 other horizons incl. D4 which is still on v9.2/compressed):")
    step2_all = run_split(OTHER_HORIZONS, "ALL 5 horizons (incl. D4/v9.2)")

    print("\nSTEP 2 (robustness: D4 excluded -- D4 is 99.95% positive UNCONDITIONALLY across the "
          "whole test fold, an artifact of staying on the old compressed v9.2 model, not real "
          "cross-horizon signal; including it in the majority-vote nearly guarantees 'disagree'):")
    horizons_no_d4 = [h for h in OTHER_HORIZONS if h != 'D4_3d']
    step2_no_d4 = run_split(horizons_no_d4, "4 horizons (D4 excluded)")

    print("\nSTEP 3 distribution check (looser definition: majority-positive only, "
          "no near-ceiling requirement, D4 excluded):")
    step3_loose = run_split(horizons_no_d4, "4 horizons, majority-positive only (no ceiling req)",
                             require_near_ceiling=False)

    print(f"\nwhole population (context): {pop_stats}")

    out = {
        'd5_sell_threshold': D5_SELL_THRESHOLD,
        'test_fold_rows': int(len(d5_pred)),
        'n_sell': n_sell,
        'sell_occupancy': round(n_sell / len(d5_pred), 4),
        'step1_per_horizon': step1,
        'd4_whole_fold_positive_rate_unconditioned': 0.9995,  # see standalone check, matches this run's data source
        'step2_all_5_horizons': step2_all,
        'step2_excl_d4_robustness': step2_no_d4,
        'step3_loose_majority_only': step3_loose,
        'whole_pop_realized_2w': pop_stats,
    }
    (ML_DIR / 'scratch').mkdir(exist_ok=True)
    with open(ML_DIR / 'scratch' / 'scratch_multihorizon_disagreement_results.json', 'w') as f:
        json.dump(out, f, indent=2)
    print("\nWrote scratch/scratch_multihorizon_disagreement_results.json")


if __name__ == '__main__':
    main()
