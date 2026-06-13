-- Add group_id to product_categories for company-group isolation.
-- Existing categories are backfilled to the oldest group (the default/original company).
ALTER TABLE "product_categories"
  ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "branch_groups"("id");

-- Sync the history table so the temporal audit trigger doesn't fail.
ALTER TABLE "product_categories_history"
  ADD COLUMN IF NOT EXISTS "group_id" uuid;

-- Backfill: assign all existing categories to the oldest (default) group.
UPDATE "product_categories"
SET "group_id" = (SELECT "id" FROM "branch_groups" ORDER BY "created_at" ASC LIMIT 1)
WHERE "group_id" IS NULL;
