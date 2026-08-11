#!/usr/bin/env python3
"""HISTORIC POTS — Tier 1: is it ALPHA or BETA, and are the trait gradients REAL?

(1) BENCHMARK-NEUTRALISE. Test-fold events have a positive mean forward return, so part
    of any measured "skill" may just be market drift. For each event, hedge against the
    SAME native index training would have used (NATIVE_BENCHMARK mapping — .L->^FTSE,
    .DE->^GDAXI, ... else ^GSPC), then re-measure decision skill on
        alpha_h = stock_forward_return_h - benchmark_forward_return_h

    Horizon conventions are matched to the pipeline EXACTLY (they are not uniform —
    calculate_forward_returns.ts uses calendar-day offsets, reextractDailyEvents.ts uses
    trading bars for 1M):
        2D  = +2 calendar days      2W = +10 calendar days   (NOT 14)
        1M  = 21 TRADING BARS       3M = +91 calendar days   6M = +182 calendar days
    ...and the same "nearest trading day at or after the target, up to 10 days forward"
    rule as findNearestPrice().

(2) BOOTSTRAP over EVENTS. All prior t-stats treat one pot's events as the sample, but
    the trait GRADIENTS were compared across 16,384 pots that share a single set of model
    predictions and are nowhere near independent — "56% of pots clear t>3" is closer to
    one observation than to 16,384. Resampling EVENTS (the genuine unit of independence)
    with replacement gives honest CIs on the trait effects, in particular the
    opportunistic gradient.

Immature labels are excluded throughout (see historic_pots_matured.py).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
HORIZONS = ['2D', '2W', '1M', '3M', '6M']
CAL_OFFSET = {0: 2, 1: 10, 3: 91, 4: 182}     # 1M (index 2) is bar-based, handled separately
BAR_OFFSET = {2: 21}
NATIVE = {'.AX': '^AXJO', '.SW': '^SSMI', '.ST': '^OMX', '.SI': '^STI', '.L': '^FTSE',
          '.DE': '^GDAXI', '.PA': '^FCHI', '.TO': '^GSPTSE', '.NS': '^BSESN',
          '.BO': '^BSESN', '.HK': '^HSI'}
N_BOOT = 2000
ROW_CHUNK = 512
RNG = np.random.default_rng(20260811)


def bench_for(symbol):
    s = str(symbol).upper()
    for suf, tk in NATIVE.items():
        if s.endswith(suf):
            return tk
    return '^GSPC'


def main():
    bars = {k: {d: float(v) for d, v in m.items()} for k, m in
            json.loads((OUT / 'benchmark_bars.json').read_text()).items()}
    sorted_dates = {k: np.array(sorted(m)) for k, m in bars.items()}

    ev = pd.read_csv(OUT / 'events.csv')
    ev['bench'] = ev['symbol'].map(bench_for)
    dates = pd.to_datetime(ev['date'])
    data_end = dates.max()
    n_ev = len(ev)

    def price_on_or_after(tk, target):
        """findNearestPrice(): first bar on/after target, searching up to 10 days."""
        arr = sorted_dates.get(tk)
        if arr is None:
            return None
        i = np.searchsorted(arr, target.strftime('%Y-%m-%d'))
        if i >= len(arr):
            return None
        d = str(arr[i])
        if (pd.Timestamp(d) - target).days > 10:
            return None
        return bars[tk][d]

    print('computing benchmark forward returns (matched conventions)...')
    bench_fwd = np.full((n_ev, 5), np.nan)
    matured = np.zeros((n_ev, 5), dtype=bool)
    for i in range(n_ev):
        tk = ev.at[i, 'bench']
        d0 = dates.iat[i]
        p0 = price_on_or_after(tk, d0)
        if p0 is None or p0 <= 0:
            continue
        arr = sorted_dates.get(tk)
        for h in range(5):
            if h in CAL_OFFSET:
                tgt = d0 + pd.Timedelta(days=CAL_OFFSET[h])
                matured[i, h] = tgt <= data_end
                p1 = price_on_or_after(tk, tgt)
            else:                                    # 1M: 21 trading bars on the benchmark
                j = np.searchsorted(arr, d0.strftime('%Y-%m-%d')) + BAR_OFFSET[h]
                p1 = bars[tk][str(arr[j])] if j < len(arr) else None
                matured[i, h] = (j < len(arr)) and (pd.Timestamp(str(arr[j])) <= data_end)
            if p1 is not None and p1 > 0:
                bench_fwd[i, h] = p1 / p0 - 1
        if i % 8000 == 0:
            print(f'  {i:,}/{n_ev:,}')

    stock = ev[[f'actual_{h}' for h in HORIZONS]].to_numpy(dtype=np.float64)
    alpha = stock - bench_fwd
    tf = (ev['cohort'] == 'testfold').to_numpy()
    usable = matured & np.isfinite(alpha)

    print('\n=== RAW vs BENCHMARK-NEUTRAL forward returns (test fold, matured only) ===')
    print(f'{"horizon":>8}{"stock mean":>13}{"benchmark":>12}{"ALPHA":>12}{"usable":>9}')
    for h in range(5):
        m = tf & usable[:, h]
        print(f'{HORIZONS[h]:>8}{stock[m, h].mean():>12.3%}{bench_fwd[m, h].mean():>12.3%}'
              f'{alpha[m, h].mean():>12.3%}{m.sum():>9,}')

    # ---- decision skill on alpha ------------------------------------------------
    grid = pd.read_csv(OUT / 'pots.csv')
    grid = grid[grid['control'].isna() | (grid['control'] == '')].reset_index(drop=True)
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    hor = np.load(OUT / 'horizon.npy', mmap_mode='r')
    n_pots = len(grid)
    tf_idx = np.where(tf)[0]

    cov_a = np.zeros(n_pots); t_a = np.zeros(n_pots)
    cov_r = np.zeros(n_pots); n_used = np.zeros(n_pots)
    # per-pot per-event contribution for the alpha metric, kept for the bootstrap
    contrib = np.zeros((n_pots, len(tf_idx)), dtype=np.float32)
    valid = np.zeros((n_pots, len(tf_idx)), dtype=bool)

    for lo in range(0, n_pots, ROW_CHUNK):
        hi = min(lo + ROW_CHUNK, n_pots)
        a = np.asarray(act[lo:hi])[:, tf_idx]
        h = np.asarray(hor[lo:hi]).astype(np.int64)[:, tf_idx]
        u = np.where(a == 1, 1.0, np.where(a == 2, -1.0, 0.0))
        rows = np.arange(len(tf_idx))
        aH = alpha[tf_idx][rows, h]
        okH = usable[tf_idx][rows, h]
        for r in range(hi - lo):
            m = okH[r]
            if m.sum() < 100:
                continue
            uu, aa = u[r, m], aH[r, m]
            x = (uu - uu.mean()) * (aa - aa.mean())
            c, sd, n = x.mean(), x.std(ddof=1), len(x)
            cov_a[lo + r] = c; n_used[lo + r] = n
            t_a[lo + r] = c / (sd / np.sqrt(n)) if sd > 0 else 0.0
            keep = np.argsort(-np.abs(x))[int(0.01 * n):]
            cov_r[lo + r] = x[keep].mean()
            full = np.zeros(len(tf_idx), dtype=np.float32)
            full[m] = x
            contrib[lo + r] = full
            valid[lo + r] = m
        if (lo // ROW_CHUNK) % 8 == 0:
            print(f'  pots {lo:,}/{n_pots:,}')

    res = grid[TRAITS].copy()
    res['cov_alpha'] = cov_a; res['t_alpha'] = t_a
    res['cov_alpha_robust'] = cov_r; res['n_used'] = n_used
    res.to_csv(OUT / 'alpha_skill.csv', index=False)

    print('\n=== DECISION SKILL on BENCHMARK-NEUTRAL returns ===')
    print(f'  cov: mean {cov_a.mean():+.4%}   best {cov_a.max():+.4%}')
    print(f'  pots t>3: {(t_a > 3).mean():.1%}')
    print(f'  robust (drop top 1% |contribution|): mean {cov_r.mean():+.4%}')

    # ---- bootstrap the opportunistic gradient over EVENTS ------------------------
    print(f'\n=== BOOTSTRAP over EVENTS (n={N_BOOT:,}) — opportunistic gradient ===')
    groups = {lvl: np.where(res['opportunistic'].to_numpy() == lvl)[0] for lvl in (1, 4, 7, 10)}
    # mean contribution per level, per event -> resample events
    lvl_mean = {lvl: np.where(valid[idx].sum(0) > 0,
                              contrib[idx].sum(0) / np.maximum(valid[idx].sum(0), 1), np.nan)
                for lvl, idx in groups.items()}
    n_e = len(tf_idx)
    boot = {lvl: np.empty(N_BOOT) for lvl in groups}
    boot_diff = np.empty(N_BOOT)
    for b in range(N_BOOT):
        s = RNG.integers(0, n_e, n_e)
        for lvl in groups:
            v = lvl_mean[lvl][s]
            boot[lvl][b] = np.nanmean(v)
        boot_diff[b] = boot[1][b] - boot[10][b]
    print(f'{"opp":>5}{"cov":>12}{"95% CI":>26}')
    for lvl in (1, 4, 7, 10):
        lo_, hi_ = np.percentile(boot[lvl], [2.5, 97.5])
        print(f'{lvl:>5}{np.nanmean(lvl_mean[lvl]):>11.3%}   [{lo_:+.3%}, {hi_:+.3%}]')
    d_lo, d_hi = np.percentile(boot_diff, [2.5, 97.5])
    print(f'\n  opp=1 minus opp=10: {boot_diff.mean():+.3%}  95% CI [{d_lo:+.3%}, {d_hi:+.3%}]'
          f'   P(>0) = {(boot_diff > 0).mean():.1%}')
    print('  -> CI excluding zero means the gradient is not an artefact of which events landed'
          '\n     in the sample; it is a property of the signal.')

    print('\n=== ALL TRAITS on alpha (bootstrap 95% CI on level-1 minus level-10) ===')
    for t in TRAITS:
        g = {lvl: np.where(res[t].to_numpy() == lvl)[0] for lvl in (1, 10)}
        lm = {lvl: np.where(valid[idx].sum(0) > 0,
                            contrib[idx].sum(0) / np.maximum(valid[idx].sum(0), 1), np.nan)
              for lvl, idx in g.items()}
        bd = np.empty(500)
        for b in range(500):
            s = RNG.integers(0, n_e, n_e)
            bd[b] = np.nanmean(lm[1][s]) - np.nanmean(lm[10][s])
        lo_, hi_ = np.percentile(bd, [2.5, 97.5])
        sig = '' if lo_ <= 0 <= hi_ else '  <-- CI excludes 0'
        print(f'  {t:<15} lvl1-lvl10 {bd.mean():+.3%}  [{lo_:+.3%}, {hi_:+.3%}]{sig}')
    print('\nwrote alpha_skill.csv')


if __name__ == '__main__':
    main()
