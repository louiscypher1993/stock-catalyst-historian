-- ============================================================
-- Watchlist Live Pulse — Database Schema
-- Run once in Supabase SQL editor
-- Table: watchlist_live_state
-- ============================================================

CREATE TABLE IF NOT EXISTS watchlist_live_state (
  symbol                 TEXT PRIMARY KEY,
  last_checked_price     NUMERIC,
  last_checked_at        TIMESTAMPTZ,
  last_full_score_price  NUMERIC,
  last_full_score_at     TIMESTAMPTZ
);
ALTER TABLE watchlist_live_state DISABLE ROW LEVEL SECURITY;
