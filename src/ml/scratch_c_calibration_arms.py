#!/usr/bin/env python3
"""Model C — two defects the row-drop alone does NOT fix, tested rather than asserted.

Training model_c_v9.5 on the rows-only arm exposed two things the fold study had hidden,
because rank correlation is invariant to level and the fold study only reported rank:

  1. base_score=0.5. XGBoost's default is a classification-flavoured constant, and C's
     target is centred at -0.084. Early stopping fires around iteration 24-57 of 1000, so
     the model never descends from 0.5 to the data and is stranded ABOVE it. This is why
     deployed v9.1 reports "no downside" on 84.3% of anomalies and why the rows-only
     candidate still does on 60.0%.

  2. A label outlier v9.4's row-exclusion cannot catch. III.L 2023-12-01 carries
     max_adverse_excursion_1m = +113.54 — the 21-bar minimum low recorded as 114x the
     entry close, a GBp/GBP scale artefact. v9.4's filter keys on overnight_gap_pct
     (0.004 here) and excess_return (-0.99), never on the LABEL, so it survives. One row
     drags the post-2021 label std to 0.516 against an IQR of 0.087, and RMSE-based early
     stopping is exactly the thing an outlier like that destabilises.

A max ADVERSE excursion is (min_low - close)/close: bounded below by -1, and a positive
value just means the low never went under the entry. |label| > 1 implies the minimum low
was more than 2x the entry inside a month — physically a data error, not a market move.
That is the clip threshold, and it removes 2 rows in the whole file.

ARMS (all on top of the corrupt-row drop, which is already settled):
  c-rowsonly        the current candidate — reference point, not a control
  c-base            + base_score = training label mean
  c-clip            + drop |label| > 1
  c-base-clip       both

Same protocol, same fixed test folds, same paired day-level test as
scratch_c_corrupt_target.py. Deploys nothing.

Usage:
  python src/ml/scratch_c_calibration_arms.py
"""
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr, t as tdist

import scratch_c_corrupt_target as C

ML_DIR = Path(__file__).parent
FOLDS = [('2023-06-01', '2024-02-01'), ('2024-02-01', '2024-10-01'),
         ('2024-10-01', '2025-06-01'), ('2025-06-01', '2027-01-01')]


