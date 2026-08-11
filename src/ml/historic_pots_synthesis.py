#!/usr/bin/env python3
"""HISTORIC POTS — synthesis: which characteristics, which horizons, which combinations.

Ranks by SELECTION ALPHA (real minus permutation null) and Sharpe, never by raw return —
raw return is dominated by exposure and horizon scale, which is the trap that made
conviction and patience look like skill in the first pass.

Cells (a combination's value-tuple) are ranked by the MEAN over the pots in them, not by
their best member: with 16,384 pots the single best is a selection artefact, whereas a
cell mean over 64-4,096 pots is far more robust.

Adds two things nothing else covered:
  * HORIZON MIX per trait — which horizons each trait level actually chooses, so the
    trait findings and the horizon findings can be reconciled rather than read separately.
  * TIME-SPLIT STABILITY — the test fold cut in half by date, with per-event decision
    skill recomputed on each half. A "best combination" that flips between halves is a
    fitting artefact, and this project's standing method rule demands that check before
    any configuration claim.
"""
import itertools
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
HORIZONS = ['2D', '2W', '1M', '3M', '6M']
ROW_CHUNK = 1024


def main():
    p = pd.read_csv(OUT / 'portfolio2.csv')
    print(f'pots: {len(p):,}\n')

    print('=' * 90)
    print('1. SINGLE CHARACTERISTICS  (selection alpha = real minus permuted null)')
    print('=' * 90)
    print(f'{"trait":<15}{"level":>6}{"sel-alpha":>12}{"Sharpe":>9}{"exposure":>10}{"raw ret":>10}')
    for t in TRAITS:
        g = p.groupby(t)[['selection_alpha', 'sharpe', 'exposure', 'total_return']].mean()
        for lvl, r in g.iterrows():
            print(f'{t if lvl == g.index[0] else "":<15}{lvl:>6}{r["selection_alpha"]:>+12.2%}'
                  f'{r["sharpe"]:>9.2f}{r["exposure"]:>10.1%}{r["total_return"]:>+10.2%}')
        print()

    # ---- combinations, ranked by cell-mean selection alpha ----------------------
    for k in (2, 3, 4):
        rows = []
        for combo in itertools.combinations(TRAITS, k):
            g = p.groupby(list(combo))[['selection_alpha', 'sharpe', 'exposure', 'total_return']].agg(
                ['mean', 'count'])
            for key, r in g.iterrows():
                rows.append({
                    'combo': '+'.join(combo),
                    'values': '/'.join(str(v) for v in (key if isinstance(key, tuple) else (key,))),
                    'sel_alpha': r[('selection_alpha', 'mean')],
                    'sharpe': r[('sharpe', 'mean')],
                    'exposure': r[('exposure', 'mean')],
                    'raw_return': r[('total_return', 'mean')],
                    'n_pots': int(r[('selection_alpha', 'count')]),
                })
        df = pd.DataFrame(rows).sort_values('sel_alpha', ascending=False)
        df.to_csv(OUT / f'synth_combo_{k}.csv', index=False)
        print('=' * 90)
        print(f'{k}-CHARACTERISTIC COMBINATIONS — top 10 by mean selection alpha')
        print('=' * 90)
        print(df.head(10).to_string(index=False, float_format=lambda v: f'{v:,.3f}'))
        print(f'\n  ...and the WORST 3:')
        print(df.tail(3).to_string(index=False, float_format=lambda v: f'{v:,.3f}'))
        print()

    # ---- horizon mix per trait ---------------------------------------------------
    print('=' * 90)
    print('2. HORIZON MIX — which horizons each trait level actually chooses (test fold)')
    print('=' * 90)
    ev = pd.read_csv(OUT / 'events.csv')
    tf = (ev['cohort'] == 'testfold').to_numpy()
    hor = np.load(OUT / 'horizon.npy', mmap_mode='r')
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    n_pots = len(p)
    mix = np.zeros((n_pots, 5))
    for lo in range(0, n_pots, ROW_CHUNK):
        hi = min(lo + ROW_CHUNK, n_pots)
        h = np.asarray(hor[lo:hi][:, tf])
        a = np.asarray(act[lo:hi][:, tf])
        traded = a == 1
        for hh in range(5):
            mix[lo:hi, hh] = ((h == hh) & traded).sum(1)
    tot = mix.sum(1, keepdims=True)
    share = mix / np.maximum(tot, 1)
    for i, h in enumerate(HORIZONS):
        p[f'mix_{h}'] = share[:, i]

    for t in ['opportunistic', 'patience', 'boldness']:
        print(f'\n  by {t}:')
        print(f'{"level":>8}' + ''.join(f'{h:>9}' for h in HORIZONS) + f'{"sel-alpha":>12}')
        g = p.groupby(t)[[f'mix_{h}' for h in HORIZONS] + ['selection_alpha']].mean()
        for lvl, r in g.iterrows():
            print(f'{lvl:>8}' + ''.join(f'{r[f"mix_{h}"]:>8.1%} ' for h in HORIZONS)
                  + f'{r["selection_alpha"]:>+11.2%}')

    # ---- time-split stability ----------------------------------------------------
    print('\n' + '=' * 90)
    print('3. TIME-SPLIT STABILITY — per-event decision skill, first vs second half of fold')
    print('=' * 90)
    alpha_cols = [f'actual_{h}' for h in HORIZONS]
    actual = ev[alpha_cols].to_numpy(dtype=np.float64)
    tf_idx = np.where(tf)[0]
    order = np.argsort(pd.to_datetime(ev['date']).to_numpy()[tf_idx], kind='stable')
    tf_idx = tf_idx[order]
    half = len(tf_idx) // 2
    halves = {'first': tf_idx[:half], 'second': tf_idx[half:]}
    res = {}
    for name, ix in halves.items():
        cov = np.zeros(n_pots)
        for lo in range(0, n_pots, ROW_CHUNK):
            hi = min(lo + ROW_CHUNK, n_pots)
            a = np.asarray(act[lo:hi][:, ix])
            h = np.asarray(hor[lo:hi][:, ix]).astype(np.int64)
            u = np.where(a == 1, 1.0, np.where(a == 2, -1.0, 0.0))
            aH = actual[ix][np.arange(len(ix)), h]
            ok = np.isfinite(aH)
            for r in range(hi - lo):
                m = ok[r]
                if m.sum() < 50:
                    continue
                uu, aa = u[r, m], aH[r, m]
                cov[lo + r] = ((uu - uu.mean()) * (aa - aa.mean())).mean()
        res[name] = cov
    p['skill_h1'] = res['first']; p['skill_h2'] = res['second']
    print(f'  rank correlation of pot skill between halves: '
          f'{pd.Series(res["first"]).corr(pd.Series(res["second"]), method="spearman"):.3f}')
    print(f'  pots positive in BOTH halves: {((res["first"] > 0) & (res["second"] > 0)).mean():.1%}')
    print(f'\n  opportunistic gradient in each half:')
    print(f'{"level":>8}{"first half":>14}{"second half":>14}{"stable?":>10}')
    for lvl in (1, 4, 7, 10):
        m = p['opportunistic'] == lvl
        a1, a2 = p.loc[m, 'skill_h1'].mean(), p.loc[m, 'skill_h2'].mean()
        print(f'{lvl:>8}{a1:>+14.3%}{a2:>+14.3%}{"yes" if np.sign(a1) == np.sign(a2) else "NO":>10}')

    p.to_csv(OUT / 'synthesis.csv', index=False)

    # ---- the recommendation ------------------------------------------------------
    print('\n' + '=' * 90)
    print('4. BEST CONFIGURATION — cell means, ranked by selection alpha then Sharpe')
    print('=' * 90)
    d4 = pd.read_csv(OUT / 'synth_combo_4.csv')
    best = d4.iloc[0]
    print(f'  best 4-trait cell: {best["combo"]} = {best["values"]}')
    print(f'    selection alpha {best["sel_alpha"]:+.2%}   Sharpe {best["sharpe"]:.2f}   '
          f'exposure {best["exposure"]:.1%}   n_pots {best["n_pots"]}')
    # best cell that ALSO has a good Sharpe
    good = d4[d4['sharpe'] >= d4['sharpe'].quantile(0.9)].head(3)
    print('\n  top 3 cells among the best-Sharpe decile (risk-adjusted pick):')
    print(good.to_string(index=False, float_format=lambda v: f'{v:,.3f}'))
    print('\nwrote synthesis.csv, synth_combo_{2,3,4}.csv')


if __name__ == '__main__':
    main()
