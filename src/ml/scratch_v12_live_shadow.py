#!/usr/bin/env python3
"""Shadow comparison: what would actually change if live stopped hedging everything
against SPY and used the per-market benchmark training was built on?

WHY THIS IS NOT A SAFE BLIND FLIP. `excess_return` does not merely feed the model — it
feeds the z-score that DECIDES WHAT COUNTS AS AN ANOMALY (LiveInferenceService.ts:305,
|z| > 2.15). Changing the benchmark for 445 symbols therefore changes which events are
DETECTED, not just how they are scored. That is a behavioural change to a system issuing
daily recommendations, so the blast radius gets measured before anything is touched.

WHAT IS COMPARED, per symbol per day, over a recent window:
    current   excess = r - beta_SPY  * spy_return(same date)     <- live today
    proposed  excess = r - beta_nat  * native_return(same date)  <- matches training
then live's own convention: 90-day rolling window EXCLUDING the current bar, and
detection at |z| > 2.15.

Reports detections that APPEAR, DISAPPEAR, and PERSIST under the change, by market.

CAVEAT: live hedges against the SPY ETF; this uses ^GSPC as the stand-in, since that is
what is stored locally. Their daily returns differ only by tracking error and dividend
treatment, which is immaterial for a z-score threshold comparison — but it does mean the
absolute detection counts here are indicative, not a byte-exact replay of live.

Usage:
  python src/ml/scratch_v12_live_shadow.py [--since 2024-08-01]
"""
import argparse
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).parent.parent.parent
Z_THRESHOLD = 2.15      # LiveInferenceService.ts:84
ROLLING_WINDOW = 90     # LiveInferenceService.ts:85
BETA_WINDOW = 60

NATIVE_BENCHMARK = {
    '.AX': '^AXJO', '.SW': '^SSMI', '.ST': '^OMX', '.SI': '^STI', '.L': '^FTSE',
    '.DE': '^GDAXI', '.PA': '^FCHI', '.TO': '^GSPTSE', '.NS': '^BSESN',
    '.BO': '^BSESN', '.HK': '^HSI',
}


def suffix(s):
    s = str(s).upper()
    i = s.rfind('.')
    return s[i:] if i != -1 else 'US'


