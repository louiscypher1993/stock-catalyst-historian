"""
Which RANGE of each pot characteristic is best -- alone, and conditional on the others?

Answers the deployment question, so it is built to resist the obvious trap: the best of
770,000 configurations is the maximum of 770,000 noisy draws, and picking it is selection
on noise. Three defences:

  1. MARGINALS over the whole sweep (each value averaged across every other setting), so a
     value has to be good broadly rather than in one lucky corner.
  2. PLATEAU rather than peak -- a range is only recommendable if its NEIGHBOURS are good
     too. An isolated spike is noise; a plateau is signal.
  3. TIME-SPLIT via synthesis.csv's skill_h1 / skill_h2 (first vs second half of events).
     Anything that does not hold in both halves is not a recommendation.

cov_alpha = cov(sign(decision), benchmark-neutral realised return), in percent. It is
size-neutral, so it measures DECISION quality, not leverage.
"""
import numpy as np
import pandas as pd
from pathlib import Path

D = Path(__file__).parent / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'focus', 'reactivity', 'opportunistic']
HOME = {0: '2D', 1: '2W', 2: '1M', 3: '3M', 4: '6M'}

df = pd.read_csv(D / 'fullsweep.csv.gz')
df['cov_pct'] = df['cov_alpha'] * 100
print(f'sweep: {len(df):,} configurations\n')

# ---------------------------------------------------------------- 1. degeneracy
# Values that are bit-identical in effect are not separate options. Detect by checking
# whether the whole cov vector is identical between adjacent values, holding all else.
print('=' * 78)
print('DEGENERACY — which values are genuinely distinct?')
print('=' * 78)
for t in TRAITS:
    others = [c for c in TRAITS if c != t]
    piv = df.pivot_table(index=others, columns=t, values='cov_alpha')
    vals = list(piv.columns)
    groups, cur = [], [vals[0]]
    for a, b in zip(vals, vals[1:]):
        if np.allclose(piv[a].values, piv[b].values, atol=1e-12):
            cur.append(b)
        else:
            groups.append(cur); cur = [b]
    groups.append(cur)
    desc = ', '.join('='.join(map(str, g)) for g in groups)
    print(f'  {t:<14} {len(groups):>2} distinct: {desc}')

# ---------------------------------------------------------------- 2. marginals
print('\n' + '=' * 78)
print('MARGINAL EFFECT of each value (mean cov_alpha % over all other settings)')
print('=' * 78)
marg = {}
for t in TRAITS:
    g = df.groupby(t)['cov_pct'].agg(['mean', 'std', 'count'])
    marg[t] = g
    best = g['mean'].idxmax()
    print(f'\n  {t}  (best single value: {best}, {g["mean"].max():+.4f}%)')
    line = '    '
    for v, r in g.iterrows():
        mark = ' *' if r['mean'] == g['mean'].max() else '  '
        line += f'{v}:{r["mean"]:+.3f}{mark}'
    print(line)

# ---------------------------------------------------------------- 3. plateaus
print('\n' + '=' * 78)
print('BEST CONTIGUOUS RANGE per trait (widest run whose every value beats the median)')
print('=' * 78)
ranges = {}
for t in TRAITS:
    m = marg[t]['mean']
    thresh = m.median()
    good = m[m > thresh].index.tolist()
    # longest contiguous run of "good" values
    runs, cur = [], [good[0]] if good else []
    for a, b in zip(good, good[1:]):
        if b == a + 1:
            cur.append(b)
        else:
            runs.append(cur); cur = [b]
    if cur:
        runs.append(cur)
    best_run = max(runs, key=lambda r: (m.loc[r].mean(), len(r))) if runs else []
    ranges[t] = best_run
    if best_run:
        print(f'  {t:<14} {best_run[0]}-{best_run[-1]:<3}  mean {m.loc[best_run].mean():+.4f}%  '
              f'(peak {m.idxmax()} at {m.max():+.4f}%)')

# ------------------------------------------------- 4. conditional on the others being good
print('\n' + '=' * 78)
print('CONDITIONAL: each trait re-measured with the OTHERS held in their best ranges')
print('=' * 78)
print('(marginals average over bad configs, which can hide or invent an effect)')
for t in TRAITS:
    mask = np.ones(len(df), dtype=bool)
    for o in TRAITS:
        if o != t and ranges[o]:
            mask &= df[o].isin(ranges[o]).values
    sub = df[mask]
    g = sub.groupby(t)['cov_pct'].mean()
    print(f'\n  {t}  (n={len(sub):,} configs)   best now: {g.idxmax()} at {g.max():+.4f}%')
    print('    ' + '  '.join(f'{v}:{x:+.3f}' for v, x in g.items()))

