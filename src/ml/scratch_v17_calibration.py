#!/usr/bin/env python3
"""v17 — the calibration question v14 could not answer.

v14 found that correcting ~9,858 fabricated zero labels changed day-clustered IC by
-0.0028, i.e. nothing. But IC is a RANK correlation, and it is rank-invariant: a model
whose predictions are all shifted or compressed scores exactly the same IC. Every tier
decision the system actually makes is the opposite -- HORIZON_TIER_CONFIG's cutoffs are
ABSOLUTE numbers:

    D5 2W   STRONG_BUY >= 0.031582   BUY >= 0.024743   SELL <= -0.001411
    D3 2D   STRONG_BUY >= 0.010831                     SELL <= -0.004385
    D1 3M   STRONG_BUY >= 0.057568
    D2 6M   BUY        >  0.106656

So a model can be identically skilful by IC and still route a completely different set of
symbols to STRONG_BUY. Those cutoffs were calibrated on the v9.3 fold to land ~10% each
of STRONG_BUY / BUY / SELL and ~70% HOLD. Training on ~9,858 rows asserting "the outcome
was exactly 0%" is a systematic pull toward zero, which is precisely the kind of change
IC cannot see and these thresholds are maximally exposed to.

This measures the prediction DISTRIBUTION and the resulting TIER OCCUPANCY for
old-vs-corrected training, on the same fixed test fold. It answers two questions:
  1. does correcting labels move the distribution enough to matter, and
  2. are the deployed cutoffs still anywhere near their intended ~10/10/10/70 split?

Question 2 is worth asking regardless of the answer to 1 -- the cutoffs were fitted to a
v9.3 fold and have not been re-checked since.

Deploys nothing. Read-only.

Usage:  python src/ml/scratch_v17_calibration.py
"""
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

ML_DIR = Path(__file__).parent
OLD_CSV = Path(r'C:\Users\Lewis\AppData\Local\Temp\claude'
               r'\d--Projects-stock-catalyst-historian'
               r'\cedc837a-6594-4cda-a4ab-f3b79971424e\scratchpad'
               r'\features_backup_20260807.csv')
RANDOM_STATE = 42

