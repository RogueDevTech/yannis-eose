-- System settings: add group_id for per-company config.
-- CEO directive 2026-06-10.

-- 1. Add group_id column (nullable — NULL = legacy/global)
ALTER TABLE "system_settings" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "branch_groups"("id");

-- 2. Backfill existing settings → default group
UPDATE "system_settings"
SET "group_id" = (SELECT "id" FROM "branch_groups" ORDER BY "created_at" LIMIT 1)
WHERE "group_id" IS NULL;

-- 3. Drop the old unique constraint on key alone
ALTER TABLE "system_settings" DROP CONSTRAINT IF EXISTS "system_settings_key_unique";

-- 4. Add composite unique: same key once per group
CREATE UNIQUE INDEX IF NOT EXISTS "system_settings_key_group_uniq"
  ON "system_settings" ("key", "group_id");

-- 5. Index for group lookups
CREATE INDEX IF NOT EXISTS "system_settings_group_id_idx" ON "system_settings" ("group_id");
