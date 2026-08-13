#!/usr/bin/env python3
"""v15 — does ensembling raise IC? The one ungated lever on the backlog.

WHY THIS AND NOT MORE DATA. days-to-significance scales as (sd/IC)^2, so IC enters
quadratically while breadth enters weakly: the power budget (scratch_powerBudget.ts)
measured only 33.5% of 2W's daily-IC variance as sampling noise, capping the entire
more-symbols lever at ~32% fewer days even with infinite breadth. A 20% larger IC is
worth about the same and costs one training run. top-of-book-rank-stability already
recorded that averaging predictions beat every individual member at k=3; this tests that
claim under the production protocol, day-clustered, over 4 folds.

THE TRAP THIS SCRIPT IS BUILT AROUND. Production REG_PARAMS use subsample=1.0 and
colsample_bytree=1.0, which makes XGBoost deterministic — training N members that differ
only by `seed` would produce N IDENTICAL models, an ensemble that is arithmetically the
same as one model, and a confident null result that means nothing. Diversity therefore
has to be introduced deliberately (subsample/colsample < 1.0), and, more importantly,
VERIFIED: the script reports mean pairwise correlation between member predictions and
refuses to interpret an ensemble whose members are copies of each other.

ARMS, per head and fold
  single-prod   production params exactly, one model. The baseline to beat.
  single-bag    ONE bagged member. Separates "bagging changed the config" from
                "averaging several models helps" — without it, any ensemble gain could
                just be subsample=0.8 being a better hyperparameter.
  ens-3, ens-5  mean prediction over the first 3 / all 5 bagged members.
  best-member   the single best member in hindsight. Not deployable (it needs the test
                set to identify), but it bounds what member selection could ever buy and
                shows whether the ensemble beats picking a winner.

Deploys nothing. Writes only under src/ml/scratch/.

Usage:  python src/ml/scratch_v15_ensemble.py --folds
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
N_MEMBERS = 5

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
PROD_PARAMS = dict(objective='reg:squarederror', max_depth=8, eta=0.05, subsample=1.0,
                   colsample_bytree=1.0, eval_metric='rmse', seed=RANDOM_STATE)
# Diversity source. Row and column subsampling are what make `seed` actually bite; without
# them every member is byte-identical and the ensemble is vacuous.
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
    if len(ics) < 2:
        return float('nan')
    return float(np.mean(ics))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--folds', action='store_true')
    args = ap.parse_args()

    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)

    feats = [c for c in df.columns
             if c not in EXCLUDE_COLS and df[c].dtype in (np.float64, np.int64)
             and c not in STAMPED]
    print(f'{len(df):,} rows, {len(feats)} leakage-free features, {N_MEMBERS} members\n')

    FOLDS = ([('2023-06-01', '2024-02-01'), ('2024-02-01', '2024-10-01'),
              ('2024-10-01', '2025-06-01'), ('2025-06-01', '2027-01-01')]
             if args.folds else [(None, None)])

    rows, diversity = [], []
    for fold_start, fold_end in FOLDS:
        for head, (label, hz) in HEADS.items():
            base = df.dropna(subset=[label])
            d = pd.to_datetime(base['date'])
            n = len(base)
            emb = pd.Timedelta(days=EMBARGO_DAYS)
            if fold_start is None:
                cut_tr = d.sort_values().iloc[int(n * 0.70)]
                cut_va = d.sort_values().iloc[int(n * 0.85)]
                test_mask = d >= cut_va
            else:
                cut_va = pd.Timestamp(fold_start)
                cut_tr = cut_va - pd.Timedelta(days=120)
                test_mask = (d >= cut_va) & (d < pd.Timestamp(fold_end))

            test = base[test_mask]
            tr = base[d < (cut_tr - emb)]
            va = base[(d >= cut_tr) & (d < (cut_va - emb))]
            if len(test) < 300 or len(tr) < 500 or len(va) < 100:
                print(f'  [{fold_start}] {head}: SKIP')
                continue

            w = compute_sample_weights(tr)
            dtr = xgb.DMatrix(tr[feats], label=tr[label], weight=w)
            dva = xgb.DMatrix(va[feats], label=va[label])
            dte = xgb.DMatrix(test[feats])
            y, dates = test[label].values, test['date'].values

            def fit(params):
                m = xgb.train(params, dtr, num_boost_round=1000, obj=asymmetric_mse(),
                              evals=[(dva, 'val')], early_stopping_rounds=50,
                              verbose_eval=False)
                return m.predict(dte)

            p_prod = fit(PROD_PARAMS)
            members = [fit({**PROD_PARAMS, 'subsample': BAG_SUBSAMPLE,
                            'colsample_bytree': BAG_COLSAMPLE, 'seed': RANDOM_STATE + i})
                       for i in range(N_MEMBERS)]

            # VALIDITY CHECK. If members are near-identical the ensemble cannot help and
            # any null result would be an artefact of the setup, not a finding.
            corrs = [np.corrcoef(members[i], members[j])[0, 1]
                     for i in range(N_MEMBERS) for j in range(i + 1, N_MEMBERS)]
            mean_corr = float(np.mean(corrs))
            diversity.append(mean_corr)

            ic_prod = daily_ic(dates, y, p_prod)
            ic_bag = daily_ic(dates, y, members[0])
            ic_e3 = daily_ic(dates, y, np.mean(members[:3], axis=0))
            ic_e5 = daily_ic(dates, y, np.mean(members, axis=0))
            member_ics = [daily_ic(dates, y, m) for m in members]
            ic_best, ic_mean_member = float(np.max(member_ics)), float(np.mean(member_ics))

            print(f'{head} ({hz}) fold {fold_start}: prod={ic_prod:+.4f} bag1={ic_bag:+.4f} '
                  f'ens3={ic_e3:+.4f} ens5={ic_e5:+.4f} | members mean={ic_mean_member:+.4f} '
                  f'best={ic_best:+.4f} corr={mean_corr:.3f}')

            rows.append(dict(fold=fold_start, head=head, prod=ic_prod, bag1=ic_bag,
                             ens3=ic_e3, ens5=ic_e5, member_mean=ic_mean_member,
                             best_member=ic_best, member_corr=mean_corr))

    res = pd.DataFrame(rows)
    if res.empty:
        print('no results'); return
    res.to_csv(OUT_DIR / 'v15_ensemble_results.csv', index=False)

    print('\n' + '=' * 78)
    mc = float(np.mean(diversity))
    print(f'MEMBER DIVERSITY: mean pairwise prediction correlation {mc:.4f}')
    if mc > 0.995:
        print('  !! Members are effectively identical — the ensemble is vacuous and the')
        print('     numbers below mean nothing. Increase diversity before interpreting.')
    else:
        print('  Members are genuinely different, so the comparison below is meaningful.')

    print('\nMEAN IC BY HEAD')
    piv = res.groupby('head')[['prod', 'bag1', 'member_mean', 'ens3', 'ens5', 'best_member']].mean()
    print(piv.round(4).to_string())

    print('\nvs the production baseline (mean delta, head-folds won)')
    for col in ['bag1', 'member_mean', 'ens3', 'ens5', 'best_member']:
        dlt = res[col] - res['prod']
        print(f'  {col:<13} {dlt.mean():+.4f}   wins {int((dlt > 0).sum())}/{len(dlt)}')

    print('\nDoes averaging beat its own members? (ens5 - member_mean)')
    d2 = res['ens5'] - res['member_mean']
    print(f'  {d2.mean():+.4f}   wins {int((d2 > 0).sum())}/{len(d2)}')
    d3 = res['ens5'] - res['best_member']
    print(f'ens5 vs the BEST member in hindsight: {d3.mean():+.4f}   '
          f'wins {int((d3 > 0).sum())}/{len(d3)}')
    print(f'\nwrote {OUT_DIR / "v15_ensemble_results.csv"}')


if __name__ == '__main__':
    main()
