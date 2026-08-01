#!/usr/bin/env python3
"""v11 retrain — three arms, designed so each answers one question on its own.

  ARM 1  v11-clean    : the re-extracted daily events (303k rows, 1962-2026), PRICE-ONLY
                        features, corrected forward_return_1m / MFE / MAE.
                        Q: does a real edge exist on honest data and a correct time scale?
  ARM 2  v94-control  : features.csv exactly as v9.4 trained it.
                        Q: does this harness reproduce the known v9.4 day-clustered
                        anchors? If arm 2 misses, arms 1 and 3 mean nothing.
  ARM 3  v94-nostamp  : arm 2 minus stocktwits_virality_z and price_target_consensus.
                        Q: how much of v9.4's measured IC was those two leaky features?

WHY PRICE-ONLY FOR ARM 1. The re-extraction found ~250k pre-2021 events that never had
premium data and never can (FMP premium expired 2026-07-06 and never covered 2005 anyway).
Training on the union with premium columns would make missingness a near-perfect proxy for
the date — the exact failure class this whole effort exists to remove. So arm 1 uses only
features present for every row in every era. It is a narrower model on far more data.

WHY IC AND NOT RMSE. RMSE across eras is not comparable when label variance differs by era.
Rank IC within a day is, and it is what the strategy actually consumes. IC is DAY-CLUSTERED:
Spearman within each run_date, then averaged across dates, t = mean / (sd/sqrt(days)).
Pooled IC overstates significance by ignoring within-day correlation.

Writes only to src/ml/scratch/. Touches no deployed model.

Usage:
  python src/ml/scratch_v11_retrain.py --smoke     # fast subsample, proves it runs
  python src/ml/scratch_v11_retrain.py             # full run
"""
import argparse
import json
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr
from sklearn.metrics import mean_absolute_error, mean_squared_error

ML_DIR = Path(__file__).parent
ROOT = ML_DIR.parent.parent
OUT_DIR = ML_DIR / 'scratch'
OUT_DIR.mkdir(exist_ok=True)
RANDOM_STATE = 42

# v9.4 day-clustered test-fold anchors (outcomeScoreboard.ts TEST_IC_DAILY)
TEST_IC_DAILY = {
    '2D': (0.0826, 0.2968, 330), '2W': (0.1111, 0.3376, 331),
    '1M': (-0.0278, 0.2799, 313), '3M': (0.0709, 0.3177, 275),
    '6M': (0.0977, 0.2953, 210),
}
HEADS = {  # name -> (label column, horizon key)
    'B': ('forward_return_1m', '1M'), 'D1': ('forward_return_3m', '3M'),
    'D2': ('forward_return_6m', '6M'), 'D3': ('forward_return_2d', '2D'),
    'D5': ('forward_return_2w', '2W'),
}
STAMPED = ['stocktwits_virality_z', 'price_target_consensus']

REG_PARAMS = dict(objective='reg:squarederror', max_depth=8, eta=0.05,
                  subsample=1.0, colsample_bytree=1.0, eval_metric='rmse',
                  seed=RANDOM_STATE)
ASYM_ALPHA, ASYM_BETA = 2.5, 1.0

EXCLUDE_COLS = [
    'cache_key', 'symbol', 'date', 'is_null_sample', 'label',
    'forward_return_1d', 'forward_return_1w', 'forward_return_1m',
    'forward_return_2d', 'forward_return_3d', 'forward_return_2w',
    'forward_return_3m', 'forward_return_6m', 'forward_return_12m',
    'max_favorable_excursion_1m', 'max_adverse_excursion_1m',
    'outperform_12m', 'is_event', 'sector_excess_return', 'options_put_call_ratio',
]
ZERO_FILL_COLS = ['digital_exhaust_velocity_14d', 'gdelt_tone_z', 'dark_pool_index',
                  'institutional_ownership_pct', 'put_call_ratio_t_minus_1',
                  'short_interest_pct_float']
PRE_RETURN_COLS = ['pre_return_1d', 'pre_return_3d', 'pre_return_5d', 'pre_return_10d',
                   'pre_return_21d', 'pre_vol_ratio_5d', 'pre_vol_ratio_10d']


