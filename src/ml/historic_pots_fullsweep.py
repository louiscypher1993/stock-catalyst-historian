#!/usr/bin/env python3
"""HISTORIC POTS — FULL-RESOLUTION sweep: 7,700,000 pots.

WHY the 16,384 grid (4 levels x 7 traits) was not enough, and why a naive 10^7 would be
mostly waste — both established empirically first:

  GAP     patience {1,4,7,10} maps to home horizons {2D, 2W, 3M, 6M}. `home` is
          round((p-1)/9*4), so 1M is the home horizon ONLY at patience 5-6, which the
          coarse grid skipped entirely. A whole horizon was untested as a home.
  GAP     opportunistic never reached w_chase = 0 (pure home horizon, no chasing at all).
          Given that chasing turned out to be the dominant negative effect, that is the
          most interesting point on the axis and it was missing.
  WASTE   boldness 7 and 10 are BIT-IDENTICAL (+0.422245 each): the gate is
          `risk > boldness*10`, riskScore maxes at 89 and p99 is 70, so boldness >= 7
          blocks 0.0% of events. Levels 8-10 are duplicate pots. 25% of the old grid.
  WASTE   conviction is provably pure position sizing — exactly 0.000000 effect on
          decision skill at every level. It scales P&L linearly and is separable
          analytically, so sweeping it costs 10x compute for zero new information.

DECOMPOSITION that makes 7.7M tractable. The horizon choice depends ONLY on
(patience, focus, opportunistic) -> 10 x 10 x 11 = 1,100 distinct choice behaviours.
Given a chosen horizon, the ACTION depends only on (ambition, reactivity, boldness)
-> 10 x 10 x 7 = 700 settings. So the sweep is 1,100 outer x 700 inner = 770,000
distinct DECISION behaviours, x 10 conviction levels = 7,700,000 nominal pots, computed
in 1,100 vectorised passes instead of 7.7M simulations.

Levels: patience 1-10 · focus 1-10 · opportunistic 0-10 (0 = boundary probe, outside the
PotService 1-10 range, flagged in output) · ambition 1-10 · reactivity 1-10 · boldness 1-7
(8-10 provably identical to 7) · conviction separable.

Metric: benchmark-neutral decision skill Cov(decision, alpha) on MATURED test-fold
events — the measure that established every prior trait finding. Also trade rate and
horizon mix.

The utility scaler keeps historic_pots.py's original sqrt(days/14) with days=[2,14,30,
91,182] so results stay comparable with the 16,384-pot run; it is a normaliser inside the
pot's own preference function, not a claim about the data. Maturity and benchmark maths
use the PIPELINE's true offsets (2W=10 calendar days etc).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
HORIZONS = ['2D', '2W', '1M', '3M', '6M']
U_DAYS = np.array([2, 14, 30, 91, 182], dtype=np.float64)     # utility scaler (see header)
CAL_OFFSET = {0: 2, 1: 10, 3: 91, 4: 182}                     # true pipeline offsets
BAR_OFFSET = {2: 21}
H_BASE = np.array([0.0108, 0.0247, 0.04, 0.0576, 0.1067])
NATIVE = {'.AX': '^AXJO', '.SW': '^SSMI', '.ST': '^OMX', '.SI': '^STI', '.L': '^FTSE',
          '.DE': '^GDAXI', '.PA': '^FCHI', '.TO': '^GSPTSE', '.NS': '^BSESN',
          '.BO': '^BSESN', '.HK': '^HSI'}
PATIENCE = np.arange(1, 11)
FOCUS = np.arange(1, 11)
OPP = np.arange(0, 11)
AMBITION = np.arange(1, 11)
REACTIVITY = np.arange(1, 11)
BOLDNESS = np.arange(1, 8)


def bench_for(s):
    s = str(s).upper()
    for suf, tk in NATIVE.items():
        if s.endswith(suf):
            return tk
    return '^GSPC'


def build_alpha(ev, dates, data_end):
    cache = OUT / 'alpha_cache.npz'
    if cache.exists():
        z = np.load(cache)
        return z['alpha'], z['usable']
    bars = {k: {d: float(v) for d, v in m.items()}
            for k, m in json.loads((OUT / 'benchmark_bars.json').read_text()).items()}
    sd = {k: np.array(sorted(m)) for k, m in bars.items()}
    n = len(ev)
    bench = np.full((n, 5), np.nan); matured = np.zeros((n, 5), dtype=bool)

    def p_after(tk, target):
        arr = sd.get(tk)
        if arr is None:
            return None
        i = np.searchsorted(arr, target.strftime('%Y-%m-%d'))
        if i >= len(arr):
            return None
        d = str(arr[i])
        return None if (pd.Timestamp(d) - target).days > 10 else bars[tk][d]

    for i in range(n):
        tk = bench_for(ev.at[i, 'symbol']); d0 = dates.iat[i]
        p0 = p_after(tk, d0)
        if not p0:
            continue
        arr = sd[tk]
        for h in range(5):
            if h in CAL_OFFSET:
                tgt = d0 + pd.Timedelta(days=CAL_OFFSET[h])
                matured[i, h] = tgt <= data_end
                p1 = p_after(tk, tgt)
            else:
                j = np.searchsorted(arr, d0.strftime('%Y-%m-%d')) + BAR_OFFSET[h]
                p1 = bars[tk][str(arr[j])] if j < len(arr) else None
                matured[i, h] = (j < len(arr)) and (pd.Timestamp(str(arr[j])) <= data_end)
            if p1:
                bench[i, h] = p1 / p0 - 1
    stock = ev[[f'actual_{h}' for h in HORIZONS]].to_numpy(dtype=np.float64)
    alpha = stock - bench
    usable = matured & np.isfinite(alpha)
    np.savez_compressed(cache, alpha=alpha, usable=usable)
    return alpha, usable


def main():
    ev = pd.read_csv(OUT / 'events.csv')
    dates = pd.to_datetime(ev['date'])
    data_end = dates.max()
    alpha, usable = build_alpha(ev, dates, data_end)
    tf = (ev['cohort'] == 'testfold').to_numpy()

    P = ev[[f'pred_{h}' for h in HORIZONS]].to_numpy(dtype=np.float64)[tf]
    A = alpha[tf]; U = usable[tf]
    risk = ev['risk_score'].to_numpy(dtype=np.float64)[tf]
    n_ev = len(P)
    total = len(PATIENCE) * len(FOCUS) * len(OPP) * len(AMBITION) * len(REACTIVITY) * len(BOLDNESS)
    print(f'test-fold events {n_ev:,}')
    print(f'distinct decision behaviours: {total:,}   (x10 conviction = {total*10:,} nominal pots)')

    u = P / np.sqrt(U_DAYS / 14)[None, :]
    un = np.abs(u) / (np.abs(u).max(1, keepdims=True) + 1e-9)
    mult = (AMBITION[:, None] / REACTIVITY[None, :]).ravel()            # (100,)
    gate = risk[None, :] > (BOLDNESS[:, None] * 10)                     # (7, n_ev)

    rows = []
    done = 0
    for p in PATIENCE:
        home = int(np.clip(round((p - 1) / 9 * 4), 0, 4))
        for f in FOCUS:
            width = (11 - f) / 5
            prior = np.exp(-np.abs(home - np.arange(5)) / width)        # (5,)
            for o in OPP:
                w = o / 10.0
                c = w * un + (1 - w) * prior[None, :]
                H = c.argmax(1)                                          # (n_ev,)
                idx = np.arange(n_ev)
                predH = P[idx, H]; okH = U[idx, H]
                # NaN-SAFE: unusable entries of A are NaN, and NaN * False == NaN in
                # numpy, so masking by multiplication poisons the whole sum. Zero them
                # BEFORE any arithmetic. (This silently NaN'd every long-horizon
                # configuration on the first run -- 3M/6M are only 84%/59% matured.)
                aH = np.where(okH, np.nan_to_num(A[idx, H]), 0.0)
                base = H_BASE[H]
                thr = base[None, :] * mult[:, None]                      # (100, n_ev)
                buy = predH[None, :] >= thr
                sell = predH[None, :] <= -thr
                # (7,100,n_ev): boldness gate forces HOLD
                sig = (buy[None, :, :].astype(np.int8) - sell[None, :, :].astype(np.int8))
                sig = np.where(gate[:, None, :], 0, sig).astype(np.float64)
                m = okH.astype(np.float64)[None, None, :]
                nv = max(int(okH.sum()), 1)                              # same for all settings
                su = (sig * m).sum(2) / nv
                sa = float(aH.sum()) / nv
                cov = ((sig - su[:, :, None]) * (aH - sa)[None, None, :] * m).sum(2) / nv
                trate = ((sig != 0) * m).sum(2) / nv
                mixH = np.array([((H == hh) & okH).sum() / max(okH.sum(), 1) for hh in range(5)])
                for bi, b in enumerate(BOLDNESS):
                    for mi in range(len(mult)):
                        rows.append((b, AMBITION[mi // 10], p, f, REACTIVITY[mi % 10], o,
                                     cov[bi, mi], trate[bi, mi], home))
                done += len(BOLDNESS) * len(mult)
        print(f'  patience {p}/10 done — {done:,}/{total:,} behaviours')

    df = pd.DataFrame(rows, columns=['boldness', 'ambition', 'patience', 'focus',
                                     'reactivity', 'opportunistic', 'cov_alpha',
                                     'trade_rate', 'home_horizon'])
    df.to_csv(OUT / 'fullsweep.csv.gz', index=False, compression='gzip')
    print(f'\nwrote fullsweep.csv.gz ({len(df):,} rows)')

    print('\n' + '=' * 84)
    print('FULL SWEEP RESULTS — benchmark-neutral decision skill (test fold)')
    print('=' * 84)
    print(f'  cov: best {df["cov_alpha"].max():+.4%}   median {df["cov_alpha"].median():+.4%}'
          f'   worst {df["cov_alpha"].min():+.4%}')

    print('\n--- PATIENCE at FULL resolution (the coarse grid skipped 5 and 6 = home 1M) ---')
    g = df.groupby(['patience', 'home_horizon'])['cov_alpha'].mean().reset_index()
    for _, r in g.iterrows():
        star = '   <-- was MISSING from the 4-level grid' if r['patience'] in (2, 3, 5, 6, 8, 9) else ''
        print(f'  patience {int(r["patience"]):>2} (home {HORIZONS[int(r["home_horizon"])]:>2}): '
              f'{r["cov_alpha"]:+.4%}{star}')

    print('\n--- OPPORTUNISTIC at FULL resolution (0 = never chase, was untested) ---')
    for o in OPP:
        m = df['opportunistic'] == o
        tag = '   <-- BOUNDARY PROBE (outside PotService 1-10)' if o == 0 else ''
        print(f'  opp {o:>2} (w_chase {o/10:.1f}): {df.loc[m,"cov_alpha"].mean():+.4%}'
              f'   trade rate {df.loc[m,"trade_rate"].mean():.1%}{tag}')

    print('\n--- BOLDNESS 1-7 (8-10 omitted: provably identical to 7) ---')
    for b in BOLDNESS:
        m = df['boldness'] == b
        print(f'  boldness {b}: {df.loc[m,"cov_alpha"].mean():+.4%}')

    # ambition and reactivity enter ONLY as the ratio ambition/reactivity (the threshold
    # multiplier), so e.g. 2/2 and 7/7 are the same pot. Collapse before ranking, or the
    # top-N is just one configuration repeated.
    df['thr_mult'] = (df['ambition'] / df['reactivity']).round(4)
    print(f'\n--- DEGENERACY: ambition x reactivity = {len(df[["ambition","reactivity"]].drop_duplicates()):,} '
          f'pairs but only {df["thr_mult"].nunique():,} distinct threshold multipliers ---')

    print('\n--- TOP 15 DISTINCT CONFIGURATIONS (collapsed on threshold multiplier) ---')
    key = ['boldness', 'patience', 'focus', 'opportunistic', 'thr_mult']
    top = (df.sort_values('cov_alpha', ascending=False)
             .drop_duplicates(subset=key).head(15))
    print(top[key + ['cov_alpha', 'trade_rate', 'home_horizon']]
          .to_string(index=False, float_format=lambda v: f'{v:,.4f}'))

    print('\n--- PATIENCE x OPPORTUNISTIC RESPONSE SURFACE (mean cov_alpha) ---')
    piv = df.pivot_table(index='patience', columns='opportunistic', values='cov_alpha')
    print(piv.to_string(float_format=lambda v: f'{v*100:+.2f}'))
    print('\n(values are % — rows patience 1-10, cols opportunistic 0-10)')


if __name__ == '__main__':
    main()
