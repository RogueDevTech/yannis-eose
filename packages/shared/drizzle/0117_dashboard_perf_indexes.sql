-- Dashboard / finance hot-path performance indexes (2026-05).
--
-- Problem: as order + ad-spend volume grows, the CEO Executive Overview, branch
-- breakdown, and finance profit reports degrade. Branch-scoped filters fall back
-- to scanning the date index and post-filtering branch_id; the ad-spend MV cannot
-- refresh CONCURRENTLY because it lacks a unique index, so its refresh blocks
-- every reader for the duration.
--
-- This migration:
--   1. Adds a UNIQUE index on `mv_ad_spend_summary` so `REFRESH MATERIALIZED VIEW
--      CONCURRENTLY` works (reads no longer block during refresh).
--   2. Drops the now-redundant non-unique single-column index on the same MV.
--   3. Adds composite (branch_id, <date>) indexes on orders — the table every
--      CEO/admin/finance aggregate hits when scoped to a branch (admin landing,
--      branch breakdown, status counts, profit report).
--
-- ad_spend_logs and payout_records intentionally do NOT carry a branch_id
-- column today (branch is derived through campaigns / payroll_batches), so we
-- skip those — their branch-scoped queries already join on the parent and rely
-- on the existing date+status composites.
--
-- All indexes use IF NOT EXISTS so re-running on an already-migrated DB is a no-op.

-- ── 1. mv_ad_spend_summary unique index for CONCURRENTLY refresh ──────────
-- The MV groups by (spend_date, media_buyer_id, product_id) so that triple is
-- the only natural unique key. Once this exists, the refresh command can use
-- CONCURRENTLY and reads stop blocking during the refresh window.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_ad_spend_summary
  ON mv_ad_spend_summary (spend_date, media_buyer_id, product_id);

-- The earlier non-unique single-column index was sized for the same access
-- pattern; it is fully covered by the leading column of the unique index above.
DROP INDEX IF EXISTS idx_mv_ad_spend_summary_date;

-- ── 2. Orders: branch + date composites ────────────────────────────────────
-- Hottest CEO/admin queries scope by branch_id then by created_at or delivered_at.
-- The existing (created_at, status) and (delivered_at, status) indexes work great
-- for SuperAdmin/global views; these composites cover branch-scoped views.
CREATE INDEX IF NOT EXISTS idx_orders_branch_id_created_at
  ON orders (branch_id, created_at)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_branch_id_delivered_at
  ON orders (branch_id, delivered_at)
  WHERE branch_id IS NOT NULL AND delivered_at IS NOT NULL;
