#!/usr/bin/env python3
"""MODEL C — does the corrupt pre-2021 target actually degrade it?

WHY THIS EXISTS. `max_adverse_excursion_1m` is built by the engine as
`points.slice(i+1, i+22)` — 21 BARS, not 21 trading days. Pre-2021 rows were built
from MONTHLY/QUARTERLY Yahoo bars (the `range=max` trap), so for those rows the label
is the worst excursion over ~21 MONTHS. Measured against the re-extracted true-daily
labels:

    era        n      median |stored-true|   mean stored   mean true
    <=2010     385    0.1766                 -0.3079       -0.0974
    2011-15     91    0.1000                 -0.2092       -0.0827
    2016-18     54    0.1135                 -0.2169       -0.0863
    2019-20    103    0.0979                 -0.2263       -0.1106
    2021+   31,304    0.0000                 -0.0712       -0.0705

100% of joined pre-2021 rows differ; 2021+ reproduces exactly. So the corrupt rows
teach C that drawdowns are ~2.5-3x deeper than they really are.

C was diagnosed alongside B in the blast-radius work and then never evaluated — every
v11/v12 arm trained B/D1/D2/D3/D5 only. C is NOT idle: it feeds getRecommendation
(server.ts:1454, LiveInferenceService.ts:1405), riskScore via
`(1 - modelCPercentileRank(c)) * 40` (LiveInferenceService.ts:820-823) and
risk_reward_ratio (LiveInferenceService.ts:831).

PROTOCOL. v9.1, NOT v9.4. C has never been retrained past v9.1, so the control must
use v9.1's REG_PARAMS (max_depth=5, subsample=0.8, colsample_bytree=0.8) and must NOT
apply v9.4's row-exclusion hygiene — that shipped for B/D1/D2/D3/D5 only. Using the
v9.4 harness verbatim would mean the control is not a control. Everything else matches
train_all_models_v9.py::train_regressor: asymmetric MSE (2.5/1.0), VIX x liquidity
sample weights on train only, chronological 70/15/15, 21-day embargo, 1000 rounds with
early stopping at 50.

METRIC. C has no TEST_IC_DAILY anchor — it predicts a magnitude, not a ranking, so the
five regression heads' anchors do not transfer. But the DEPLOYED system consumes C as a
RANK (modelCPercentileRank), so rank correlation is the decision-relevant measure, and
PotService.ts:344 already validated the sign convention that way (pooled Spearman +0.285
vs realized max_adverse_excursion_1m, 10,051-row fold). Reported here:
  - day-clustered Spearman  (primary; matches the standing method rule)
  - pooled Spearman         (comparable to the +0.285 note)
  - RMSE / MAE              (the training objective's own scale)
  - mean |delta percentile| (what actually moves riskScore)

THE TEST FOLD IS CLEAN AND HELD FIXED ACROSS ARMS. Cutoffs and test rows are derived
ONCE from the full v9.1 data, then shared, so dropping 16,435 pre-2021 rows cannot
silently move the split. The cutoffs land in 2021+, where the stored label reproduces
the true daily-bar value exactly — so every arm is judged against an uncorrupted target.

Writes to src/ml/scratch/ only. Deploys nothing.

Usage:
  python src/ml/scratch_c_corrupt_target.py            # single production fold
  python src/ml/scratch_c_corrupt_target.py --folds    # 4 non-overlapping windows
"""
import argparse
import sqlite3
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

LABEL = 'max_adverse_excursion_1m'
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

# v9.1 regressor params — NOT v9.4's depth-8/1.0/1.0. See PROTOCOL above.
REG_PARAMS_V91 = dict(objective='reg:squarederror', max_depth=5, eta=0.05, subsample=0.8,
                      colsample_bytree=0.8, eval_metric='rmse', seed=RANDOM_STATE)
ASYMMETRIC_ALPHA, ASYMMETRIC_BETA = 2.5, 1.0
EMBARGO_DAYS = 21

# PotService.ts:350-368 — the breakpoints live inference actually ranks C against.
MODEL_C_BREAKPOINTS = [
    (0.00, -1.4857), (0.01, -0.0958), (0.02, -0.0717), (0.05, -0.0440),
    (0.10, -0.0201), (0.20, 0.0235), (0.30, 0.0562), (0.40, 0.0686),
    (0.50, 0.0770), (0.60, 0.0821), (0.70, 0.0862), (0.80, 0.0921),
    (0.90, 0.0975), (0.95, 0.1002), (0.98, 0.1002), (0.99, 0.1009), (1.00, 0.1009),
]


