-- ============================================================
-- Outcome Tracker — dividend_credit column (additive)
-- Run once in Supabase SQL editor, AFTER supabase_outcome_results_migration.sql
-- ============================================================
-- Forward-return labels + the outcome tracker use Yahoo quote.close (split-
-- adjusted, DIVIDEND-EXCLUDED), so realized total return is understated by the
-- horizon dividend yield. src/scripts/enrichDividendCredit.ts computes the
-- per-row credit = (adjclose_target/adjclose_entry) − (close_target/close_entry)
-- and mirrors it here; outcomeScoreboard folds it into net (net = realized −
-- cost + dividend_credit). NULL = not yet enriched / non-resolvable.
--
-- Schema-drift hazard: until this runs, the enrichment's Supabase mirror will
-- 404 the missing column and only the local outcome_tracker.db is updated
-- (the run still succeeds — the mirror is fail-soft).
-- ============================================================

ALTER TABLE outcome_results ADD COLUMN IF NOT EXISTS dividend_credit NUMERIC;
