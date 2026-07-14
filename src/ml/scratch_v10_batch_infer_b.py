#!/usr/bin/env python3
"""
v10 recon (b): batch-scores ALL real, post-2016 events in features.csv through
the CURRENTLY DEPLOYED models (same files/versions infer.py loads), in one
vectorized pass instead of infer.py's per-call subprocess+model-reload pattern.

Excludes:
  - is_null_sample == 1 (negative-control training rows, never reach decidePot()
    in production)
  - date < 2016-01-01 (predates daily_prices' actual coverage; these rows look
    like synthetic/placeholder backfill -- constant vixAtEvent=0.2199, dates
    landing on quarterly boundaries -- not genuine point-in-time detections)

Writes symbol/date + the 7 model outputs PotService.ts's gate logic reads
(model_a_confidence, model_b_return_1m, model_c_max_drawdown,
model_d1_return_3m, model_d2_return_6m, model_d3_return_2d,
model_d5_return_2w) + the ground-truth forward_return_* columns (already in
features.csv, real outcomes -- not model output) to a NEW local sqlite file.
Never touches market_cache.db or Supabase.
"""
import json
import pickle
import sqlite3
from pathlib import Path

import pandas as pd
import xgboost as xgb

ML_DIR = Path(__file__).parent
OUT_DB = ML_DIR.parent.parent / 'synthetic_pots' / 'v10_history_sweep.db'

MODEL_A_COLS = [
    'z_score', 'excess_return', 'volume_ratio', 'relative_volume_30d',
    'seismic_magnitude_mw', 'pre_return_3d', 'pre_return_5d',
    'pre_return_10d', 'pre_return_21d', 'pre_vol_ratio_5d', 'pre_vol_ratio_10d',
]


def load_models():
    model_a = xgb.XGBClassifier()
    model_a.load_model(ML_DIR / 'model_a_v9.1.json')
    with open(ML_DIR / 'calibrator_a_v9.1.pkl', 'rb') as f:
        calibrator_a = pickle.load(f)
    model_c = xgb.XGBRegressor(); model_c.load_model(ML_DIR / 'model_c_v9.1.json')
    model_b = xgb.XGBRegressor(); model_b.load_model(ML_DIR / 'model_b_v9.3.json')
    model_d1 = xgb.XGBRegressor(); model_d1.load_model(ML_DIR / 'model_d1_v9.3.json')
    model_d2 = xgb.XGBRegressor(); model_d2.load_model(ML_DIR / 'model_d2_v9.3.json')
    model_d3 = xgb.XGBRegressor(); model_d3.load_model(ML_DIR / 'model_d3_v9.3.json')
    model_d5 = xgb.XGBRegressor(); model_d5.load_model(ML_DIR / 'model_d5_v9.3.json')
    return model_a, calibrator_a, model_b, model_c, model_d1, model_d2, model_d3, model_d5


def main():
    df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
    print(f'features.csv: {len(df)} rows')

    df['is_us_listed'] = df['symbol'].apply(
        lambda s: 1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0
    ).astype(int)

    pop_b = df[(df['is_null_sample'] == 0) & (df['date'] >= '2016-01-01')].copy()
    excluded_pre2016 = df[(df['is_null_sample'] == 0) & (df['date'] < '2016-01-01')]
    print(f'population (b): {len(pop_b)} rows (excluded {len(excluded_pre2016)} pre-2016 is_null_sample=0 rows, '
          f'{(df["is_null_sample"] == 1).sum()} is_null_sample=1 rows excluded globally)')

    with open(ML_DIR / 'feature_metadata_v9.3.json') as f:
        metadata = json.load(f)
    model_bcde_cols = metadata['full_feature_cols']
    missing = [c for c in model_bcde_cols if c not in pop_b.columns]
    assert not missing, f'missing feature cols: {missing}'

    model_a, calibrator_a, model_b, model_c, model_d1, model_d2, model_d3, model_d5 = load_models()

    a_df = pop_b[MODEL_A_COLS].fillna(0.0)
    raw_prob_a = model_a.predict_proba(a_df)[:, 1]
    model_a_confidence = calibrator_a.transform(raw_prob_a)

    bcde_df = pop_b[model_bcde_cols].fillna(0)
    pred_b = model_b.predict(bcde_df)
    pred_c = model_c.predict(bcde_df)
    pred_d1 = model_d1.predict(bcde_df)
    pred_d2 = model_d2.predict(bcde_df)
    pred_d3 = model_d3.predict(bcde_df)
    pred_d5 = model_d5.predict(bcde_df)

    out = pd.DataFrame({
        'symbol': pop_b['symbol'].values,
        'date': pop_b['date'].values,
        'model_a_confidence': model_a_confidence,
        'model_b_return_1m': pred_b,
        'model_c_max_drawdown': pred_c,
        'model_d1_return_3m': pred_d1,
        'model_d2_return_6m': pred_d2,
        'model_d3_return_2d': pred_d3,
        'model_d5_return_2w': pred_d5,
        'forward_return_2d': pop_b['forward_return_2d'].values,
        'forward_return_2w': pop_b['forward_return_2w'].values,
        'forward_return_3m': pop_b['forward_return_3m'].values,
        'forward_return_6m': pop_b['forward_return_6m'].values,
    })

    OUT_DB.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(OUT_DB)
    out.to_sql('model_scores_b', conn, if_exists='replace', index=False)
    conn.execute('CREATE INDEX IF NOT EXISTS idx_scores_b_symdate ON model_scores_b(symbol, date)')
    conn.commit()
    conn.close()

    print(f'Wrote {len(out)} rows to {OUT_DB}::model_scores_b')
    print(out.describe().to_string())


if __name__ == '__main__':
    main()
