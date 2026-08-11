#!/usr/bin/env python3
"""HISTORIC POTS — sequential PORTFOLIO backtest ("what would I actually have made?").

This answers a DIFFERENT question from historic_pots.py. That one resets £100k every
event and gifts £100k of shares, which measures signal quality per opportunity but
cannot produce an equity curve. This one runs a single capital pool forward through
time under real constraints:

  * ONE pool, starts at £100,000, compounds. No gifted endowment — the pot starts flat
    and only ever owns what it chose to buy.
  * CAPITAL CONSTRAINT. On a day when 50 signals fire you cannot take them all. A BUY is
    skipped if cash or slots are unavailable — so the strategy is forced to choose, which
    the per-event study never was.
  * SLOTS from `focus` (concentration): {1:12, 4:8, 7:5, 10:3} concurrent positions.
  * SIZE from `conviction`: target = (conviction/10) x equity / slots. In the per-event
    study conviction had EXACTLY zero effect (it was pure sizing on an unconstrained
    book); here sizing genuinely matters because it drives compounding and how much
    capital is tied up when the next signal arrives. That contrast is the point.
  * OVERLAPPING HOLDINGS. A 2W position opened Monday is still tying up capital on
    Friday when new signals fire. Slots free only when the horizon completes.
  * COSTS charged on entry (deployed costModel.ts round-trip, so exit is prepaid).
  * RAW returns, not alpha — this is what the account actually earns. The benchmark
    buy-and-hold comparison is reported alongside so alpha is still visible.

LONG-ONLY, and this is a real limitation: with no gifted shares there is nothing to sell,
and acting on SELL would mean shorting (borrow costs, hard-to-borrow names — see
costModel.shortBorrowCostGBP's own caveat). SELL therefore means "do not open". The
measured decision skill had a two-sided component, so this backtest captures only the
long half of the signal and is conservative for that reason.

Equity is BOOK VALUE (cash + cost basis of open positions): open positions are not marked
to market because we hold only horizon-end labels, not interim prices. Drawdown and
volatility are therefore understated between entry and exit; realised totals are exact.

Test fold only (>= 2025-02-13) — the honest slice.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
HORIZONS = ['2D', '2W', '1M', '3M', '6M']
H_CAL = np.array([2, 10, 30, 91, 182])          # 1M ~30 cal days (21 bars) for scheduling
SLOTS_BY_FOCUS = {1: 12, 4: 8, 7: 5, 10: 3}
MAX_SLOTS = 12
START = 100_000.0
NATIVE = {'.AX': '^AXJO', '.SW': '^SSMI', '.ST': '^OMX', '.SI': '^STI', '.L': '^FTSE',
          '.DE': '^GDAXI', '.PA': '^FCHI', '.TO': '^GSPTSE', '.NS': '^BSESN',
          '.BO': '^BSESN', '.HK': '^HSI'}


def main():
    ev = pd.read_csv(OUT / 'events.csv')
    costs = json.loads((OUT / 'costs.json').read_text())
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    hor = np.load(OUT / 'horizon.npy', mmap_mode='r')
    grid = pd.read_csv(OUT / 'pots.csv')
    grid = grid[grid['control'].isna() | (grid['control'] == '')].reset_index(drop=True)
    n_pots = len(grid)

    ev['date'] = pd.to_datetime(ev['date'])
    tf_mask = (ev['cohort'] == 'testfold').to_numpy()
    order = np.argsort(ev['date'].to_numpy()[tf_mask], kind='stable')
    idx = np.where(tf_mask)[0][order]                     # event rows, date-ordered
    n_ev = len(idx)
    dates = ev['date'].to_numpy()[idx].astype('datetime64[D]').astype(np.int64)
    data_end = int(ev['date'].max().to_datetime64().astype('datetime64[D]').astype(np.int64))
    raw = ev[[f'actual_{h}' for h in HORIZONS]].to_numpy(dtype=np.float64)[idx]
    exit_day = dates[:, None] + H_CAL[None, :]
    matured = exit_day <= data_end

    cost_bps = np.full((n_ev, 4), np.nan)
    for j, s in enumerate(ev['symbol'].to_numpy()[idx]):
        c = costs['symbols'].get(str(s))
        if c:
            cost_bps[j] = c['bps']
    size_ix = {1: 0, 4: 1, 7: 2, 10: 3}
    print(f'test-fold events (date-ordered): {n_ev:,}   pots: {n_pots:,}')
    print(f'window: {ev["date"].to_numpy()[idx][0]} -> {ev["date"].to_numpy()[idx][-1]}')

    slots_n = np.array([SLOTS_BY_FOCUS[f] for f in grid['focus']], dtype=np.int64)
    conv = grid['conviction'].to_numpy(dtype=np.float64)
    csize = np.array([size_ix[int(c)] for c in conv])

    cash = np.full(n_pots, START)
    tied = np.zeros(n_pots)                                # cost basis of open positions
    s_exit = np.full((n_pots, MAX_SLOTS), np.iinfo(np.int64).max, dtype=np.int64)
    s_proceeds = np.zeros((n_pots, MAX_SLOTS))
    s_basis = np.zeros((n_pots, MAX_SLOTS))
    slot_alive = np.zeros((n_pots, MAX_SLOTS), dtype=bool)
    slot_allowed = np.arange(MAX_SLOTS)[None, :] < slots_n[:, None]

    n_trades = np.zeros(n_pots); n_skipped = np.zeros(n_pots); n_wins = np.zeros(n_pots)
    peak = np.full(n_pots, START); maxdd = np.zeros(n_pots)
    curve_dates, curve_equity = [], []
    pots_all = np.arange(n_pots)

    for i in range(n_ev):
        today = dates[i]
        due = slot_alive & (s_exit <= today)
        if due.any():
            cash += np.where(due, s_proceeds, 0.0).sum(1)
            tied -= np.where(due, s_basis, 0.0).sum(1)
            slot_alive &= ~due
            s_exit = np.where(due, np.iinfo(np.int64).max, s_exit)

        # memmaps carry the 3 control pots after the grid — slice them off
        h = np.asarray(hor[:n_pots, idx[i]]).astype(np.int64)
        a = np.asarray(act[:n_pots, idx[i]])
        equity = cash + tied
        target = (conv / 10.0) * equity / slots_n
        free = slot_allowed & ~slot_alive
        has_free = free.any(1)
        want = (a == 1) & matured[i][h] & np.isfinite(raw[i][h])
        do = want & has_free & (cash >= target) & (target > 0)
        n_skipped += (want & ~do)

        if do.any():
            p = pots_all[do]
            slot = np.argmax(free[p], axis=1)
            size = target[p]
            bps = cost_bps[i, csize[p]]
            fee = size * np.nan_to_num(bps) / 10000.0
            ret = raw[i][h[p]]
            cash[p] -= size
            tied[p] += size
            s_basis[p, slot] = size
            s_proceeds[p, slot] = size * (1.0 + ret) - fee
            s_exit[p, slot] = exit_day[i, h[p]]
            slot_alive[p, slot] = True
            n_trades[p] += 1
            n_wins[p] += (size * ret - fee) > 0

        eq = cash + tied
        peak = np.maximum(peak, eq)
        maxdd = np.maximum(maxdd, (peak - eq) / peak)
        if i % 50 == 0 or i == n_ev - 1:
            curve_dates.append(today); curve_equity.append(eq.copy())
        if i % 2000 == 0:
            print(f'  event {i:,}/{n_ev:,}  median equity £{np.median(eq):,.0f}')

    # settle anything still open at the end
    cash += np.where(slot_alive, s_proceeds, 0.0).sum(1)
    final = cash
    years = (dates[-1] - dates[0]) / 365.25

    res = grid[TRAITS].copy()
    res['final_equity'] = final
    res['total_return'] = final / START - 1
    res['cagr'] = (final / START) ** (1 / years) - 1
    res['max_dd'] = maxdd
    res['trades'] = n_trades
    res['skipped_no_capital'] = n_skipped
    res['win_rate'] = np.where(n_trades > 0, n_wins / np.maximum(n_trades, 1), np.nan)
    res.to_csv(OUT / 'portfolio.csv', index=False)

    # benchmark buy-and-hold over the same window
    bars = json.loads((OUT / 'benchmark_bars.json').read_text())['^GSPC']
    bd = np.array(sorted(bars))
    d0 = str(np.datetime64(int(dates[0]), 'D')); d1 = str(np.datetime64(int(dates[-1]), 'D'))
    i0 = np.searchsorted(bd, d0); i1 = min(np.searchsorted(bd, d1), len(bd) - 1)
    bench_ret = bars[str(bd[i1])] / bars[str(bd[i0])] - 1

    print('\n' + '=' * 78)
    print(f'SEQUENTIAL PORTFOLIO BACKTEST — £{START:,.0f} start, {years:.2f} years, long-only')
    print('=' * 78)
    print(f'  S&P 500 buy-and-hold over the same window: {bench_ret:+.2%}')
    print(f'\n  pot total return : best {res["total_return"].max():+.2%}   '
          f'median {res["total_return"].median():+.2%}   worst {res["total_return"].min():+.2%}')
    print(f'  pots beating buy-and-hold: {(res["total_return"] > bench_ret).mean():.1%}')
    print(f'  pots with a POSITIVE return: {(res["total_return"] > 0).mean():.1%}')
    print(f'  max drawdown (book value): median {res["max_dd"].median():.2%}   '
          f'worst {res["max_dd"].max():.2%}')
    print(f'  trades: median {res["trades"].median():,.0f}   '
          f'signals skipped for lack of capital: median {res["skipped_no_capital"].median():,.0f}')
    print(f'  win rate: median {res["win_rate"].median():.1%}')

    print('\n=== BY OPPORTUNISTIC ===')
    print(f'{"opp":>4}{"tot ret":>10}{"CAGR":>9}{"maxDD":>8}{"trades":>9}{"skipped":>9}{"win%":>7}')
    for lvl in (1, 4, 7, 10):
        m = res['opportunistic'] == lvl
        print(f'{lvl:>4}{res.loc[m,"total_return"].mean():>+10.2%}{res.loc[m,"cagr"].mean():>+9.2%}'
              f'{res.loc[m,"max_dd"].mean():>8.2%}{res.loc[m,"trades"].mean():>9.0f}'
              f'{res.loc[m,"skipped_no_capital"].mean():>9.0f}{res.loc[m,"win_rate"].mean():>7.1%}')

    print('\n=== BY CONVICTION (was EXACTLY zero-effect per-event; sizing bites here) ===')
    for lvl in (1, 4, 7, 10):
        m = res['conviction'] == lvl
        print(f'  conv {lvl:>2}: total {res.loc[m,"total_return"].mean():+7.2%}   '
              f'maxDD {res.loc[m,"max_dd"].mean():6.2%}   trades {res.loc[m,"trades"].mean():,.0f}')

    print('\n=== BY FOCUS (slot count: 1->12 slots, 10->3 slots) ===')
    for lvl in (1, 4, 7, 10):
        m = res['focus'] == lvl
        print(f'  focus {lvl:>2} ({SLOTS_BY_FOCUS[lvl]:>2} slots): total '
              f'{res.loc[m,"total_return"].mean():+7.2%}   maxDD {res.loc[m,"max_dd"].mean():6.2%}'
              f'   skipped {res.loc[m,"skipped_no_capital"].mean():,.0f}')

    print('\n=== TOP 5 BY TOTAL RETURN ===')
    print(res.nlargest(5, 'total_return')[TRAITS + ['total_return', 'cagr', 'max_dd', 'trades', 'win_rate']]
          .to_string(index=False, float_format=lambda v: f'{v:,.3f}'))

    np.save(OUT / 'equity_curve.npy', np.array(curve_equity))
    np.save(OUT / 'equity_dates.npy', np.array(curve_dates))
    print('\nwrote portfolio.csv, equity_curve.npy')


if __name__ == '__main__':
    main()