def main():
    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    null_ind = [c for c in df.columns if c.endswith('_is_null')]
    object_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop_cols = (set(C.EXCLUDE_COLS) | set(null_ind) | set(C.ZERO_FILL_COLS)
                 | set(C.PRE_RETURN_COLS) | set(object_cols))
    feats = [c for c in df.columns if c not in drop_cols]

    fixed = df[df['date'] >= '2021-01-01']
    outlier = fixed[C.LABEL].abs() > 1.0
    print(f'post-2021 rows {len(fixed):,}; label outliers |y|>1: {int(outlier.sum())}')
    print(f'label std with outlier {fixed[C.LABEL].std():.4f} -> '
          f'without {fixed[~outlier][C.LABEL].std():.4f}')

    # v91-control carries the corrupt pre-2021 rows — the deployed model. It is the
    # reference every arm must beat, and the paired test below is scored against it, not
    # against c-rowsonly, so the shipping claim is stated against what is live today.
    ARMS = [('v91-control', False, False), ('c-rowsonly', False, False),
            ('c-base', True, False), ('c-clip', False, True), ('c-base-clip', True, True)]

    rows, per_day = [], {}
    for fs, fe in FOLDS:
        base = fixed.dropna(subset=[C.LABEL])
        full_base = df.dropna(subset=[C.LABEL])   # control keeps the corrupt pre-2021 rows
        d = pd.to_datetime(base['date'])
        cut_va = pd.Timestamp(fs)
        cut_tr = cut_va - pd.Timedelta(days=120)
        emb = pd.Timedelta(days=C.EMBARGO_DAYS)
        test = base[(d >= cut_va) & (d < pd.Timestamp(fe))]
        if len(test) < 300:
            continue
        y = test[C.LABEL].values
        print(f'\n=== fold {fs}: test {test["date"].min()} -> {test["date"].max()}, '
              f'{len(test):,} rows ===')

        for arm, use_base, use_clip in ARMS:
            src = full_base if arm == 'v91-control' else base
            sub = src if not use_clip else src[src[C.LABEL].abs() <= 1.0]
            sd_ = pd.to_datetime(sub['date'])
            tr = sub[sd_ < (cut_tr - emb)]
            va = sub[(sd_ >= cut_tr) & (sd_ < (cut_va - emb))]
            if len(tr) < 500 or len(va) < 100:
                print(f'  {arm:<13} SKIP'); continue
            params = dict(C.REG_PARAMS_V91)
            if use_base:
                params['base_score'] = float(tr[C.LABEL].mean())
            dtr = xgb.DMatrix(tr[feats], label=tr[C.LABEL],
                              weight=C.compute_sample_weights(tr), feature_names=feats)
            dva = xgb.DMatrix(va[feats], label=va[C.LABEL], feature_names=feats)
            bst = xgb.train(params, dtr, num_boost_round=1000, obj=C.asymmetric_mse(),
                            evals=[(dva, 'val')], early_stopping_rounds=50,
                            verbose_eval=False)
            pred = bst.predict(xgb.DMatrix(test[feats], feature_names=feats),
                               iteration_range=(0, bst.best_iteration + 1))
            ic, sd, nd, t, series = C.daily_ic(test['date'].values, y, pred)
            per_day.setdefault(arm, []).append(series)
            rows.append(dict(fold=fs, arm=arm, iter=int(bst.best_iteration), ic=ic,
                             pooled=float(spearmanr(y, pred).statistic),
                             pred_mean=float(pred.mean()), pred_med=float(np.median(pred)),
                             frac_pos=float(np.mean(pred > 0)),
                             cal_err=float(np.abs(pred - y).mean())))
            print(f'  {arm:<13} iter={bst.best_iteration:>4} dayIC={ic:+.4f} '
                  f'pred_mean={pred.mean():+.4f} (real {y.mean():+.4f})  '
                  f'"no downside"={np.mean(pred > 0):>5.1%}  |err|={np.abs(pred - y).mean():.4f}')

    res = pd.DataFrame(rows)
    res.to_csv(ML_DIR / 'scratch' / 'c_calibration_arms.csv', index=False)

    print('\n' + '=' * 90)
    agg = res.groupby('arm').agg(day_ic=('ic', 'mean'), pooled=('pooled', 'mean'),
                                 iters=('iter', 'mean'), pred_mean=('pred_mean', 'mean'),
                                 frac_pos=('frac_pos', 'mean'), cal_err=('cal_err', 'mean'))
    agg = agg.reindex([a for a, _, _ in ARMS])
    print(f"{'arm':<14}{'day IC':>9}{'vs ctl':>9}{'paired t':>10}{'iters':>8}"
          f"{'pred mean':>11}{'no-downside':>13}{'|cal err|':>11}")
    print('-' * 85)
    ref = pd.concat(per_day['v91-control'])
    for a in agg.index:
        r = agg.loc[a]
        if a == 'v91-control':
            tv = float('nan')
        else:
            j = pd.concat([ref.rename('r'), pd.concat(per_day[a]).rename('a')],
                          axis=1).dropna()
            dd = (j['a'] - j['r']).values
            tv = dd.mean() / (dd.std(ddof=1) / np.sqrt(len(dd)))
        print(f"{a:<14}{r.day_ic:>+9.4f}{r.day_ic - agg.loc['v91-control','day_ic']:>+9.4f}"
              f"{tv:>10.2f}{r.iters:>8.0f}{r.pred_mean:>+11.4f}"
              f"{r.frac_pos:>12.1%}{r.cal_err:>11.4f}")
    print('\nRANK is what the corrupt-row drop was justified on; CALIBRATION (pred mean, '
          '\n"no-downside" share, |cal err|) is the user-facing defect. An arm has to hold '
          '\nthe first while fixing the second to be worth shipping.')


if __name__ == '__main__':
    main()
