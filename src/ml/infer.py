#!/usr/bin/env python3
import sys
import json
import pandas as pd
import xgboost as xgb
from pathlib import Path

ML_DIR = Path(__file__).parent

NON_FEATURE_COLS = ["cache_key", "symbol", "date"]
TARGET_COLS = [
    "is_null_sample",
    "forward_return_1d",
    "forward_return_1w",
    "forward_return_1m",
    "max_favorable_excursion_1m",
    "max_adverse_excursion_1m",
]
TEMPORAL_COLS = ["day_sin", "day_cos", "month_sin", "month_cos"]


def load_models():
    model_a = xgb.XGBClassifier()
    model_a.load_model(ML_DIR / 'model_a_v3.json')
    model_b = xgb.XGBRegressor()
    model_b.load_model(ML_DIR / 'model_b_v3.json')
    model_c = xgb.XGBRegressor()
    model_c.load_model(ML_DIR / 'model_c_v3.json')
    return model_a, model_b, model_c


def infer(feature_vector: dict) -> dict:
    model_a, model_b, model_c = load_models()

    with open(ML_DIR / 'feature_metadata.json') as f:
        metadata = json.load(f)

    column_names = [c['name'] for c in metadata['columns']]
    all_feature_cols = [c for c in column_names if c not in NON_FEATURE_COLS + TARGET_COLS]
    is_null_cols = [c for c in all_feature_cols if c.endswith('_is_null')]

    model_a_cols = [c for c in all_feature_cols if c not in is_null_cols]
    model_bc_cols = [c for c in all_feature_cols if c not in TEMPORAL_COLS]

    def build_df(cols):
        row = {c: feature_vector.get(c, 0) for c in cols}
        return pd.DataFrame([row], columns=cols)

    prob_event = float(model_a.predict_proba(build_df(model_a_cols))[0][0])
    pred_return = float(model_b.predict(build_df(model_bc_cols))[0])
    pred_drawdown = float(model_c.predict(build_df(model_bc_cols))[0])

    return {
        'model_a_confidence': round(prob_event, 4),
        'model_b_return_1m': round(pred_return, 4),
        'model_c_max_drawdown': round(pred_drawdown, 4)
    }


if __name__ == '__main__':
    vector = json.loads(sys.argv[1])
    result = infer(vector)
    print(json.dumps(result))
