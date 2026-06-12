CREATE TABLE IF NOT EXISTS inference_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date DATE NOT NULL,
  symbol TEXT NOT NULL,
  company_name TEXT,
  sector TEXT,
  exchange TEXT,
  z_score REAL,
  excess_return REAL,
  model_a_confidence REAL,
  model_b_return_1m REAL,
  model_c_max_drawdown REAL,
  model_d1_return_3m REAL,
  model_d2_return_6m REAL,
  model_e_outperform_12m_prob REAL,
  recommendation TEXT CHECK (recommendation IN ('STRONG_BUY','BUY','ADD','HOLD','REDUCE','SELL')),
  risk_score INTEGER CHECK (risk_score BETWEEN 0 AND 100),
  risk_reward_ratio REAL,
  position_size_pct REAL,
  narrative TEXT,
  signal_completeness_score REAL,
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
