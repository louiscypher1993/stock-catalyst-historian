#!/usr/bin/env python3
"""
v10 DROP ablation. Retrains B/D1/D2/D3/D5 twice with IDENTICAL logic to
scratch_retrain_v94cand.py (row exclusion, temporal 70/85 split + 21d embargo,
sample weights, asymmetric-MSE, early stopping) on two feature sets:

  FULL   = v9.4's 72 cols (baseline reproduction)
  DROP16 = FULL minus 7 structurally-dead + 9 stale-premium features (56 cols)

Same rows per head (dropna on label only), same split, so FULL vs DROP16 is
apples-to-apples. Evaluates BOTH via booster.predict(iteration_range=(0,
best_iter+1)) -- the served path -- reporting test RMSE, MAE, and Spearman IC
(rank corr of prediction vs realized forward return). DROP16 candidates are
saved to scratch/; FULL is in-memory only. Nothing deploys.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error

ML_DIR = Path(__file__).parent
OUT_DIR = ML_DIR / 'scratch'
RANDOM_STATE = 42

EXCLUDE_COLS = [
    'cache_key', 'symbol', 'date', 'is_null_sample', 'label',
    'forward_return_1d', 'forward_return_1w', 'forward_return_1m',
    'forward_return_2d', 'forward_return_3d', 'forward_return_2w',
    'forward_return_3m', 'forward_return_6m', 'forward_return_12m',
    'max_favorable_excursion_1m', 'max_adverse_excursion_1m',
    'outperform_12m', 'is_event', 'sector_excess_return',
    'options_put_call_ratio',
]
ZERO_FILL_COLS = [
    'digital_exhaust_velocity_14d', 'gdelt_tone_z', 'dark_pool_index',
    'institutional_ownership_pct', 'put_call_ratio_t_minus_1',
    'short_interest_pct_float',
]
PRE_RETURN_COLS = [
    'pre_return_1d', 'pre_return_3d', 'pre_return_5d', 'pre_return_10d',
    'pre_return_21d', 'pre_vol_ratio_5d', 'pre_vol_ratio_10d',
]

DEAD7 = ['av_news_sentiment', 'congressional_net_flow_30d', 'ctb_velocity_7d',
         'iv_crush_pct', 'news_relevance_z', 'peer_average_return',
         'peer_contagion_delta']
PREMIUM9 = ['fmp_news_article_count_7d', 'fmp_news_sentiment_avg',
            'price_target_consensus', 'eps_surprise_pct', 'revenue_surprise_pct',
            'earnings_date_proximity_days', 'analyst_upgrades_30d',
            'analyst_downgrades_30d', 'price_target_upside_pct']
DROP16 = DEAD7 + PREMIUM9

REG_PARAMS = dict(objective='reg:squarederror', max_depth=8, eta=0.05,
                  subsample=1.0, colsample_bytree=1.0, eval_metric='rmse', seed=RANDOM_STATE)
ASYMMETRIC_ALPHA = 2.5
ASYMMETRIC_BETA = 1.0
HEADS = {
    'B':  ('forward_return_1m', 'model_b_v10drop16cand.json'),
    'D1': ('forward_return_3m', 'model_d1_v10drop16cand.json'),
    'D2': ('forward_return_6m', 'model_d2_v10drop16cand.json'),
    'D3': ('forward_return_2d', 'model_d3_v10drop16cand.json'),
    'D5': ('forward_return_2w', 'model_d5_v10drop16cand.json'),
}


def compute_sample_weights(df):
    vix_col = next((c for c in df.columns if 'vix' in c.lower()), None)
    vix = df[vix_col].fillna(20.0) if vix_col else pd.Series(20.0, index=df.index)
    vix_weight = 1.0 / vix.clip(lower=5.0); vix_weight = vix_weight / vix_weight.mean()
    liq = df.get('volume_ratio', pd.Series(1.0, index=df.index)).fillna(1.0)
    liq_weight = liq.clip(0.1, 10.0); liq_weight = liq_weight / liq_weight.mean()
    weight = vix_weight * liq_weight
    return (weight / weight.mean()).values


def asymmetric_mse(alpha=2.5, beta=1.0):
    def objective(y_pred, dtrain):
        y_true = dtrain.get_label(); error = y_pred - y_true
        grad = np.where(error > 0, alpha * error, beta * error)
        hess = np.where(error > 0, np.full_like(error, alpha), np.full_like(error, beta))
        return grad, hess
    return objective


def rmse(y_true, y_pred):
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))


def split_masks(sub, embargo_days=21):
    dates = pd.to_datetime(sub['date']); n = len(dates)
    sorted_dates = dates.sort_values()
    cutoff_train = sorted_dates.iloc[int(n * 0.70)]
    cutoff_val = sorted_dates.iloc[int(n * 0.85)]
    embargo = pd.Timedelta(days=embargo_days)
    train_mask = dates < (cutoff_train - embargo)
    val_mask = (dates >= cutoff_train) & (dates < (cutoff_val - embargo))
    test_mask = dates >= cutoff_val
    return train_mask.values, val_mask.values, test_mask.values


def train_and_eval(sub, feature_cols, label_col, save_path=None):
    tr, va, te = split_masks(sub)
    X = sub[feature_cols]; y = sub[label_col].values
    sw = compute_sample_weights(sub[tr])
    dtrain = xgb.DMatrix(X[tr], label=y[tr], weight=sw, feature_names=feature_cols)
    dval = xgb.DMatrix(X[va], label=y[va], feature_names=feature_cols)
    dtest = xgb.DMatrix(X[te], label=y[te], feature_names=feature_cols)
    booster = xgb.train(REG_PARAMS, dtrain, num_boost_round=1000,
                        obj=asymmetric_mse(ASYMMETRIC_ALPHA, ASYMMETRIC_BETA),
                        evals=[(dval, 'val')], early_stopping_rounds=50, verbose_eval=False)
    bi = booster.best_iteration
    preds = booster.predict(dtest, iteration_range=(0, bi + 1))
    yt = y[te]
    ic = float(pd.Series(preds).corr(pd.Series(yt), method='spearman'))
    if save_path:
        booster.save_model(str(save_path))
    return {'rmse': rmse(yt, preds), 'mae': float(mean_absolute_error(yt, preds)),
            'ic': ic, 'best_iter': int(bi), 'n_test': int(te.sum()), 'n_feat': len(feature_cols)}


def main():
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
    missing = [c for c in DROP16 if c not in full_cols]
    assert not missing, f'DROP16 features not in full set: {missing}'
    drop16_cols = [c for c in full_cols if c not in set(DROP16)]
    print(f'FULL={len(full_cols)} cols  DROP16={len(drop16_cols)} cols  (dropped {len(DROP16)})')

    rows = []
    print(f"\n{'head':<4} {'set':<7} {'nfeat':>5} {'best_it':>7} {'n_test':>7} "
          f"{'RMSE':>8} {'MAE':>8} {'IC':>8}   {'dIC':>8}")
    print('-' * 76)
    results = {}
    for name, (label_col, fn) in HEADS.items():
        sub = df.dropna(subset=[label_col]).reset_index(drop=True)
        full = train_and_eval(sub, full_cols, label_col, save_path=None)
        d16 = train_and_eval(sub, drop16_cols, label_col, save_path=OUT_DIR / fn)
        dic = d16['ic'] - full['ic']
        results[name] = {'full': full, 'drop16': d16, 'dIC': dic}
        print(f"{name:<4} {'FULL':<7} {full['n_feat']:>5} {full['best_iter']:>7} {full['n_test']:>7} "
              f"{full['rmse']:>8.4f} {full['mae']:>8.4f} {full['ic']:>8.4f}")
        print(f"{name:<4} {'DROP16':<7} {d16['n_feat']:>5} {d16['best_iter']:>7} {d16['n_test']:>7} "
              f"{d16['rmse']:>8.4f} {d16['mae']:>8.4f} {d16['ic']:>8.4f}   {dic:>+8.4f}")
    (OUT_DIR / 'scratch_v10_drop_ablation_results.json').write_text(json.dumps({
        'full_cols': full_cols, 'drop16_cols': drop16_cols, 'dropped': DROP16, 'results': results}, indent=2))
    print('\nWrote scratch/scratch_v10_drop_ablation_results.json')
    print('IC = Spearman rank corr(prediction, realized forward return) on held-out test.')
    print('dIC>0 => dropping HELPS ranking; dIC<0 => dropping costs ranking signal.')


if __name__ == '__main__':
    main()
