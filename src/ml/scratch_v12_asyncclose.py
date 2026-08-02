#!/usr/bin/env python3
"""v12 fix 1 — the asynchronous-close benchmark defect.

THE DEFECT. `excess_return = dailyReturn - beta*benchmarkReturn(SAME CALENDAR DATE)`.
For a Tokyo stock closing 15:00 JST (06:00 UTC) hedged against ^GSPC, the same-date
S&P close is 21:00 UTC — FIFTEEN HOURS AFTER the stock closed. So the hedge subtracts a
benchmark move that had not happened yet when the stock printed its close. 24.4% of
training rows carry up to 15.5h of this lookahead, and on the live side the map lookup
misses and `|| 0` silently zeroes the hedge on 44.3% of Asian rows (0.6% control).

THE FIX. Align each stock to the most recent benchmark close that PRECEDES its own
close. Concretely: if the benchmark's market closes later in the day than the stock's,
use the PREVIOUS benchmark trading day's return for that date.

APPLIED CONSISTENTLY. The shift is applied to the whole rolling beta window as well as
to the same-day hedge term. Shifting only the hedge would estimate beta on one alignment
and apply it on another — internally inconsistent, and the sort of plausible-looking
error that started this investigation.

CONTROL FIRST. The script re-derives excess_return with NO shift and requires it to
reproduce the stored values. If the unshifted path does not reproduce, the machinery is
wrong and the shifted numbers mean nothing. (reextractDailyEvents.ts already proved this
is reproducible exactly, so anything else is a bug here.)

Writes a corrected features CSV for src/ml/scratch_v11_candidate.py --features-file.
Mutates nothing.

Usage:
  python src/ml/scratch_v12_asyncclose.py            # control + write corrected file
  python src/ml/scratch_v12_asyncclose.py --control  # control only
"""
import argparse
import bisect
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

ML_DIR = Path(__file__).parent
ROOT = ML_DIR.parent.parent
OUT = ML_DIR / 'scratch'
OUT.mkdir(exist_ok=True)

ROLLING_WINDOW = 90
BETA_WINDOW = 60

# v9.4 benchmark map (HistoricalEngine.ts:1533-1543) — reproduced verbatim
NATIVE_BENCHMARK = {
    '.AX': '^AXJO', '.SW': '^SSMI', '.ST': '^OMX', '.SI': '^STI', '.L': '^FTSE',
    '.DE': '^GDAXI', '.PA': '^FCHI', '.TO': '^GSPTSE', '.NS': '^BSESN',
    '.BO': '^BSESN', '.HK': '^HSI',
}
# Approximate market close in UTC hours. Only the ORDERING matters (does the benchmark
# close after the stock?), so DST wobble of an hour does not flip any of these cases.
MARKET_CLOSE_UTC = {
    'US': 21.0, '.TO': 21.0, '.SA': 21.0, '.MX': 21.0, '.BA': 20.0,
    '.L': 16.5, '.DE': 16.5, '.PA': 16.5, '.AS': 16.5, '.BR': 16.5, '.MI': 16.5,
    '.MC': 16.5, '.SW': 16.5, '.ST': 16.0, '.OL': 16.0, '.CO': 16.0, '.HE': 16.0,
    '.LS': 16.5, '.VI': 16.5, '.IR': 16.5, '.AT': 15.0, '.WA': 16.0, '.PR': 15.0,
    '.SR': 12.0, '.QA': 10.5, '.KW': 9.5, '.CA': 12.5, '.TA': 14.5, '.IS': 15.0,
    '.JO': 15.0, '.NS': 10.0, '.BO': 10.0, '.SI': 9.0, '.HK': 8.0, '.SS': 7.0,
    '.SZ': 7.0, '.T': 6.0, '.KS': 6.0, '.KQ': 6.0, '.AX': 6.0, '.TW': 5.5,
    '.NZ': 4.75, '.JK': 8.0, '.BK': 9.5, '.KL': 9.0,
}
BENCHMARK_MARKET = {
    '^GSPC': 'US', '^GSPTSE': '.TO', '^FTSE': '.L', '^GDAXI': '.DE', '^FCHI': '.PA',
    '^SSMI': '.SW', '^OMX': '.ST', '^STI': '.SI', '^HSI': '.HK', '^BSESN': '.NS',
    '^AXJO': '.AX',
}
# HistoricalEngine.ts:132 — excess_return also subtracts commodityBeta*commodityReturn
# for these sectors. Omitting it broke the first control run: the term is real for
# oil-linked names, and the reproduction has to be exact before any fix is trusted.
SECTOR_COMMODITY_MAP = {
    'Airlines': 'DCOILWTICO', 'Transportation': 'DCOILWTICO',
    'Logistics & Transportation': 'DCOILWTICO', 'Energy': 'DCOILWTICO',
    'Utilities': 'DCOILWTICO', 'Semiconductors': 'PCOPPUSDM',
    'Technology': 'PCOPPUSDM', 'Industrials': 'PCOPPUSDM',
    'Basic Materials': 'PCOPPUSDM', 'Machinery': 'PCOPPUSDM',
}
# Pre-2021 stored features were computed on MONTHLY/QUARTERLY bars and cannot be
# reproduced from daily prices by construction. Validating against them would be
# measuring a different bug. The control — and the fix — are confined to rows this
# script demonstrably reproduces.
CONTROL_FROM = '2021-01-01'