def zseries(bar_dates, closes, bench_by_date):
    """Live's construction: per-day 60-bar beta against the benchmark, then a 90-day
    rolling mean/sd of excess returns EXCLUDING the current bar (LiveInferenceService
    .ts:287-298)."""
    n = len(closes)
    r = np.zeros(n)
    for i in range(1, n):
        if closes[i - 1]:
            r[i] = (closes[i] - closes[i - 1]) / closes[i - 1]
    b = np.array([bench_by_date.get(d, np.nan) for d in bar_dates])
    ex = np.zeros(n)
    for i in range(1, n):
        lo = max(1, i - (BETA_WINDOW - 1))
        m = ~np.isnan(b[lo:i + 1])
        beta = 1.0
        if m.sum() >= 10:
            bb, ss = b[lo:i + 1][m], r[lo:i + 1][m]
            vb = np.sum((bb - bb.mean()) ** 2)
            if vb > 1e-12:
                beta = float(np.sum((bb - bb.mean()) * (ss - ss.mean())) / vb)
        bt = b[i] if np.isfinite(b[i]) else 0.0
        ex[i] = r[i] - beta * bt
    z = np.full(n, np.nan)
    for i in range(1, n):
        lo = max(1, i - ROLLING_WINDOW)
        w = ex[lo:i]                      # excludes the current bar, as live does
        if len(w) < 10:
            continue
        mu, sd = w.mean(), w.std(ddof=1)
        if sd > 1e-12:
            z[i] = (ex[i] - mu) / sd
    return z


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', default='2024-08-01')
    args = ap.parse_args()

    con = sqlite3.connect(f'file:{ROOT / "market_cache.db"}?mode=ro', uri=True)
    cur = con.cursor()

    bench = {}
    for t in set(NATIVE_BENCHMARK.values()) | {'^GSPC'}:
        rows = cur.execute(
            'SELECT date, close FROM benchmark_prices WHERE ticker=? ORDER BY date',
            (t,)).fetchall()
        bench[t] = {rows[i][0]: (rows[i][1] - rows[i - 1][1]) / rows[i - 1][1]
                    for i in range(1, len(rows)) if rows[i - 1][1]}
    spy = bench['^GSPC']

    feats = pd.read_csv(ROOT / 'src/ml/features.csv', low_memory=False, usecols=['symbol'])
    universe = sorted(feats['symbol'].unique())
    affected = [s for s in universe if suffix(s) in NATIVE_BENCHMARK]
    print(f'universe {len(universe):,} symbols; {len(affected):,} would change benchmark')
    print(f'comparison window: {args.since} -> present\n')

    lead = (pd.Timestamp(args.since) - pd.Timedelta(days=400)).strftime('%Y-%m-%d')
    rows_out = []
    for k, s in enumerate(affected):
        if k % 100 == 0:
            print(f'   {k}/{len(affected)} symbols')
        px = cur.execute(
            'SELECT date, close FROM daily_prices WHERE symbol=? AND date>=? ORDER BY date',
            (s, lead)).fetchall()
        if len(px) < 150:
            continue
        d = [p[0] for p in px]
        c = [p[1] for p in px]
        nat = bench[NATIVE_BENCHMARK[suffix(s)]]
        z_cur = zseries(d, c, spy)
        z_new = zseries(d, c, nat)
        for i, dt in enumerate(d):
            if dt < args.since or not np.isfinite(z_cur[i]) or not np.isfinite(z_new[i]):
                continue
            a, b = abs(z_cur[i]) > Z_THRESHOLD, abs(z_new[i]) > Z_THRESHOLD
            if a or b:
                rows_out.append((s, suffix(s), dt, z_cur[i], z_new[i], a, b))
    con.close()

    df = pd.DataFrame(rows_out, columns=['symbol', 'market', 'date', 'z_spy', 'z_native',
                                         'det_current', 'det_proposed'])
    if df.empty:
        print('no detections in window'); return
    persist = int((df.det_current & df.det_proposed).sum())
    lost = int((df.det_current & ~df.det_proposed).sum())
    gained = int((~df.det_current & df.det_proposed).sum())
    cur_tot, new_tot = int(df.det_current.sum()), int(df.det_proposed.sum())

    print('\n' + '=' * 70)
    print('BLAST RADIUS — live detections on affected symbols')
    print(f'  detected today (SPY-hedged)      : {cur_tot:,}')
    print(f'  detected after fix (native)      : {new_tot:,}')
    print(f'  PERSIST (same event both ways)   : {persist:,}')
    print(f'  DISAPPEAR (no longer flagged)    : {lost:,}')
    print(f'  APPEAR (newly flagged)           : {gained:,}')
    overlap = persist / max(1, cur_tot)
    print(f'\n  overlap with today\'s detections  : {100*overlap:.1f}%')
    print(f'  net change in detection count    : {new_tot - cur_tot:+,} '
          f'({100*(new_tot-cur_tot)/max(1,cur_tot):+.1f}%)')

    print(f'\n{"market":<8}{"today":>8}{"after":>8}{"persist":>9}{"lost":>7}{"gained":>8}{"overlap":>9}')
    print('-' * 60)
    for mk, g in df.groupby('market'):
        c0, c1 = int(g.det_current.sum()), int(g.det_proposed.sum())
        p = int((g.det_current & g.det_proposed).sum())
        print(f'{mk:<8}{c0:>8,}{c1:>8,}{p:>9,}{c0-p:>7,}{c1-p:>8,}'
              f'{100*p/max(1,c0):>8.0f}%')

    out = ROOT / 'src/ml/scratch/v12_live_shadow.csv'
    df.to_csv(out, index=False)
    print(f'\nwrote {out}')


if __name__ == '__main__':
    main()
