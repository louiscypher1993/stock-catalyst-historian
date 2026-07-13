"""
Follow-up: does restricting the zero-count to ONLY the snap-referencing
accessor fields (rather than all ~113 feature columns, which are dominated by
globally-inert features per Session 1 Finding 8) give better separation
between legitimately-covered rows and null-collapsed ones?
"""
import numpy as np
import pandas as pd
from pathlib import Path

ML_DIR = Path(__file__).parent

# Every NUMERIC_ACCESSORS entry that references `s` in feature_extractor.ts,
# either s-first (the Phenomenon 3 pattern) or f-first-with-s-fallback.
SNAP_REFERENCING_FIELDS = [
    'z_score', 'excess_return', 'atr_shock_score', 'volume_ratio', 'vix_close',
    'vix_regime', 'trend_regime', 'yield_curve_spread', 'credit_spread',
    'shannon_entropy_30d', 'amihud_illiquidity_30d', 'fractal_efficiency_ratio_10d',
    'sector_relative_z_score', 'gdelt_tone_z', 'stocktwits_virality_z',
    'google_trends_z', 'wikipedia_spike_z', 'news_relevance_z',
    'short_interest_pct_float', 'put_call_ratio_t_minus_1', 'dark_pool_index',
    'iv_crush_pct', 'congressional_net_flow_30d', 'insider_net_shares_30d',
    'institutional_ownership_pct', 'eps_surprise_pct', 'revenue_surprise_pct',
    'earnings_date_proximity_days', 'analyst_upgrades_30d', 'analyst_downgrades_30d',
    'price_target_consensus', 'price_target_upside_pct', 'fmp_news_sentiment_avg',
    'fmp_news_article_count_7d', 'av_news_sentiment',
]

def split_test(dates_series, idx):
    dates = pd.to_datetime(dates_series.loc[idx])
    n = len(dates)
    cutoff_val = dates.sort_values().iloc[int(n * 0.85)]
    m = dates >= cutoff_val
    return idx[m]

def main():
    df = pd.read_csv(ML_DIR / 'features.csv')
    present = [c for c in SNAP_REFERENCING_FIELDS if c in df.columns]
    missing = [c for c in SNAP_REFERENCING_FIELDS if c not in df.columns]
    print(f"Snap-referencing fields present in features.csv: {len(present)}/{len(SNAP_REFERENCING_FIELDS)} (missing: {missing})")

    test_idx = split_test(df['date'], df.index)
    test_df = df.loc[test_idx, present]

    zero_counts = (test_df == 0).sum(axis=1)
    print(f"\nZero-count per row (out of {len(present)} snap-referencing columns), legitimately-covered population:")
    for q in [0, 10, 25, 50, 75, 90, 95, 99, 99.9, 100]:
        print(f"  p{q}: {np.percentile(zero_counts, q):.1f}")
    print(f"  mean: {zero_counts.mean():.2f}")

if __name__ == '__main__':
    main()
