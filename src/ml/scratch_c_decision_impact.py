#!/usr/bin/env python3
"""What the corrupt Model C target costs at the DECISION layer, not the metric layer.

scratch_c_corrupt_target.py established that dropping the 16,435 corrupt pre-2021 rows
raises C's day-clustered rank correlation by +0.0237 (t=+5.43, p=7e-08, 4/4 folds).
This script answers the "so what": C is consumed live as a PERCENTILE, and that
percentile sets position size.

  LiveInferenceService.ts:820-836
    drawdownTerm      = (1 - modelCPercentileRank(modelC)) * 40
    riskScore         = drawdownTerm + (1 - modelA) * 30 + tailRiskTerm
    riskReward        = |modelD5| / max(1 - modelCRank, RISK_REWARD_FLOOR)
    positionSizePct   = min(10, max(1, modelA * 10 * (1 - riskScore / 100)))

THE DIRECTIONAL HYPOTHESIS. The corrupt labels are ~21 MONTHS of excursion recorded as
1 month, so they overstate drawdown roughly 3x (mean stored -0.21 to -0.31 vs true -0.08
to -0.11). A model trained on them should be systematically PESSIMISTIC: it predicts
deeper drawdowns, which lowers the percentile rank, which RAISES riskScore, which SHRINKS
position size. So the expected cost is not random noise — it is a persistent, one-sided
under-sizing of positions. This tests that sign explicitly rather than only |delta|.

Reads nothing but features.csv and market_cache.db. Deploys nothing.
"""
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

import scratch_c_corrupt_target as C

ML_DIR = Path(__file__).parent


