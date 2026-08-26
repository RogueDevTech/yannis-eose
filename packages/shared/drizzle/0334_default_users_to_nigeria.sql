-- ============================================
-- Multi-country — default every user to Nigeria (NGN)
-- ============================================
-- Reassertion / safety-net for the per-user country data-scope introduced in
-- 0330. Guarantees the go-live end state HR asked for:
--
--   1. Every EXISTING user is scoped to Nigeria (NGN) by default, so nobody
--      loses visibility. HR / Admin can later ADD foreign countries per user
--      from the user edit form ("Countries this user can access").
--
--   2. Media Buyers keep ALL-COUNTRY access WITHOUT any user_countries rows.
--      That is NOT expressed here as data — it is resolved in code:
--      `canViewAllCountries(user)` returns true for role = 'MEDIA_BUYER'
--      (apps/api/src/common/authz.ts), so the country filter is a no-op for
--      them regardless of their user_countries rows. See trpc/context.ts
--      `effectiveCurrencyCodes`. We therefore do NOT stamp MBs to a single
--      country — doing so would be meaningless (view_all wins) and could
--      mislead a future reader into thinking MBs are NGN-only.
--
-- Why a second migration when 0330 already backfilled NGN:
--   0330's backfill only ran against users that existed the moment it applied.
--   Any account created between 0330 and this migration (e.g. during rollout,
--   or on a DB where 0330's INSERT was skipped) could have zero country rows,
--   which resolves to NGN-only anyway but leaves the join table incomplete —
--   the go-dark alarm ("which users see country X?") would under-report them.
--   This backfills those stragglers so the table is authoritative.
--
-- Idempotent: NOT EXISTS guard + the (user_id, currency_code) unique index make
-- re-running a no-op.

INSERT INTO user_countries (user_id, currency_code)
SELECT u.id, 'NGN'
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_countries uc
  WHERE uc.user_id = u.id
)
ON CONFLICT (user_id, currency_code) DO NOTHING;
