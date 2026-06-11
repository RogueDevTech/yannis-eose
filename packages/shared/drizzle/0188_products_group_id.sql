-- Products: add group_id for multi-company isolation.
-- CEO directive 2026-06-10.

-- 1. Add group_id column (nullable first for backfill)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "branch_groups"("id");

-- 2. Backfill all existing products → default group
UPDATE "products"
SET "group_id" = (SELECT "id" FROM "branch_groups" ORDER BY "created_at" LIMIT 1)
WHERE "group_id" IS NULL;

-- 3. Make NOT NULL after backfill
ALTER TABLE "products" ALTER COLUMN "group_id" SET NOT NULL;

-- 4. Index for group-scoped lookups
CREATE INDEX IF NOT EXISTS "products_group_id_idx" ON "products" ("group_id");

-- 5. History table sync
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'products_history'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products_history' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE "products_history" ADD COLUMN "group_id" uuid;
  END IF;
END $$;
