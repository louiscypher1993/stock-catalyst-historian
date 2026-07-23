#!/usr/bin/env python3
"""v10 recon: training-side fill rate of the premium/snapshot-sourced features
in features.csv -- how often each was actually populated vs null/zero. Grounds
the train/serve-mismatch question: a feature that's mostly-null in training AND
null-live has little mismatch; one that's well-filled in training but null-live
is a real mismatch."""
import pandas as pd
from pathlib import Path

ML_DIR = Path(__file__).parent
df = pd.read_csv(ML_DIR / 'features.csv', low_memory=False)
# real, post-2016 events only (mirror the population the model serves)
real = df[(df['is_null_sample'] == 0) & (df['date'] >= '2016-01-01')]
print(f'features.csv total={len(df)}  real post-2016={len(real)}')

PREMIUM = [
    'eps_surprise_pct', 'revenue_surprise_pct', 'earnings_date_proximity_days',
    'analyst_upgrades_30d', 'analyst_downgrades_30d',
    'price_target_consensus', 'price_target_upside_pct',
    'fmp_news_sentiment_avg', 'fmp_news_article_count_7d', 'av_news_sentiment',
    'insider_net_shares_30d', 'institutional_ownership_pct',
    'congressional_net_flow_30d', 'ctb_velocity_7d', 'iv_crush_pct',
    'peer_average_return', 'peer_contagion_delta', 'news_relevance_z',
    'stocktwits_virality_z', 'google_trends_z', 'wikipedia_spike_z',
]
print(f"\n{'feature':<32} {'present':>8} {'nonzero':>8}  {'%nonnull':>9} {'%nonzero':>9}")
print('-' * 72)
for c in PREMIUM:
    if c not in real.columns:
        print(f'{c:<32} {"MISSING COL":>8}')
        continue
    col = real[c]
    nonnull = col.notna().sum()
    nonzero = ((col.notna()) & (col != 0)).sum()
    print(f'{c:<32} {nonnull:>8} {nonzero:>8}  {100*nonnull/len(real):>8.2f}% {100*nonzero/len(real):>8.2f}%')
