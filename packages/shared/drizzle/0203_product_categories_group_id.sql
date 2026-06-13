-- Add group_id to product_categories for company-group isolation.
-- Existing categories are backfilled to the oldest group (the default/original company).
ALTER TABLE "product_categories"
  ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "branch_groups"("id");

-- Sync the history table so the temporal audit trigger doesn't fail.
ALTER TABLE "product_categories_history"
  ADD COLUMN IF NOT EXISTS "group_id" uuid;

-- History tables must NOT have unique constraints — they store multiple
-- versions of the same row. Programmatically drop ALL unique constraints
-- and unique indexes to prevent trigger failures on any future UPDATE.
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Drop named constraints (PRIMARY KEY, UNIQUE)
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'product_categories_history'
      AND nsp.nspname = 'public'
      AND con.contype IN ('p', 'u')
  LOOP
    EXECUTE format('ALTER TABLE product_categories_history DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
  -- Drop unique indexes (may exist independently of constraints)
  FOR r IN
    SELECT ic.relname AS index_name
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class ic ON ic.oid = ix.indexrelid
    JOIN pg_namespace nsp ON nsp.oid = t.relnamespace
    WHERE t.relname = 'product_categories_history'
      AND nsp.nspname = 'public'
      AND ix.indisunique
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.index_name);
  END LOOP;
END $$;

-- Backfill: assign all existing categories to the oldest (default) group.
UPDATE "product_categories"
SET "group_id" = (SELECT "id" FROM "branch_groups" ORDER BY "created_at" ASC LIMIT 1)
WHERE "group_id" IS NULL;
