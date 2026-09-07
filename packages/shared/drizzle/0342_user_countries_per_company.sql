-- ============================================
-- Migration 0342: Country access is PER COMPANY
-- ============================================
-- `user_countries` was (user_id, currency_code) with no company dimension, so a
-- user's country access was one global list spanning every company they belong
-- to. Currencies, however, ARE company-scoped (`currencies.group_id`, unique on
-- (group_id, code)). The two models disagreed, with two consequences:
--
--   * Meaningless grants. Members of an NGN-only company carried GHS/KES/TZS/ZMW
--     that do not exist there. Not a data leak (no order in that company is
--     stamped with those codes, so nothing extra became visible), but the rows
--     are inert, they make audits unreadable, and they become wrong the moment a
--     second company gains a second currency.
--   * Real lockouts. A user whose global list omitted a company's base currency
--     could see NOTHING in that company. Observed in prod: a HEAD_OF_CS holding
--     GHS,KES,TZS,ZMW was a member of an NGN-only company and every list there
--     returned empty, because the country filter is a hard AND with no
--     ownership escape hatch (see orders.service.ts countryScopeCondition).
--
-- After this migration a grant is (user, company, country), so access in one
-- company can never affect another.
--
-- ── Backfill strategy ────────────────────────────────────────────────────────
-- For every existing (user, code) row, create one row per company the user
-- belongs to, but ONLY where that company actually has that currency active.
-- That preserves real access, drops the inert rows, and cannot invent access a
-- company's catalog does not support.
--
-- Then a repair pass: any (user, company) pair left with NO countries would be
-- locked out of that company entirely, so it is granted that company's DEFAULT
-- currency. This is the same go-dark safeguard migration 0330 used, applied per
-- company — nobody loses visibility on deploy day.
--
-- Global users (SUPER_ADMIN / SUPPORT / ADMIN / MEDIA_BUYER, or anyone with
-- countries.view_all) bypass this filter entirely in code (see
-- authz.ts canViewAllCountries), so their rows are irrelevant either way and are
-- migrated on the same terms without special-casing.

-- ── 1. Add the company dimension ─────────────────────────────────────────────
ALTER TABLE user_countries
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES branch_groups(id);

-- Drop the OLD (user_id, currency_code) uniqueness FIRST.
-- This must happen before the backfill: expanding one global grant into N
-- per-company rows reuses the same (user_id, currency_code) pair N times, so
-- with the old index still in place every expanded row after the first would be
-- swallowed by `ON CONFLICT DO NOTHING` and then deleted with the originals in
-- step 4 — silently destroying the access this migration is meant to preserve.
DROP INDEX IF EXISTS user_countries_user_currency_uniq;

-- ── 2. Expand each global grant into per-company grants ──────────────────────
-- Insert the (user, company, code) triples implied by the user's memberships,
-- keeping only codes the company genuinely has active. Rows are inserted
-- alongside the old NULL-group rows; step 4 removes those.
INSERT INTO user_countries (user_id, group_id, currency_code)
SELECT DISTINCT uc.user_id, b.group_id, uc.currency_code
FROM user_countries uc
JOIN user_branches ub ON ub.user_id = uc.user_id
JOIN branches b       ON b.id = ub.branch_id
JOIN currencies c     ON c.group_id = b.group_id
                     AND upper(c.code) = upper(uc.currency_code)
                     AND c.active
WHERE uc.group_id IS NULL
  AND b.group_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 3. Go-dark repair: every (user, company) must have at least one country ──
-- A user who belonged to a company but held none of its currencies would be
-- locked out of it. Grant that company's default currency so they retain the
-- visibility they had before this migration.
INSERT INTO user_countries (user_id, group_id, currency_code)
SELECT DISTINCT ub.user_id, b.group_id, c.code
FROM user_branches ub
JOIN branches b   ON b.id = ub.branch_id
JOIN currencies c ON c.group_id = b.group_id
                 AND c.is_default
                 AND c.active
WHERE b.group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_countries x
    WHERE x.user_id = ub.user_id
      AND x.group_id = b.group_id
  )
ON CONFLICT DO NOTHING;

-- ── 4. Drop the superseded global rows ───────────────────────────────────────
-- Every still-relevant grant now exists as a (user, company, code) triple.
DELETE FROM user_countries WHERE group_id IS NULL;

-- ── 5. Re-key uniqueness on the company dimension ────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS user_countries_user_group_currency_uniq
  ON user_countries (user_id, group_id, currency_code);

-- Session resolution reads "this user's codes in this company" on every login,
-- mirror and company switch.
CREATE INDEX IF NOT EXISTS user_countries_user_group_idx
  ON user_countries (user_id, group_id);

-- group_id is mandatory from here on: a grant with no company is exactly the
-- ambiguity this migration removes. Set last, so the backfill above could run.
ALTER TABLE user_countries
  ALTER COLUMN group_id SET NOT NULL;

COMMENT ON COLUMN user_countries.group_id IS
  'Company this country grant applies to. Access is per company: a user in two companies has independent country access in each.';
