CREATE TABLE IF NOT EXISTS inference_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE NOT NULL,
  symbol TEXT NOT NULL,
  company_name TEXT,
  sector TEXT,
  exchange TEXT,
  z_score REAL,
  excess_return REAL,
  current_price REAL,
  day_change_pct REAL,
  trend_alignment TEXT,
  model_a_confidence REAL,
  model_b_return_1m REAL,
  model_c_max_drawdown REAL,
  model_d1_return_3m REAL,
  model_d2_return_6m REAL,
  model_d3_return_2d REAL,
  model_d4_return_3d REAL,
  model_d5_return_2w REAL,
  model_e_outperform_12m_prob REAL,
  recommendation TEXT CHECK (recommendation IN ('STRONG_BUY','BUY','ADD','HOLD','REDUCE','SELL')),
  risk_score INTEGER CHECK (risk_score BETWEEN 0 AND 100),
  risk_reward_ratio REAL,
  position_size_pct REAL,
  narrative TEXT,
  signal_completeness_score REAL,
  is_watchlist BOOLEAN,
  edgar_8k_items TEXT,
  management_confidence_score REAL,
  earnings_primary_concern TEXT,
  digital_exhaust_velocity_14d REAL,
  alphavantage_sentiment_avg REAL,
  unreliable_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (run_date, symbol)
);

CREATE INDEX IF NOT EXISTS idx_inference_results_run_date ON inference_results (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_inference_results_symbol ON inference_results (symbol);

CREATE TABLE IF NOT EXISTS symbol_snapshots (
  symbol TEXT PRIMARY KEY,
  company_name TEXT,
  sector TEXT,
  exchange TEXT,
  is_us_listed BOOLEAN,
  latest_signal_snapshot JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Written/read only by the backend pipeline using the publishable key; no end-user access.
ALTER TABLE symbol_snapshots DISABLE ROW LEVEL SECURITY;

-- Models D1/D2/E (forward_return_3m/6m regressors, 12m-outperform classifier).
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS model_d1_return_3m REAL;
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS model_d2_return_6m REAL;
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS model_e_outperform_12m_prob REAL;

-- Models D3/D4/D5 (forward_return_2d/3d/2w regressors).
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS model_d3_return_2d REAL;
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS model_d4_return_3d REAL;
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS model_d5_return_2w REAL;

-- Watchlist feature
CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY,
  company_name TEXT,
  exchange TEXT,
  added_date DATE DEFAULT CURRENT_DATE
);
ALTER TABLE watchlist DISABLE ROW LEVEL SECURITY;
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS is_watchlist BOOLEAN DEFAULT FALSE;

-- Watchlist enhancements
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS list_type TEXT NOT NULL DEFAULT 'watching'
  CHECK (list_type IN ('holding', 'watching'));
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS entry_price REAL;

-- Live price snapshot on inference results
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS current_price REAL;
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS day_change_pct REAL;
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS trend_alignment TEXT;

-- Recent SEC 8-K filing context for narrative generation
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS edgar_8k_items TEXT;

-- Macro environment snapshot per inference run
CREATE TABLE IF NOT EXISTS macro_snapshots (
  run_date DATE PRIMARY KEY,
  vix REAL,
  yield_curve_spread REAL,
  high_yield_oas REAL,
  dollar_index REAL,
  fed_funds_rate REAL,
  economic_policy_uncertainty REAL,
  vix_regime TEXT,
  credit_regime TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE macro_snapshots DISABLE ROW LEVEL SECURITY;

-- Earnings call management sentiment (EarningsSentimentService + Gemini)
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS management_confidence_score INTEGER;
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS earnings_primary_concern TEXT;

-- Digital exhaust velocity composite (StockTwits + Google Trends + Wikipedia z-scores)
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS digital_exhaust_velocity_14d REAL;

-- Alpha Vantage NEWS_SENTIMENT, live run only (free tier budget too small for backfill)
ALTER TABLE inference_results ADD COLUMN IF NOT EXISTS alphavantage_sentiment_avg REAL;

-- ---------------------------------------------------------------------------
-- shadow_benchmark_divergence
--
-- Populated only when LIVE_BENCHMARK_MODE=shadow. Live decides on SPY exactly as
-- it does today; the native-per-market benchmark verdict is computed alongside and
-- every DISAGREEMENT about whether a bar is an anomaly is recorded here.
--
-- Why it exists: switching live to the training-matched benchmark would change ~33%
-- of detections (10,206 -> 9,990 total but only 67% overlap; measured by
-- src/ml/scratch_v12_live_shadow.py). Backtest cannot say which detection set performs
-- better — only realised forward returns on the two disjoint sets can. This table is
-- how that evidence accumulates without changing any behaviour.
--
-- To adjudicate later: take rows where detected_spy != detected_native, pull forward
-- returns for each group from daily_prices, and compare. Whichever group's exclusive
-- detections realise better outcomes wins.
--
-- run_slot is part of the key because live runs 3x/day (live-inference.yml) and the
-- same symbol can legitimately diverge in more than one slot on the same date. It is
-- NOT NULL with a default so the unique constraint behaves (NULLs compare distinct in
-- Postgres, which would silently permit duplicates).
CREATE TABLE IF NOT EXISTS shadow_benchmark_divergence (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE NOT NULL,
  run_slot TEXT NOT NULL DEFAULT 'default',
  symbol TEXT NOT NULL,
  benchmark TEXT NOT NULL,
  bar_date DATE,
  z_spy REAL,
  z_native REAL,
  detected_spy BOOLEAN NOT NULL,
  detected_native BOOLEAN NOT NULL,
  close REAL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (run_date, run_slot, symbol)
);

CREATE INDEX IF NOT EXISTS idx_shadow_div_run_date ON shadow_benchmark_divergence (run_date DESC);
CREATE INDEX IF NOT EXISTS idx_shadow_div_symbol   ON shadow_benchmark_divergence (symbol);

-- The live job authenticates with SUPABASE_ANON_KEY (see live-inference.yml), so anon
-- must be able to write here exactly as it already can for inference_results. If RLS is
-- enabled on this table without a matching policy the insert fails and the run stays
-- green — the recorded silent-failure hazard. The service logs loudly on write failure
-- for that reason, but the safest posture is to match whatever inference_results uses.
