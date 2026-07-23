#!/usr/bin/env python3
"""
v10 recon: dump per-head GAIN importance for every feature in the DEPLOYED
v9.4 heads (B/D1/D2/D3/D5), so the v10 DROP list can be grounded in real
gain numbers rather than memory. Read-only; writes a JSON summary to scratch/.
"""
import json
from pathlib import Path
import xgboost as xgb

ML_DIR = Path(__file__).parent
OUT = ML_DIR / 'scratch' / 'scratch_v10_gain_dump_results.json'

with open(ML_DIR / 'feature_metadata_v9.4.json') as f:
    COLS = json.load(f)['full_feature_cols']

HEADS = {
    'B':  'model_b_v9.4.json',
    'D1': 'model_d1_v9.4.json',
    'D2': 'model_d2_v9.4.json',
    'D3': 'model_d3_v9.4.json',
    'D5': 'model_d5_v9.4.json',
}

# per-feature gain, normalized to % of total gain, per head
per_head = {}
for name, fn in HEADS.items():
    m = xgb.XGBRegressor()
    m.load_model(ML_DIR / fn)
    booster = m.get_booster()
    gain = booster.get_score(importance_type='gain')  # keyed by f0,f1,... or names
    # xgboost keys by feature name if the booster carries them; else f{idx}
    total = sum(gain.values()) or 1.0
    # normalize + map f{idx}->name if needed
    norm = {}
    for k, v in gain.items():
        if k.startswith('f') and k[1:].isdigit():
            idx = int(k[1:])
            key = COLS[idx] if idx < len(COLS) else k
        else:
            key = k
        norm[key] = norm.get(key, 0.0) + v / total * 100.0
    per_head[name] = norm

# assemble a table: feature -> {head: gain%}, plus max across heads
table = {}
for c in COLS:
    row = {h: round(per_head[h].get(c, 0.0), 4) for h in HEADS}
    row['max'] = round(max(row.values()), 4)
    row['mean'] = round(sum(per_head[h].get(c, 0.0) for h in HEADS) / len(HEADS), 4)
    table[c] = row

ordered = dict(sorted(table.items(), key=lambda kv: kv[1]['max']))
OUT.write_text(json.dumps({'per_feature': ordered}, indent=2))

print(f"{'feature':<34} {'B':>7} {'D1':>7} {'D2':>7} {'D3':>7} {'D5':>7} {'max':>7} {'mean':>7}")
print('-' * 90)
for c, row in ordered.items():
    print(f"{c:<34} {row['B']:>7.3f} {row['D1']:>7.3f} {row['D2']:>7.3f} "
          f"{row['D3']:>7.3f} {row['D5']:>7.3f} {row['max']:>7.3f} {row['mean']:>7.3f}")
print(f"\nWrote {OUT}")