def model_c_percentile_rank(values):
    """Port of PotService.ts::modelCPercentileRank — piecewise-linear interpolation
    between fixed breakpoints, NOT a min-max scale (C has a long negative tail)."""
    ps = np.array([p for p, _ in MODEL_C_BREAKPOINTS])
    vs = np.array([v for _, v in MODEL_C_BREAKPOINTS])
    v = np.asarray(values, dtype=float)
    out = np.interp(v, vs, ps)              # np.interp clamps outside the range,
    return np.clip(out, ps[0], ps[-1])      # matching the TS early returns


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
    """Returns (mean, sd, ndays, t, per_day_series). The per-day series is kept so the
    arms can be compared PAIRED on the same days — 4 folds is a weak N, ~765 shared
    test days is a strong one, and every arm is scored on identical test rows."""
    d = pd.DataFrame({'d': pd.to_datetime(dates).values, 'y': y_true, 'p': y_pred})
    ics = {}
    for day, g in d.groupby('d'):
        if len(g) < min_per_day or g['y'].nunique() < 2 or g['p'].nunique() < 2:
            continue
        r = spearmanr(g['y'], g['p']).statistic
        if np.isfinite(r):
            ics[day] = r
    s = pd.Series(ics, dtype=float)
    if len(s) < 2:
        return float('nan'), float('nan'), len(s), float('nan'), s
    ic, sd, n = float(s.mean()), float(s.std(ddof=1)), len(s)
    return ic, sd, n, (ic / (sd / np.sqrt(n)) if sd > 0 else float('nan')), s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--folds', action='store_true')
    args = ap.parse_args()

    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    print(f'features.csv {len(df):,} rows (v9.1 protocol — NO v9.4 row exclusion)')

    null_ind = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(EXCLUDE_COLS) | set(null_ind) | set(ZERO_FILL_COLS)
                 | set(PRE_RETURN_COLS) | set(object_cols))
    feats_v91 = [c for c in df.columns if c not in drop_cols]
    feats_nostamp = [c for c in feats_v91 if c not in STAMPED]
    print(f'features: v9.1 {len(feats_v91)}, no-stamp {len(feats_nostamp)}')

    pre21 = df['date'] < '2021-01-01'
    print(f'pre-2021 corrupt-label rows: {int(pre21.sum()):,} of {len(df):,} '
          f'({pre21.mean():.1%})')

    # C's label carries extremes the v9.1 protocol never filtered (max +583.3 —
    # a near-zero close). Reported, not filtered: filtering would break the control.
    ext = df[LABEL].abs() > 1.0
    print(f'|C label| > 1.0: {int(ext.sum())} rows '
          f'({int((ext & pre21).sum())} pre-2021 / {int((ext & ~pre21).sum())} post)')

    # REPAIR ARM. The only arm that fixes the label rather than deleting it: pre-2021
    # rows are replaced with the re-extracted true-daily-bar events, whose MAE is built
    # from bars.slice(i+1, i+22) over genuine DAILY bars (reextractDailyEvents.ts:340).
    con = sqlite3.connect(f'file:{ML_DIR.parent.parent / "market_cache.db"}?mode=ro', uri=True)
    rex = pd.read_sql_query(
        """SELECT symbol, date, excess_return, z_score, atr_shock_score, volume_ratio,
                  relative_volume_30d, body_to_range_ratio, overnight_gap_pct,
                  gap_fill_ratio, obv_delta_10d, dist_sma_50, dist_sma_200, rsi_14,
                  max_adverse_excursion_1m, is_null_sample
           FROM training_events_v11
           WHERE price_source='daily_reextract' AND date < '2021-01-01'
             AND max_adverse_excursion_1m IS NOT NULL""", con)
    con.close()
    # 8 re-extracted rows carry an INFINITE MAE — (min_low - close)/close where the
    # close rounded to zero. features.csv has none (max +583.3, a near-zero close that
    # survived as a finite absurdity), so this guard is specific to the repair source.
    n_inf = int((~np.isfinite(rex[LABEL])).sum())
    rex = rex[np.isfinite(rex[LABEL])]
    print(f'repair source: dropped {n_inf} non-finite MAE rows (zero-close division)')
    rex['date'] = rex['date'].astype(str).str[:10]
    rex['is_us_listed'] = rex['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    for c in feats_v91:
        if c not in rex.columns:
            rex[c] = np.nan
    keep = list(df.columns.intersection(rex.columns))
    union = pd.concat([df[~pre21], rex[keep]], ignore_index=True, sort=False)
    print(f'repair arm: {int((~pre21).sum()):,} post-2021 + {len(rex):,} re-extracted '
          f'pre-2021 = {len(union):,}')

    ARMS = [
        ('v91-control',  df,            feats_v91),      # deployed C, unchanged
        ('c-nostamp',    df,            feats_nostamp),  # stamped leakage only
        ('c-rowsonly',   df[~pre21],    feats_v91),      # drop corrupt rows only
        ('c-cand',       df[~pre21],    feats_nostamp),  # both
        ('c-repair',     union,         feats_nostamp),  # REPLACE corrupt rows
    ]

    FOLDS = ([(None, None)] if not args.folds else
             [('2023-06-01', '2024-02-01'), ('2024-02-01', '2024-10-01'),
              ('2024-10-01', '2025-06-01'), ('2025-06-01', '2027-01-01')])

    results = []
    ctrl_rank = {}
    per_day = {}
    for fold_start, fold_end in FOLDS:
        base = df.dropna(subset=[LABEL])
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
            print(f'  [{fold_start}] SKIP, only {len(test_df)} test rows'); continue
        y_test = test_df[LABEL].values
        test_dates = test_df['date'].values
        fk = fold_start or 'production'

        print(f'\n=== C  fold {fk}: test {test_df["date"].min()} -> {test_df["date"].max()}, '
              f'{len(test_df):,} rows (fixed across arms; labels verified clean post-2021) ===')

        for arm, data, feats in ARMS:
            sub = data.dropna(subset=[LABEL])
            sd_ = pd.to_datetime(sub['date'])
            tr = sub[sd_ < (cut_tr - emb)]
            va = sub[(sd_ >= cut_tr) & (sd_ < (cut_va - emb))]
            if len(tr) < 500 or len(va) < 100:
                print(f'  {arm:<13} SKIP (train={len(tr)}, val={len(va)})'); continue

            dtr = xgb.DMatrix(tr[feats], label=tr[LABEL],
                              weight=compute_sample_weights(tr), feature_names=feats)
            dva = xgb.DMatrix(va[feats], label=va[LABEL], feature_names=feats)
            bst = xgb.train(REG_PARAMS_V91, dtr, num_boost_round=1000,
                            obj=asymmetric_mse(), evals=[(dva, 'val')],
                            early_stopping_rounds=50, verbose_eval=False)
            pred = bst.predict(xgb.DMatrix(test_df[feats], feature_names=feats),
                               iteration_range=(0, bst.best_iteration + 1))

            ic, sd, nd, t, day_series = daily_ic(test_dates, y_test, pred)
            per_day.setdefault(arm, []).append(day_series)
            pooled = spearmanr(y_test, pred).statistic
            rank = model_c_percentile_rank(pred)
            if arm == 'v91-control':
                ctrl_rank[fk] = rank
                d_rank = 0.0
            else:
                d_rank = float(np.mean(np.abs(rank - ctrl_rank[fk]))) if fk in ctrl_rank else np.nan

            results.append(dict(
                fold=fk, arm=arm, train=len(tr), val=len(va), test=len(test_df),
                best_iter=int(bst.best_iteration),
                rmse=float(np.sqrt(mean_squared_error(y_test, pred))),
                mae=float(mean_absolute_error(y_test, pred)),
                ic=ic, ic_sd=sd, ic_days=nd, ic_t=t, pooled_rho=float(pooled),
                mean_abs_d_rank=d_rank, mean_pred=float(pred.mean())))
            print(f'  {arm:<13} train={len(tr):>6,} iter={bst.best_iteration:>4} '
                  f'dayIC={ic:+.4f} t={t:+.2f} ({nd}d)  pooled={pooled:+.4f}  '
                  f'RMSE={np.sqrt(mean_squared_error(y_test, pred)):.4f}  '
                  f'|drank|={d_rank:.4f}')

    res = pd.DataFrame(results)
    res.to_csv(OUT_DIR / ('c_target_folds.csv' if args.folds else 'c_target_results.csv'),
               index=False)

    print('\n' + '=' * 88)
    print('MODEL C — day-clustered Spearman vs realized max_adverse_excursion_1m')
    print('(positive = higher C predicts shallower drawdown, PotService sign convention)')
    piv = res.pivot_table(index='arm', columns='fold', values='ic')
    order = [a for a, _, _ in ARMS if a in piv.index]
    print(piv.reindex(order).round(4).to_string())

    if args.folds:
        print('\n' + '=' * 88)
        agg = res.groupby('arm').agg(
            day_ic=('ic', 'mean'), pooled=('pooled_rho', 'mean'),
            rmse=('rmse', 'mean'), d_rank=('mean_abs_d_rank', 'mean')).reindex(order)
        ctrl = agg.loc['v91-control']
        print(f"{'arm':<14}{'day IC':>9}{'delta':>9}{'folds won':>11}"
              f"{'pooled':>9}{'RMSE':>10}{'|d rank|':>10}")
        print('-' * 72)
        for a in order:
            r = agg.loc[a]
            if a == 'v91-control':
                print(f"{a:<14}{r.day_ic:>+9.4f}{'—':>9}{'—':>11}"
                      f"{r.pooled:>+9.4f}{r.rmse:>10.4f}{'—':>10}")
                continue
            w = t_ = 0
            for f in res['fold'].unique():
                s = res[res['fold'] == f].set_index('arm')['ic']
                if a in s.index and 'v91-control' in s.index:
                    w += int(s[a] > s['v91-control']); t_ += 1
            print(f"{a:<14}{r.day_ic:>+9.4f}{r.day_ic - ctrl.day_ic:>+9.4f}"
                  f"{f'{w}/{t_}':>11}{r.pooled:>+9.4f}{r.rmse:>10.4f}{r.d_rank:>10.4f}")
        print('\n|d rank| = mean absolute change in modelCPercentileRank vs the deployed')
        print('control. riskScore moves by 40x this; risk_reward_ratio scales with it.')

        # PAIRED DAY-LEVEL TEST. The fold-level test above has N=4 and cannot resolve
        # an effect this size. Every arm is scored on the SAME test rows, so the per-day
        # ICs are paired and their differences can be tested directly across all folds'
        # days pooled — the same day-clustered unit the anchors use, just paired.
        print('\n' + '=' * 88)
        print('PAIRED day-level test vs v91-control (same test days, folds pooled)')
        ctrl_days = pd.concat(per_day['v91-control'])
        print(f"{'arm':<14}{'mean d':>10}{'sd':>9}{'days':>7}{'t':>9}"
              f"{'p (two-sided)':>15}{'days won':>11}")
        print('-' * 75)
        from scipy.stats import t as tdist, wilcoxon
        for a in order:
            if a == 'v91-control':
                continue
            arm_days = pd.concat(per_day[a])
            j = pd.concat([ctrl_days.rename('c'), arm_days.rename('a')], axis=1).dropna()
            d = (j['a'] - j['c']).values
            n = len(d)
            tv = d.mean() / (d.std(ddof=1) / np.sqrt(n))
            p = 2 * (1 - tdist.cdf(abs(tv), n - 1))
            print(f'{a:<14}{d.mean():>+10.4f}{d.std(ddof=1):>9.4f}{n:>7}{tv:>+9.2f}'
                  f'{p:>15.2e}{f"{int((d > 0).sum())}/{n}":>11}')
        # Wilcoxon on the headline arm — the per-day IC differences are not Gaussian
        aj = pd.concat([ctrl_days.rename('c'), pd.concat(per_day['c-rowsonly']).rename('a')],
                       axis=1).dropna()
        w = wilcoxon(aj['a'], aj['c'])
        print(f'\nc-rowsonly Wilcoxon signed-rank (no normality assumption): '
              f'W={w.statistic:.0f}, p={w.pvalue:.2e}')
    print(f"\nwrote {OUT_DIR / ('c_target_folds.csv' if args.folds else 'c_target_results.csv')}")


if __name__ == '__main__':
    main()
