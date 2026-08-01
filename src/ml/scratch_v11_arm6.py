#!/usr/bin/env python3
"""ARM 6 — the decisive test: does the re-extracted history actually improve the model?

Two earlier attempts failed for structural reasons and must not be repeated:
  - v11-clean was confounded by FEATURE COUNT (14 price-only vs v9.4's 72).
  - v11-premium/v94-samerows was confounded by ERA: the overlap subset is 98.0%
    post-2021, i.e. almost entirely the population where the bug never applied, so it
    could not show benefit by construction.

This design removes both confounds by holding everything fixed except the training data:

  MODEL A (v9.4 data)   trains on features.csv
  MODEL B (v11 union)   trains on the re-extracted events, left-joined to the SAME
                        premium columns. Its 2021+ rows carry premium; its 235k
                        corrected pre-2021 rows carry NaN there (XGBoost handles NaN
                        natively, and this is exactly the production situation —
                        that data never existed and never can).

  IDENTICAL feature list for both.
  IDENTICAL evaluation: one fixed window, the SAME (symbol,date) rows, and ONE set of
  labels used for both models. For 2021+ the two label sources agree exactly anyway
  (verified: forward_return_2d/3m/6m reproduce at 0.00%), so using v11's labels
  introduces no bias toward either model.

So B - A is attributable to the training data and nothing else. The question it answers:
does adding 235,227 correctly-labelled pre-2021 events help heads that currently learn
from ~46k rows?

Usage:
  python src/ml/scratch_v11_arm6.py [--eval-start 2024-06-01]
"""
import argparse
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from scipy.stats import spearmanr

ML_DIR = Path(__file__).parent
ROOT = ML_DIR.parent.parent
OUT_DIR = ML_DIR / 'scratch'
OUT_DIR.mkdir(exist_ok=True)
RANDOM_STATE = 42
EMBARGO_DAYS = 21

HEADS = {'B': ('forward_return_1m', '1M'), 'D1': ('forward_return_3m', '3M'),
         'D2': ('forward_return_6m', '6M'), 'D3': ('forward_return_2d', '2D'),
         'D5': ('forward_return_2w', '2W')}
STAMPED = ['stocktwits_virality_z', 'price_target_consensus']
PRICE_COLS = ['excess_return', 'z_score', 'atr_shock_score', 'volume_ratio',
              'relative_volume_30d', 'body_to_range_ratio', 'overnight_gap_pct',
              'gap_fill_ratio', 'obv_delta_10d', 'dist_sma_50', 'dist_sma_200', 'rsi_14']
LABELS = ['forward_return_1m', 'forward_return_2d', 'forward_return_2w',
          'forward_return_3m', 'forward_return_6m']
EXCLUDE_COLS = ['cache_key', 'symbol', 'date', 'is_null_sample', 'label',
                'forward_return_1d', 'forward_return_1w', 'forward_return_3d',
                'forward_return_12m', 'max_favorable_excursion_1m',
                'max_adverse_excursion_1m', 'outperform_12m', 'is_event',
                'sector_excess_return', 'options_put_call_ratio'] + LABELS
ZERO_FILL = ['digital_exhaust_velocity_14d', 'gdelt_tone_z', 'dark_pool_index',
             'institutional_ownership_pct', 'put_call_ratio_t_minus_1',
             'short_interest_pct_float']
PRE_RET = ['pre_return_1d', 'pre_return_3d', 'pre_return_5d', 'pre_return_10d',
           'pre_return_21d', 'pre_vol_ratio_5d', 'pre_vol_ratio_10d']
REG_PARAMS = dict(objective='reg:squarederror', max_depth=8, eta=0.05, subsample=1.0,
                  colsample_bytree=1.0, eval_metric='rmse', seed=RANDOM_STATE)


def asym(alpha=2.5, beta=1.0):
    def obj(p, d):
        e = p - d.get_label()
        return (np.where(e > 0, alpha * e, beta * e),
                np.where(e > 0, np.full_like(e, alpha), np.full_like(e, beta)))
    return obj


def daily_ic(dates, y, p, min_per_day=8):
    df = pd.DataFrame({'d': pd.to_datetime(dates).values, 'y': y, 'p': p})
    ics = []
    for _, g in df.groupby('d'):
        if len(g) < min_per_day or g['y'].nunique() < 2 or g['p'].nunique() < 2:
            continue
        r = spearmanr(g['y'], g['p']).statistic
        if np.isfinite(r):
            ics.append(r)
    if len(ics) < 2:
        return float('nan'), float('nan'), len(ics), float('nan')
    ic, sd, n = float(np.mean(ics)), float(np.std(ics, ddof=1)), len(ics)
    return ic, sd, n, (ic / (sd / np.sqrt(n)) if sd > 0 else float('nan'))


