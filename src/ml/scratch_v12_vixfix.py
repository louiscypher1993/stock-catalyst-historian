#!/usr/bin/env python3
"""v12 fix 2 — stop a MISSING VIX from being encoded as a real "low" regime.

MEASURED DEFECT (from features.csv, not estimated):
    vix_regime                  0      1
    has VIX                 13587  16401
    vix_close == 0 (missing) 36846      0
36,846 rows (55.1%) have no usable VIX, and EVERY one of them lands in regime 0 —
"low volatility" — while only 384 carry the vix_regime_is_null flag. So 36,462 rows tell
the model "volatility was low" when the truth is "we had no volatility reading at all".

Why that is worse than ordinary missing data: the missingness is not random. Four of the
seven regional volatility tickers are dead on Yahoo, so whether a row has a VIX is mostly
a function of WHERE the stock is listed. A model reading regime 0 is therefore partly
reading geography while appearing to read volatility — the same class of defect as the
commodity term that was present after 2021-06 and absent before, and as the benchmark
that silently zeroes on Asian rows.

THE FIX is deliberately minimal and makes no claim to recover the missing data:
  - where vix_close == 0, vix_regime becomes NaN (XGBoost handles NaN natively and can
    split on absence) instead of the false 0
  - vix_regime_is_null is set to 1 on those rows so absence is explicit
  - vix_close itself is left alone; the arm changes one thing

The vocabulary half of the defect (the encoder maps only low/moderate/high and silently
drops 'elevated'/'extreme') is NOT addressed here — that needs the raw regime string out
of features_json and would be a second, separately-attributable change.

Usage:
  python src/ml/scratch_v12_vixfix.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

ML_DIR = Path(__file__).parent
OUT = ML_DIR / 'scratch'
OUT.mkdir(exist_ok=True)


def main():
    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    n = len(df)
    missing = df['vix_close'] == 0

    print(f'features.csv: {n:,} rows')
    print(f'  vix_close == 0 (no usable reading) : {int(missing.sum()):,} '
          f'({100*missing.mean():.1f}%)')
    falsely_low = int((missing & (df['vix_regime'] == 0)).sum())
    already_flagged = int((missing & (df['vix_regime_is_null'] == 1)).sum())
    print(f'  of those, encoded as regime 0="low": {falsely_low:,}')
    print(f'  of those, already flagged null     : {already_flagged:,}')
    print(f'  -> rows asserting a false "low"    : {falsely_low - already_flagged:,}')

    # is the missingness geographic? that is what makes it a proxy rather than noise
    df['suffix'] = df['symbol'].astype(str).str.upper().apply(
        lambda s: s[s.rfind('.'):] if '.' in s else 'US')
    g = df.groupby('suffix').agg(rows=('vix_close', 'size'),
                                 missing=('vix_close', lambda c: (c == 0).mean()))
    g = g[g['rows'] >= 400].sort_values('missing', ascending=False)
    print('\n  missing-VIX rate by market (>=400 rows) — if this varies wildly, regime 0')
    print('  is partly a geography label:')
    for suf, r in g.head(6).iterrows():
        print(f'     {suf:<6} {int(r["rows"]):>7,} rows   {100*r["missing"]:>5.1f}% missing')
    print('     ...')
    for suf, r in g.tail(3).iterrows():
        print(f'     {suf:<6} {int(r["rows"]):>7,} rows   {100*r["missing"]:>5.1f}% missing')

    fixed = df.drop(columns=['suffix']).copy()
    fixed.loc[missing, 'vix_regime'] = np.nan
    fixed.loc[missing, 'vix_regime_is_null'] = 1
    path = OUT / 'features_vixfix.csv'
    fixed.to_csv(path, index=False)
    print(f'\nrewrote vix_regime -> NaN and vix_regime_is_null -> 1 on '
          f'{int(missing.sum()):,} rows')
    print(f'wrote {path}')


if __name__ == '__main__':
    main()
