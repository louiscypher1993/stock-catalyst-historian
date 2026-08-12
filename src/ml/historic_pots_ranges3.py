"""
THE REAL CROSS-HORIZON CONFOUND.

cov_alpha = cov(sign(decision), realised return at horizon H). That covariance carries the
UNITS of the return, and a 3M return has several times the standard deviation of a 2W
return. So a 3M-home config scoring +2.29% against a 2W-home config's +1.24% may be no more
skilful at all -- it is betting on a noisier variable and the covariance scales with that
noise. Comparing raw cov across horizons is comparing apples to a bigger apple.

Two normalisations make them commensurable:
  * cov / sigma_H         -- unitless, correlation-like: skill per unit of risk taken
  * cov * (252 / days_H)  -- annualised: skill per unit of TIME the capital is tied up

Also re-checks maturity on the TEST COHORT specifically (the full events.csv is 100%
matured, so any maturity gap must live in the fold actually used by the sweep).
"""
import numpy as np
import pandas as pd
from pathlib import Path

D = Path(__file__).parent / 'scratch' / 'historic_pots'
HOME = {0: '2D', 1: '2W', 2: '1M', 3: '3M', 4: '6M'}
DAYS = {'2D': 2, '2W': 14, '1M': 30, '3M': 91, '6M': 182}

ev = pd.read_csv(D / 'events.csv')
print('cohorts:', ev['cohort'].value_counts().to_dict())

test = ev[ev['cohort'].astype(str).str.lower().str.contains('test')] if 'cohort' in ev else ev
if not len(test):
    test = ev
print(f'\n=== MATURITY ON THE SWEEP FOLD (n={len(test):,}) ===')
for h in ['2D', '2W', '1M', '3M', '6M']:
    c = f'actual_{h}'
    if c in test:
        ok = test[c].notna().sum()
        print(f'  {h:<3} matured {ok:>6,}/{len(test):,} = {100*ok/len(test):5.1f}%   '
              f'sigma={test[c].std():.4f}  mean={test[c].mean():+.4f}')

print('\n=== NORMALISED CROSS-HORIZON COMPARISON ===')
sig = {h: test[f'actual_{h}'].std() for h in DAYS if f'actual_{h}' in test}
df = pd.read_csv(D / 'fullsweep.csv.gz')
df['cov_pct'] = df['cov_alpha'] * 100
df['home_name'] = df['home_horizon'].map(HOME)

print(f'{"home":<5}{"n":>9}{"best raw%":>11}{"sigma":>9}{"cov/sigma":>11}{"annualised%":>13}{"trade_rate":>11}')
print('-' * 69)
rows = []
for h, name in HOME.items():
    sub = df[df['home_horizon'] == h]
    if not len(sub) or name not in sig:
        continue
    top = sub.nlargest(1, 'cov_pct').iloc[0]
    raw = top['cov_pct']
    norm = raw / (sig[name] * 100)
    ann = raw * (252 / DAYS[name])
    rows.append((name, len(sub), raw, sig[name], norm, ann, top['trade_rate']))
    print(f'{name:<5}{len(sub):>9,}{raw:>11.4f}{sig[name]:>9.4f}{norm:>11.4f}{ann:>13.2f}{top["trade_rate"]:>11.3f}')

print('\n  ranked by cov/sigma (skill per unit risk):')
for r in sorted(rows, key=lambda x: -x[4]):
    print(f'    {r[0]:<3} {r[4]:+.4f}')
print('\n  ranked by annualised (skill per unit time):')
for r in sorted(rows, key=lambda x: -x[5]):
    print(f'    {r[0]:<3} {r[5]:+.2f}%')

# median config per horizon, same normalisation -- the top config is a max over 154k draws,
# the median is what a randomly-chosen pot at that horizon actually gets.
print('\n=== MEDIAN (not best) CONFIG PER HORIZON — what a typical pot gets ===')
print(f'{"home":<5}{"median raw%":>13}{"cov/sigma":>11}{"annualised%":>13}')
print('-' * 42)
for h, name in HOME.items():
    sub = df[df['home_horizon'] == h]
    if not len(sub) or name not in sig:
        continue
    med = sub['cov_pct'].median()
    print(f'{name:<5}{med:>13.4f}{med/(sig[name]*100):>11.4f}{med*(252/DAYS[name]):>13.2f}')
