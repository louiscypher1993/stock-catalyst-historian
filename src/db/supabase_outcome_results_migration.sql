-- ============================================================
-- Outcome Tracker — durable predicted-vs-actual store
-- Run once in Supabase SQL editor
-- Table: outcome_results
-- ============================================================
-- Durable mirror of the local outcome_tracker.db (src/scripts/outcomeTracker.ts).
-- The tracker persists its sqlite db across CI runs via actions/cache, which
-- GitHub can evict after 7 idle days or under repo cache pressure -- a silent
-- data-loss risk for the months-long 3M/6M horizon dataset. The tracker now
-- ALSO upserts each matured outcome here (fail-soft), and outcomeScoreboard.ts
-- can read it via `--source supabase`, so the accumulating record survives even
-- if the cache is lost. Idempotent on the (symbol, run_date, horizon) PK.
-- ============================================================

CREATE TABLE IF NOT EXISTS outcome_results (
  symbol             TEXT NOT NULL,
  run_date           TEXT NOT NULL,
  horizon            TEXT NOT NULL,
  predicted_return   NUMERIC,
  predicted_tier     TEXT,
  actual_return      NUMERIC,
  target_date        TEXT,
  matched_price_date TEXT,
  actual_source      TEXT,
  checked_at         TIMESTAMPTZ,
  PRIMARY KEY (symbol, run_date, horizon)
);
ALTER TABLE outcome_results DISABLE ROW LEVEL SECURITY;
