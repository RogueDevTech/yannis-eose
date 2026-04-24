-- Phone uniqueness is enforced at the SERVICE layer only for now.
-- See UsersService.createStaff / UsersService.update: both scan for duplicate phones and throw
-- a friendly CONFLICT naming the other user. CEO directive 2026-04-24.
--
-- We intentionally skip the DB-level partial unique index here because the existing seed
-- dataset contains ~12 Media Buyer / CS Agent phone collisions. Nulling or regenerating them
-- was deferred; those conflicts surface organically when an admin edits one of the affected
-- profiles (the update validator blocks save until they pick a unique number).
--
-- To add the DB-level safety net later, first run:
--   SELECT phone, COUNT(*) FROM users WHERE phone IS NOT NULL GROUP BY phone HAVING COUNT(*) > 1;
-- resolve any remaining rows, then create a new migration:
--   CREATE UNIQUE INDEX users_phone_unique_not_null ON users(phone) WHERE phone IS NOT NULL;

SELECT 1;  -- no-op so drizzle-kit records the migration as applied
