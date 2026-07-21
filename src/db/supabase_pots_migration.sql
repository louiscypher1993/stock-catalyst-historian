-- ============================================================
-- POTS Multi-Agent System — Database Schema
-- Run once in Supabase SQL editor
-- Tables: pots, pot_positions, pot_snapshots, pot_trades
-- ============================================================

CREATE TABLE IF NOT EXISTS pots (
  pot_id           SERIAL PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  boldness         REAL NOT NULL,
  ambition         REAL NOT NULL,
  patience         REAL NOT NULL,
  conviction       REAL NOT NULL,
  focus            INTEGER NOT NULL,
  reactivity       REAL NOT NULL,
  starting_balance REAL NOT NULL DEFAULT 10000,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pots DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pots_name ON pots (name);

CREATE TABLE IF NOT EXISTS pot_positions (
  id                       SERIAL PRIMARY KEY,
  pot_id                   INTEGER NOT NULL REFERENCES pots(pot_id),
  symbol                   TEXT NOT NULL,
  direction                TEXT NOT NULL CHECK (direction IN ('long','short')),
  entry_date               DATE NOT NULL,
  entry_price              REAL NOT NULL,
  shares                   REAL NOT NULL,
  position_size_gbp        REAL NOT NULL,
  expected_return_at_entry REAL,
  patience_horizon         TEXT NOT NULL,
  exit_deadline            DATE NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','closed')),
  exit_date                DATE,
  exit_price               REAL,
  realised_pnl             REAL,
  realised_return_pct      REAL,
  exit_reason              TEXT CHECK (exit_reason IN (
                             'patience','stop_loss','reactivity',
                             'replacement','short_cover','manual_correction'
                           )),
  current_price            REAL,
  current_value_gbp        REAL,
  unrealised_pnl           REAL,
  unrealised_return_pct    REAL,
  created_at               TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pot_positions DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pot_positions_pot_id ON pot_positions(pot_id);
CREATE INDEX IF NOT EXISTS idx_pot_positions_status ON pot_positions(status);
CREATE INDEX IF NOT EXISTS idx_pot_positions_symbol ON pot_positions(symbol);

CREATE TABLE IF NOT EXISTS pot_snapshots (
  id                      SERIAL PRIMARY KEY,
  pot_id                  INTEGER NOT NULL REFERENCES pots(pot_id),
  run_date                TIMESTAMPTZ NOT NULL,
  portfolio_value         REAL NOT NULL,
  cash_balance            REAL NOT NULL,
  open_positions_count    INTEGER NOT NULL DEFAULT 0,
  unrealised_pnl          REAL NOT NULL DEFAULT 0,
  realised_pnl_cumulative REAL NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (pot_id, run_date)
);
ALTER TABLE pot_snapshots DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pot_snapshots_pot_id
  ON pot_snapshots(pot_id);
CREATE INDEX IF NOT EXISTS idx_pot_snapshots_run_date
  ON pot_snapshots(run_date DESC);

CREATE TABLE IF NOT EXISTS pot_trades (
  id                SERIAL PRIMARY KEY,
  pot_id            INTEGER NOT NULL REFERENCES pots(pot_id),
  symbol            TEXT NOT NULL,
  action            TEXT NOT NULL CHECK (action IN
                    ('BUY','SELL','SHORT','COVER')),
  price             REAL NOT NULL,
  shares            REAL NOT NULL,
  position_size_gbp REAL NOT NULL,
  reason            TEXT,
  run_date          TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE pot_trades DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pot_trades_pot_id
  ON pot_trades(pot_id);
CREATE INDEX IF NOT EXISTS idx_pot_trades_run_date
  ON pot_trades(run_date DESC);
