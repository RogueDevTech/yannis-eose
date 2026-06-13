-- Add group_id to logistics_providers for company-group isolation.
-- Existing providers are backfilled to the oldest group (the default/original company).
ALTER TABLE "logistics_providers"
  ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "branch_groups"("id");

-- Sync the history table so the temporal audit trigger doesn't fail
-- with "INSERT has more expressions than target columns".
ALTER TABLE "logistics_providers_history"
  ADD COLUMN IF NOT EXISTS "group_id" uuid;

-- Backfill: assign all existing providers to the oldest (default) group.
UPDATE "logistics_providers"
SET "group_id" = (SELECT "id" FROM "branch_groups" ORDER BY "created_at" ASC LIMIT 1)
WHERE "group_id" IS NULL;
