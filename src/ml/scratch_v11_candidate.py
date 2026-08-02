#!/usr/bin/env python3
"""v11 CANDIDATE — production protocol, data-only changes.

Yesterday's 220+ models ran at a fixed 400 boosting rounds so the arms were comparable
TO EACH OTHER. That makes their absolute ICs (0.015-0.04) incomparable to the deployed
v9.4 anchors (0.083-0.111), which come from the production protocol. This script uses
the production protocol verbatim — REG_PARAMS, 70/15/15 temporal split with a 21-day
embargo, asymmetric-MSE objective, vix/liquidity sample weights, 1000 rounds with
early stopping at 50 — copied from scratch_retrain_v94cand.py, and changes ONLY the data.

ARMS
  v94-control    v9.4 exactly. MUST reproduce TEST_IC_DAILY at ~0.0000 or nothing else
                 in this file is readable. This control caught two real bugs yesterday.
  v11-cand       drop the 16,435 corrupt pre-2021 rows + the 2 stamped leakage features.
                 This is the scope the subtraction test settled on (all 5 heads improved,
                 4/4 windows).
  v11-cand-ne    additionally drop the ~5,000 non-events mislabelled is_null_sample=0
                 (|z| below the engine's own 1.80 floor). Best D1 yesterday, cost D3 —
                 included so the choice is made on evidence rather than taste.

THE TEST FOLD IS HELD FIXED ACROSS ARMS. The production split takes date percentiles of
whatever rows survive filtering, so dropping 16,435 old rows would silently move the
70/85 cutoffs later and each arm would be scored on a different period — which would
also break comparability with the anchors. Instead the cutoffs and the test rows are
derived ONCE per head from the full v9.4 data, then reused by every arm. Only the
TRAINING set differs. (The cutoffs land in 2021+, so the test rows are post-2021 anyway
and are unaffected by the pre-2021 drop.)

Writes CANDIDATE files under src/ml/scratch/ only. Deploys nothing.

Usage:
  python src/ml/scratch_v11_candidate.py
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr
from sklearn.metrics import mean_absolute_error, mean_squared_error

ML_DIR = Path(__file__).parent
OUT_DIR = ML_DIR / 'scratch'
OUT_DIR.mkdir(exist_ok=True)
RANDOM_STATE = 42

# deployed v9.4 day-clustered anchors (outcomeScoreboard.ts TEST_IC_DAILY)
TEST_IC_DAILY = {
    '2D': (0.0826, 0.2968, 330), '2W': (0.1111, 0.3376, 331),
    '1M': (-0.0278, 0.2799, 313), '3M': (0.0709, 0.3177, 275),
    '6M': (0.0977, 0.2953, 210),
}
HEADS = {
    'B':  ('forward_return_1m', '1M', 'model_b_v11cand.json'),
    'D1': ('forward_return_3m', '3M', 'model_d1_v11cand.json'),
    'D2': ('forward_return_6m', '6M', 'model_d2_v11cand.json'),
    'D3': ('forward_return_2d', '2D', 'model_d3_v11cand.json'),
    'D5': ('forward_return_2w', '2W', 'model_d5_v11cand.json'),
}
STAMPED = ['stocktwits_virality_z', 'price_target_consensus']

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
REG_PARAMS = dict(objective='reg:squarederror', max_depth=8, eta=0.05, subsample=1.0,
                  colsample_bytree=1.0, eval_metric='rmse', seed=RANDOM_STATE)
ASYMMETRIC_ALPHA, ASYMMETRIC_BETA = 2.5, 1.0
EMBARGO_DAYS = 21
FOLD_MODE = False


def asymmetric_mse(alpha=ASYMMETRIC_ALPHA, beta=ASYMMETRIC_BETA):
    def objective(y_pred, dtrain):
        error = y_pred - dtrain.get_label()
        grad = np.where(error > 0, alpha * error, beta * error)
        hess = np.where(error > 0, np.full_like(error, alpha), np.full_like(error, beta))
        return grad, hess
    return objective


def compute_sample_weights(df):
    vix_col = next((c for c in df.columns if 'vix' in c.lower()), None)
    vix = df[vix_col].fillna(20.0) if vix_col else pd.Series(20.0, index=df.index)
    vw = 1.0 / vix.clip(lower=5.0); vw = vw / vw.mean()
    liq = df.get('volume_ratio', pd.Series(1.0, index=df.index)).fillna(1.0)
    lw = liq.clip(0.1, 10.0); lw = lw / lw.mean()
    w = vw * lw
    return (w / w.mean()).values


def daily_ic(dates, y_true, y_pred, min_per_day=8):
    """Spearman within each run_date, then across dates. Pooled IC overstates
    significance by ignoring within-day correlation, so the anchors are day-clustered
    and this must match them."""
    d = pd.DataFrame({'d': pd.to_datetime(dates).values, 'y': y_true, 'p': y_pred})
    ics = []
    for _, g in d.groupby('d'):
        if len(g) < min_per_day or g['y'].nunique() < 2 or g['p'].nunique() < 2:
            continue
        r = spearmanr(g['y'], g['p']).statistic
        if np.isfinite(r):
            ics.append(r)
    if len(ics) < 2:
        return float('nan'), float('nan'), len(ics), float('nan')
    ic, sd, n = float(np.mean(ics)), float(np.std(ics, ddof=1)), len(ics)
    return ic, sd, n, (ic / (sd / np.sqrt(n)) if sd > 0 else float('nan'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--folds', action='store_true',
                    help='run the production protocol over several non-overlapping test '
                         'windows; a single fold produced the non-replicating result')
    ap.add_argument('--features-file', default=None,
                    help='alternative features CSV (e.g. scratch/features_asyncfix.csv) '
                         'to add as an extra arm alongside the untouched v9.4 baseline')
    args = ap.parse_args()
    global FOLD_MODE
    FOLD_MODE = args.folds
    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    n0 = len(df)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)

    # v9.4 row-exclusion outlier hygiene — identical thresholds
    excl = (df['overnight_gap_pct'].abs() >= 1.0) | (df['excess_return'].abs() > 10)
    df = df[~excl].reset_index(drop=True)
    print(f'features.csv {n0:,} rows; excluded {int(excl.sum())} discontinuity rows -> {len(df):,}')

    null_ind = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(EXCLUDE_COLS) | set(null_ind) | set(ZERO_FILL_COLS)
                 | set(PRE_RETURN_COLS) | set(object_cols))
    feats_v94 = [c for c in df.columns if c not in drop_cols]
    feats_v11 = [c for c in feats_v94 if c not in STAMPED]
    print(f'features: v9.4 {len(feats_v94)}, v11 {len(feats_v11)} (dropped {STAMPED})')

    # rows a REAL event cannot be: |z| below the engine's own 1.80 adaptive floor
    zc = 'z_score' if 'z_score' in df.columns else None
    bad_ne = ((df['is_null_sample'] == 0) & (df[zc].abs() < 1.80)) if zc else pd.Series(False, index=df.index)
    pre21 = df['date'] < '2021-01-01'
    print(f'to drop: pre-2021 {int(pre21.sum()):,} | mislabelled non-events {int(bad_ne.sum()):,}')

    # v11-cand changes TWO things at once (drop pre-2021 rows, drop stamped features).
    # These two extra arms isolate each, so a regression can be attributed rather than
    # guessed at — the stamped removal was measured inert under the fixed-round protocol
    # but that needs confirming under the production one.
    # REPLACEMENT arm. The union was rejected yesterday under the fixed-400-round
    # protocol — the SAME protocol whose subtraction result failed to replicate here.
    # Discarding one of those conclusions while keeping the other would be arbitrary, so
    # the union is re-tested under the production protocol as well: 2021+ rows keep their
    # premium features, pre-2021 rows are the RE-EXTRACTED (correct-time-scale) events
    # with premium NaN, which is what that data genuinely is.
    import sqlite3
    con = sqlite3.connect(f'file:{ML_DIR.parent.parent / "market_cache.db"}?mode=ro', uri=True)
    v11px = pd.read_sql_query(
        """SELECT symbol, date, excess_return, z_score, atr_shock_score, volume_ratio,
                  relative_volume_30d, body_to_range_ratio, overnight_gap_pct,
                  gap_fill_ratio, obv_delta_10d, dist_sma_50, dist_sma_200, rsi_14,
                  forward_return_1m, forward_return_2d, forward_return_2w,
                  forward_return_3m, forward_return_6m, is_null_sample
           FROM training_events_v11
           WHERE price_source='daily_reextract' AND date < '2021-01-01'""", con)
    con.close()
    v11px['date'] = v11px['date'].astype(str).str[:10]
    v11px['is_us_listed'] = v11px['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0).astype(int)
    for c in feats_v11:
        if c not in v11px.columns:
            v11px[c] = np.nan
    ex2 = (v11px['overnight_gap_pct'].abs() >= 1.0) | (v11px['excess_return'].abs() > 10)
    v11px = v11px[~ex2]
    union = pd.concat([df[~pre21], v11px[list(df[~pre21].columns.intersection(v11px.columns))]],
                      ignore_index=True, sort=False)
    print(f'union arm: {int((~pre21).sum()):,} post-2021 v9.4 rows + '
          f'{len(v11px):,} re-extracted pre-2021 rows = {len(union):,}')

    ARMS = [
        ('v94-control', df, feats_v94),                       # neither change
        ('v94-nostamp', df, feats_v11),                       # stamped only
        ('v11-rowsonly', df[~pre21], feats_v94),              # pre-2021 drop only
        ('v11-cand', df[~pre21], feats_v11),                  # both
        ('v11-cand-ne', df[~(pre21 | bad_ne)], feats_v11),    # both + non-events
        ('v11-union', union, feats_v11),                      # REPLACE pre-2021 instead
    ]
    if args.features_file:
        # An alternative feature file (e.g. the async-close correction) enters as an
        # extra arm against the UNTOUCHED v9.4 baseline, on the same fixed test fold and
        # the same v9.4 feature list — so the corrected columns are the only difference.
        alt = pd.read_csv(args.features_file, low_memory=False)
        alt['date'] = alt['date'].astype(str).str[:10]
        alt['is_us_listed'] = alt['symbol'].apply(
            lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
        ).astype(int)
        alt = alt[~((alt['overnight_gap_pct'].abs() >= 1.0) | (alt['excess_return'].abs() > 10))]
        alt = alt.reset_index(drop=True)
        name = Path(args.features_file).stem.replace('features_', '')
        print(f'extra arm "{name}": {len(alt):,} rows from {args.features_file}')
        ARMS = [ARMS[0], (name, alt, feats_v94)]

    # MULTI-FOLD. A single test fold is what produced yesterday's non-replicating result,
    # so the production protocol is now run over several non-overlapping test windows.
    # Each keeps the protocol's temporal train/val/test structure with the same embargo:
    # val is a fixed 120-day window ending one embargo before the test window opens.
    FOLDS = ([(None, None)] if not FOLD_MODE else
             [('2023-06-01', '2024-02-01'), ('2024-02-01', '2024-10-01'),
              ('2024-10-01', '2025-06-01'), ('2025-06-01', '2027-01-01')])

    results = []
    for fold_start, fold_end in FOLDS:
      for head, (label, hz, fname) in HEADS.items():
        # --- cutoffs and TEST ROWS derived ONCE from full v9.4 data, then shared
        base = df.dropna(subset=[label])
        dates_base = pd.to_datetime(base['date'])
        sorted_d = dates_base.sort_values()
        n = len(base)
        emb = pd.Timedelta(days=EMBARGO_DAYS)
        if fold_start is None:
            cut_tr = sorted_d.iloc[int(n * 0.70)]
            cut_va = sorted_d.iloc[int(n * 0.85)]
            test_mask = dates_base >= cut_va
        else:
            cut_va = pd.Timestamp(fold_start)
            cut_tr = cut_va - pd.Timedelta(days=120)
            test_mask = (dates_base >= cut_va) & (dates_base < pd.Timestamp(fold_end))
        test_df = base[test_mask]
        if len(test_df) < 300:
            print(f'  [{fold_start}] {head}: SKIP, only {len(test_df)} test rows'); continue
        y_test = test_df[label].values
        test_dates = test_df['date'].values
        a_ic, a_sd, a_n = TEST_IC_DAILY[hz]

        print(f'\n=== {head} ({hz})  test fold {test_df["date"].min()} -> {test_df["date"].max()}, '
              f'{len(test_df):,} rows (fixed across arms) ===')

        for arm, data, feats in ARMS:
            sub = data.dropna(subset=[label])
            sd_ = pd.to_datetime(sub['date'])
            tr = sub[sd_ < (cut_tr - emb)]
            va = sub[(sd_ >= cut_tr) & (sd_ < (cut_va - emb))]
            if len(tr) < 500 or len(va) < 100:
                print(f'  {arm:<13} SKIP (train={len(tr)}, val={len(va)})'); continue

            dtr = xgb.DMatrix(tr[feats], label=tr[label],
                              weight=compute_sample_weights(tr), feature_names=feats)
            dva = xgb.DMatrix(va[feats], label=va[label], feature_names=feats)
            bst = xgb.train(REG_PARAMS, dtr, num_boost_round=1000,
                            obj=asymmetric_mse(), evals=[(dva, 'val')],
                            early_stopping_rounds=50, verbose_eval=False)
            pred = bst.predict(xgb.DMatrix(test_df[feats], feature_names=feats),
                               iteration_range=(0, bst.best_iteration + 1))
            ic, sd, nd, t = daily_ic(test_dates, y_test, pred)
            # two-sample z carrying BOTH standard errors, not just ours
            se = np.sqrt(sd**2 / max(nd, 1) + a_sd**2 / max(a_n, 1)) if np.isfinite(sd) else np.nan
            z = (ic - a_ic) / se if se and np.isfinite(se) and se > 0 else np.nan
            if arm != 'v94-control':
                bst.save_model(str(OUT_DIR / fname.replace('v11cand', f'{arm}')))
            results.append(dict(fold=fold_start or 'production', head=head, horizon=hz, arm=arm, train=len(tr), val=len(va),
                                test=len(test_df), best_iter=int(bst.best_iteration),
                                rmse=float(np.sqrt(mean_squared_error(y_test, pred))),
                                mae=float(mean_absolute_error(y_test, pred)),
                                ic=ic, ic_sd=sd, ic_days=nd, ic_t=t,
                                anchor_ic=a_ic, z_vs_anchor=z))
            print(f'  {arm:<13} train={len(tr):>6,} iter={bst.best_iteration:>4} '
                  f'IC={ic:+.4f} t={t:+.2f} ({nd}d)  anchor {a_ic:+.4f}  z={z:+.2f}')

    res = pd.DataFrame(results)
    # name the output after the arm under test so successive runs do not clobber
    # each other (an earlier run of this script overwrote its predecessor's results)
    tag = Path(args.features_file).stem.replace('features_', '') if args.features_file else 'v11'
    res.to_csv(OUT_DIR / (f'{tag}_folds.csv' if FOLD_MODE
                          else f'{tag}_candidate_results.csv'), index=False)

    if FOLD_MODE:
        print('\n' + '=' * 84)
        print('PER-FOLD day-clustered test IC')
        for f in res['fold'].unique():
            sub = res[res['fold'] == f]
            piv = sub.pivot_table(index='head', columns='arm', values='ic')
            cols = [a for a, _, _ in ARMS if a in piv.columns]
            piv = piv[cols].reindex([h for h in HEADS if h in piv.index])
            print(f'\n--- test window opening {f} ---')
            print(piv.round(4).to_string())

        print('\n' + '=' * 84)
        print(f'AGGREGATE over {res["fold"].nunique()} folds — mean IC, and how often each')
        print('arm beats v9.4 on the SAME fold (the check against fitting one window)')
        agg = res.pivot_table(index='head', columns='arm', values='ic', aggfunc='mean')
        cols = [a for a, _, _ in ARMS if a in agg.columns]
        agg = agg[cols].reindex([h for h in HEADS if h in agg.index])
        print(agg.round(4).to_string())
        print(f"\n{'arm':<14}{'mean delta':>12}{'head-folds won':>16}{'B':>9}{'D1':>9}{'D5(live)':>10}")
        print('-' * 70)
        for a in cols:
            if a == 'v94-control':
                continue
            wins = tot = 0
            for f in res['fold'].unique():
                s = res[res['fold'] == f].pivot_table(index='head', columns='arm', values='ic')
                if a not in s.columns or 'v94-control' not in s.columns:
                    continue
                d = (s[a] - s['v94-control']).dropna()
                wins += int((d > 0).sum()); tot += len(d)
            d = agg[a] - agg['v94-control']
            print(f'{a:<14}{d.mean():>+12.4f}{f"{wins}/{tot}":>16}'
                  f'{agg.loc["B", a]:>+9.4f}{agg.loc["D1", a]:>+9.4f}{agg.loc["D5", a]:>+10.4f}')
        print(f'{"v94-control":<14}{"—":>12}{"—":>16}'
              f'{agg.loc["B", "v94-control"]:>+9.4f}{agg.loc["D1", "v94-control"]:>+9.4f}'
              f'{agg.loc["D5", "v94-control"]:>+10.4f}')
        print(f'\nwrote {OUT_DIR / "v11_candidate_folds.csv"}')
        return

    print('\n' + '=' * 84)
    ctrl = res[res['arm'] == 'v94-control']
    dev = (ctrl['ic'] - ctrl['anchor_ic']).abs().max() if not ctrl.empty else float('nan')
    print(f'CONTROL CHECK: max |v94-control IC - deployed anchor| = {dev:.4f}')
    print('  ' + ('PASS — protocol reproduces the deployed anchors; results below are readable.'
                  if dev < 0.01 else
                  'FAIL — protocol does NOT reproduce v9.4. Do not read the candidate arms.'))

    print('\nDAY-CLUSTERED TEST IC (fixed test fold, production protocol)')
    piv = res.pivot_table(index='head', columns='arm', values='ic')
    cols = [a for a, _, _ in ARMS if a in piv.columns]
    piv = piv[cols].reindex([h for h in HEADS if h in piv.index])
    print(piv.round(4).to_string())

    if 'v94-control' in piv.columns:
        print(f"\n{'head':<6}{'anchor':>9}{'v9.4':>9}{'v11-cand':>11}{'delta':>9}{'t':>8}{'z vs anchor':>13}")
        print('-' * 66)
        for h, (_, hz, _) in HEADS.items():
            if h not in piv.index or 'v11-cand' not in piv.columns:
                continue
            r = res[(res['head'] == h) & (res['arm'] == 'v11-cand')]
            if r.empty:
                continue
            r = r.iloc[0]
            print(f'{h:<6}{TEST_IC_DAILY[hz][0]:>+9.4f}{piv.loc[h, "v94-control"]:>+9.4f}'
                  f'{piv.loc[h, "v11-cand"]:>+11.4f}'
                  f'{piv.loc[h, "v11-cand"] - piv.loc[h, "v94-control"]:>+9.4f}'
                  f'{r.ic_t:>+8.2f}{r.z_vs_anchor:>+13.2f}')
    print(f'\nwrote {OUT_DIR / "v11_candidate_results.csv"}')


if __name__ == '__main__':
    main()
