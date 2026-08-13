#!/usr/bin/env python3
"""v16 — CONFIRMATORY test of one pre-registered hypothesis.

=============================================================================
PRE-REGISTRATION. Written before running; not edited afterwards.

HYPOTHESIS (single, chosen in advance, no others tested here):
    For head D5 (forward_return_2w), training with subsample=0.8 and
    colsample_bytree=0.8 produces a HIGHER day-clustered test IC than the
    production setting of subsample=1.0, colsample_bytree=1.0.

WHY IT NEEDS CONFIRMING. v15 found +0.0286 for D5 in 4 of 4 folds, but D5 was
identified AFTER looking at five heads. That is the multiple-comparison trap the
DSR work exists to guard against: the best of five is expected to look good even
when nothing is real. This re-tests the single surviving hypothesis on data the
original never touched.

TEST WINDOWS ARE DISJOINT FROM v15. v15 used folds starting 2023-06-01, 2024-02-01,
2024-10-01 and 2025-06-01. This uses windows entirely BEFORE 2023-06-01, so no test
row is shared with the run that generated the hypothesis.

DECISION RULE, fixed in advance:
    CONFIRMED           mean delta > 0 AND bagging wins in >= 75% of folds
    PARTIALLY CONFIRMED mean delta > 0 AND wins in >= 50% of folds
    NOT CONFIRMED       anything else
No other outcome counts as support, and a large delta on a minority of folds is
explicitly NOT confirmation.

METRIC. The bagged arm is stochastic, so a single fit could simply be a lucky seed.
The comparison therefore uses the MEAN IC over N_SEEDS independent bagged fits --
an estimate of expected bagged performance -- NOT an ensembled prediction. Ensembling
was already shown to add nothing beyond bagging for D5, and mixing the two would
re-confound the very thing v15 separated.
=============================================================================

Deploys nothing.

Usage:  python src/ml/scratch_v16_confirm_d5subsample.py
"""
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr

ML_DIR = Path(__file__).parent
OUT_DIR = ML_DIR / 'scratch'
OUT_DIR.mkdir(exist_ok=True)
RANDOM_STATE = 42
N_SEEDS = 5

LABEL, HZ = 'forward_return_2w', '2W'
# Disjoint from v15's folds, which all start at or after 2023-06-01.
FOLDS = [('2021-07-01', '2021-11-01'), ('2021-11-01', '2022-03-01'),
         ('2022-03-01', '2022-07-01'), ('2022-07-01', '2022-11-01'),
         ('2022-11-01', '2023-03-01'), ('2023-03-01', '2023-06-01')]

STAMPED = ['price_target_upside_pct', 'insider_net_shares_30d', 'price_target_consensus',
           'eps_surprise_pct', 'revenue_surprise_pct', 'vix_close']
EXCLUDE_COLS = [
    'cache_key', 'symbol', 'date', 'is_null_sample', 'label',
    'forward_return_1d', 'forward_return_1w', 'forward_return_1m',
    'forward_return_2d', 'forward_return_3d', 'forward_return_2w',
    'forward_return_3m', 'forward_return_6m', 'forward_return_12m',
    'max_favorable_excursion_1m', 'max_adverse_excursion_1m',
    'outperform_12m', 'is_event', 'sector_excess_return', 'options_put_call_ratio',
]
PROD_PARAMS = dict(objective='reg:squarederror', max_depth=8, eta=0.05, subsample=1.0,
                   colsample_bytree=1.0, eval_metric='rmse', seed=RANDOM_STATE)
BAG_SUBSAMPLE, BAG_COLSAMPLE = 0.8, 0.8
ASYMMETRIC_ALPHA, ASYMMETRIC_BETA = 2.5, 1.0
EMBARGO_DAYS = 21


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
    d = pd.DataFrame({'d': pd.to_datetime(dates).values, 'y': y_true, 'p': y_pred})
    ics = []
    for _, g in d.groupby('d'):
        if len(g) < min_per_day or g['y'].nunique() < 2 or g['p'].nunique() < 2:
            continue
        r = spearmanr(g['y'], g['p']).statistic
        if np.isfinite(r):
            ics.append(r)
    return float(np.mean(ics)) if len(ics) >= 2 else float('nan')