def asymmetric_mse(alpha, beta):
    def obj(y_pred, dtrain):
        err = y_pred - dtrain.get_label()
        grad = np.where(err > 0, alpha * err, beta * err)
        hess = np.where(err > 0, np.full_like(err, alpha), np.full_like(err, beta))
        return grad, hess
    return obj


def compute_sample_weights(df):
    vix_col = next((c for c in df.columns if 'vix' in c.lower()), None)
    vix = df[vix_col].fillna(20.0) if vix_col else pd.Series(20.0, index=df.index)
    vw = 1.0 / vix.clip(lower=5.0); vw = vw / vw.mean()
    liq = df.get('volume_ratio', pd.Series(1.0, index=df.index)).fillna(1.0)
    lw = liq.clip(0.1, 10.0); lw = lw / lw.mean()
    w = vw * lw
    return (w / w.mean()).values


def daily_ic(dates, y_true, y_pred, min_per_day=8):
    """Spearman within each date, then across dates. Returns (ic, sd, ndays, t)."""
    df = pd.DataFrame({'d': pd.to_datetime(dates).values, 'y': y_true, 'p': y_pred})
    ics = []
    for _, g in df.groupby('d'):
        if len(g) < min_per_day:
            continue
        if g['y'].nunique() < 2 or g['p'].nunique() < 2:
            continue
        rho = spearmanr(g['y'], g['p']).statistic
        if np.isfinite(rho):
            ics.append(rho)
    if len(ics) < 2:
        return float('nan'), float('nan'), len(ics), float('nan')
    ic = float(np.mean(ics)); sd = float(np.std(ics, ddof=1)); n = len(ics)
    t = ic / (sd / np.sqrt(n)) if sd > 0 else float('nan')
    return ic, sd, n, t


def temporal_split(dates, embargo_days=21):
    n = len(dates)
    sd = dates.sort_values()
    cut_tr, cut_va = sd.iloc[int(n * 0.70)], sd.iloc[int(n * 0.85)]
    emb = pd.Timedelta(days=embargo_days)
    return (dates < (cut_tr - emb),
            (dates >= cut_tr) & (dates < (cut_va - emb)),
            dates >= cut_va)


def run_head(arm, name, df, feature_cols, label_col, horizon, rounds, results):
    sub = df.dropna(subset=[label_col]).copy()
    if len(sub) < 500:
        print(f'  [{arm}/{name}] SKIP — only {len(sub)} labelled rows'); return
    dates = pd.to_datetime(sub['date'])
    m_tr, m_va, m_te = temporal_split(dates)
    if m_tr.sum() < 200 or m_te.sum() < 100:
        print(f'  [{arm}/{name}] SKIP — split too small'); return
    X = sub[feature_cols]
    y = sub[label_col]
    dtr = xgb.DMatrix(X[m_tr], label=y[m_tr], weight=compute_sample_weights(sub[m_tr]),
                      feature_names=feature_cols)
    dva = xgb.DMatrix(X[m_va], label=y[m_va], feature_names=feature_cols)
    dte = xgb.DMatrix(X[m_te], label=y[m_te], feature_names=feature_cols)
    bst = xgb.train(REG_PARAMS, dtr, num_boost_round=rounds,
                    obj=asymmetric_mse(ASYM_ALPHA, ASYM_BETA),
                    evals=[(dva, 'val')], early_stopping_rounds=50, verbose_eval=False)
    pred = bst.predict(dte, iteration_range=(0, bst.best_iteration + 1))
    ic, sd, ndays, t = daily_ic(dates[m_te], y[m_te].values, pred)
    a_ic, a_sd, a_n = TEST_IC_DAILY[horizon]
    # two-sample z carrying both standard errors
    se = np.sqrt((sd**2 / max(ndays, 1)) + (a_sd**2 / max(a_n, 1))) if np.isfinite(sd) else float('nan')
    z_vs_anchor = (ic - a_ic) / se if se and np.isfinite(se) and se > 0 else float('nan')
    fname = f'model_{name.lower()}_{arm}.json'
    bst.save_model(str(OUT_DIR / fname))
    results.append(dict(arm=arm, head=name, horizon=horizon, label=label_col,
                        train=int(m_tr.sum()), test=int(m_te.sum()),
                        best_iter=int(bst.best_iteration),
                        rmse=float(np.sqrt(mean_squared_error(y[m_te], pred))),
                        mae=float(mean_absolute_error(y[m_te], pred)),
                        ic=ic, ic_sd=sd, ic_days=ndays, ic_t=t,
                        anchor_ic=a_ic, z_vs_anchor=z_vs_anchor))
    print(f'  [{arm}/{name}] {horizon} train={int(m_tr.sum()):>7} test={int(m_te.sum()):>6} '
          f'IC={ic:+.4f} t={t:+.2f} ({ndays}d) vs anchor {a_ic:+.4f} z={z_vs_anchor:+.2f}')


