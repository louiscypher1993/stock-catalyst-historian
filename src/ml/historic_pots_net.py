#!/usr/bin/env python3
"""HISTORIC POTS — Tier 2: does the alpha survive the 7-component cost model?

Everything so far is GROSS. This charges the deployed costModel.ts (IBKR_DEFAULT:
tax + commission + FX + spread, with a separate latency-slippage variant) against the
actual traded notional, on benchmark-neutral (alpha) returns and matured labels only.

Per event, the DECISION's economics versus its own counterfactual (HOLD, which trades
nothing and therefore costs nothing):
    gross £ = amt * alpha_H          amt = +stake on BUY, -stake on SELL
    cost  £ = |amt| * roundtrip_bps(symbol, |amt|) / 10000
    net   £ = gross - cost
`amt` is conviction/10 x £100k, so only four sizes occur and costs.json carries all four.

Round-trip is charged on SELL as well as BUY. That is deliberately CONSERVATIVE: a sell
is one leg, but the pot resets to a neutral book each event, so the position is round-
tripped in practice. Where it matters the sell-leg-only figure is reported alongside.

Reported for the traits that survived the Tier-1 bootstrap (opportunistic, boldness,
focus) and for the best pots, with the break-even trade rate.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
HORIZONS = ['2D', '2W', '1M', '3M', '6M']
CAL_OFFSET = {0: 2, 1: 10, 3: 91, 4: 182}
BAR_OFFSET = {2: 21}
NATIVE = {'.AX': '^AXJO', '.SW': '^SSMI', '.ST': '^OMX', '.SI': '^STI', '.L': '^FTSE',
          '.DE': '^GDAXI', '.PA': '^FCHI', '.TO': '^GSPTSE', '.NS': '^BSESN',
          '.BO': '^BSESN', '.HK': '^HSI'}
SIZES = np.array([10000., 40000., 70000., 100000.])
CAPITAL = 100_000.0
ROW_CHUNK = 512


def bench_for(s):
    s = str(s).upper()
    for suf, tk in NATIVE.items():
        if s.endswith(suf):
            return tk
    return '^GSPC'


def main():
    bars = {k: {d: float(v) for d, v in m.items()}
            for k, m in json.loads((OUT / 'benchmark_bars.json').read_text()).items()}
    sorted_dates = {k: np.array(sorted(m)) for k, m in bars.items()}
    costs = json.loads((OUT / 'costs.json').read_text())
    ev = pd.read_csv(OUT / 'events.csv')
    dates = pd.to_datetime(ev['date'])
    data_end = dates.max()
    n_ev = len(ev)

    def p_on_after(tk, target):
        arr = sorted_dates.get(tk)
        if arr is None:
            return None
        i = np.searchsorted(arr, target.strftime('%Y-%m-%d'))
        if i >= len(arr):
            return None
        d = str(arr[i])
        return None if (pd.Timestamp(d) - target).days > 10 else bars[tk][d]

    bench_fwd = np.full((n_ev, 5), np.nan)
    matured = np.zeros((n_ev, 5), dtype=bool)
    for i in range(n_ev):
        tk = bench_for(ev.at[i, 'symbol']); d0 = dates.iat[i]
        p0 = p_on_after(tk, d0)
        if not p0:
            continue
        arr = sorted_dates[tk]
        for h in range(5):
            if h in CAL_OFFSET:
                tgt = d0 + pd.Timedelta(days=CAL_OFFSET[h])
                matured[i, h] = tgt <= data_end
                p1 = p_on_after(tk, tgt)
            else:
                j = np.searchsorted(arr, d0.strftime('%Y-%m-%d')) + BAR_OFFSET[h]
                p1 = bars[tk][str(arr[j])] if j < len(arr) else None
                matured[i, h] = (j < len(arr)) and (pd.Timestamp(str(arr[j])) <= data_end)
            if p1:
                bench_fwd[i, h] = p1 / p0 - 1
    alpha = ev[[f'actual_{h}' for h in HORIZONS]].to_numpy(dtype=np.float64) - bench_fwd
    usable = matured & np.isfinite(alpha)
    tf_idx = np.where((ev['cohort'] == 'testfold').to_numpy())[0]

    # cost bps lookup: (event, size-index)
    cbps = np.full((n_ev, 4), np.nan)
    cbps_slip = np.full((n_ev, 4), np.nan)
    for i, s in enumerate(ev['symbol']):
        c = costs['symbols'].get(str(s))
        if c:
            cbps[i] = c['bps']; cbps_slip[i] = c['bpsSlip']
    print(f'cost model: {costs["config"]}')
    print(f'median round-trip: {np.nanmedian(cbps[tf_idx], axis=0).round(1)} bps at '
          f'£{SIZES.astype(int).tolist()}\n')

    grid = pd.read_csv(OUT / 'pots.csv')
    grid = grid[grid['control'].isna() | (grid['control'] == '')].reset_index(drop=True)
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    hor = np.load(OUT / 'horizon.npy', mmap_mode='r')
    n_pots = len(grid)
    conv = grid['conviction'].to_numpy()
    size_ix = {1: 0, 4: 1, 7: 2, 10: 3}

    gross = np.zeros(n_pots); cost = np.zeros(n_pots); cost_s = np.zeros(n_pots)
    trate = np.zeros(n_pots); nused = np.zeros(n_pots)
    for lo in range(0, n_pots, ROW_CHUNK):
        hi = min(lo + ROW_CHUNK, n_pots)
        a = np.asarray(act[lo:hi])[:, tf_idx]
        h = np.asarray(hor[lo:hi]).astype(np.int64)[:, tf_idx]
        rows = np.arange(len(tf_idx))
        aH = alpha[tf_idx][rows, h]
        ok = usable[tf_idx][rows, h]
        for r in range(hi - lo):
            pid = lo + r
            si = size_ix[int(conv[pid])]
            stake = SIZES[si]
            m = ok[r]
            if m.sum() < 100:
                continue
            u = np.where(a[r] == 1, 1.0, np.where(a[r] == 2, -1.0, 0.0))[m]
            amt = u * stake
            g = amt * aH[r][m]
            traded = np.abs(amt)
            c = traded * cbps[tf_idx][m, si] / 10000
            cs = traded * cbps_slip[tf_idx][m, si] / 10000
            gross[pid] = np.nanmean(g); cost[pid] = np.nanmean(c); cost_s[pid] = np.nanmean(cs)
            trate[pid] = (u != 0).mean(); nused[pid] = m.sum()
        if (lo // ROW_CHUNK) % 8 == 0:
            print(f'  pots {lo:,}/{n_pots:,}')

    res = grid[TRAITS].copy()
    res['gross'] = gross; res['cost'] = cost; res['net'] = gross - cost
    res['net_slip'] = gross - cost_s; res['trade_rate'] = trate; res['n'] = nused
    res.to_csv(OUT / 'net_pnl.csv', index=False)

    print('\n=== NET-OF-COST DECISION P&L per event (£, alpha-based, test fold) ===')
    print(f'  gross: mean £{gross.mean():+,.0f}   best £{gross.max():+,.0f}')
    print(f'  costs: mean £{cost.mean():,.0f}    (with latency slippage £{cost_s.mean():,.0f})')
    print(f'  NET  : mean £{res["net"].mean():+,.0f}   best £{res["net"].max():+,.0f}   '
          f'share>0 {(res["net"] > 0).mean():.1%}')
    print(f'  NET with slippage: mean £{res["net_slip"].mean():+,.0f}   '
          f'share>0 {(res["net_slip"] > 0).mean():.1%}')

    print('\n=== BY OPPORTUNISTIC (the Tier-1 survivor) ===')
    print(f'{"opp":>4}{"gross":>10}{"cost":>9}{"NET":>10}{"net+slip":>10}{"trades":>9}')
    for lvl in (1, 4, 7, 10):
        m = res['opportunistic'] == lvl
        print(f'{lvl:>4}{res.loc[m,"gross"].mean():>+10.0f}{res.loc[m,"cost"].mean():>9.0f}'
              f'{res.loc[m,"net"].mean():>+10.0f}{res.loc[m,"net_slip"].mean():>+10.0f}'
              f'{res.loc[m,"trade_rate"].mean():>8.1%}')

    print('\n=== BEST NET POTS ===')
    top = res.nlargest(5, 'net')[TRAITS + ['gross', 'cost', 'net', 'net_slip', 'trade_rate']]
    print(top.to_string(index=False, float_format=lambda v: f'{v:,.2f}'))

    b = res.loc[res['net'].idxmax()]
    print(f'\nbest pot nets £{b["net"]:+,.0f}/event on a £{SIZES[size_ix[int(b["conviction"])]]:,.0f} '
          f'stake = {10000 * b["net"] / SIZES[size_ix[int(b["conviction"])]]:.1f}bps of capital at risk, '
          f'trading {b["trade_rate"]:.1%} of events.')
    print('\nwrote net_pnl.csv')


if __name__ == '__main__':
    main()
