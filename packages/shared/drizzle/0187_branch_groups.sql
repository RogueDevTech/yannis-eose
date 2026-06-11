-- Branch Groups — lightweight "company" boundary layer.
-- CEO directive 2026-06-10: reuse the platform for multiple companies.
-- Each branch belongs to exactly one group. Products, system settings,
-- commission plans are scoped per group.

-- 1. Create the branch_groups table
CREATE TABLE IF NOT EXISTS "branch_groups" (
  "id"         uuid PRIMARY KEY,
  "name"       text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- 2. Create a default group for all existing branches
INSERT INTO "branch_groups" ("id", "name")
SELECT gen_random_uuid(), 'Default'
WHERE NOT EXISTS (SELECT 1 FROM "branch_groups" LIMIT 1);

-- 3. Add group_id column to branches (nullable first for backfill)
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "branch_groups"("id");

-- 4. Backfill all existing branches → default group
UPDATE "branches"
SET "group_id" = (SELECT "id" FROM "branch_groups" ORDER BY "created_at" LIMIT 1)
WHERE "group_id" IS NULL;

-- 5. Make group_id NOT NULL after backfill
ALTER TABLE "branches" ALTER COLUMN "group_id" SET NOT NULL;

-- 6. Index for fast group lookups
CREATE INDEX IF NOT EXISTS "branches_group_id_idx" ON "branches" ("group_id");

-- 7. History table sync — add group_id to branches_history if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'branches_history'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'branches_history' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE "branches_history" ADD COLUMN "group_id" uuid;
  END IF;
END $$;