def load_v11(smoke):
    con = sqlite3.connect(f'file:{ROOT / "market_cache.db"}?mode=ro', uri=True)
    # legacy_only rows carry NULL price features by design (they stay reachable through
    # legacy_cache_key), so they cannot feed a price-only model -- re-derived rows only.
    q = """SELECT symbol, date, excess_return, z_score, daily_return, atr_shock_score,
                  volume_ratio, relative_volume_30d, relative_volume_90d,
                  body_to_range_ratio, overnight_gap_pct, gap_fill_ratio, obv_delta_10d,
                  dist_sma_50, dist_sma_200, rsi_14, is_null_sample,
                  forward_return_1m, forward_return_2d, forward_return_2w,
                  forward_return_3m, forward_return_6m
           FROM training_events_v11 WHERE price_source='daily_reextract'"""
    df = pd.read_sql_query(q, con)
    con.close()
    n0 = len(df)
    # v9.4 outlier hygiene, same thresholds
    excl = (df['overnight_gap_pct'].abs() >= 1.0) | (df['excess_return'].abs() > 10)
    df = df[~excl].reset_index(drop=True)
    print(f'ARM 1 v11: {n0:,} re-derived rows, excluded {int(excl.sum()):,} outliers -> {len(df):,}')
    if smoke:
        df = df.sample(n=min(20000, len(df)), random_state=RANDOM_STATE).reset_index(drop=True)
        print(f'  smoke: subsampled to {len(df):,}')
    feats = ['excess_return', 'z_score', 'daily_return', 'atr_shock_score', 'volume_ratio',
             'relative_volume_30d', 'relative_volume_90d', 'body_to_range_ratio',
             'overnight_gap_pct', 'gap_fill_ratio', 'obv_delta_10d', 'dist_sma_50',
             'dist_sma_200', 'rsi_14']
    return df, feats


def load_v94(smoke):
    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    n0 = len(df)
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0).astype(int)
    excl = (df['overnight_gap_pct'].abs() >= 1.0) | (df['excess_return'].abs() > 10)
    df = df[~excl].reset_index(drop=True)
    print(f'ARM 2/3 v9.4: {n0:,} rows, excluded {int(excl.sum())} outliers -> {len(df):,}')
    if smoke:
        df = df.sample(n=min(20000, len(df)), random_state=RANDOM_STATE).reset_index(drop=True)
        print(f'  smoke: subsampled to {len(df):,}')
    null_ind = [c for c in df.columns if c.endswith('_is_null')]
    obj = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop = set(EXCLUDE_COLS) | set(null_ind) | set(ZERO_FILL_COLS) | set(PRE_RETURN_COLS) | set(obj)
    feats = [c for c in df.columns if c not in drop]
    return df, feats