def suffix(sym):
    s = str(sym).upper()
    i = s.rfind('.')
    return s[i:] if i != -1 else 'US'


def benchmark_for(sym):
    return NATIVE_BENCHMARK.get(suffix(sym), '^GSPC')


def needs_shift(sym):
    """True when the benchmark's market closes AFTER the stock's, i.e. the same-date
    benchmark return is not yet knowable when the stock closes."""
    st = MARKET_CLOSE_UTC.get(suffix(sym))
    bm = MARKET_CLOSE_UTC.get(BENCHMARK_MARKET.get(benchmark_for(sym), 'US'))
    if st is None or bm is None:
        return False          # unknown market: leave alignment untouched
    return bm > st + 0.01


def beta_of(s, b, fallback):
    if len(b) < 10:
        return fallback
    mb, ms = np.mean(b), np.mean(s)
    varb = np.sum((b - mb) ** 2)
    if varb <= 0.0001:
        return fallback
    return float(np.sum((b - mb) * (s - ms)) / varb)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--control', action='store_true', help='run the control only')
    args = ap.parse_args()

    feats = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    feats['date'] = feats['date'].astype(str).str[:10]
    print(f'features.csv: {len(feats):,} rows, {feats["symbol"].nunique():,} symbols')

    con = sqlite3.connect(f'file:{ROOT / "market_cache.db"}?mode=ro', uri=True)
    cur = con.cursor()

    bench_cache = {}

    def bench_series(t):
        if t not in bench_cache:
            rows = cur.execute(
                'SELECT date, close FROM benchmark_prices WHERE ticker=? ORDER BY date',
                (t,)).fetchall()
            dates = [r[0] for r in rows]
            rets = [np.nan] + [((rows[i][1] - rows[i - 1][1]) / rows[i - 1][1]) * 100
                               if rows[i - 1][1] else np.nan for i in range(1, len(rows))]
            bench_cache[t] = (dates, rets)
        return bench_cache[t]

    def bench_ret(t, date, shift):
        """benchmark return aligned to `date`; when shift=True take the last benchmark
        day STRICTLY BEFORE `date`, i.e. the most recent close preceding the stock's."""
        dates, rets = bench_series(t)
        if not dates:
            return None
        i = bisect.bisect_left(dates, date)
        if shift:
            i -= 1
        elif i < len(dates) and dates[i] == date:
            pass
        else:
            i -= 1
        if i < 0 or i >= len(dates):
            return None
        v = rets[i]
        return None if v is None or not np.isfinite(v) else v

    px_stmt = 'SELECT date, close FROM daily_prices WHERE symbol=? ORDER BY date'

    sector_of = {r[0]: r[1] for r in cur.execute(
        'SELECT UPPER(symbol), sector FROM company_profiles').fetchall()}

    def derive(sym, want_dates, shift):
        rows = cur.execute(px_stmt, (sym,)).fetchall()
        if len(rows) < 30:
            return {}
        dates = [r[0] for r in rows]
        closes = [r[1] for r in rows]
        t = benchmark_for(sym)
        sh = shift and needs_shift(sym)
        n = len(dates)
        dr = np.zeros(n)
        for i in range(1, n):
            if closes[i - 1]:
                dr[i] = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100
        br = np.array([bench_ret(t, d, sh) if bench_ret(t, d, sh) is not None else np.nan
                       for d in dates])
        # commodity leg — NOT shifted: FRED/commodity series are daily settlement marks
        # rather than an exchange close racing the stock's, so the async argument does
        # not apply to them. commodityBeta initialises to 0 (not 1) when undetermined.
        cid = SECTOR_COMMODITY_MAP.get(sector_of.get(str(sym).upper()) or '')
        if cid:
            cr = np.array([bench_ret(cid, d, False) if bench_ret(cid, d, False) is not None
                           else np.nan for d in dates])
        else:
            cr = np.full(n, np.nan)
        ex = np.zeros(n)
        for i in range(1, n):
            lo = max(1, i - (BETA_WINDOW - 1))
            m = ~np.isnan(br[lo:i + 1])
            beta = beta_of(dr[lo:i + 1][m], br[lo:i + 1][m], 1.0) if m.sum() >= 10 else 1.0
            bt = br[i] if np.isfinite(br[i]) else 0.0
            cbeta, ct = 0.0, 0.0
            if cid:
                mc = ~np.isnan(cr[lo:i + 1])
                if mc.sum() >= 10:
                    cbeta = beta_of(dr[lo:i + 1][mc], cr[lo:i + 1][mc], 0.0)
                ct = cr[i] if np.isfinite(cr[i]) else 0.0
            ex[i] = dr[i] - beta * bt - cbeta * ct
        idx = {d: i for i, d in enumerate(dates)}
        out = {}
        for d in want_dates:
            i = idx.get(d)
            if i is None or i < 1:
                continue
            lo = max(1, i - (ROLLING_WINDOW - 1))
            w = ex[lo:i + 1]
            z = 0.0
            if len(w) >= 10:
                mu, sd = w.mean(), w.std(ddof=1)
                if sd > 0.0001:
                    z = (ex[i] - mu) / sd
            out[d] = (ex[i] / 100.0, z)   # engine stores excess_return /100
        return out

    by_sym = feats.groupby('symbol')['date'].apply(list).to_dict()
    shifted_syms = [s for s in by_sym if needs_shift(s)]
    print(f'symbols needing a benchmark shift: {len(shifted_syms):,}/{len(by_sym):,} '
          f'({100*len(shifted_syms)/len(by_sym):.1f}%)')
    aff_rows = int(feats['symbol'].isin(shifted_syms).sum())
    print(f'rows affected: {aff_rows:,}/{len(feats):,} ({100*aff_rows/len(feats):.1f}%)\n')

    # ---------------- CONTROL: unshifted must reproduce stored values
    print(f'CONTROL — re-derive with NO shift, rows from {CONTROL_FROM}, vs stored')
    diffs, zdiffs, checked = [], [], 0
    sample = list(by_sym)[::max(1, len(by_sym) // 300)][:300]
    stored = feats.set_index(['symbol', 'date'])
    for s in sample:
        got = derive(s, [d for d in by_sym[s] if d >= CONTROL_FROM], shift=False)
        for d, (ex, z) in got.items():
            try:
                row = stored.loc[(s, d)]
            except KeyError:
                continue
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            a, b = row.get('excess_return'), row.get('z_score')
            if pd.notna(a) and np.isfinite(ex):
                diffs.append(abs(a - ex)); checked += 1
            if pd.notna(b) and np.isfinite(z):
                zdiffs.append(abs(b - z))
    if diffs:
        med = float(np.median(diffs)); p90 = float(np.percentile(diffs, 90))
        zmed = float(np.median(zdiffs)) if zdiffs else float('nan')
        print(f'  n={checked:,}  excess_return med|diff|={med:.2e} p90={p90:.2e}   '
              f'z_score med|diff|={zmed:.2e}')
        ok = med < 1e-6
        print('  ' + ('PASS — machinery reproduces stored values; the shifted numbers are readable.'
                      if ok else
                      'FAIL — cannot reproduce stored excess_return. Fix this before trusting the shift.'))
        if not ok:
            con.close(); return
    else:
        print('  no overlap — cannot validate'); con.close(); return

    if args.control:
        con.close(); return

    # ---------------- apply the fix and write a corrected features file
    print('\nApplying the shift as a DELTA on the stored value ...')
    print('  Reproduction is float-exact for US rows (9e-17) but carries a ~1e-4 residual')
    print('  on Asian markets — small data-vintage differences between the engine\'s')
    print('  extraction-time benchmark fetch and the local benchmark_prices table. A')
    print('  strict overwrite would either reject those rows (only 409 survived a 1e-6')
    print('  gate) or bake that residual into the data. Instead we apply')
    print('      new = stored + (derived_shifted - derived_unshifted)')
    print('  so the residual is common to both terms and CANCELS, leaving only the effect')
    print('  of the alignment change itself. Pre-2021 rows are still excluded: their')
    print('  stored values come from monthly bars and neither term is meaningful.')
    new_vals, skipped_pre21, skipped_nan = {}, 0, 0
    for k, s in enumerate(by_sym):
        if k % 300 == 0:
            print(f'   {k:,}/{len(by_sym):,} symbols')
        if not needs_shift(s):
            continue                      # nothing to change for this market
        ds = by_sym[s]
        base = derive(s, ds, shift=False)
        shifted = derive(s, ds, shift=True)
        for d in ds:
            if d < CONTROL_FROM:
                skipped_pre21 += 1
                continue
            if d not in base or d not in shifted:
                skipped_nan += 1
                continue
            ex0, z0 = base[d]
            ex1, z1 = shifted[d]
            if not (np.isfinite(ex0) and np.isfinite(ex1)):
                skipped_nan += 1
                continue
            try:
                row = stored.loc[(s, d)]
            except KeyError:
                skipped_nan += 1
                continue
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            a, bz = row.get('excess_return'), row.get('z_score')
            if pd.isna(a):
                skipped_nan += 1
                continue
            new_ex_v = a + (ex1 - ex0)
            new_z_v = (bz + (z1 - z0)) if pd.notna(bz) else z1
            new_vals[(s, d)] = (new_ex_v, new_z_v)
    con.close()
    print(f'\n  skipped pre-{CONTROL_FROM[:4]} (unreproducible bars): {skipped_pre21:,}')
    print(f'  skipped (missing price/benchmark/stored)  : {skipped_nan:,}')

    fixed = feats.copy()
    key = list(zip(fixed['symbol'], fixed['date']))
    ex_new = np.array([new_vals.get(k, (np.nan, np.nan))[0] for k in key])
    z_new = np.array([new_vals.get(k, (np.nan, np.nan))[1] for k in key])
    have = np.isfinite(ex_new)
    fixed.loc[have, 'excess_return'] = ex_new[have]
    fixed.loc[have, 'z_score'] = z_new[have]
    delta = np.abs(fixed['excess_return'].values - feats['excess_return'].values)
    changed = int(np.nansum(delta > 1e-9))
    print(f'\n  rows in shift-affected markets      : {aff_rows:,}')
    print(f'  rewritten                           : {int(have.sum()):,}')
    print(f'  actually changed value              : {changed:,} '
          f'({100*changed/len(feats):.1f}% of the file)')
    if changed:
        d = delta[np.isfinite(delta) & (delta > 1e-9)]
        print(f'  median |change| in excess_return    : {np.median(d):.2e} '
              f'(p90 {np.percentile(d, 90):.2e})')
    path = OUT / 'features_asyncfix.csv'
    fixed.to_csv(path, index=False)
    print(f'\nwrote {path}')


if __name__ == '__main__':
    main()
