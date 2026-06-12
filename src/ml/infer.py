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
    "forward_return_2d",
    "forward_return_3d",
    "forward_return_2w",
    "max_favorable_excursion_1m",
    "max_adverse_excursion_1m",
    "forward_return_3m",
    "forward_return_6m",
    "forward_return_12m",
    "forward_return_12m_is_null",
]
TEMPORAL_COLS = ["day_sin", "day_cos", "month_sin", "month_cos"]

# Must match the macro_features list used to train Model E in train_xgboost.py.
MACRO_FEATURES = [
    'z_score', 'snap_vix_close', 'snap_excessReturn', 'snap_volumeRatio',
    'snap_shannon_entropy_30d', 'snap_amihud_illiquidity_30d',
    'snap_fractal_efficiency_ratio_10d', 'snap_sector_relative_z_score',
    'snap_fmp_news_sentiment_avg', 'snap_analyst_upgrades_30d', 'snap_eps_surprise_pct',
    'snap_kinetic_energy', 'snap_seismic_magnitude_mw',
]


def load_models():
    model_a = xgb.XGBClassifier()
    model_a.load_model(ML_DIR / 'model_a_v3.json')
    model_b = xgb.XGBRegressor()
    model_b.load_model(ML_DIR / 'model_b_v3.json')
    model_c = xgb.XGBRegressor()
    model_c.load_model(ML_DIR / 'model_c_v3.json')
    model_d1 = xgb.XGBRegressor()
    model_d1.load_model(ML_DIR / 'model_d1_v1.json')
    model_d2 = xgb.XGBRegressor()
    model_d2.load_model(ML_DIR / 'model_d2_v2.json')
    model_d3 = xgb.XGBRegressor()
    model_d3.load_model(ML_DIR / 'model_d3_v1.json')
    model_d4 = xgb.XGBRegressor()
    model_d4.load_model(ML_DIR / 'model_d4_v1.json')
    model_d5 = xgb.XGBRegressor()
    model_d5.load_model(ML_DIR / 'model_d5_v1.json')
    model_e = xgb.XGBClassifier()
    model_e.load_model(ML_DIR / 'model_e_v1.json')
    return model_a, model_b, model_c, model_d1, model_d2, model_d3, model_d4, model_d5, model_e


def remap_vector(v: dict) -> dict:
    """
    Translate live inference flat feature names to the snap_* training schema.
    Features with no equivalent are left as 0 by build_df's .get() fallback.
    """
    RENAME = {
        'excess_return':              'snap_excessReturn',
        'atr_shock_score':            'snap_atrShockScore',
        'volume_ratio':               'snap_volumeRatio',
        'body_to_range_ratio':        'snap_body_to_range_ratio',
        'overnight_gap_pct':          'snap_overnight_gap_pct',
        'gap_fill_ratio':             'snap_gap_fill_ratio',
        'obv_delta_10d':              'snap_obv_delta_10d',
        'dist_sma_50':                'snap_dist_sma_50',
        'dist_sma_200':               'snap_dist_sma_200',
        'rsi_14':                     'snap_rsi_14',
        'relative_volume_30d':        'snap_relative_volume_30d',
        'kinetic_energy':             'snap_kinetic_energy',
        'vix_close':                  'snap_vix_close',
        'economic_policy_uncertainty':'snap_economic_policy_uncertainty',
        'day_sin':                    'snap_day_sin',
        'day_cos':                    'snap_day_cos',
        'month_sin':                  'snap_month_sin',
        'month_cos':                  'snap_month_cos',
        'shannon_entropy_30d':        'snap_shannon_entropy_30d',
        'amihud_illiquidity_30d':     'snap_amihud_illiquidity_30d',
        'fractal_efficiency_ratio_10d':'snap_fractal_efficiency_ratio_10d',
        'market_reynolds_number':     'snap_market_reynolds_number',
        'seismic_magnitude_mw':       'snap_seismic_magnitude_mw',
        'barycenter_stretch_20d':     'snap_barycenter_stretch_20d',
        'sector_relative_z_score':    'snap_sector_relative_z_score',
        'fmp_news_sentiment_avg':     'snap_fmp_news_sentiment_avg',
        'fmp_news_article_count_7d':  'snap_fmp_news_article_count_7d',
        'put_call_ratio_t_minus_1':   'snap_put_call_ratio_t_minus_1',
        'dark_pool_index':            'snap_dark_pool_index',
        'ctb_velocity_7d':            'snap_ctb_velocity_7d',
        'iv_crush_pct':               'snap_iv_crush_pct',
        'peer_average_return':        'snap_peer_average_return',
        'peer_contagion_delta':       'snap_peer_contagion_delta',
        'congressional_net_flow_30d': 'snap_congressional_net_flow_30d',
        'insider_net_shares_30d':     'snap_insider_net_shares_30d',
        'institutional_ownership_pct':'snap_institutional_ownership_pct',
        'analyst_upgrades_30d':       'snap_analyst_upgrades_30d',
        'analyst_downgrades_30d':     'snap_analyst_downgrades_30d',
        'price_target_consensus':     'snap_price_target_consensus',
        'price_target_upside_pct':    'snap_price_target_upside_pct',
        'eps_surprise_pct':           'snap_eps_surprise_pct',
        'revenue_surprise_pct':       'snap_revenue_surprise_pct',
        'earnings_date_proximity_days':'snap_earnings_date_proximity_days',
        'confidence_tier_high':       'snap_confidence_tier_high',
        'confidence_tier_medium':     'snap_confidence_tier_medium',
        'confidence_tier_low':        'snap_confidence_tier_low',
        'google_trends_z':            'snap_google_trends_shock_ratio',
    }
    result = dict(v)
    for flat, snap in RENAME.items():
        if flat in result:
            result[snap] = result[flat]
    # Aliases: model expects these under multiple names
    result['snap_zScore']      = result.get('z_score', 0)
    result['snap_z_score']     = result.get('z_score', 0)
    result['snap_vixAtEvent']  = result.get('vix_close', 0)
    result['price_change_pct'] = result.get('excess_return', 0)
    return result