# Cutoffs copied verbatim from PotService.ts HORIZON_TIER_CONFIG (v9.3 recalibration).
CUTS = {
    'D5': dict(label='forward_return_2w', sb=0.031582, buy=0.024743, sell=-0.001411),
    'D3': dict(label='forward_return_2d', sb=0.010831, buy=None,     sell=-0.004385),
    'D1': dict(label='forward_return_3m', sb=0.057568, buy=None,     sell=None),
    'D2': dict(label='forward_return_6m', sb=None,     buy=0.106656, sell=None),
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


def prep(df):
    df = df.copy()
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    return df


def tiers(p, c):
    """Reproduces resolveTierFromConfig's precedence: STRONG_BUY, then BUY, then SELL."""
    sb = np.zeros(len(p), bool) if c['sb'] is None else (p >= c['sb'])
    if c['buy'] is None:
        buy = np.zeros(len(p), bool)
    elif c['sb'] is None:
        buy = p > c['buy']
    else:
        buy = (p >= c['buy']) & (p < c['sb'])
    sell = np.zeros(len(p), bool) if c['sell'] is None else (p <= c['sell'])
    sell = sell & ~sb & ~buy
    hold = ~(sb | buy | sell)
    n = len(p)
    return dict(SB=100 * sb.sum() / n, BUY=100 * buy.sum() / n,
                SELL=100 * sell.sum() / n, HOLD=100 * hold.sum() / n)


def main():
    new = prep(pd.read_csv(ML_DIR / 'features.csv', low_memory=False))
    old = prep(pd.read_csv(OLD_CSV, low_memory=False))
    assert (old['symbol'].values == new['symbol'].values).all(), 'row alignment mismatch'
    feats = [c for c in new.columns
             if c not in EXCLUDE_COLS and new[c].dtype in (np.float64, np.int64)
             and c not in STAMPED]
    print(f'{len(new):,} rows, {len(feats)} leakage-free features\n')

    for head, c in CUTS.items():
        label = c['label']
        base_old = old.dropna(subset=[label])
        d = pd.to_datetime(base_old['date'])
        n = len(base_old)
        emb = pd.Timedelta(days=EMBARGO_DAYS)
        cut_tr = d.sort_values().iloc[int(n * 0.70)]
        cut_va = d.sort_values().iloc[int(n * 0.85)]
        test = base_old[d >= cut_va]
        genuine = new.dropna(subset=[label]).set_index(['symbol', 'date']).index
        test = test[pd.MultiIndex.from_arrays([test['symbol'], test['date']]).isin(genuine)]
        if len(test) < 300:
            print(f'{head}: SKIP ({len(test)} test rows)'); continue
        dte = xgb.DMatrix(test[feats])

        preds = {}
        for arm, data in (('old', old), ('new', new)):
            sub = data.dropna(subset=[label])
            sd = pd.to_datetime(sub['date'])
            tr = sub[sd < (cut_tr - emb)]
            va = sub[(sd >= cut_tr) & (sd < (cut_va - emb))]
            dtr = xgb.DMatrix(tr[feats], label=tr[label], weight=compute_sample_weights(tr))
            dva = xgb.DMatrix(va[feats], label=va[label])
            m = xgb.train(PROD_PARAMS, dtr, num_boost_round=1000, obj=asymmetric_mse(),
                          evals=[(dva, 'val')], early_stopping_rounds=50, verbose_eval=False)
            preds[arm] = m.predict(dte)

        print(f'=== {head} ({label})  test n={len(test):,} ===')
        cutstr = '  '.join(f'{k}={v}' for k, v in c.items() if k != 'label' and v is not None)
        print(f'  deployed cutoffs: {cutstr}')
        print(f'  {"arm":<5}{"p10":>9}{"p25":>9}{"median":>9}{"p75":>9}{"p90":>9}{"mean":>9}')
        for arm in ('old', 'new'):
            p = preds[arm]
            print(f'  {arm:<5}{np.percentile(p,10):>9.4f}{np.percentile(p,25):>9.4f}'
                  f'{np.median(p):>9.4f}{np.percentile(p,75):>9.4f}'
                  f'{np.percentile(p,90):>9.4f}{p.mean():>9.4f}')
        shift = preds['new'].mean() - preds['old'].mean()
        print(f'  mean shift (new - old): {shift:+.5f}')

        print(f'  {"arm":<5}{"STRONG_BUY":>12}{"BUY":>9}{"SELL":>9}{"HOLD":>9}   (target ~10/10/10/70)')
        occ = {}
        for arm in ('old', 'new'):
            t = tiers(preds[arm], c)
            occ[arm] = t
            print(f'  {arm:<5}{t["SB"]:>11.1f}%{t["BUY"]:>8.1f}%{t["SELL"]:>8.1f}%{t["HOLD"]:>8.1f}%')
        dsb = occ['new']['SB'] - occ['old']['SB']
        print(f'  STRONG_BUY occupancy change: {dsb:+.1f}pp')
        if abs(dsb) >= 3:
            print(f'  -> MATERIAL: the corrected model routes a visibly different share to STRONG_BUY.')
        else:
            print(f'  -> immaterial: label correction does not move tier routing.')
        worst = max(abs(occ['old'][k] - tgt) for k, tgt in
                    (('SB', 10), ('BUY', 10), ('SELL', 10)) if occ['old'][k] is not None)
        if worst >= 10:
            print(f'  !! DEPLOYED CUTOFFS ARE FAR OFF THEIR ~10% TARGET (worst {worst:.0f}pp) — '
                  f'independent of the label fix, these need refitting.')
        print()


if __name__ == '__main__':
    main()
