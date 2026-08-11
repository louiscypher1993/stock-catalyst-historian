#!/usr/bin/env python3
"""HISTORIC POTS — per-event trading simulation over every real training event.

Spec (Lewis, 2026-08-11):
  Each pot starts EVERY event with £100,000 cash + £100,000 of that company's shares
  (valued at the event-date price by construction: P&L is computed in return space
  from the event row's own forward labels, so today's price never enters). The event
  is scored through the deployed models as a live scan would score it; the pot sees
  the predicted horizon returns + riskScore, picks a horizon via its traits (the NEW
  `opportunistic` trait sets how strongly it chases the best predicted horizon vs
  its patience-native one — the choice DEPENDS on the predictions, it is not fixed
  per pot), then chooses HOLD / BUY-more(size) / SELL(size). Realized P&L uses the
  ACTUAL forward return of the chosen horizon. Money resets every event.

Pot population: full grid over 7 traits x levels {1,4,7,10} = 16,384 pots,
plus 3 controls: ALWAYS-HOLD, ALWAYS-BUY (all cash), ALWAYS-SELL (all shares) — all
three on the 2W horizon (the recommendation basis).

Decision model (deterministic, no RNG — reproducible):
  eligible horizons: all 5, except 1M for pre-2021 events (forward_return_1m label
    corrupt on monthly/quarterly-bar rows — the known 27% contamination).
  time-scaled utility     u_h   = pred_h / sqrt(days_h / 14)          (2W-normalised)
  home prior              prior = exp(-|h - home(patience)| / width), width=(11-focus)/5
  choice score            c_h   = (opportunistic/10)*|u_h|/max|u| + (1-opp/10)*prior
  chosen horizon          H     = argmax c_h
  risk gate               riskScore > boldness*10  ->  forced HOLD   (PotService:531)
  act threshold           t_H   = base_H * ambition / reactivity
      base per horizon from HORIZON_TIER_CONFIG's calibrated tiers:
      2D 0.0108 (strongBuy) | 2W 0.0247 (buy) | 1M 0.04 (no config; interpolated)
      | 3M 0.0576 (strongBuy) | 6M 0.1067 (buy)
  action: pred_H >= t_H -> BUY (conviction/10 * £100k more shares)
          pred_H <= -t_H -> SELL (conviction/10 * £100k of shares)
          else HOLD
  P&L = (100000 + signed_amount) * actual_H

riskScore reconstructed exactly as production: (1-Crank_v9.5)*40 + (1-A_cal)*30
  + 30 if D5 <= -0.001411 (the 2W sell tier). Model A through its isotonic calibrator.

HONESTY CAVEAT (printed + stored): the deployed models were TRAINED on ~78% of these
events. Absolute P&L on the insample cohort is optimistic by construction. The
testfold cohort (date >= 2025-02-13) is the honest slice; trait RANKINGS are more
robust than absolute levels everywhere. B/C predictions additionally sit on corrupt
labels pre-2021 (their training saw them); 1M is excluded from choice there.

Outputs (src/ml/scratch/historic_pots/, gitignored — ~3GB):
  pnl.npy      float32 memmap  (n_pots x n_events)   per-event P&L in £
  action.npy   uint8           0=HOLD 1=BUY 2=SELL
  horizon.npy  uint8           0=2D 1=2W 2=1M 3=3M 4=6M
  pots.csv     trait table (pot_id, 7 traits; controls flagged)
  events.csv   symbol, date, cohort, preds, actuals, riskScore
  summary.txt  controls + cohort headline

Run: python historic_pots.py            (~10-20 min)
Then: python historic_pots_stats.py     (characteristic/combination statistics)
"""
import itertools
import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

ML = Path(__file__).parent
OUT = ML / 'scratch' / 'historic_pots'
OUT.mkdir(parents=True, exist_ok=True)

TRAITS = ['boldness', 'ambition', 'patience', 'conviction', 'focus', 'reactivity', 'opportunistic']
LEVELS = [1, 4, 7, 10]
HORIZONS = ['2D', '2W', '1M', '3M', '6M']
H_DAYS = np.array([2, 14, 30, 91, 182], dtype=np.float32)
H_BASE = np.array([0.0108, 0.0247, 0.04, 0.0576, 0.1067], dtype=np.float32)
LABELS = ['forward_return_2d', 'forward_return_2w', 'forward_return_1m',
          'forward_return_3m', 'forward_return_6m']
TESTFOLD_START = '2025-02-13'
CAPITAL = 100_000.0
CHUNK = 1024  # (16,384 pots x 1,024 events x 5 horizons) f32 ~= 335MB per big intermediate

HEADS = {  # prediction column -> (artefact, clamp)
    'p_2D': ('model_d3_v9.4.json', 0.20),
    'p_2W': ('model_d5_v9.4.json', 0.35),
    'p_1M': ('model_b_v9.4.json', 0.30),
    'p_3M': ('model_d1_v9.4.json', 0.50),
    'p_6M': ('model_d2_v9.4.json', 0.40),
    'p_C':  ('model_c_v9.5.json', None),
}