def infer(feature_vector: dict) -> dict:
    feature_vector = remap_vector(feature_vector)

    model_a, model_b, model_c, model_d1, model_d2, model_d3, model_d4, model_d5, model_e = load_models()

    with open(ML_DIR / 'feature_metadata.json') as f:
        metadata = json.load(f)

    column_names = [c['name'] for c in metadata['columns']]
    all_feature_cols = [c for c in column_names if c not in NON_FEATURE_COLS + TARGET_COLS]
    is_null_cols = [c for c in all_feature_cols if c.endswith('_is_null')]

    model_a_cols = [c for c in all_feature_cols if c not in is_null_cols]
    model_bc_cols = [c for c in all_feature_cols if c not in TEMPORAL_COLS]
    model_e_cols = [c for c in MACRO_FEATURES if c in all_feature_cols]

    def build_df(cols):
        row = {c: feature_vector.get(c, 0) for c in cols}
        return pd.DataFrame([row], columns=cols)

    prob_event = float(model_a.predict_proba(build_df(model_a_cols))[0][0])
    pred_return_1m = float(model_b.predict(build_df(model_bc_cols))[0])
    pred_drawdown = float(model_c.predict(build_df(model_bc_cols))[0])
    pred_return_3m = float(model_d1.predict(build_df(model_bc_cols))[0])
    pred_return_6m = float(model_d2.predict(build_df(model_bc_cols))[0])
    pred_return_2d = float(model_d3.predict(build_df(model_bc_cols))[0])
    pred_return_3d = float(model_d4.predict(build_df(model_bc_cols))[0])
    pred_return_2w = float(model_d5.predict(build_df(model_bc_cols))[0])
    pred_outperform_12m = float(model_e.predict_proba(build_df(model_e_cols))[0][1])

    return {
        'model_a_confidence': round(prob_event, 4),
        'model_b_return_1m': round(pred_return_1m, 4),
        'model_c_max_drawdown': round(pred_drawdown, 4),
        'model_d1_return_3m': round(pred_return_3m, 4),
        'model_d2_return_6m': round(pred_return_6m, 4),
        'model_d3_return_2d': round(pred_return_2d, 4),
        'model_d4_return_3d': round(pred_return_3d, 4),
        'model_d5_return_2w': round(pred_return_2w, 4),
        'model_e_outperform_12m_prob': round(pred_outperform_12m, 4),
    }


if __name__ == '__main__':
    vector = json.loads(sys.argv[1])
    result = infer(vector)
    print(json.dumps(result))
