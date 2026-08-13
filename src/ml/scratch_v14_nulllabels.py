#!/usr/bin/env python3
"""v14 — retrain on corrected labels, under the production protocol.

WHAT CHANGED IN THE DATA. feature_extractor.ts wrote a null TARGET as 0.0, so an event
whose horizon had not yet matured entered training asserting "the outcome was exactly
0%". The fix writes an empty cell, which pandas reads as NaN and dropna removes. Measured
on the re-extraction: of the values that used to be zero, 99.5% of forward_return_12m,
98.8% of 6M, 96.8% of 3M and 93.7% of 1M were missing rather than genuinely zero.
max_favorable/max_adverse are unchanged (223/406), the control that says the extractor
is not simply blanking everything.

WHY THE TEST SET HAD TO MOVE TOO, AND WHY THIS IS THE POINT. Unmatured rows concentrate
at the END of the sample, which is exactly where the production protocol puts its test
fold. In the most recent fold the OLD label column is fabricated for 98.7% of E's test
rows, 57.9% of D2's, 25.3% of D1's and 20.3% of B's. Scoring a model against fabricated
zeros measures nothing, so the test rows here are derived from the CORRECTED labels and
every arm is scored on that same corrected set. D5 (1.2%) and D3 (0.1%) are barely
touched, which is the reassuring part: the live recommendation basis was never the
contaminated one.

Because the evaluation basis moves, these numbers are NOT directly comparable to the
recorded TEST_IC_DAILY anchors for the long heads. That comparison is made explicitly
instead: the v94-old arm is scored on BOTH bases, so the anchor shift is measured rather
than assumed.

ARMS (test fold fixed across all three, only training data / features differ)
  v94-old      old CSV, v9.4 feature list. Reproduces history; the reference point.
  honest-old   old CSV, leakage-free features. v13's honest control (-0.0007 vs v9.4).
  honest-new   NEW CSV, leakage-free features. The candidate: corrected labels.

Deploys nothing. Writes only under src/ml/scratch/.

Usage:  python src/ml/scratch_v14_nulllabels.py --folds
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr

ML_DIR = Path(__file__).parent
OUT_DIR = ML_DIR / 'scratch'
OUT_DIR.mkdir(exist_ok=True)
RANDOM_STATE = 42
OLD_CSV = Path(r'C:\Users\Lewis\AppData\Local\Temp\claude'
               r'\d--Projects-stock-catalyst-historian'
               r'\cedc837a-6594-4cda-a4ab-f3b79971424e\scratchpad'
               r'\features_backup_20260807.csv')

TEST_IC_DAILY = {
    '2D': (0.0826, 0.2968, 330), '2W': (0.1111, 0.3376, 331),
    '1M': (-0.0278, 0.2799, 313), '3M': (0.0709, 0.3177, 275),
    '6M': (0.0977, 0.2953, 210),
}
HEADS = {
    'B':  ('forward_return_1m', '1M'), 'D1': ('forward_return_3m', '3M'),
    'D2': ('forward_return_6m', '6M'), 'D3': ('forward_return_2d', '2D'),
    'D5': ('forward_return_2w', '2W'),
}
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
REG_PARAMS = dict(objective='reg:squarederror', max_depth=8, eta=0.05, subsample=1.0,
                  colsample_bytree=1.0, eval_metric='rmse', seed=RANDOM_STATE)
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
    if len(ics) < 2:
        return float('nan'), float('nan'), len(ics)
    return float(np.mean(ics)), float(np.std(ics, ddof=1)), len(ics)


def prep(df):
    df = df.copy()
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--folds', action='store_true')
    args = ap.parse_args()

    new = prep(pd.read_csv(ML_DIR / 'features.csv', low_memory=False))
    old = prep(pd.read_csv(OLD_CSV, low_memory=False))
    print(f'new {len(new):,} rows x {new.shape[1]} cols   old {len(old):,} x {old.shape[1]}')

    # The two files must be the SAME rows in the SAME order, or "corrected labels" would
    # silently also mean "different sample" and nothing below would be attributable.
    assert list(old.columns) == list(new.columns), 'column mismatch between old and new'
    assert (old['symbol'].values == new['symbol'].values).all() \
        and (old['date'].values == new['date'].values).all(), 'row alignment mismatch'
    print('row alignment verified: identical symbols and dates, same order\n')

    feats_v94 = [c for c in new.columns
                 if c not in EXCLUDE_COLS and new[c].dtype in (np.float64, np.int64)]
    feats_honest = [c for c in feats_v94 if c not in STAMPED]
    print(f'features: v9.4 {len(feats_v94)}, leakage-free {len(feats_honest)}')

    FOLDS = ([('2023-06-01', '2024-02-01'), ('2024-02-01', '2024-10-01'),
              ('2024-10-01', '2025-06-01'), ('2025-06-01', '2027-01-01')]
             if args.folds else [(None, None)])

    ARMS = [('v94-old', old, feats_v94),
            ('honest-old', old, feats_honest),
            ('honest-new', new, feats_honest)]

    rows = []
    for fold_start, fold_end in FOLDS:
        for head, (label, hz) in HEADS.items():
            # Cutoffs come from the OLD row population so the split geometry matches
            # history; the test ROWS are then restricted to genuinely-labelled ones.
            base_old = old.dropna(subset=[label])
            d_old = pd.to_datetime(base_old['date'])
            n = len(base_old)
            emb = pd.Timedelta(days=EMBARGO_DAYS)
            if fold_start is None:
                cut_tr = d_old.sort_values().iloc[int(n * 0.70)]
                cut_va = d_old.sort_values().iloc[int(n * 0.85)]
                test_mask = d_old >= cut_va
            else:
                cut_va = pd.Timestamp(fold_start)
                cut_tr = cut_va - pd.Timedelta(days=120)
                test_mask = (d_old >= cut_va) & (d_old < pd.Timestamp(fold_end))

            test_old = base_old[test_mask]                      # contaminated basis
            genuine = new.dropna(subset=[label]).set_index(['symbol', 'date']).index
            keep = pd.MultiIndex.from_arrays([test_old['symbol'], test_old['date']]).isin(genuine)
            test_new = test_old[keep]                            # corrected basis
            if len(test_new) < 300:
                print(f'  [{fold_start}] {head}: SKIP, only {len(test_new)} corrected test rows')
                continue

            fake_pct = 100 * (1 - len(test_new) / len(test_old))
            print(f'\n=== {head} ({hz}) fold {fold_start} — test {len(test_old):,} old / '
                  f'{len(test_new):,} corrected ({fake_pct:.1f}% fabricated) ===')

            for arm, data, feats in ARMS:
                sub = data.dropna(subset=[label])
                sd = pd.to_datetime(sub['date'])
                tr = sub[sd < (cut_tr - emb)]
                va = sub[(sd >= cut_tr) & (sd < (cut_va - emb))]
                if len(tr) < 500 or len(va) < 100:
                    print(f'  {arm:<12} SKIP (train={len(tr)}, val={len(va)})')
                    continue

                dtr = xgb.DMatrix(tr[feats], label=tr[label], weight=compute_sample_weights(tr))
                dva = xgb.DMatrix(va[feats], label=va[label])
                model = xgb.train(REG_PARAMS, dtr, num_boost_round=1000,
                                  obj=asymmetric_mse(),
                                  evals=[(dva, 'val')], early_stopping_rounds=50,
                                  verbose_eval=False)

                # Corrected basis: the honest number.
                pred_new = model.predict(xgb.DMatrix(test_new[feats]))
                ic_c, sd_c, nd_c = daily_ic(test_new['date'].values,
                                            test_new[label].values, pred_new)
                line = (f'  {arm:<12} train={len(tr):>6,}  IC(corrected)={ic_c:+.4f} '
                        f'(sd {sd_c:.3f}, {nd_c} days)')

                # Contaminated basis, for v94-old only: quantifies how far the recorded
                # anchor moves once fabricated labels stop counting.
                if arm == 'v94-old':
                    pred_old = model.predict(xgb.DMatrix(test_old[feats]))
                    ic_o, _, nd_o = daily_ic(test_old['date'].values,
                                             test_old[label].values, pred_old)
                    line += f'   IC(old basis)={ic_o:+.4f} -> shift {ic_c - ic_o:+.4f}'
                print(line)
                rows.append(dict(fold=fold_start, head=head, arm=arm, ic=ic_c,
                                 n_train=len(tr), n_test=len(test_new), fake_pct=fake_pct))

    res = pd.DataFrame(rows)
    if res.empty:
        print('\nno results'); return
    res.to_csv(OUT_DIR / 'v14_nulllabels_results.csv', index=False)

    print('\n' + '=' * 78)
    print('MEAN IC BY HEAD AND ARM (corrected basis)')
    piv = res.pivot_table(index='head', columns='arm', values='ic', aggfunc='mean')
    piv = piv[[c for c in ['v94-old', 'honest-old', 'honest-new'] if c in piv.columns]]
    print(piv.round(4).to_string())

    print('\nCANDIDATE vs CONTROLS (mean over head-folds, and head-folds won)')
    base = res[res.arm == 'honest-old'].set_index(['fold', 'head'])['ic']
    for arm in ['v94-old', 'honest-new']:
        a = res[res.arm == arm].set_index(['fold', 'head'])['ic']
        common = a.index.intersection(base.index)
        diff = (a.loc[common] - base.loc[common])
        print(f'  {arm:<12} vs honest-old: {diff.mean():+.4f}   '
              f'wins {int((diff > 0).sum())}/{len(diff)}')
    print(f'\nwrote {OUT_DIR / "v14_nulllabels_results.csv"}')


if __name__ == '__main__':
    main()
