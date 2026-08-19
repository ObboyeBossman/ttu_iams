-- =============================================================================
-- Migration: 20260819000001_public_season_read.sql
-- Allow unauthenticated (anonymous) users to read the active open season.
--
-- Context:
--   The public attachment letter generation flow (/public-letter.html) calls
--   getOpenSeason() without a logged-in user. The existing policy
--   "seasons: all authenticated users read" requires auth.uid() IS NOT NULL,
--   which blocks anonymous requests. Without an open season, the form still
--   works via the hardcoded fallback UUID, but adding this policy lets the
--   app fetch the real live season data for unauthenticated students.
-- =============================================================================

DROP POLICY IF EXISTS "seasons: public reads open season" ON seasons;

CREATE POLICY "seasons: public reads open season"
  ON seasons
  FOR SELECT
  USING (status = 'open');
