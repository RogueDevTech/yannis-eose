-- Commission plans + settlement configs: add group_id for multi-company.
-- CEO directive 2026-06-10.

-- commission_plans
ALTER TABLE "commission_plans" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "branch_groups"("id");

UPDATE "commission_plans"
SET "group_id" = (SELECT "id" FROM "branch_groups" ORDER BY "created_at" LIMIT 1)
WHERE "group_id" IS NULL;

CREATE INDEX IF NOT EXISTS "commission_plans_group_id_idx" ON "commission_plans" ("group_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'commission_plans_history'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'commission_plans_history' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE "commission_plans_history" ADD COLUMN "group_id" uuid;
  END IF;
END $$;

-- settlement_configs
ALTER TABLE "settlement_configs" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "branch_groups"("id");

UPDATE "settlement_configs"
SET "group_id" = (SELECT "id" FROM "branch_groups" ORDER BY "created_at" LIMIT 1)
WHERE "group_id" IS NULL;

CREATE INDEX IF NOT EXISTS "settlement_configs_group_id_idx" ON "settlement_configs" ("group_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'settlement_configs_history'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'settlement_configs_history' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE "settlement_configs_history" ADD COLUMN "group_id" uuid;
  END IF;
END $$;