def load_model(fname):
    j = json.load(open(ML / fname))
    feats = j['learner']['feature_names']
    bst = xgb.Booster(); bst.load_model(str(ML / fname))
    attrs = j['learner'].get('attributes', {})
    rng = (0, int(attrs['best_iteration']) + 1) if 'best_iteration' in attrs else None
    return feats, bst, rng


def predict(fname, clamp, frame):
    feats, bst, rng = load_model(fname)
    X = frame.reindex(columns=feats, fill_value=0)
    p = (bst.predict(xgb.DMatrix(X, feature_names=feats), iteration_range=rng)
         if rng else bst.predict(xgb.DMatrix(X, feature_names=feats)))
    return np.clip(p, -clamp, clamp) if clamp is not None else p


def c_rank(values):
    bp = json.load(open(ML / 'model_c_breakpoints_v9.5.json'))['breakpoints']
    ps = np.array([b[0] for b in bp]); vs = np.array([b[1] for b in bp])
    return np.interp(values, vs, ps)  # clamps at both ends, matches infer.py


def main():
    print('loading events...')
    df = pd.read_csv(ML / 'features.csv', low_memory=False)
    df['date'] = df['date'].astype(str).str[:10]
    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith(('.NYSE', '.NASDAQ')) else 0
    ).astype(int)
    ev = df[df['is_null_sample'] == 0].sort_values('date').reset_index(drop=True)
    n_ev = len(ev)
    print(f'events: {n_ev:,}  ({ev["date"].min()} -> {ev["date"].max()})')

    print('scoring deployed models...')
    preds = {}
    for col, (fname, clamp) in HEADS.items():
        preds[col] = predict(fname, clamp, ev).astype(np.float32)
        print(f'  {col}: {fname} median {np.median(preds[col]):+.4f}')
    # Model A + isotonic calibrator (binary head: Booster gives probability directly)
    feats_a, bst_a, rng_a = load_model('model_a_v9.1.json')
    Xa = ev.reindex(columns=feats_a, fill_value=0)
    pa = (bst_a.predict(xgb.DMatrix(Xa, feature_names=feats_a), iteration_range=rng_a)
          if rng_a else bst_a.predict(xgb.DMatrix(Xa, feature_names=feats_a)))
    with open(ML / 'calibrator_a_v9.1.pkl', 'rb') as f:
        cal = pickle.load(f)
    a_cal = np.asarray(cal.predict(pa) if hasattr(cal, 'predict') else cal.transform(pa), dtype=np.float32)
    print(f'  A: raw median {np.median(pa):.4f} -> calibrated median {np.median(a_cal):.4f} '
          f'(share >=0.9999: {(a_cal >= 0.9999).mean():.1%})')

    rank = c_rank(preds['p_C']).astype(np.float32)
    sell_2w = preds['p_2W'] <= -0.001411
    risk = np.round(np.clip((1 - rank) * 40 + (1 - a_cal) * 30 + np.where(sell_2w, 30, 0), 0, 100))
    print(f'  riskScore: p10/p50/p90 = {np.percentile(risk, [10, 50, 90])}')

    P = np.stack([preds['p_2D'], preds['p_2W'], preds['p_1M'], preds['p_3M'], preds['p_6M']], axis=1)
    A = ev[LABELS].to_numpy(dtype=np.float32)[:, [0, 1, 2, 3, 4]]  # same order as HORIZONS
    pre2021 = (ev['date'] < '2021-01-01').to_numpy()
    cohort = np.where(ev['date'] >= TESTFOLD_START, 'testfold', 'insample')

    # pot grid
    grid = np.array(list(itertools.product(LEVELS, repeat=len(TRAITS))), dtype=np.float32)
    n_pots = len(grid)
    pots = pd.DataFrame(grid.astype(int), columns=TRAITS)
    pots['control'] = ''
    controls = pd.DataFrame([dict.fromkeys(TRAITS, 0) | {'control': c}
                             for c in ['ALWAYS_HOLD', 'ALWAYS_BUY', 'ALWAYS_SELL']])
    pots = pd.concat([pots, controls], ignore_index=True)
    pots.index.name = 'pot_id'
    total_pots = len(pots)
    print(f'pots: {n_pots:,} grid + 3 controls = {total_pots:,}')

    # per-pot derived scalars (grid pots only)
    boldness, ambition, patience = grid[:, 0], grid[:, 1], grid[:, 2]
    conviction, focus, reactivity, opp = grid[:, 3], grid[:, 4], grid[:, 5], grid[:, 6]
    home = np.clip(((patience - 1) / 9 * 4).round(), 0, 4).astype(np.int32)   # 1..10 -> 0..4
    width = (11 - focus) / 5
    w_chase = (opp / 10).astype(np.float32)
    size_frac = (conviction / 10).astype(np.float32)
    risk_cap = (boldness * 10).astype(np.float32)
    thresh_mult = (ambition / reactivity).astype(np.float32)
    prior = np.exp(-np.abs(home[:, None] - np.arange(5)[None, :]) / width[:, None]).astype(np.float32)

    pnl = np.lib.format.open_memmap(OUT / 'pnl.npy', mode='w+', dtype=np.float32, shape=(total_pots, n_ev))
    act = np.lib.format.open_memmap(OUT / 'action.npy', mode='w+', dtype=np.uint8, shape=(total_pots, n_ev))
    hor = np.lib.format.open_memmap(OUT / 'horizon.npy', mode='w+', dtype=np.uint8, shape=(total_pots, n_ev))

    u_scale = np.sqrt(H_DAYS / 14)[None, :]
    for lo in range(0, n_ev, CHUNK):
        hi = min(lo + CHUNK, n_ev)
        Pk = P[lo:hi]                                     # (E,5)
        u = Pk / u_scale                                  # time-scaled
        u_abs = np.abs(u)
        u_norm = u_abs / (u_abs.max(axis=1, keepdims=True) + 1e-9)
        # choice score: (pots,E,5) built pot-chunk-free via broadcasting on (n_pots,1,5)x(1,E,5)
        c = w_chase[:, None, None] * u_norm[None, :, :] + (1 - w_chase)[:, None, None] * prior[:, None, :]
        if pre2021[lo:hi].any():
            c[:, pre2021[lo:hi], 2] = -np.inf             # 1M ineligible pre-2021
        H = c.argmax(axis=2)                              # (pots,E)
        predH = np.take_along_axis(np.broadcast_to(Pk[None], c.shape), H[:, :, None], 2)[:, :, 0]
        actH = np.take_along_axis(np.broadcast_to(A[lo:hi][None], c.shape), H[:, :, None], 2)[:, :, 0]
        t = H_BASE[H] * thresh_mult[:, None]
        buy = predH >= t
        sell = predH <= -t
        gate = risk[None, lo:hi] > risk_cap[:, None]      # risk too high -> forced HOLD
        buy &= ~gate; sell &= ~gate
        amt = np.where(buy, size_frac[:, None] * CAPITAL, np.where(sell, -size_frac[:, None] * CAPITAL, 0.0))
        pnl[:n_pots, lo:hi] = (CAPITAL + amt) * actH
        act[:n_pots, lo:hi] = np.where(buy, 1, np.where(sell, 2, 0)).astype(np.uint8)
        hor[:n_pots, lo:hi] = H.astype(np.uint8)
        # controls (2W horizon)
        a2w = A[lo:hi, 1]
        pnl[n_pots + 0, lo:hi] = CAPITAL * a2w;       act[n_pots + 0, lo:hi] = 0
        pnl[n_pots + 1, lo:hi] = 2 * CAPITAL * a2w;   act[n_pots + 1, lo:hi] = 1
        pnl[n_pots + 2, lo:hi] = 0.0;                 act[n_pots + 2, lo:hi] = 2
        hor[n_pots:, lo:hi] = 1
        if (lo // CHUNK) % 5 == 0:
            print(f'  events {lo:,}..{hi:,} done')
    pnl.flush(); act.flush(); hor.flush()

    pots.to_csv(OUT / 'pots.csv')
    ev_out = ev[['symbol', 'date']].copy()
    ev_out['cohort'] = cohort
    for i, h in enumerate(HORIZONS):
        ev_out[f'pred_{h}'] = P[:, i]
        ev_out[f'actual_{h}'] = A[:, i]
    ev_out['risk_score'] = risk
    ev_out.to_csv(OUT / 'events.csv', index=False)

    lines = [f'events={n_ev}  pots={total_pots}  (grid {n_pots} + 3 controls)',
             f'cohorts: insample={np.sum(cohort == "insample")}  testfold={np.sum(cohort == "testfold")}',
             'CAVEAT: models were trained on the insample cohort; its P&L is optimistic by',
             'construction. testfold (>=2025-02-13) is the honest slice; trait RANKINGS are',
             'more robust than absolute levels.', '']
    tf = cohort == 'testfold'
    for name, row in [('ALWAYS_HOLD', n_pots), ('ALWAYS_BUY', n_pots + 1), ('ALWAYS_SELL', n_pots + 2)]:
        p = pnl[row]
        lines.append(f'{name:<12} mean £{p.mean():+,.0f}/event  (insample £{p[~tf].mean():+,.0f}, '
                     f'testfold £{p[tf].mean():+,.0f})')
    g = pnl[:n_pots]
    gm = g.mean(axis=1)
    lines += ['', f'grid pots mean-P&L/event: best £{gm.max():+,.0f}  median £{np.median(gm):+,.0f}  '
              f'worst £{gm.min():+,.0f}']
    best = pots.iloc[int(gm.argmax())][TRAITS].to_dict()
    lines.append(f'best grid pot traits: {best}')
    (OUT / 'summary.txt').write_text('\n'.join(lines))
    print('\n' + '\n'.join(lines))


if __name__ == '__main__':
    main()