def main():
    print(__doc__.split('=====')[1])
    print('=' * 78)

    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    feats = [c for c in df.columns
             if c not in EXCLUDE_COLS and df[c].dtype in (np.float64, np.int64)
             and c not in STAMPED]
    print(f'{len(df):,} rows, {len(feats)} leakage-free features, head D5 only, '
          f'{N_SEEDS} seeds per fold\n')

    base = df.dropna(subset=[LABEL])
    d = pd.to_datetime(base['date'])
    emb = pd.Timedelta(days=EMBARGO_DAYS)

    rows = []
    for fold_start, fold_end in FOLDS:
        cut_va = pd.Timestamp(fold_start)
        cut_tr = cut_va - pd.Timedelta(days=120)
        test = base[(d >= cut_va) & (d < pd.Timestamp(fold_end))]
        tr = base[d < (cut_tr - emb)]
        va = base[(d >= cut_tr) & (d < (cut_va - emb))]
        if len(test) < 300 or len(tr) < 500 or len(va) < 100:
            print(f'  fold {fold_start}: SKIP (test={len(test)}, train={len(tr)}, val={len(va)})')
            continue

        dtr = xgb.DMatrix(tr[feats], label=tr[LABEL], weight=compute_sample_weights(tr))
        dva = xgb.DMatrix(va[feats], label=va[LABEL])
        dte = xgb.DMatrix(test[feats])
        y, dates = test[LABEL].values, test['date'].values

        def fit(params):
            m = xgb.train(params, dtr, num_boost_round=1000, obj=asymmetric_mse(),
                          evals=[(dva, 'val')], early_stopping_rounds=50, verbose_eval=False)
            return m.predict(dte)

        ic_prod = daily_ic(dates, y, fit(PROD_PARAMS))
        bag_ics = [daily_ic(dates, y, fit({**PROD_PARAMS, 'subsample': BAG_SUBSAMPLE,
                                           'colsample_bytree': BAG_COLSAMPLE,
                                           'seed': RANDOM_STATE + i}))
                   for i in range(N_SEEDS)]
        ic_bag = float(np.nanmean(bag_ics))
        spread = float(np.nanstd(bag_ics, ddof=1))
        print(f'  fold {fold_start}  test={len(test):>5,}  train={len(tr):>6,}  '
              f'prod={ic_prod:+.4f}  bag(mean of {N_SEEDS})={ic_bag:+.4f}  '
              f'delta={ic_bag - ic_prod:+.4f}  seed sd={spread:.4f}')
        rows.append(dict(fold=fold_start, n_test=len(test), prod=ic_prod, bag=ic_bag,
                         delta=ic_bag - ic_prod, seed_sd=spread))

    res = pd.DataFrame(rows)
    if res.empty:
        print('\nno usable folds'); return
    res.to_csv(OUT_DIR / 'v16_confirm_d5subsample.csv', index=False)

    wins, k = int((res.delta > 0).sum()), len(res)
    md = float(res.delta.mean())
    print('\n' + '=' * 78)
    print(f'folds usable: {k}   mean delta {md:+.4f}   bagging wins {wins}/{k} '
          f'({100 * wins / k:.0f}%)')
    # Two-sided sign test against a fair coin, exact binomial.
    from math import comb
    p = sum(comb(k, i) for i in range(wins, k + 1)) / 2 ** k
    print(f'sign test (one-sided, H0 = coin flip): p = {p:.4f}')

    if md > 0 and wins / k >= 0.75:
        verdict = ('CONFIRMED — the pre-registered rule is met on data the hypothesis was '
                   'never fitted to.')
    elif md > 0 and wins / k >= 0.50:
        verdict = ('PARTIALLY CONFIRMED — positive but below the 75% bar set in advance. '
                   'Not sufficient to change production on its own.')
    else:
        verdict = ('NOT CONFIRMED — the v15 result does not replicate out of sample, and '
                   'is best explained as the best-of-five selection effect.')
    print(f'\nVERDICT: {verdict}')
    print(f'\nwrote {OUT_DIR / "v16_confirm_d5subsample.csv"}')


if __name__ == '__main__':
    main()