def weights(df, half_life=None, ref=None):
    """v9.4's vix/liquidity weighting, optionally multiplied by exponential RECENCY decay.

    Arm 6 showed D1 (3M) regressing when 235k mostly-old rows are added, while the
    2-day and 2-week heads were unaffected — consistent with sixty years of regime
    variation diluting recent structure at longer horizons. `half_life` (in years) is
    the lever: a row `h` years older than the training cutoff gets weight 0.5**(h/half_life),
    so old data still contributes but cannot dominate. None = flat, i.e. arm 6's behaviour.
    """
    v = next((c for c in df.columns if 'vix' in c.lower()), None)
    vix = df[v].fillna(20.0) if v else pd.Series(20.0, index=df.index)
    vw = 1.0 / vix.clip(lower=5.0); vw /= vw.mean()
    lw = df.get('volume_ratio', pd.Series(1.0, index=df.index)).fillna(1.0).clip(0.1, 10.0)
    lw /= lw.mean()
    w = vw * lw
    if half_life:
        age_years = (pd.Timestamp(ref) - pd.to_datetime(df['date'])).dt.days / 365.25
        rw = np.power(0.5, age_years.clip(lower=0) / half_life)
        w = w * rw
    return (w / w.mean()).values


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--eval-start', default='2024-06-01')
    ap.add_argument('--windows', default=None,
                    help='comma-separated eval starts; repeats the whole sweep on each '
                         'and aggregates, so no single window decides')
    ap.add_argument('--sweep', action='store_true',
                    help='sweep recency weighting to test whether D1 recovers without losing B')
    ap.add_argument('--subtract', action='store_true',
                    help='SUBTRACTION test: v9.4 data with the corrupt rows REMOVED rather '
                         'than replaced by the union')
    args = ap.parse_args()

    leg = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    leg['date'] = leg['date'].astype(str).str[:10]
    leg['is_us_listed'] = leg['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0).astype(int)

    null_ind = [c for c in leg.columns if c.endswith('_is_null')]
    obj = [c for c in leg.columns if not pd.api.types.is_numeric_dtype(leg[c])]
    drop = set(EXCLUDE_COLS) | set(null_ind) | set(ZERO_FILL) | set(PRE_RET) | set(obj) | set(STAMPED)
    FEATS = [c for c in leg.columns if c not in drop]
    premium_only = [c for c in FEATS if c not in PRICE_COLS]
    print(f'shared feature list: {len(FEATS)} ({len(PRICE_COLS)} price + {len(premium_only)} premium/context)')

    con = sqlite3.connect(f'file:{ROOT / "market_cache.db"}?mode=ro', uri=True)
    v11 = pd.read_sql_query(
        f"""SELECT symbol, date, {','.join(PRICE_COLS)}, {','.join(LABELS)}
            FROM training_events_v11 WHERE price_source='daily_reextract'""", con)
    con.close()
    v11['date'] = v11['date'].astype(str).str[:10]

    # MODEL B data: corrected price features + labels, premium left-joined where it exists
    v11b = v11.merge(leg[['symbol', 'date'] + premium_only], on=['symbol', 'date'], how='left')
    for c in FEATS:
        if c not in v11b.columns:
            v11b[c] = np.nan
    # v9.4 outlier hygiene on both
    for d in (leg, v11b):
        pass
    legA = leg[~((leg['overnight_gap_pct'].abs() >= 1.0) | (leg['excess_return'].abs() > 10))].reset_index(drop=True)
    v11B = v11b[~((v11b['overnight_gap_pct'].abs() >= 1.0) | (v11b['excess_return'].abs() > 10))].reset_index(drop=True)
    print(f'MODEL A (v9.4 data)  : {len(legA):,} rows')
    print(f'MODEL B (v11 union)  : {len(v11B):,} rows '
          f'({(v11B["date"] < "2021-01-01").sum():,} pre-2021 corrected)')

    windows = [w.strip() for w in args.windows.split(',')] if args.windows else [args.eval_start]
    all_rows = []
    for EVAL in windows:
        all_rows.extend(run_window(EVAL, legA, v11B, FEATS, args))

    out = pd.DataFrame(all_rows)
    fn = ('v11_arm6_subtract.csv' if args.subtract
          else 'v11_arm6_sweep.csv' if args.sweep else 'v11_arm6_results.csv')
    out.to_csv(OUT_DIR / fn, index=False)
    print(f'\nwrote {OUT_DIR / fn}')
    if out.empty:
        return

    schemes = [s for s in ['A v9.4', 'A -pre2021', 'A -nonevent', 'A -both',
                           'B flat', 'B hl=10y', 'B hl=5y', 'B hl=3y', 'B >=2010',
                           'B v11-union'] if s in set(out['model'])]
    for w in windows:
        sub = out[out['window'] == w]
        if sub.empty:
            continue
        piv = sub.pivot_table(index='head', columns='model', values='ic')
        piv = piv[[s for s in schemes if s in piv.columns]].reindex([h for h in HEADS if h in piv.index])
        atr = sub[sub['model'] == 'A v9.4']['train'].max()
        print(f'\n--- window >= {w}   (model A trained on {atr:,} rows) ---')
        print(piv.round(4).to_string())

    # AGGREGATE — the point of running several windows. A scheme that only wins on one
    # window is fitting to that window; what matters is consistency across all of them.
    print('\n' + '=' * 78)
    print(f'AGGREGATE ACROSS {len(windows)} WINDOWS — mean IC per head and scheme')
    agg = out.pivot_table(index='head', columns='model', values='ic', aggfunc='mean')
    agg = agg[[s for s in schemes if s in agg.columns]].reindex([h for h in HEADS if h in agg.index])
    print(agg.round(4).to_string())

    if 'A v9.4' in agg.columns:
        base = agg['A v9.4']
        print(f"\n{'scheme':<12}{'heads better':>13}{'mean delta':>12}"
              f"{'windows won':>13}{'D1':>9}{'B':>9}{'D5(live)':>10}")
        print('-' * 78)
        for m in schemes:
            if m == 'A v9.4':
                continue
            d = agg[m] - base
            # count windows where this scheme beats v9.4 on mean-across-heads
            wins = 0
            for w in windows:
                s = out[out['window'] == w].pivot_table(index='head', columns='model', values='ic')
                if m in s.columns and 'A v9.4' in s.columns:
                    wins += int((s[m] - s['A v9.4']).mean() > 0)
            print(f'{m:<12}{int((d > 0.005).sum()):>8}/{len(d):<4}{d.mean():>+12.4f}'
                  f'{wins:>8}/{len(windows):<4}{agg.loc["D1", m]:>+9.4f}'
                  f'{agg.loc["B", m]:>+9.4f}{agg.loc["D5", m]:>+10.4f}')
        print(f'{"A v9.4":<12}{"—":>13}{"—":>12}{"—":>13}'
              f'{base["D1"]:>+9.4f}{base["B"]:>+9.4f}{base["D5"]:>+10.4f}')


def run_window(EVAL, legA, v11B, FEATS, args):
    cut = pd.Timestamp(EVAL) - pd.Timedelta(days=EMBARGO_DAYS)
    # EVALUATION SET: rows both datasets contain, in the fixed window, one label source
    keys = v11B[v11B['date'] >= EVAL][['symbol', 'date']].drop_duplicates()
    ev = keys.merge(legA[['symbol', 'date']].drop_duplicates(), on=['symbol', 'date'], how='inner')
    print(f'\neval window >= {EVAL}: {len(ev):,} common events '
          f'({ev["date"].min()} -> {ev["date"].max()})')

    evalB = v11B.merge(ev, on=['symbol', 'date'], how='inner').reset_index(drop=True)
    evalA = legA.merge(ev, on=['symbol', 'date'], how='inner').reset_index(drop=True)
    # order both identically so predictions align row-for-row
    evalB = evalB.sort_values(['date', 'symbol']).reset_index(drop=True)
    evalA = evalA.sort_values(['date', 'symbol']).reset_index(drop=True)
    assert (evalA['symbol'].values == evalB['symbol'].values).all(), 'eval row misalignment'
    assert (evalA['date'].values == evalB['date'].values).all(), 'eval row misalignment'

    # SUBTRACTION. Both arms compared so far are flawed: `A v9.4` still CONTAINS the
    # 16,435 monthly-bar rows (wrong price features, wrong B/C labels) plus ~5,000
    # non-events mislabelled is_null_sample=0, while `B union` ADDS 235k old rows that
    # D1 and D3 measurably do not want. Nobody has tried simply REMOVING what is broken
    # — which keeps the recent-data concentration D1 prefers while deleting exactly what
    # was proven corrupt. Motivated by two findings pointing the same way: B improves
    # whenever corrupt 1M labels are dropped, and D1/D3 prefer recent data.
    if args.subtract:
        # a row flagged as a REAL event cannot have |z| below the engine's own 1.80
        # adaptive floor — those are injected non-events whose flag failed to persist
        zc = 'z_score' if 'z_score' in legA.columns else None
        bad_ne = ((legA['is_null_sample'] == 0) & (legA[zc].abs() < 1.80)) if zc else pd.Series(False, index=legA.index)
        pre21 = legA['date'] < '2021-01-01'
        A_no_pre = legA[~pre21].reset_index(drop=True)
        A_no_ne = legA[~bad_ne].reset_index(drop=True)
        A_clean = legA[~(pre21 | bad_ne)].reset_index(drop=True)
        print(f'subtraction: full {len(legA):,} | -pre2021 {len(A_no_pre):,} '
              f'| -nonevents {len(A_no_ne):,} (removed {int(bad_ne.sum()):,}) '
              f'| -both {len(A_clean):,}')
        variants = [('A v9.4', legA, evalA, None),
                    ('A -pre2021', A_no_pre, evalA, None),
                    ('A -nonevent', A_no_ne, evalA, None),
                    ('A -both', A_clean, evalA, None),
                    ('B >=2010', v11B[v11B['date'] >= '2010-01-01'].reset_index(drop=True), evalB, None)]
    # One weighting scheme is applied across ALL five heads and scored on the SAME fold.
    # Picking a different dataset per head would just overfit this one window.
    elif args.sweep:
        v11_2010 = v11B[v11B['date'] >= '2010-01-01'].reset_index(drop=True)
        print(f'sweep: recency half-lives + a hard 2010 cutoff ({len(v11_2010):,} rows)')
        variants = [('A v9.4', legA, evalA, None),
                    ('B flat', v11B, evalB, None),
                    ('B hl=10y', v11B, evalB, 10.0),
                    ('B hl=5y', v11B, evalB, 5.0),
                    ('B hl=3y', v11B, evalB, 3.0),
                    ('B >=2010', v11_2010, evalB, None)]
    else:
        variants = [('A v9.4', legA, evalA, None), ('B v11-union', v11B, evalB, None)]

    rows = []
    print(f"\n[window >= {EVAL}] "
          f"{'head':<5}{'model':<14}{'train':>9}{'IC':>10}{'t':>8}{'days':>6}")
    print('-' * 66)
    for h, (label, hz) in HEADS.items():
        # ONE label vector, from v11, used to score BOTH models
        y = evalB[label].values
        ok = np.isfinite(y)
        if ok.sum() < 200:
            print(f'{h:<5}{hz:<4} skipped — only {int(ok.sum())} labelled eval rows'); continue
        ev_dates = evalB['date'].values[ok]
        y = y[ok]

        res_h = {}
        for tag, train_df, eval_df, hl in variants:
            tr = train_df[(pd.to_datetime(train_df['date']) < cut)].dropna(subset=[label])
            if len(tr) < 500:
                print(f'{h:<5}{hz:<4}{tag:<14} skipped — {len(tr)} train rows'); continue
            dtr = xgb.DMatrix(tr[FEATS], label=tr[label],
                              weight=weights(tr, hl, cut), feature_names=FEATS)
            bst = xgb.train(REG_PARAMS, dtr, num_boost_round=400, obj=asym(),
                            verbose_eval=False)
            pred = bst.predict(xgb.DMatrix(eval_df[FEATS], feature_names=FEATS))[ok]
            ic, sd, nd, t = daily_ic(ev_dates, y, pred)
            res_h[tag] = ic
            rows.append(dict(window=EVAL, head=h, horizon=hz, model=tag, half_life=hl,
                             train=len(tr), eval=int(ok.sum()), ic=ic, ic_t=t, ic_days=nd))
            print(f'{"":<16}{h:<5}{tag:<14}{len(tr):>9,}{ic:>+10.4f}{t:>+8.2f}{nd:>6}')
    return rows


if __name__ == '__main__':
    main()