# ---------------------------------------------------------------- 5. interactions
print('\n' + '=' * 78)
print('INTERACTION: does the best value of one trait MOVE with another?')
print('=' * 78)
print('(spread = range of the optimal value of ROW across all COL settings; 0 = independent)')
rows = []
for a in TRAITS:
    for b in TRAITS:
        if a >= b:
            continue
        piv = df.pivot_table(index=a, columns=b, values='cov_pct', aggfunc='mean')
        argmax_per_col = piv.idxmax(axis=0)
        spread = argmax_per_col.max() - argmax_per_col.min()
        rows.append({'trait_a': a, 'trait_b': b, 'a_opt_spread': spread,
                     'gain': piv.values.max() - piv.values.mean()})
inter = pd.DataFrame(rows).sort_values('a_opt_spread', ascending=False)
print(inter.to_string(index=False))

# ---------------------------------------------------------------- 6. stability gate
print('\n' + '=' * 78)
print('TIME-SPLIT STABILITY (synthesis.csv, coarse 4-level grid, conviction included)')
print('=' * 78)
s = pd.read_csv(D / 'synthesis.csv')
r = np.corrcoef(s['skill_h1'], s['skill_h2'])[0, 1]
rs = s[['skill_h1', 'skill_h2']].corr(method='spearman').iloc[0, 1]
print(f'  config-level skill, half 1 vs half 2:  pearson {r:+.3f}   spearman {rs:+.3f}')
print(f'  (n={len(s):,} configs)')
for t in [c for c in TRAITS if c in s.columns]:
    g = s.groupby(t)[['skill_h1', 'skill_h2']].mean()
    agree = np.sign(g['skill_h1']) == np.sign(g['skill_h2'])
    print(f'\n  {t}: sign agreement across halves {agree.sum()}/{len(g)}')
    for v, row in g.iterrows():
        flag = '' if agree.loc[v] else '   <-- FLIPS'
        print(f'    {v}: h1={row["skill_h1"]:+.5f}  h2={row["skill_h2"]:+.5f}{flag}')

# ---------------------------------------------------------------- 7. top plateau configs
print('\n' + '=' * 78)
print('TOP CONFIGURATIONS — but scored by their NEIGHBOURHOOD, not their peak')
print('=' * 78)
idx = {t: {v: i for i, v in enumerate(sorted(df[t].unique()))} for t in TRAITS}
shape = tuple(len(idx[t]) for t in TRAITS)
cube = np.full(shape, np.nan)
cube[tuple(df[t].map(idx[t]).values for t in TRAITS)] = df['cov_pct'].values
# mean over the +/-1 neighbourhood in every trait dimension
from itertools import product
acc = np.zeros_like(cube); cnt = np.zeros_like(cube)
for shift in product([-1, 0, 1], repeat=len(TRAITS)):
    sh = cube.copy()
    for ax, s_ in enumerate(shift):
        if s_:
            sh = np.roll(sh, s_, axis=ax)
            sl = [slice(None)] * len(TRAITS)
            sl[ax] = 0 if s_ > 0 else -1
            sh[tuple(sl)] = np.nan
    m = ~np.isnan(sh)
    acc[m] += sh[m]; cnt[m] += 1
nbhd = acc / np.maximum(cnt, 1)
flat = nbhd.ravel()
order = np.argsort(flat)[::-1][:12]
print(f'{"boldness":>9}{"ambition":>9}{"patience":>9}{"focus":>7}{"react":>7}{"opp":>5}'
      f'{"nbhd%":>9}{"peak%":>9}  home')
for o in order:
    coords = np.unravel_index(o, shape)
    vals = {t: sorted(df[t].unique())[c] for t, c in zip(TRAITS, coords)}
    row = df[(df[TRAITS] == pd.Series(vals)).all(axis=1)].iloc[0]
    print(f'{vals["boldness"]:>9}{vals["ambition"]:>9}{vals["patience"]:>9}{vals["focus"]:>7}'
          f'{vals["reactivity"]:>7}{vals["opportunistic"]:>5}{flat[o]:>9.4f}{row["cov_pct"]:>9.4f}'
          f'  {HOME.get(int(row["home_horizon"]), "?")}')
