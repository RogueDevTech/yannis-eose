-- ============================================
-- Multi-country — Phase 1: per-user country data-scope
-- ============================================
-- A user only sees data (orders/shipments/stock/logistics) for the currencies
-- they are assigned. 1 country = 1 currency, so assignment is keyed on
-- currency_code. Mirrors user_branches (a plain membership join, NOT temporal —
-- user_branches has no history twin, so neither does this).
--
-- Resolution (trpc/context.ts → effectiveCurrencyCodes):
--   MEDIA_BUYER + countries.view_all → all currencies (no filter)
--   assigned non-view_all           → their assigned codes
--   UNassigned non-view_all         → base country 'NGN' only (rollout-safe)
--
-- Go-dark safeguard: every EXISTING user is backfilled to 'NGN' so nobody loses
-- visibility on the day this ships. Foreign countries are opt-in per user after.

CREATE TABLE IF NOT EXISTS user_countries (
  user_id       uuid NOT NULL REFERENCES users(id),
  currency_code text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS user_countries_user_currency_uniq
  ON user_countries (user_id, currency_code);

-- Index for the reverse lookup used by the go-dark alarm
-- ("which users are assigned currency X?").
CREATE INDEX IF NOT EXISTS user_countries_currency_idx
  ON user_countries (currency_code);

-- Backfill: assign every existing user to the base country (NGN). Idempotent via
-- the unique index + NOT EXISTS guard so re-running the migration is safe.
INSERT INTO user_countries (user_id, currency_code)
SELECT u.id, 'NGN'
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_countries uc
  WHERE uc.user_id = u.id AND uc.currency_code = 'NGN'
);