def load_v11_premium(smoke):
    """ARM 4 — the fair, like-for-like test.

    Arm 1 was deliberately price-only (14 features) to avoid making missingness a date
    proxy, so its loss against v9.4 (72 features) says nothing about whether the
    re-extraction helps. This arm removes that confound: it INNER JOINS the re-derived
    events onto features.csv, so it sees the SAME events and the SAME premium features
    v9.4 saw, and the only thing that changes is the correction — right time scale, right
    forward_return_1m, right MFE/MAE.

    Directly comparable to arm 2 (v9.4 on the same rows). Arm4 - arm2 IS the value of the
    fix. The two stamped leakage features are dropped, having been measured as
    contributing nothing.
    """
    con = sqlite3.connect(f'file:{ROOT / "market_cache.db"}?mode=ro', uri=True)
    v11 = pd.read_sql_query(
        """SELECT symbol, date, excess_return, z_score, daily_return, atr_shock_score,
                  volume_ratio, relative_volume_30d, body_to_range_ratio,
                  overnight_gap_pct, gap_fill_ratio, obv_delta_10d, dist_sma_50,
                  dist_sma_200, rsi_14,
                  forward_return_1m, forward_return_2d, forward_return_2w,
                  forward_return_3m, forward_return_6m
           FROM training_events_v11 WHERE price_source='daily_reextract'""", con)
    con.close()
    v11['date'] = v11['date'].astype(str).str[:10]

    leg = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    leg['date'] = leg['date'].astype(str).str[:10]
    leg['is_us_listed'] = leg['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0).astype(int)

    # premium/context columns = everything v9.4 fed the model that is NOT a price feature
    # we recompute and NOT a label. Those come from v11 instead.
    corrected = set(v11.columns) - {'symbol', 'date'}
    null_ind = [c for c in leg.columns if c.endswith('_is_null')]
    obj = [c for c in leg.columns if not pd.api.types.is_numeric_dtype(leg[c])]
    drop = (set(EXCLUDE_COLS) | set(null_ind) | set(ZERO_FILL_COLS)
            | set(PRE_RETURN_COLS) | set(obj) | corrected | set(STAMPED))
    premium_cols = [c for c in leg.columns if c not in drop]

    df = v11.merge(leg[['symbol', 'date'] + premium_cols], on=['symbol', 'date'], how='inner')
    n0 = len(df)
    excl = (df['overnight_gap_pct'].abs() >= 1.0) | (df['excess_return'].abs() > 10)
    df = df[~excl].reset_index(drop=True)
    print(f'ARM 4 v11+premium: inner join -> {n0:,} rows '
          f'(excluded {int(excl.sum())} outliers -> {len(df):,})')
    if smoke:
        df = df.sample(n=min(20000, len(df)), random_state=RANDOM_STATE).reset_index(drop=True)
    feats = [c for c in corrected if not c.startswith('forward_return_')] + premium_cols
    feats = [c for c in feats if c in df.columns]

    # ARM 5 — the control arm 4 actually needs. Comparing arm 4 against arm 2 is
    # CONFOUNDED: the inner join halves the data (21.8k train vs 46.5k), and less data
    # depresses IC on its own, so any gap conflates the correction with sample size.
    # This restricts v9.4's ORIGINAL features and labels to exactly the same rows and
    # the same feature set, leaving the correction as the only difference.
    keys = df[['symbol', 'date']].drop_duplicates()
    sub = leg.merge(keys, on=['symbol', 'date'], how='inner').reset_index(drop=True)
    sub_feats = [c for c in leg.columns if c not in drop] + \
                [c for c in corrected if not c.startswith('forward_return_') and c in leg.columns]
    sub_feats = sorted(set(c for c in sub_feats if c in sub.columns))
    print(f'ARM 5 v94-samerows: same {len(sub):,} rows, ORIGINAL features/labels, '
          f'{len(sub_feats)} features')
    return df, feats, sub, sub_feats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--smoke', action='store_true')
    ap.add_argument('--arm4-only', action='store_true',
                    help='run only the like-for-like arm plus the v9.4 control')
    args = ap.parse_args()
    rounds = 40 if args.smoke else 1000
    results = []

    if not args.arm4_only:
        print('=' * 78)
        df1, f1 = load_v11(args.smoke)
        print(f'  {len(f1)} price-only features, present in every era')
        for name, (label, hz) in HEADS.items():
            run_head('v11-clean', name, df1, f1, label, hz, rounds, results)

    print('=' * 78)
    df2, f2 = load_v94(args.smoke)
    print(f'  {len(f2)} features (v9.4 set)')
    for name, (label, hz) in HEADS.items():
        run_head('v94-control', name, df2, f2, label, hz, rounds, results)

    if not args.arm4_only:
        print('=' * 78)
        present = [c for c in STAMPED if c in f2]
        f3 = [c for c in f2 if c not in STAMPED]
        print(f'ARM 3 v94-nostamp: dropping {present} -> {len(f3)} features')
        for name, (label, hz) in HEADS.items():
            run_head('v94-nostamp', name, df2, f3, label, hz, rounds, results)

    print('=' * 78)
    df4, f4, df5, f5 = load_v11_premium(args.smoke)
    print(f'  {len(f4)} features (corrected price/labels + v9.4 premium, stamped dropped)')
    for name, (label, hz) in HEADS.items():
        run_head('v11-premium', name, df4, f4, label, hz, rounds, results)
    print('-' * 78)
    for name, (label, hz) in HEADS.items():
        run_head('v94-samerows', name, df5, f5, label, hz, rounds, results)

    res = pd.DataFrame(results)
    out = OUT_DIR / ('v11_retrain_smoke.csv' if args.smoke else 'v11_retrain_results.csv')
    res.to_csv(out, index=False)

    print('\n' + '=' * 78)
    print('DAY-CLUSTERED TEST IC BY ARM  (t>2 ~ significant; z vs the v9.4 anchor)')
    ARMS = ['v11-clean', 'v94-control', 'v94-nostamp', 'v11-premium']
    print(f"{'head':<5}{'horizon':<9}" + ''.join(f'{a:>22}' for a in ARMS))
    print('-' * 100)
    for name, (_, hz) in HEADS.items():
        row = f'{name:<5}{hz:<9}'
        for arm in ARMS:
            # res['head'] not res.head — the latter resolves to DataFrame.head, the method
            r = res[(res['head'] == name) & (res['arm'] == arm)]
            row += f'{"  --":>22}' if r.empty else f'{r.iloc[0].ic:>+11.4f} (t{r.iloc[0].ic_t:>+5.1f})'
        print(row)
    print(f'\nwrote {out}')

    ctrl = res[res['arm'] == 'v94-control']
    if not ctrl.empty:
        dev = (ctrl['ic'] - ctrl['anchor_ic']).abs().max()
        print(f'\nCONTROL CHECK: max |arm2 IC - v9.4 anchor| = {dev:.4f}')
        print('  ' + ('PASS — harness reproduces the known anchors.' if dev < 0.05 else
                      'DRIFT — arm 2 does not reproduce v9.4; treat other arms with caution.'))

    # THE headline comparison: arm 4 vs arm 2 on the same events and same feature set,
    # so the difference is attributable to the re-extraction fix and nothing else.
    a4 = res[res['arm'] == 'v11-premium'].set_index('head')
    a5 = res[res['arm'] == 'v94-samerows'].set_index('head')
    if not a4.empty and not a5.empty:
        print('\nTRUE LIKE-FOR-LIKE: v11-premium minus v94-samerows')
        print('(identical rows, identical feature set — the correction is the only variable)')
        print(f"{'head':<6}{'v9.4 IC':>10}{'v11 IC':>10}{'delta':>10}{'v11 t':>9}{'v94 t':>8}   verdict")
        print('-' * 70)
        for h in HEADS:
            if h not in a4.index or h not in a5.index:
                continue
            d = a4.loc[h, 'ic'] - a5.loc[h, 'ic']
            v = 'better' if d > 0.005 else ('worse' if d < -0.005 else 'no change')
            print(f'{h:<6}{a5.loc[h, "ic"]:>+10.4f}{a4.loc[h, "ic"]:>+10.4f}{d:>+10.4f}'
                  f'{a4.loc[h, "ic_t"]:>+9.2f}{a5.loc[h, "ic_t"]:>+8.2f}   {v}')


if __name__ == '__main__':
    sys.exit(main())
