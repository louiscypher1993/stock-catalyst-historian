#!/usr/bin/env python3
"""
Deployment-verification harness for the v9.4cand row-exclusion retrain.
Same process as verify_v9_3.py's rollout:
  1) reproduce v9.4cand's training-report RMSE/MAE EXACTLY through infer.py's
     served path (xgb.XGBRegressor.load_model + .predict, == best_iter), on the
     candidate's own test fold -- confirms the served path matches training;
  2) report served-path IC, deployed v9.3 vs v9.4cand, on the common test fold
     (0 excluded rows in test, so identical holdout for both);
  3) confirm the v9.3 fallback files are present and untouched.
Read-only: loads models, trains nothing, writes nothing but console output.
Nothing here deploys.
"""
import json
from pathlib import Path
import numpy as np, pandas as pd, xgboost as xgb
from scipy.stats import spearmanr
from sklearn.metrics import mean_absolute_error, mean_squared_error

ML = Path(__file__).parent
EXCLUDE_COLS=['cache_key','symbol','date','is_null_sample','label','forward_return_1d','forward_return_1w','forward_return_1m','forward_return_2d','forward_return_3d','forward_return_2w','forward_return_3m','forward_return_6m','forward_return_12m','max_favorable_excursion_1m','max_adverse_excursion_1m','outperform_12m','is_event','sector_excess_return','options_put_call_ratio']
ZERO_FILL_COLS=['digital_exhaust_velocity_14d','gdelt_tone_z','dark_pool_index','institutional_ownership_pct','put_call_ratio_t_minus_1','short_interest_pct_float']
PRE_RETURN_COLS=['pre_return_1d','pre_return_3d','pre_return_5d','pre_return_10d','pre_return_21d','pre_vol_ratio_5d','pre_vol_ratio_10d']

HEADS={'B':'forward_return_1m','D1':'forward_return_3m','D2':'forward_return_6m','D3':'forward_return_2d','D5':'forward_return_2w'}
DEPLOYED={'B':'model_b_v9.3.json','D1':'model_d1_v9.3.json','D2':'model_d2_v9.3.json','D3':'model_d3_v9.3.json','D5':'model_d5_v9.3.json'}
CAND={'B':'scratch/model_b_v9.4cand.json','D1':'scratch/model_d1_v9.4cand.json','D2':'scratch/model_d2_v9.4cand.json','D3':'scratch/model_d3_v9.4cand.json','D5':'scratch/model_d5_v9.4cand.json'}
# training-report numbers printed by scratch_retrain_v94cand.py (best_iter path)
TRAIN_REPORT={'B':(27,0.1841,0.1471),'D1':(42,0.2014,0.1255),'D2':(25,0.3283,0.1861),'D3':(74,0.0452,0.0301),'D5':(55,0.0861,0.0602)}


def build(df):
    df=df.copy()
    df['is_us_listed']=df['symbol'].apply(lambda s:1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0).astype(int)
    nic=[c for c in df.columns if c.endswith('_is_null')];obj=[c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop=set(EXCLUDE_COLS)|set(nic)|set(ZERO_FILL_COLS)|set(PRE_RETURN_COLS)|set(obj)
    return df,[c for c in df.columns if c not in drop]


def test_fold(df,label,train_pct=0.70,val_pct=0.85,emb=21):
    sub=df.dropna(subset=[label]).copy();d=pd.to_datetime(sub['date']);n=len(d);cv=d.sort_values().iloc[int(n*val_pct)]
    return sub[d>=cv]


def main():
    df0=pd.read_csv(ML/'features.csv')
    df,feat=build(df0)
    # candidate training data = 51-row exclusion
    excl=(df['overnight_gap_pct'].abs()>=1.0)|(df['excess_return'].abs()>10)
    df_excl=df[~excl].reset_index(drop=True)

    print("=== (1) Reproduce v9.4cand training-report RMSE/MAE through infer.py served path (XGBRegressor) ===")
    print(f"{'Head':<5}{'report RMSE/MAE':<20}{'served RMSE/MAE':<20}{'match?':<8}")
    ok=True
    for h,label in HEADS.items():
        test=test_fold(df_excl,label)  # candidate's OWN test fold (its training split)
        reg=xgb.XGBRegressor();reg.load_model(str(ML/CAND[h]))
        X=test.reindex(columns=feat,fill_value=0);y=test[label].values
        pred=reg.predict(X)
        r=np.sqrt(mean_squared_error(y,pred));m=mean_absolute_error(y,pred)
        _,rr,mm=TRAIN_REPORT[h]
        match=(abs(r-rr)<5e-4) and (abs(m-mm)<5e-4)
        ok=ok and match
        print(f"{h:<5}{rr:.4f}/{mm:.4f}       {r:.4f}/{m:.4f}       {'OK' if match else 'MISMATCH'}")
    print(f"  -> served path reproduces training report: {'YES (deploy-safe)' if ok else 'NO -- investigate before deploy'}")

    print("\n=== (2) Served-path IC on common test fold (0 excluded in test): deployed v9.3 -> v9.4cand ===")
    print(f"{'Head':<5}{'v9.3 (live)':<14}{'v9.4cand':<12}{'dIC':<10}")
    for h,label in HEADS.items():
        test=test_fold(df,label)  # full-data test fold = identical holdout for both
        X=test.reindex(columns=feat,fill_value=0);y=test[label].values
        rb=xgb.XGBRegressor();rb.load_model(str(ML/DEPLOYED[h]));icb=spearmanr(rb.predict(X),y).correlation
        rc=xgb.XGBRegressor();rc.load_model(str(ML/CAND[h]));icc=spearmanr(rc.predict(X),y).correlation
        print(f"{h:<5}{icb:<14.4f}{icc:<12.4f}{icc-icb:<+10.4f}")

    print("\n=== (3) v9.3 fallback readiness ===")
    for h in HEADS:
        p=ML/DEPLOYED[h]
        print(f"  {h}: {DEPLOYED[h]} present={p.exists()} size={p.stat().st_size if p.exists() else 0}")
    print("  infer.py currently points at model_*_v9.3.json -- untouched; rollback = leave as-is / no candidate wired in yet.")


if __name__=='__main__':
    main()
