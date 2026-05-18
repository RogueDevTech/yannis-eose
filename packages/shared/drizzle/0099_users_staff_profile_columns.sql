-- Drizzle schema (`packages/shared/src/db/schema/users.ts`) has always included
-- logistics_location_id, phone, visible_order_statuses, and commission_plan_id,
-- but no earlier migration added them to PostgreSQL — only orders/other tables got
-- logistics_location_id. App queries (e.g. users.list) SELECT these columns →
-- "column does not exist" even when "_yannis_applied_migrations" shows everything applied.

ALTER TABLE users ADD COLUMN IF NOT EXISTS logistics_location_id uuid REFERENCES logistics_locations(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS visible_order_statuses jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_plan_id uuid REFERENCES commission_plans(id) ON DELETE SET NULL;

-- Keep history mirror aligned (idempotent with 0098).
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS logistics_location_id uuid;
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS visible_order_statuses jsonb;
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS commission_plan_id uuid;
