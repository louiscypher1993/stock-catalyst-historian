#!/usr/bin/env python3
"""
P1a of DEEP_DIVE_BRIEFING.md: quantify the obv_delta_10d train/serve skew.

Established facts (timestamps, do not re-derive):
  - F1 commit b4e5987 (2026-07-11 03:31) redefined obv_delta_10d in BOTH
    HistoricalEngine.ts and LiveInferenceService.ts.
      OLD: cumulative-OBV delta over 10 bars, normalized by |level| of the
           since-inception running sum:  ((obv[i]-obv[i-10]) / max(1,|obv[i-10]|)) * 100
      NEW: net volume-signed pressure over bars [i-9..i] as % of total volume
           in that window: (signedVolSum / max(1,totalVolSum)) * 100, in [-100,100]
  - features.csv mtime 2026-07-07 19:21 (pre-change); v9.3 trained 2026-07-11
    ~18:04 FROM that stale CSV. So every deployed head (B/C/D1-D5/E) is trained
    on OLD-formula values while live now sends NEW-formula values.

This script quantifies what that means, with real events / real vectors /
real model scoring (the F1 measurement standard):
  1. Provenance: recompute OLD formula from daily_prices for every features.csv
     event; match rate vs stored values confirms the recompute harness is a
     valid stand-in for the training pipeline.
  2. Value-level skew: distribution of OLD vs NEW values; Spearman/sign
     agreement between them.
  3. Model-level skew: per deployed head, predictions on each head's real
     temporal-test-split rows with (a) stored OLD values [training-consistent]
     vs (b) NEW-formula values [what live will actually send]. Reports
     prediction-delta stats, rank stability, and IC under both.
  4. obv_delta_10d gain-importance per head, for context.

Read-only against model files and market_cache.db. Writes results JSON to
src/ml/scratch/ only.
"""
import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr

ML_DIR = Path(__file__).parent
DB_PATH = ML_DIR.parent.parent / 'market_cache.db'

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

REGRESSION_HEADS = {
    'B':  ('forward_return_1m', 'model_b_v9.3.json'),
    'D1': ('forward_return_3m', 'model_d1_v9.3.json'),
    'D2': ('forward_return_6m', 'model_d2_v9.3.json'),
    'D3': ('forward_return_2d', 'model_d3_v9.3.json'),
    'D5': ('forward_return_2w', 'model_d5_v9.3.json'),
}
# C (regressor, label not needed for shift stats) and E (classifier) — v9.1
OTHER_HEADS = {'C': 'model_c_v9.1.json', 'E': 'model_e_v9.1.json'}


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


def compute_obv_both_formulas(closes: np.ndarray, volumes: np.ndarray):
    """Vectorized per-symbol computation of both formulas at every bar index.
    Returns (old_vals, new_vals) arrays aligned to the input bars."""
    n = len(closes)
    # signed volume per transition: sign(close[i]-close[i-1]) * volume[i], 0 at i=0
    sign = np.zeros(n)
    sign[1:] = np.sign(closes[1:] - closes[:-1])
    signed_vol = sign * volumes

    # OLD: cumulative OBV level, delta over 10 bars normalized by |past level|
    obv = np.cumsum(signed_vol)  # obv[0]=0 matches TS (sign[0]=0)
    old_vals = np.full(n, np.nan)
    past_idx = np.maximum(0, np.arange(n) - 10)
    past_obv = obv[past_idx]
    old_vals = ((obv - past_obv) / np.maximum(1.0, np.abs(past_obv))) * 100.0

    # NEW: window [i-9..i]; total volume of those bars; signed volume of
    # transitions into each bar in the window (idx>0 only, matching TS)
    csum_vol = np.concatenate([[0.0], np.cumsum(volumes)])
    csum_signed = np.concatenate([[0.0], np.cumsum(signed_vol)])
    start = np.maximum(0, np.arange(n) - 9)
    total_win = csum_vol[np.arange(n) + 1] - csum_vol[start]
    signed_win = csum_signed[np.arange(n) + 1] - csum_signed[start]
    new_vals = (signed_win / np.maximum(1.0, total_win)) * 100.0
    return old_vals, new_vals