def train_arm(data, feats, label, cut_tr, cut_va, emb):
    sub = data.dropna(subset=[label])
    sd_ = pd.to_datetime(sub['date'])
    tr = sub[sd_ < (cut_tr - emb)]
    va = sub[(sd_ >= cut_tr) & (sd_ < (cut_va - emb))]
    dtr = xgb.DMatrix(tr[feats], label=tr[label],
                      weight=C.compute_sample_weights(tr), feature_names=feats)
    dva = xgb.DMatrix(va[feats], label=va[label], feature_names=feats)
    bst = xgb.train(C.REG_PARAMS_V91, dtr, num_boost_round=1000, obj=C.asymmetric_mse(),
                    evals=[(dva, 'val')], early_stopping_rounds=50, verbose_eval=False)
    return bst


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
    pre21 = df['date'] < '2021-01-01'

    base = df.dropna(subset=[C.LABEL])
    dates_base = pd.to_datetime(base['date'])
    sorted_d = dates_base.sort_values()
    n = len(base)
    emb = pd.Timedelta(days=C.EMBARGO_DAYS)
    cut_tr = sorted_d.iloc[int(n * 0.70)]
    cut_va = sorted_d.iloc[int(n * 0.85)]
    test_df = base[dates_base >= cut_va]
    print(f'production test fold: {test_df["date"].min()} -> {test_df["date"].max()}, '
          f'{len(test_df):,} rows')

    dtest = xgb.DMatrix(test_df[feats], feature_names=feats)
    b_ctl = train_arm(df, feats, C.LABEL, cut_tr, cut_va, emb)
    b_fix = train_arm(df[~pre21], feats, C.LABEL, cut_tr, cut_va, emb)
    p_ctl = b_ctl.predict(dtest, iteration_range=(0, b_ctl.best_iteration + 1))
    p_fix = b_fix.predict(dtest, iteration_range=(0, b_fix.best_iteration + 1))

    r_ctl = C.model_c_percentile_rank(p_ctl)
    r_fix = C.model_c_percentile_rank(p_fix)
    dd_ctl = (1 - r_ctl) * 40      # riskScore drawdown term
    dd_fix = (1 - r_fix) * 40
    d_dd = dd_fix - dd_ctl

    print('\n--- raw C prediction (the drawdown it forecasts) ---')
    print(f'  deployed (corrupt rows in):  mean {p_ctl.mean():+.4f}  median {np.median(p_ctl):+.4f}')
    print(f'  fixed    (corrupt rows out): mean {p_fix.mean():+.4f}  median {np.median(p_fix):+.4f}')
    print(f'  realized max_adverse_1m:     mean {test_df[C.LABEL].mean():+.4f}  '
          f'median {test_df[C.LABEL].median():+.4f}')

    # DO NOT read the fixed-breakpoint shift as the cost of the bug. MODEL_C_PERCENTILE_
    # BREAKPOINTS were fitted to the DEPLOYED model's own output distribution on this very
    # fold (PotService.ts:342-343), so the deployed model's ranks are uniform BY
    # CONSTRUCTION and its mean drawdown term is ~20/40 whatever the model does. Pushing a
    # differently-levelled model through those same breakpoints measures the missing
    # recalibration, not the defect — which is exactly what the code comment
    # "Recalibrate after any future Model C retrain" already tells you to do.
    print('\n--- fixed breakpoints: the ARTEFACT, shown so it is not mistaken for the cost ---')
    print(f'  deployed drawdown term {dd_ctl.mean():5.2f}/40 (uniform by construction), '
          f'fixed model through the SAME breakpoints {dd_fix.mean():5.2f}/40')
    print(f'  apparent shift {d_dd.mean():+.2f} pts on {(np.abs(d_dd) >= 5).mean():.0%} of rows'
          f' — this is recalibration debt, NOT the defect')

    # The honest decision comparison ranks each model within ITS OWN distribution, which
    # is what recalibrating the breakpoints would do. Any residual difference is then
    # genuinely attributable to the model rather than to the stale mapping.
    er_ctl = pd.Series(p_ctl).rank(pct=True).values
    er_fix = pd.Series(p_fix).rank(pct=True).values
    dd_ctl_r, dd_fix_r = (1 - er_ctl) * 40, (1 - er_fix) * 40
    d_r = dd_fix_r - dd_ctl_r
    print('\n--- recalibrated (each model ranked in its own distribution) ---')
    print(f'  mean drawdown term: deployed {dd_ctl_r.mean():5.2f}/40, '
          f'fixed {dd_fix_r.mean():5.2f}/40')
    print(f'  mean |change| {np.abs(d_r).mean():.2f} riskScore points; '
          f'>=5 pts on {(np.abs(d_r) >= 5).mean():.1%} of rows, '
          f'>=10 on {(np.abs(d_r) >= 10).mean():.1%}')
    print('  so post-recalibration the RANKING still reorders risk materially, but with')
    print('  no systematic level shift — the reordering is the real effect.')

    # The raw value is NOT always ranked away. It is printed to the user and handed to
    # the LLM verbatim (LiveInferenceService.ts:866 and :922), where miscalibration is
    # read literally as a percentage.
    print('\n--- raw value, surfaced verbatim at LiveInferenceService.ts:866 and :922 ---')
    y = test_df[C.LABEL].values
    for nm, p in (('deployed', p_ctl), ('fixed', p_fix)):
        pos = p > 0
        print(f'  {nm:<9} says "drawdown" is POSITIVE (i.e. no downside) on {pos.mean():>5.1%} '
              f'of anomalies; those actually realized a mean {y[pos].mean() if pos.any() else float("nan"):+.4f}')
    print(f'  mean absolute calibration error: deployed {np.abs(p_ctl - y).mean():.4f}, '
          f'fixed {np.abs(p_fix - y).mean():.4f}')

    print('\n--- does the fix rank real risk better? decile check on realized drawdown ---')
    t = pd.DataFrame({'y': test_df[C.LABEL].values, 'ctl': p_ctl, 'fix': p_fix})
    t = t[t['y'] > -1.0]
    for col in ('ctl', 'fix'):
        q = pd.qcut(t[col], 10, labels=False, duplicates='drop')
        worst, best = t.loc[q == 0, 'y'].mean(), t.loc[q == q.max(), 'y'].mean()
        print(f'  {col}: riskiest decile realized {worst:+.4f}, safest {best:+.4f}, '
              f'spread {best - worst:.4f}')


if __name__ == '__main__':
    main()
