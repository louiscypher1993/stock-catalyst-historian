#!/usr/bin/env python3
"""
Split-sensitivity of the row-exclusion retrain (v9.4cand) vs v9.3-equivalent,
ALL 5 heads, across 3 temporal splits. For each split we train BOTH a full
model (no exclusion = v9.3-equivalent under that split) and an excluded model
(51-row hygiene), evaluate each on THAT split's own test fold via the served
path (Booster best_iter, == XGBRegressor.predict), and report the delta.
Read-only vs deployed files; writes nothing but console output.
"""
import numpy as np, pandas as pd, xgboost as xgb
from scipy.stats import spearmanr
from pathlib import Path
ML=Path('src/ml')
EXCLUDE_COLS=['cache_key','symbol','date','is_null_sample','label','forward_return_1d','forward_return_1w','forward_return_1m','forward_return_2d','forward_return_3d','forward_return_2w','forward_return_3m','forward_return_6m','forward_return_12m','max_favorable_excursion_1m','max_adverse_excursion_1m','outperform_12m','is_event','sector_excess_return','options_put_call_ratio']
ZERO_FILL_COLS=['digital_exhaust_velocity_14d','gdelt_tone_z','dark_pool_index','institutional_ownership_pct','put_call_ratio_t_minus_1','short_interest_pct_float']
PRE_RETURN_COLS=['pre_return_1d','pre_return_3d','pre_return_5d','pre_return_10d','pre_return_21d','pre_vol_ratio_5d','pre_vol_ratio_10d']
REG=dict(objective='reg:squarederror',max_depth=8,eta=0.05,subsample=1.0,colsample_bytree=1.0,eval_metric='rmse',seed=42)
HEADS={'B':'forward_return_1m','D1':'forward_return_3m','D2':'forward_return_6m','D3':'forward_return_2d','D5':'forward_return_2w'}
def amse(a=2.5,b=1.0):
    def o(p,d):
        e=p-d.get_label();g=np.where(e>0,a*e,b*e);h=np.where(e>0,np.full_like(e,a),np.full_like(e,b));return g,h
    return o
def weights(df):
    vc=next((c for c in df.columns if 'vix' in c.lower()),None)
    vix=df[vc].fillna(20.0) if vc else pd.Series(20.0,index=df.index)
    vw=1.0/vix.clip(lower=5.0);vw=vw/vw.mean()
    liq=df.get('volume_ratio',pd.Series(1.0,index=df.index)).fillna(1.0);lw=liq.clip(0.1,10.0);lw=lw/lw.mean()
    w=vw*lw;return (w/w.mean()).values
def split(dates,train_pct,val_pct,emb):
    n=len(dates);sd=dates.sort_values();ct=sd.iloc[int(n*train_pct)];cv=sd.iloc[int(n*val_pct)];e=pd.Timedelta(days=emb)
    return dates<(ct-e),(dates>=ct)&(dates<(cv-e)),dates>=cv
def train_eval(df,feat,label,train_pct,val_pct,emb):
    sub=df.dropna(subset=[label]).copy();d=pd.to_datetime(sub['date'])
    tr,va,te=split(d,train_pct,val_pct,emb)
    Xtr,Xva,Xte=sub[tr][feat],sub[va][feat],sub[te][feat]
    ytr,yva,yte=sub[tr][label],sub[va][label],sub[te][label]
    dtr=xgb.DMatrix(Xtr,label=ytr,weight=weights(sub[tr]),feature_names=feat)
    dva=xgb.DMatrix(Xva,label=yva,feature_names=feat);dte=xgb.DMatrix(Xte,label=yte,feature_names=feat)
    bst=xgb.train(REG,dtr,num_boost_round=1000,obj=amse(),evals=[(dva,'val')],early_stopping_rounds=50,verbose_eval=False)
    bi=bst.best_iteration
    pred=bst.predict(dte,iteration_range=(0,bi+1))
    return spearmanr(pred,yte).correlation, len(yte)
def main():
    df=pd.read_csv(ML/'features.csv')
    df['is_us_listed']=df['symbol'].apply(lambda s:1 if ('.' not in str(s)) or str(s).endswith('.NYSE') or str(s).endswith('.NASDAQ') else 0).astype(int)
    excl=(df['overnight_gap_pct'].abs()>=1.0)|(df['excess_return'].abs()>10)
    nic=[c for c in df.columns if c.endswith('_is_null')];obj=[c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    drop=set(EXCLUDE_COLS)|set(nic)|set(ZERO_FILL_COLS)|set(PRE_RETURN_COLS)|set(obj)
    feat=[c for c in df.columns if c not in drop]
    df_full=df; df_excl=df[~excl].reset_index(drop=True)
    SPLITS=[('V0 (0.70/0.85,e21)',0.70,0.85,21),('V1 (0.62/0.80,e21)',0.62,0.80,21),('V2 (0.75/0.90,e21)',0.75,0.90,21)]
    print(f"features={len(feat)}, excluded={int(excl.sum())}\n")
    for sname,tp,vp,emb in SPLITS:
        print(f"=== {sname} ===")
        print(f"{'Head':<5}{'IC_full(v9.3eq)':<18}{'IC_excl(cand)':<16}{'dIC':<10}{'test_n':<8}")
        for h,label in HEADS.items():
            icf,nte=train_eval(df_full,feat,label,tp,vp,emb)
            ice,_=train_eval(df_excl,feat,label,tp,vp,emb)
            print(f"{h:<5}{icf:<18.4f}{ice:<16.4f}{ice-icf:<+10.4f}{nte:<8}")
        print()
main()