def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    print(f"features.csv: {len(df)} rows")
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0
    ).astype(int)

    null_indicator_cols = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(EXCLUDE_COLS) | set(null_indicator_cols) | set(ZERO_FILL_COLS)
                 | set(PRE_RETURN_COLS) | set(object_cols))
    feature_cols = [c for c in df.columns if c not in drop_cols]
    assert 'obv_delta_10d' in feature_cols, "obv_delta_10d not in model feature set?!"

    # ---- recompute both formulas per (symbol, date) from daily_prices ----
    conn = sqlite3.connect(DB_PATH)
    needed = df[['symbol', 'date']].drop_duplicates()
    print(f"Recomputing OBV for {needed['symbol'].nunique()} symbols, {len(needed)} (symbol,date) pairs")

    old_map, new_map = {}, {}
    missing_bar = 0
    for sym, grp in needed.groupby('symbol'):
        bars = pd.read_sql_query(
            "SELECT date, close, volume FROM daily_prices WHERE symbol=? ORDER BY date ASC",
            conn, params=(sym,))
        if bars.empty:
            missing_bar += len(grp)
            continue
        closes = bars['close'].to_numpy(dtype=float)
        vols = bars['volume'].to_numpy(dtype=float)
        old_vals, new_vals = compute_obv_both_formulas(closes, vols)
        date_to_idx = {d: i for i, d in enumerate(bars['date'])}
        for d in grp['date']:
            key = str(d)[:10]
            i = date_to_idx.get(key)
            if i is None:
                missing_bar += 1
                continue
            old_map[(sym, d)] = old_vals[i]
            new_map[(sym, d)] = new_vals[i]
    conn.close()

    keys = list(zip(df['symbol'], df['date']))
    df['obv_old_recomputed'] = [old_map.get(k, np.nan) for k in keys]
    df['obv_new'] = [new_map.get(k, np.nan) for k in keys]
    have = df['obv_old_recomputed'].notna() & df['obv_new'].notna() & df['obv_delta_10d'].notna()
    print(f"coverage: {have.sum()}/{len(df)} rows with stored + both recomputes "
          f"({missing_bar} pairs lacked a daily_prices bar)")

    # ---- 1. provenance: stored vs OLD recompute ----
    sub = df[have]
    stored = sub['obv_delta_10d'].to_numpy()
    old_r = sub['obv_old_recomputed'].to_numpy()
    new_r = sub['obv_new'].to_numpy()
    abs_err = np.abs(stored - old_r)
    rel_err = abs_err / np.maximum(1.0, np.abs(stored))
    prov = {
        'n': int(have.sum()),
        'exact_1e-6': float(np.mean(abs_err < 1e-6)),
        'close_1e-3_rel': float(np.mean(rel_err < 1e-3)),
        'close_1pct_rel': float(np.mean(rel_err < 0.01)),
        'spearman_stored_vs_old_recompute': float(spearmanr(stored, old_r)[0]),
        'median_abs_err': float(np.median(abs_err)),
    }
    print(f"\n[provenance] stored vs OLD-recompute: {json.dumps(prov, indent=2)}")

    # ---- 2. value-level skew: OLD vs NEW ----
    pct = lambda a: {p: float(np.percentile(a, p)) for p in (1, 5, 25, 50, 75, 95, 99)}
    value_skew = {
        'stored_old_percentiles': pct(stored),
        'new_percentiles': pct(new_r),
        'spearman_old_vs_new': float(spearmanr(stored, new_r)[0]),
        'pearson_old_vs_new': float(np.corrcoef(stored, new_r)[0, 1]),
        'sign_agreement': float(np.mean(np.sign(stored) == np.sign(new_r))),
        'old_abs_gt_100_pct': float(np.mean(np.abs(stored) > 100)),
        'new_abs_gt_100_pct': float(np.mean(np.abs(new_r) > 100)),
    }
    print(f"\n[value skew] OLD vs NEW: {json.dumps(value_skew, indent=2)}")

    # ---- 3. model-level: predictions with stored(OLD) vs NEW values ----
    def shift_stats(preds_a, preds_b, y=None):
        d = preds_b - preds_a
        out = {
            'spearman_preds': float(spearmanr(preds_a, preds_b)[0]),
            'frac_rows_changed': float(np.mean(np.abs(d) > 1e-9)),
            'mean_abs_delta': float(np.mean(np.abs(d))),
            'p95_abs_delta': float(np.percentile(np.abs(d), 95)),
            'max_abs_delta': float(np.max(np.abs(d))),
            'mean_abs_delta_changed_rows_only': float(np.mean(np.abs(d[np.abs(d) > 1e-9]))) if np.any(np.abs(d) > 1e-9) else 0.0,
            'pred_iqr_stored': float(np.percentile(preds_a, 75) - np.percentile(preds_a, 25)),
        }
        if y is not None:
            out['ic_stored_inputs'] = float(spearmanr(preds_a, y)[0])
            out['ic_new_inputs'] = float(spearmanr(preds_b, y)[0])
        return out

    # HORIZON_TIER_CONFIG thresholds (src/PotService.ts) -- calibrated on the
    # 2026-07-08 historical_inference_results fold. Tier flips are the POTS-
    # decision-relevant impact measure.
    def tier_d3(v):
        return 'STRONG_BUY' if v >= 0.0187 else ('SELL' if v <= 0.0096 else 'HOLD')

    def tier_d5(v):
        if v >= 0.1575: return 'STRONG_BUY'
        if v >= 0.1489: return 'BUY'
        if v <= 0.1341: return 'SELL'
        return 'HOLD'

    def tier_d1(v):
        return 'STRONG_BUY' if v >= 0.0682 else 'HOLD'

    def tier_d2(v):
        return 'BUY' if v > 0.2206 else 'HOLD'

    TIER_FNS = {'D3': tier_d3, 'D5': tier_d5, 'D1': tier_d1, 'D2': tier_d2}

    model_impact = {}
    gain_importance = {}
    for name, (label_col, mfile) in REGRESSION_HEADS.items():
        head_sub = df.dropna(subset=[label_col])
        hs = head_sub[head_sub.index.isin(sub.index)]  # rows with recompute coverage
        X = hs[feature_cols]
        y = hs[label_col]
        _, _, X_test, _, _, y_test = split_train_val_test_temporal(hs['date'], X, y)
        model = xgb.XGBRegressor()
        model.load_model(ML_DIR / mfile)
        # NaN preserved: matches training-side missing handling; both variants
        # go through the identical path so deltas isolate obv_delta_10d alone
        preds_stored = model.predict(X_test)
        X_new = X_test.copy()
        X_new['obv_delta_10d'] = hs.loc[X_test.index, 'obv_new'].values
        preds_new = model.predict(X_new)
        model_impact[name] = dict(test_rows=len(X_test), **shift_stats(preds_stored, preds_new, y_test.to_numpy()))
        if name in TIER_FNS:
            tf = TIER_FNS[name]
            t_a = np.array([tf(v) for v in preds_stored])
            t_b = np.array([tf(v) for v in preds_new])
            flips = t_a != t_b
            model_impact[name]['tier_flips'] = int(flips.sum())
            model_impact[name]['tier_flip_pct'] = float(flips.mean())
            if flips.any():
                pairs, counts = np.unique(
                    np.array([f"{a}->{b}" for a, b in zip(t_a[flips], t_b[flips])]), return_counts=True)
                model_impact[name]['tier_flip_breakdown'] = {p: int(c) for p, c in zip(pairs, counts)}
        booster = model.get_booster()
        gains = booster.get_score(importance_type='gain')
        ranked = sorted(gains.items(), key=lambda kv: -kv[1])
        rank = next((i + 1 for i, (f, _) in enumerate(ranked) if f == 'obv_delta_10d'), None)
        gain_importance[name] = {'gain': gains.get('obv_delta_10d'), 'rank': rank, 'n_features_used': len(ranked)}
        print(f"[{name}] {json.dumps(model_impact[name])} gain_rank={rank}/{len(ranked)}")

    # C/E: prediction-shift only, on the B-head test rows (labels not needed)
    b_sub = df.dropna(subset=['forward_return_1m'])
    bs = b_sub[b_sub.index.isin(sub.index)]
    Xb = bs[feature_cols]
    yb = bs['forward_return_1m']
    _, _, Xb_test, _, _, _ = split_train_val_test_temporal(bs['date'], Xb, yb)
    Xb_new = Xb_test.copy()
    Xb_new['obv_delta_10d'] = bs.loc[Xb_test.index, 'obv_new'].values
    for name, mfile in OTHER_HEADS.items():
        if name == 'E':
            model = xgb.XGBClassifier()
            model.load_model(ML_DIR / mfile)
            pa = model.predict_proba(Xb_test)[:, 1]
            pb = model.predict_proba(Xb_new)[:, 1]
        else:
            model = xgb.XGBRegressor()
            model.load_model(ML_DIR / mfile)
            pa = model.predict(Xb_test)
            pb = model.predict(Xb_new)
        model_impact[name] = dict(test_rows=len(Xb_test), **shift_stats(pa, pb))
        booster = model.get_booster()
        gains = booster.get_score(importance_type='gain')
        ranked = sorted(gains.items(), key=lambda kv: -kv[1])
        rank = next((i + 1 for i, (f, _) in enumerate(ranked) if f == 'obv_delta_10d'), None)
        gain_importance[name] = {'gain': gains.get('obv_delta_10d'), 'rank': rank, 'n_features_used': len(ranked)}
        print(f"[{name}] {json.dumps(model_impact[name])} gain_rank={rank}/{len(ranked)}")

    out = {
        'provenance': prov,
        'value_skew': value_skew,
        'model_impact': model_impact,
        'gain_importance': gain_importance,
    }
    (ML_DIR / 'scratch').mkdir(exist_ok=True)
    # persist per-row recomputes for reuse by later deep-dive sessions
    sub[['symbol', 'date', 'obv_delta_10d', 'obv_old_recomputed', 'obv_new']].to_csv(
        ML_DIR / 'scratch' / 'obv_recompute_values.csv', index=False)
    with open(ML_DIR / 'scratch' / 'scratch_obv_staleness_results.json', 'w') as f:
        json.dump(out, f, indent=2)
    print("\nWrote scratch/scratch_obv_staleness_results.json")


if __name__ == '__main__':
    main()
