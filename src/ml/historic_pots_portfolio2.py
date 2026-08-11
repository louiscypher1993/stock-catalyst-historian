#!/usr/bin/env python3
"""HISTORIC POTS — portfolio backtest v2: exposure-adjusted, with a PERMUTATION NULL.

v1 showed the median pot returns +11.40% against buy-and-hold's +22.66%, but could not
say whether the pots that DID win were selecting well or merely more invested. This adds
the three things needed to tell those apart:

1. EXPOSURE. Average deployed capital / equity, tracked every event. A pot ~10% invested
   in a market that rose 22.66% should make ~2.3% from beta alone; crediting it with
   "return" without dividing by exposure is the same leverage trap that made conviction
   look like skill in the per-event study.

2. PERMUTATION NULL (the decisive test). Each pot is re-run with its OWN decision
   sequence randomly permuted across events — identical number of trades, identical
   sizes, identical slot/capital mechanics, identical market, but the link between
   SIGNAL and OUTCOME is destroyed. Anything the real pot earns above its permuted twin
   is selection skill; anything it does not is exposure and market drift. Fixed seed.

3. RISK/ATTRIBUTION. Annualised Sharpe from daily book-value equity, per-horizon P&L
   attribution, time in market, and return concentration (largest single trade as a share
   of total profit — this project has been repeatedly bitten by a handful of rows
   carrying an average).

Same mechanics as v1 (one £100k pool, no endowment, slots from focus, size from
conviction, costs on entry, long-only, raw returns, test fold, book-value equity).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
HORIZONS = ['2D', '2W', '1M', '3M', '6M']
H_CAL = np.array([2, 10, 30, 91, 182])
SLOTS_BY_FOCUS = {1: 12, 4: 8, 7: 5, 10: 3}
MAX_SLOTS = 12
START = 100_000.0
SEED = 20260811


def run(act_row_getter, hor_row_getter, n_pots, n_ev, idx, dates, raw, exit_day, matured,
        cost_bps, csize, conv, slots_n, track_daily):
    """One full pass of the portfolio mechanics. Returns a dict of per-pot arrays."""
    cash = np.full(n_pots, START)
    tied = np.zeros(n_pots)
    s_exit = np.full((n_pots, MAX_SLOTS), np.iinfo(np.int64).max, dtype=np.int64)
    s_proceeds = np.zeros((n_pots, MAX_SLOTS))
    s_basis = np.zeros((n_pots, MAX_SLOTS))
    s_h = np.zeros((n_pots, MAX_SLOTS), dtype=np.int8)
    alive = np.zeros((n_pots, MAX_SLOTS), dtype=bool)
    allowed = np.arange(MAX_SLOTS)[None, :] < slots_n[:, None]

    n_trades = np.zeros(n_pots); n_skip = np.zeros(n_pots); n_wins = np.zeros(n_pots)
    exp_sum = np.zeros(n_pots); exp_n = 0
    h_trades = np.zeros((n_pots, 5)); h_pnl = np.zeros((n_pots, 5))
    max_trade = np.zeros(n_pots); gross_profit = np.zeros(n_pots)
    peak = np.full(n_pots, START); maxdd = np.zeros(n_pots)
    pots_all = np.arange(n_pots)
    daily_dates, daily_eq = [], []
    prev_day = None

    for i in range(n_ev):
        today = dates[i]
        due = alive & (s_exit <= today)
        if due.any():
            cash += np.where(due, s_proceeds, 0.0).sum(1)
            tied -= np.where(due, s_basis, 0.0).sum(1)
            pnl = np.where(due, s_proceeds - s_basis, 0.0)
            for hh in range(5):
                sel = due & (s_h == hh)
                h_pnl[:, hh] += np.where(sel, s_proceeds - s_basis, 0.0).sum(1)
            max_trade = np.maximum(max_trade, pnl.max(1))
            gross_profit += np.clip(pnl, 0, None).sum(1)
            alive &= ~due
            s_exit = np.where(due, np.iinfo(np.int64).max, s_exit)

        h = hor_row_getter(i)
        a = act_row_getter(i)
        equity = cash + tied
        target = (conv / 10.0) * equity / slots_n
        free = allowed & ~alive
        want = (a == 1) & matured[i][h] & np.isfinite(raw[i][h])
        do = want & free.any(1) & (cash >= target) & (target > 0)
        n_skip += (want & ~do)

        if do.any():
            p = pots_all[do]
            slot = np.argmax(free[p], axis=1)
            size = target[p]
            fee = size * np.nan_to_num(cost_bps[i, csize[p]]) / 10000.0
            hp = h[p]
            ret = raw[i][hp]
            cash[p] -= size
            tied[p] += size
            s_basis[p, slot] = size
            s_proceeds[p, slot] = size * (1.0 + ret) - fee
            s_exit[p, slot] = exit_day[i, hp]
            s_h[p, slot] = hp
            alive[p, slot] = True
            n_trades[p] += 1
            n_wins[p] += (size * ret - fee) > 0
            np.add.at(h_trades, (p, hp), 1)

        eq = cash + tied
        exp_sum += tied / np.maximum(eq, 1e-9); exp_n += 1
        peak = np.maximum(peak, eq)
        maxdd = np.maximum(maxdd, (peak - eq) / peak)
        if track_daily and today != prev_day:
            daily_dates.append(today); daily_eq.append(eq.copy()); prev_day = today

    cash += np.where(alive, s_proceeds, 0.0).sum(1)
    pnl = np.where(alive, s_proceeds - s_basis, 0.0)
    gross_profit += np.clip(pnl, 0, None).sum(1)
    max_trade = np.maximum(max_trade, pnl.max(1))
    for hh in range(5):
        sel = alive & (s_h == hh)
        h_pnl[:, hh] += np.where(sel, s_proceeds - s_basis, 0.0).sum(1)
    return dict(final=cash, trades=n_trades, skipped=n_skip, wins=n_wins,
                exposure=exp_sum / max(exp_n, 1), maxdd=maxdd, h_trades=h_trades,
                h_pnl=h_pnl, max_trade=max_trade, gross_profit=gross_profit,
                daily_dates=np.array(daily_dates), daily_eq=np.array(daily_eq) if daily_eq else None)


def main():
    ev = pd.read_csv(OUT / 'events.csv')
    costs = json.loads((OUT / 'costs.json').read_text())
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    hor = np.load(OUT / 'horizon.npy', mmap_mode='r')
    grid = pd.read_csv(OUT / 'pots.csv')
    grid = grid[grid['control'].isna() | (grid['control'] == '')].reset_index(drop=True)
    n_pots = len(grid)

    ev['date'] = pd.to_datetime(ev['date'])
    tf = (ev['cohort'] == 'testfold').to_numpy()
    order = np.argsort(ev['date'].to_numpy()[tf], kind='stable')
    idx = np.where(tf)[0][order]
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
    slots_n = np.array([SLOTS_BY_FOCUS[f] for f in grid['focus']], dtype=np.int64)
    conv = grid['conviction'].to_numpy(dtype=np.float64)
    csize = np.array([size_ix[int(c)] for c in conv])
    years = (dates[-1] - dates[0]) / 365.25

    print(f'events {n_ev:,}  pots {n_pots:,}  window {years:.2f}y')
    print('loading decisions into memory...')
    A = np.asarray(act[:n_pots][:, idx])
    H = np.asarray(hor[:n_pots][:, idx]).astype(np.int64)

    print('pass 1: REAL signals')
    real = run(lambda i: A[:, i], lambda i: H[:, i], n_pots, n_ev, idx, dates, raw,
               exit_day, matured, cost_bps, csize, conv, slots_n, True)

    print('pass 2: PERMUTATION NULL (same trades, shuffled across events)')
    rng = np.random.default_rng(SEED)
    perm = rng.permutation(n_ev)
    Ap, Hp = A[:, perm], H[:, perm]
    null = run(lambda i: Ap[:, i], lambda i: Hp[:, i], n_pots, n_ev, idx, dates, raw,
               exit_day, matured, cost_bps, csize, conv, slots_n, False)

    bars = json.loads((OUT / 'benchmark_bars.json').read_text())['^GSPC']
    bd = np.array(sorted(bars))
    i0 = np.searchsorted(bd, str(np.datetime64(int(dates[0]), 'D')))
    i1 = min(np.searchsorted(bd, str(np.datetime64(int(dates[-1]), 'D'))), len(bd) - 1)
    bench = bars[str(bd[i1])] / bars[str(bd[i0])] - 1

    res = grid[TRAITS].copy()
    res['total_return'] = real['final'] / START - 1
    res['null_return'] = null['final'] / START - 1
    res['selection_alpha'] = res['total_return'] - res['null_return']
    res['exposure'] = real['exposure']
    res['beta_expected'] = res['exposure'] * bench
    res['excess_over_beta'] = res['total_return'] - res['beta_expected']
    res['return_per_exposure'] = res['total_return'] / np.maximum(res['exposure'], 1e-6)
    res['max_dd'] = real['maxdd']
    res['trades'] = real['trades']
    res['win_rate'] = np.where(real['trades'] > 0, real['wins'] / np.maximum(real['trades'], 1), np.nan)
    res['top_trade_share'] = np.where(real['gross_profit'] > 0,
                                      real['max_trade'] / np.maximum(real['gross_profit'], 1e-9), np.nan)

    eqc = real['daily_eq']
    dr = np.diff(eqc, axis=0) / np.maximum(eqc[:-1], 1e-9)
    sd = dr.std(0, ddof=1)
    res['sharpe'] = np.where(sd > 0, dr.mean(0) / sd * np.sqrt(252), np.nan)
    res.to_csv(OUT / 'portfolio2.csv', index=False)

    print('\n' + '=' * 82)
    print(f'PORTFOLIO v2 — exposure-adjusted, vs permutation null.  benchmark {bench:+.2%}')
    print('=' * 82)
    print(f'  exposure (avg capital deployed): median {res["exposure"].median():.1%}   '
          f'range {res["exposure"].min():.1%}-{res["exposure"].max():.1%}')
    print(f'  total return : median {res["total_return"].median():+.2%}')
    print(f'  PERMUTED null: median {res["null_return"].median():+.2%}')
    print(f'  SELECTION ALPHA (real - null): median {res["selection_alpha"].median():+.2%}   '
          f'share>0 {(res["selection_alpha"] > 0).mean():.1%}')
    print(f'  excess over exposure-matched beta: median {res["excess_over_beta"].median():+.2%}   '
          f'share>0 {(res["excess_over_beta"] > 0).mean():.1%}')
    print(f'  Sharpe (annualised, book value): median {res["sharpe"].median():.2f}   '
          f'best {res["sharpe"].max():.2f}   share>1 {(res["sharpe"] > 1).mean():.1%}')
    print(f'  largest single trade as share of gross profit: median '
          f'{res["top_trade_share"].median():.1%}')

    print('\n=== BY OPPORTUNISTIC ===')
    print(f'{"opp":>4}{"return":>10}{"null":>10}{"SEL-ALPHA":>11}{"expo":>8}{"vs beta":>10}{"Sharpe":>8}')
    for lvl in (1, 4, 7, 10):
        m = res['opportunistic'] == lvl
        print(f'{lvl:>4}{res.loc[m,"total_return"].mean():>+10.2%}{res.loc[m,"null_return"].mean():>+10.2%}'
              f'{res.loc[m,"selection_alpha"].mean():>+11.2%}{res.loc[m,"exposure"].mean():>8.1%}'
              f'{res.loc[m,"excess_over_beta"].mean():>+10.2%}{res.loc[m,"sharpe"].mean():>8.2f}')

    print('\n=== BY CONVICTION (v1 showed +5% -> +79%; is ANY of it selection?) ===')
    print(f'{"conv":>5}{"return":>10}{"null":>10}{"SEL-ALPHA":>11}{"expo":>8}{"vs beta":>10}{"Sharpe":>8}')
    for lvl in (1, 4, 7, 10):
        m = res['conviction'] == lvl
        print(f'{lvl:>5}{res.loc[m,"total_return"].mean():>+10.2%}{res.loc[m,"null_return"].mean():>+10.2%}'
              f'{res.loc[m,"selection_alpha"].mean():>+11.2%}{res.loc[m,"exposure"].mean():>8.1%}'
              f'{res.loc[m,"excess_over_beta"].mean():>+10.2%}{res.loc[m,"sharpe"].mean():>8.2f}')

    print('\n=== BY FOCUS (slots) ===')
    for lvl in (1, 4, 7, 10):
        m = res['focus'] == lvl
        print(f'  focus {lvl:>2} ({SLOTS_BY_FOCUS[lvl]:>2} slots): return '
              f'{res.loc[m,"total_return"].mean():+7.2%}  sel-alpha {res.loc[m,"selection_alpha"].mean():+7.2%}'
              f'  expo {res.loc[m,"exposure"].mean():5.1%}  Sharpe {res.loc[m,"sharpe"].mean():5.2f}')

    print('\n=== P&L ATTRIBUTION BY HORIZON (summed over all pots) ===')
    tot = real['h_pnl'].sum(0)
    tr = real['h_trades'].sum(0)
    for i, h in enumerate(HORIZONS):
        print(f'  {h:>3}: trades {tr[i]:>12,.0f}   P&L £{tot[i]:>16,.0f}   '
              f'per trade £{tot[i]/max(tr[i],1):>9,.0f}')

    print('\n=== TOP 5 BY SELECTION ALPHA (not raw return) ===')
    print(res.nlargest(5, 'selection_alpha')[TRAITS +
          ['total_return', 'null_return', 'selection_alpha', 'exposure', 'sharpe']]
          .to_string(index=False, float_format=lambda v: f'{v:,.3f}'))
    print('\nwrote portfolio2.csv')


if __name__ == '__main__':
    main()
