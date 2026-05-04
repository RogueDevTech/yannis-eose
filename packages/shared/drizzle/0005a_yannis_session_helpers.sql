-- Session helpers for SECURITY BARRIER views (0006+) and RLS policies (0042+).
-- Mirrors packages/shared/src/db/migrations/002_row_level_security.sql helpers — that file is not
-- part of the journal-free drizzle runner, so fresh databases need these before first use.
--
-- Later migrations (e.g. 0062) may replace signatures (text → uuid); until then RLS/views expect these.

CREATE OR REPLACE FUNCTION yannis_current_user_id()
RETURNS TEXT AS $$
  SELECT current_setting('yannis.current_user_id', true);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION yannis_current_user_role()
RETURNS TEXT AS $$
  SELECT current_setting('yannis.current_user_role', true);
$$ LANGUAGE sql STABLE;
