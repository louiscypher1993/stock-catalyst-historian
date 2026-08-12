"""
THE DEPLOYMENT QUESTION: if we pick pot settings using the study, what do we actually get?

Picking the best of N configurations returns the maximum of N noisy draws, so the winner's
in-sample score is an overestimate by construction. The only honest way to size that is to
select on one period and measure on another.

synthesis.csv carries skill_h1 / skill_h2 -- the same configs scored on the first and second
half of events. So: rank by h1, then read h2. The gap between "what the winner scored when
we picked it" and "what it delivered next" IS the shrinkage, and it is what a live pot
would actually inherit.
"""
import numpy as np
import pandas as pd
from pathlib import Path

D = Path(__file__).parent / 'scratch' / 'historic_pots'
TR = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
s = pd.read_csv(D / 'synthesis.csv')
print(f'configs: {len(s):,}\n')

h1, h2 = s['skill_h1'], s['skill_h2']
print(f'baseline    h1 median {h1.median():+.5f}   h2 median {h2.median():+.5f}')
print(f'            h1 best   {h1.max():+.5f}   h2 best   {h2.max():+.5f}')
print(f'rank corr (spearman) between halves: {s[["skill_h1","skill_h2"]].corr(method="spearman").iloc[0,1]:+.3f}\n')

print('=' * 74)
print('SELECT ON HALF 1 -> MEASURE ON HALF 2   (the honest out-of-sample estimate)')
print('=' * 74)
print(f'{"pick top":>10}{"h1 mean":>11}{"h2 mean":>11}{"retained":>10}{"h2 vs median":>14}')
print('-' * 74)
for k in [1, 5, 10, 25, 100, 500, 1000]:
    top = s.nlargest(k, 'skill_h1')
    a, b = top['skill_h1'].mean(), top['skill_h2'].mean()
    ret = (b / a * 100) if a else np.nan
    print(f'{k:>10}{a:>11.5f}{b:>11.5f}{ret:>9.0f}%{b - h2.median():>14.5f}')

print('\nreverse direction (select on h2 -> measure h1), as a symmetry check:')
for k in [1, 10, 100]:
    top = s.nlargest(k, 'skill_h2')
    a, b = top['skill_h2'].mean(), top['skill_h1'].mean()
    print(f'  top {k:>4}: h2 {a:+.5f} -> h1 {b:+.5f}  ({b/a*100 if a else float("nan"):.0f}% retained)')

print('\n' + '=' * 74)
print('DO THE TRAIT RANGES SURVIVE, EVEN IF THE EXACT CONFIG DOES NOT?')
print('=' * 74)
print('(select the best RANGE per trait on h1, then score that whole region on h2)')
best_h1 = s.nlargest(max(1, len(s) // 100), 'skill_h1')   # top 1% on h1
for t in TR:
    if t not in s.columns:
        continue
    vc = best_h1[t].value_counts(normalize=True).sort_index()
    dom = vc.idxmax()
    region = s[s[t] == dom]
    others = s[s[t] != dom]
    print(f'  {t:<14} h1-top1% favours {dom:>3}  ({100*vc.max():4.1f}% of winners)   '
          f'h2: in-region {region["skill_h2"].mean():+.5f}  vs rest {others["skill_h2"].mean():+.5f}  '
          f'{"HOLDS" if region["skill_h2"].mean() > others["skill_h2"].mean() else "FAILS"}')

print('\n' + '=' * 74)
print('WHAT A COMMITTEE BEATS: top-1 vs an average of the top-k (ensembling settings)')
print('=' * 74)
for k in [1, 5, 10, 25]:
    top = s.nlargest(k, 'skill_h1')
    print(f'  top-{k:<3} on h1 -> mean h2 skill {top["skill_h2"].mean():+.5f}   '
          f'median h2 {top["skill_h2"].median():+.5f}   worst member {top["skill_h2"].min():+.5f}')
