#!/usr/bin/env python3
"""
scratch_testfold_ic_by_date.py — recompute the held-out TEST-IC anchors as
MEAN DAILY (cross-sectional) IC, not pooled IC.

WHY THIS EXISTS. `TEST_IC` in outcomeScoreboard.ts (2D 0.1160 · 2W 0.2258 ·
1M 0.0599 · 3M 0.2100 · 6M 0.1062) came from scratch_v10_drop_ablation.py's
FULL arm, which computes ONE Spearman correlation pooled over every row of the
test fold regardless of date. The live scoreboard/harness compare realized live
IC against those numbers -- and compute the live side the same pooled way.

That comparison is over-confident, and on 2026-07-31 it was already misleading:
post-v9.4 2D pooled IC read 0.174 vs the 0.116 anchor (an apparent pass), but
per run_date it was -0.108/-0.180/+0.078/-0.147/+0.378/+0.227 -- mean daily IC
+0.041, day-clustered SE 0.092, t=0.45, 3 of 6 days positive. The pooled figure
was carried by the two largest recent days. Pooling across dates also lets a
common daily move (market beta) masquerade as cross-sectional ranking skill,
which is the thing the model is actually supposed to have.

So this recomputes the anchor the way the live side should measure: IC computed
WITHIN each date, then averaged across dates, with the standard IC t-stat
(mean / (sd/sqrt(n_days))). Comparing mean-daily-live to mean-daily-anchor is
like-for-like; comparing mean-daily-live to a POOLED anchor would just swap one
apples-to-oranges error for another.

METHOD. Reuses scratch_v10_drop_ablation.py's training pieces BY IMPORT (row
exclusion, temporal 70/85 split + 21d embargo, sample weights, asymmetric-MSE,
early stopping, served-path iteration_range predict) rather than re-deriving
them, so the two scripts cannot drift. The pooled IC is recomputed alongside as
a CONTROL: it must reproduce the existing anchors, which is what proves the
per-day number is measuring the same models on the same fold.

Usage:
  python src/ml/scratch_testfold_ic_by_date.py
  python src/ml/scratch_testfold_ic_by_date.py --min-per-day 8
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

sys.path.insert(0, str(Path(__file__).parent))
from scratch_v10_drop_ablation import (  # noqa: E402
    ML_DIR, OUT_DIR, EXCLUDE_COLS, ZERO_FILL_COLS, PRE_RETURN_COLS, HEADS,
    REG_PARAMS, ASYMMETRIC_ALPHA, ASYMMETRIC_BETA,
    compute_sample_weights, asymmetric_mse, split_masks,
)

# Live horizon label per training head, so the emitted anchors key straight into
# outcomeScoreboard.ts's TEST_IC / HORIZON_ORDER.
HEAD_TO_HORIZON = {'D3': '2D', 'D5': '2W', 'B': '1M', 'D1': '3M', 'D2': '6M'}

# Existing pooled anchors, for the reproduction control.
POOLED_ANCHOR = {'2D': 0.1160, '2W': 0.2258, '1M': 0.0599, '3M': 0.2100, '6M': 0.1062}


def train_and_predict_test(sub, feature_cols, label_col):
    """Identical to the ablation's train_and_eval, but returns the per-row test
    predictions + dates instead of only the pooled scalars."""
    tr, va, te = split_masks(sub)
    X = sub[feature_cols]
    y = sub[label_col].values
    sw = compute_sample_weights(sub[tr])
    dtrain = xgb.DMatrix(X[tr], label=y[tr], weight=sw, feature_names=feature_cols)
    dval = xgb.DMatrix(X[va], label=y[va], feature_names=feature_cols)
    dtest = xgb.DMatrix(X[te], label=y[te], feature_names=feature_cols)
    booster = xgb.train(REG_PARAMS, dtrain, num_boost_round=1000,
                        obj=asymmetric_mse(ASYMMETRIC_ALPHA, ASYMMETRIC_BETA),
                        evals=[(dval, 'val')], early_stopping_rounds=50, verbose_eval=False)
    bi = booster.best_iteration
    preds = booster.predict(dtest, iteration_range=(0, bi + 1))
    return pd.DataFrame({
        'date': pd.to_datetime(sub.loc[te, 'date']).dt.strftime('%Y-%m-%d').values,
        'pred': preds,
        'actual': y[te],
    }), int(bi)


def daily_ic_stats(frame, min_per_day):
    """Cross-sectional IC within each date, then the across-date summary.

    A date with fewer than `min_per_day` names has no meaningful cross-section
    to rank, so it is excluded rather than contributing a near-random IC that
    would inflate the spread.
    """
    per_day = []
    for date, g in frame.groupby('date', sort=True):
        if len(g) < min_per_day:
            continue
        ic = g['pred'].corr(g['actual'], method='spearman')
        if pd.notna(ic):
            per_day.append({'date': date, 'n': int(len(g)), 'ic': float(ic)})
    if len(per_day) < 2:
        return {'n_days': len(per_day), 'per_day': per_day}
    ics = np.array([d['ic'] for d in per_day])
    ns = np.array([d['n'] for d in per_day])
    m = float(ics.mean())
    sd = float(ics.std(ddof=1))
    se = sd / np.sqrt(len(ics))
    return {
        'n_days': len(per_day),
        'mean_daily_ic': m,
        'sd_daily_ic': sd,
        'se_daily_ic': float(se),
        't_stat': float(m / se) if se > 0 else float('nan'),
        'ic_ir': float(m / sd) if sd > 0 else float('nan'),
        'pct_days_positive': float((ics > 0).mean()),
        'median_names_per_day': float(np.median(ns)),
        'total_rows_used': int(ns.sum()),
        'per_day': per_day,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--min-per-day', type=int, default=8,
                    help='minimum names on a date for it to contribute an IC (default 8)')
    args = ap.parse_args()

    df = pd.read_csv(ML_DIR / 'features.csv')
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0
    ).astype(int)
    excl = (df['overnight_gap_pct'].abs() >= 1.0) | (df['excess_return'].abs() > 10)
    df = df[~excl].reset_index(drop=True)
    print(f'After row exclusion: {len(df)} rows')

    null_indicator_cols = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(EXCLUDE_COLS) | set(null_indicator_cols) | set(ZERO_FILL_COLS)
                 | set(PRE_RETURN_COLS) | set(object_cols))
    full_cols = [c for c in df.columns if c not in drop_cols]
    print(f'FULL={len(full_cols)} cols   min names/day={args.min_per_day}')

    out = {}
    print(f"\n{'head':<4} {'hz':<3} {'n_test':>7} {'days':>5} {'pooled':>8} {'anchor':>8} {'repro':>6} "
          f"{'meanIC':>8} {'sd':>7} {'SE':>7} {'t':>6} {'IR':>6} {'%pos':>6} {'med n/d':>8}")
    print('-' * 108)

    for head, (label_col, _fn) in HEADS.items():
        hz = HEAD_TO_HORIZON[head]
        sub = df.dropna(subset=[label_col]).reset_index(drop=True)
        frame, best_iter = train_and_predict_test(sub, full_cols, label_col)

        pooled = float(frame['pred'].corr(frame['actual'], method='spearman'))
        anchor = POOLED_ANCHOR[hz]
        repro = 'OK' if abs(pooled - anchor) < 0.005 else 'DRIFT'

        stats = daily_ic_stats(frame, args.min_per_day)
        stats.update({'head': head, 'horizon': hz, 'pooled_ic': pooled,
                      'pooled_anchor_prev': anchor, 'reproduces_pooled': repro == 'OK',
                      'best_iter': best_iter, 'n_test': int(len(frame)),
                      'test_date_range': [frame['date'].min(), frame['date'].max()]})
        out[hz] = stats

        print(f"{head:<4} {hz:<3} {len(frame):>7} {stats.get('n_days', 0):>5} {pooled:>8.4f} "
              f"{anchor:>8.4f} {repro:>6} {stats.get('mean_daily_ic', float('nan')):>8.4f} "
              f"{stats.get('sd_daily_ic', float('nan')):>7.4f} {stats.get('se_daily_ic', float('nan')):>7.4f} "
              f"{stats.get('t_stat', float('nan')):>6.2f} {stats.get('ic_ir', float('nan')):>6.2f} "
              f"{stats.get('pct_days_positive', float('nan')) * 100:>5.0f}% "
              f"{stats.get('median_names_per_day', float('nan')):>8.0f}")

    path = OUT_DIR / 'testfold_ic_by_date.json'
    path.write_text(json.dumps(out, indent=2))
    print(f'\nWrote {path}')
    print('\nTEST_IC_DAILY for outcomeScoreboard.ts:')
    for hz in ['2D', '2W', '1M', '3M', '6M']:
        s = out[hz]
        print(f"  '{hz}': {{ ic: {s.get('mean_daily_ic', float('nan')):.4f}, "
              f"sd: {s.get('sd_daily_ic', float('nan')):.4f}, "
              f"days: {s.get('n_days', 0)} }},  // {s['head']}  pooled was {s['pooled_ic']:.4f}")
    print('\nmean daily IC = cross-sectional Spearman within each test date, averaged across dates.')
    print('t = mean / (sd/sqrt(days)). IR = mean/sd. Compare LIVE mean-daily-IC against these, not pooled.')


if __name__ == '__main__':
    main()
