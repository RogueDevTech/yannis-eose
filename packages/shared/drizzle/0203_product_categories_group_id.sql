-- Add group_id to product_categories for company-group isolation.
-- Existing categories are backfilled to the oldest group (the default/original company).
ALTER TABLE "product_categories"
  ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "branch_groups"("id");

-- Backfill: assign all existing categories to the oldest (default) group.
UPDATE "product_categories"
SET "group_id" = (SELECT "id" FROM "branch_groups" ORDER BY "created_at" ASC LIMIT 1)
WHERE "group_id" IS NULL;
