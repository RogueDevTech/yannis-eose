-- Orders list performance indexes (2026-05).
--
-- `orders.list` is a platform-wide hot path (Admin, CS, Marketing, Logistics).
-- The query always excludes archived rows via `deleted_at IS NULL` and commonly
-- filters by a scope dimension (branch_id / assigned_cs_id / media_buyer_id /
-- logistics_location_id) plus a created_at date range, then sorts by created_at
-- (or updated_at).
--
-- These partial composite indexes align with that shape and avoid scanning
-- deleted rows or scanning by date then post-filtering the scope column.

-- Base: not-deleted orders by created_at / updated_at (global views).
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted_created_at_desc
  ON orders (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_not_deleted_updated_at_desc
  ON orders (updated_at DESC)
  WHERE deleted_at IS NULL;

-- Branch-scoped lists (most common for non-admin roles).
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted_branch_created_at_desc
  ON orders (branch_id, created_at DESC)
  WHERE deleted_at IS NULL AND branch_id IS NOT NULL;

-- CS-assigned lists (CS_AGENT + supervisor scope).
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted_assigned_cs_created_at_desc
  ON orders (assigned_cs_id, created_at DESC)
  WHERE deleted_at IS NULL AND assigned_cs_id IS NOT NULL;

-- Media-buyer lists (Marketing orders + supervisor scope).
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted_media_buyer_created_at_desc
  ON orders (media_buyer_id, created_at DESC)
  WHERE deleted_at IS NULL AND media_buyer_id IS NOT NULL;

-- Logistics location lists.
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted_logistics_location_created_at_desc
  ON orders (logistics_location_id, created_at DESC)
  WHERE deleted_at IS NULL AND logistics_location_id IS NOT NULL;

-- Status-filtered lists (common on every orders table).
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted_status_created_at_desc
  ON orders (status, created_at DESC)
  WHERE deleted_at IS NULL;

