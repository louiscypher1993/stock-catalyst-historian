#!/usr/bin/env python3
"""HISTORIC POTS — characteristic & combination statistics.

For every characteristic VALUE and every COMBINATION of up to 4 characteristics
(7 singles=28 cells, 21 pairs=336, 35 triples=2,240, 35 quads=8,960 — 11,564 cells),
computes the 12 requested statistics — mean, median, mode, RMS, std, skewness,
kurtosis, coefficient of variation, IQR, median absolute deviation, 10% trimmed
mean, lag-1 autocorrelation — on BOTH:

  (a) pot-level average scores: each pot's avg_profit (mean P&L over its winning
      events) and avg_loss (mean P&L over its losing events), aggregated across
      the pots in the cell. Autocorrelation here is across pots in pot_id order —
      of limited meaning, included for spec-completeness (see README).
  (b) per-event P&L: the cell's mean P&L per event (averaged over its pots),
      a 45k-long DATE-ORDERED series — autocorrelation here is genuine serial
      dependence across events.

Also per cell: n_pots, overall mean P&L/event, and the action mix (hold/buy/sell %).

Outputs: combos_1.csv .. combos_4.csv + README.txt in scratch/historic_pots/.
Run AFTER historic_pots.py.
"""
import itertools
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats as sps

OUT = Path(__file__).parent / 'scratch' / 'historic_pots'
TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
LEVELS = [1, 4, 7, 10]
ROW_CHUNK = 512


def twelve(x, date_ordered):
    x = np.asarray(x, dtype=np.float64)
    x = x[np.isfinite(x)]
    if len(x) < 3:
        return dict.fromkeys(['mean', 'median', 'mode', 'rms', 'std', 'skew', 'kurt',
                              'cv', 'iqr', 'mad', 'tmean', 'autocorr'], np.nan)
    mean = x.mean()
    std = x.std(ddof=1)
    med = np.median(x)
    mode = float(sps.mode(np.round(x / 100) * 100, keepdims=False).mode)
    ac = np.nan
    if date_ordered and len(x) > 10 and std > 0:
        a, b = x[:-1] - mean, x[1:] - mean
        ac = float((a * b).mean() / x.var())
    elif not date_ordered and len(x) > 10 and std > 0:
        a, b = x[:-1] - mean, x[1:] - mean
        ac = float((a * b).mean() / x.var())
    return {
        'mean': mean, 'median': med, 'mode': mode,
        'rms': float(np.sqrt((x ** 2).mean())), 'std': std,
        'skew': float(sps.skew(x)), 'kurt': float(sps.kurtosis(x)),
        'cv': std / abs(mean) if abs(mean) > 1e-9 else np.nan,
        'iqr': float(np.subtract(*np.percentile(x, [75, 25]))),
        'mad': float(np.median(np.abs(x - med))),
        'tmean': float(sps.trim_mean(x, 0.1)),
        'autocorr': ac,
    }


def main():
    pots = pd.read_csv(OUT / 'pots.csv')
    grid = pots[pots['control'].isna() | (pots['control'] == '')]
    n_pots = len(grid)
    pnl = np.load(OUT / 'pnl.npy', mmap_mode='r')
    act = np.load(OUT / 'action.npy', mmap_mode='r')
    n_ev = pnl.shape[1]
    print(f'grid pots: {n_pots:,}   events: {n_ev:,}')

    # per-pot scalars in one pass
    avg_profit = np.zeros(n_pots); avg_loss = np.zeros(n_pots); mean_pnl = np.zeros(n_pots)
    frac_hold = np.zeros(n_pots); frac_buy = np.zeros(n_pots); frac_sell = np.zeros(n_pots)
    for lo in range(0, n_pots, ROW_CHUNK):
        hi = min(lo + ROW_CHUNK, n_pots)
        block = np.asarray(pnl[lo:hi], dtype=np.float64)
        pos = block > 0; neg = block < 0
        avg_profit[lo:hi] = np.where(pos.sum(1) > 0, (block * pos).sum(1) / np.maximum(pos.sum(1), 1), 0)
        avg_loss[lo:hi] = np.where(neg.sum(1) > 0, (block * neg).sum(1) / np.maximum(neg.sum(1), 1), 0)
        mean_pnl[lo:hi] = block.mean(1)
        ab = np.asarray(act[lo:hi])
        frac_hold[lo:hi] = (ab == 0).mean(1); frac_buy[lo:hi] = (ab == 1).mean(1); frac_sell[lo:hi] = (ab == 2).mean(1)
    print('per-pot scalars done')

    trait_vals = grid[TRAITS].to_numpy()
    lvl_idx = {v: i for i, v in enumerate(LEVELS)}

    for k in (1, 2, 3, 4):
        rows = []
        for combo in itertools.combinations(range(len(TRAITS)), k):
            names = [TRAITS[i] for i in combo]
            # cell id per pot for this combo
            cell = np.zeros(n_pots, dtype=np.int64)
            for i in combo:
                cell = cell * 4 + np.vectorize(lvl_idx.get)(trait_vals[:, i])
            n_cells = 4 ** k
            # mean P&L per event per cell: direct row-gather per cell (np.add.at is
            # far too slow at this scale; cells partition the pots so this is one
            # full pass over the memmap either way)
            cell_series = np.empty((n_cells, n_ev), dtype=np.float64)
            for c in range(n_cells):
                idx = np.where(cell == c)[0]
                cell_series[c] = np.asarray(pnl[idx], dtype=np.float64).mean(axis=0)
            for c in range(n_cells):
                mask = cell == c
                vals = {names[j]: LEVELS[(c // (4 ** (k - 1 - j))) % 4] for j in range(k)}
                row = {'combo': '+'.join(names), **vals, 'n_pots': int(mask.sum()),
                       'mean_pnl_per_event': mean_pnl[mask].mean(),
                       'frac_hold': frac_hold[mask].mean(), 'frac_buy': frac_buy[mask].mean(),
                       'frac_sell': frac_sell[mask].mean()}
                for prefix, vec, ordered in [('avgprofit', avg_profit[mask], False),
                                             ('avgloss', avg_loss[mask], False),
                                             ('eventpnl', cell_series[c], True)]:
                    for s, v in twelve(vec, ordered).items():
                        row[f'{prefix}_{s}'] = v
                rows.append(row)
        out = pd.DataFrame(rows)
        out.to_csv(OUT / f'combos_{k}.csv', index=False)
        print(f'combos_{k}.csv: {len(out)} cells')

    (OUT / 'README.txt').write_text(
        'combos_k.csv: one row per value-cell of each k-trait combination.\n'
        'avgprofit_*/avgloss_*: the 12 stats over POT-LEVEL average-profit / average-loss\n'
        '  scores of the pots in the cell (autocorr here is across pot_id order — included\n'
        '  for spec-completeness, interpret with caution).\n'
        'eventpnl_*: the 12 stats over the cell\'s per-event mean P&L, DATE-ORDERED —\n'
        '  autocorr here is genuine serial dependence.\n'
        'mode = mode of values rounded to the nearest £100. tmean = 10% trimmed mean.\n'
        'CAVEAT: models were trained on ~78% of events (insample); absolute levels are\n'
        'optimistic — see summary.txt; trait RANKINGS are the robust read.\n')
    print('done')


if __name__ == '__main__':
    main()
