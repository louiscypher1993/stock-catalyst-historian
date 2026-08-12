"""
Two corrections to the naive range read.

(A) MATURITY CONFOUND. cov_alpha is computed only over events whose chosen horizon has
    MATURED. Long horizons mature for fewer events, and the ones that do are systematically
    the EARLIER events -- so a 6M-home config and a 2W-home config are scored on different
    samples from different periods. Ranking them against each other is not like-for-like.

(B) AMBITION AND REACTIVITY ARE NOT INDEPENDENT. The engine uses them only as the ratio
    ambition/reactivity (threshold = H_BASE[H] * ambition / reactivity). Conditioning one on
    the other's marginal-best range therefore gives a misleading answer -- which is exactly
    why the marginal said reactivity 2 and the conditional said reactivity 7.
"""
import numpy as np
import pandas as pd
from pathlib import Path

D = Path(__file__).parent / 'scratch' / 'historic_pots'
HOME = {0: '2D', 1: '2W', 2: '1M', 3: '3M', 4: '6M'}

ev = pd.read_csv(D / 'events.csv')
print('events.csv columns:', list(ev.columns)[:14])
acts = [c for c in ev.columns if c.startswith('actual_')]
print(f'\n=== (A) MATURITY BY HORIZON (n={len(ev):,} events) ===')
for c in acts:
    ok = ev[c].notna().sum()
    print(f'  {c:<16} matured {ok:>6,} / {len(ev):,} = {100*ok/len(ev):5.1f}%')
if acts:
    print('\n  -> configs routing to a low-maturity horizon are scored on a SMALLER and')
    print('     EARLIER subsample. Cross-horizon comparison of cov_alpha is not like-for-like.')

df = pd.read_csv(D / 'fullsweep.csv.gz')
df['cov_pct'] = df['cov_alpha'] * 100
df['home_name'] = df['home_horizon'].map(HOME)

print(f'\n=== (B) AMBITION / REACTIVITY AS A RATIO ===')
df['ratio'] = df['ambition'] / df['reactivity']
q = pd.qcut(df['ratio'], 10, duplicates='drop')
g = df.groupby(q, observed=True)['cov_pct'].agg(['mean', 'count'])
print('  ratio decile          mean cov%      n')
for k, r in g.iterrows():
    print(f'  {str(k):<22}{r["mean"]:+8.4f}  {int(r["count"]):>7,}')
best_ratio = g['mean'].idxmax()
print(f'\n  best ratio band: {best_ratio}  ({g["mean"].max():+.4f}%)')
print('  NOTE: threshold = H_BASE * ambition/reactivity, so LOW ratio = low bar = trades more.')

print('\n=== TOP CONFIGS WITHIN EACH HOME HORIZON (like-for-like) ===')
for h in sorted(df['home_horizon'].unique()):
    sub = df[df['home_horizon'] == h]
    if not len(sub):
        continue
    top = sub.nlargest(1, 'cov_pct').iloc[0]
    print(f'\n  home {HOME[int(h)]:<3} (n={len(sub):,} configs)  best cov {top["cov_pct"]:+.4f}%  '
          f'trade_rate {top["trade_rate"]:.3f}')
    print(f'    bold={int(top["boldness"])} amb={int(top["ambition"])} pat={int(top["patience"])} '
          f'foc={int(top["focus"])} react={int(top["reactivity"])} opp={int(top["opportunistic"])}  '
          f'ratio={top["ambition"]/top["reactivity"]:.2f}')
    print(f'    median config at this home: {sub["cov_pct"].median():+.4f}%   '
          f'top decile: {sub["cov_pct"].quantile(0.9):+.4f}%')

print('\n=== RESTRICTED TO HIGH-MATURITY HOMES (2D / 2W / 1M) ===')
hm = df[df['home_horizon'].isin([0, 1, 2])]
print(f'  n={len(hm):,} configs')
TR = ['boldness', 'ambition', 'patience', 'focus', 'reactivity', 'opportunistic']
for t in TR:
    g2 = hm.groupby(t)['cov_pct'].mean()
    print(f'  {t:<14} best {g2.idxmax():>2} ({g2.max():+.4f}%)   ' +
          ' '.join(f'{v}:{x:+.2f}' for v, x in g2.items()))
top = hm.nlargest(8, 'cov_pct')
print('\n  top 8 high-maturity configs:')
print(top[TR + ['cov_pct', 'trade_rate', 'home_name']].to_string(index=False))
