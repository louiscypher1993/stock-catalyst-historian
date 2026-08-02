#!/usr/bin/env python3
"""Compose the two v12 corrections into one arm.

The fixes touch disjoint columns, so composing them is exact rather than approximate:
  async-close fix  ->  excess_return, z_score
  VIX fix          ->  vix_regime, vix_regime_is_null

Evaluated alongside the individual arms, this answers whether the two interact — a
combined effect that is not roughly the sum of the parts would itself be a finding.

Usage:
  python src/ml/scratch_v12_combine.py
"""
from pathlib import Path

import numpy as np
import pandas as pd

ML_DIR = Path(__file__).parent
OUT = ML_DIR / 'scratch'

base = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
async_f = pd.read_csv(OUT / 'features_asyncfix.csv', low_memory=False)
vix_f = pd.read_csv(OUT / 'features_vixfix.csv', low_memory=False)

for name, d in (('async', async_f), ('vix', vix_f)):
    if len(d) != len(base):
        raise SystemExit(f'{name} file has {len(d):,} rows, base has {len(base):,} — '
                         'row alignment is required for a column-wise compose')

combined = base.copy()
combined['excess_return'] = async_f['excess_return'].values
combined['z_score'] = async_f['z_score'].values
combined['vix_regime'] = vix_f['vix_regime'].values
combined['vix_regime_is_null'] = vix_f['vix_regime_is_null'].values

ch_async = int(np.nansum(np.abs(base['excess_return'].values
                                - async_f['excess_return'].values) > 1e-12))
ch_vix = int((base['vix_regime'].values != vix_f['vix_regime'].values).sum())
print(f'rows changed by async fix : {ch_async:,}')
print(f'rows changed by vix fix   : {ch_vix:,}')
overlap = int(np.nansum((np.abs(base['excess_return'].values
                                - async_f['excess_return'].values) > 1e-12)
                        & (base['vix_regime'].values != vix_f['vix_regime'].values)))
print(f'rows touched by BOTH      : {overlap:,}')

path = OUT / 'features_bothfix.csv'
combined.to_csv(path, index=False)
print(f'\nwrote {path}')
