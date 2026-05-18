-- Phase 22 (Task 22.3 — round 2) — additional hot-path index gaps.
--
-- 0117 / 0128 / 0142 covered the obvious orders index needs (status, branch,
-- assigned_cs, media_buyer, logistics_location, created_at + their `_status`
-- and `_created_at_desc` composites). This migration closes the remaining
-- gaps I can prove from hot-path code:
--
--   • orders.customer_phone_hash — duplicate detection (every form submission)
--   • orders.callback_scheduled_at — CS callbacks tab + scheduleKind=callback_due
--   • orders.preferred_delivery_date — delivery overdue + on-day filters
--   • orders.is_duplicate — Duplicates tab on CS queue
--   • orders.rider_id — TPL rider's "my deliveries" list
--   • orders.campaign_id — Marketing orders filtered by campaign
--   • order_items.order_id / product_id — FK constraints don't auto-index;
--     every order detail page reads order_items by order_id, and
--     detectDuplicates() runs EXISTS by product_id.
--   • call_logs.order_id — every order detail page lists the order's calls.
--   • cart_abandonments(status, updated_at) — abandoned-cart queue.
--   • notifications(user_id, created_at) WHERE read=false — bell unread list.
--
-- Risk profile: all are `CREATE INDEX IF NOT EXISTS`, so re-running is safe.
-- They are NOT `CONCURRENTLY` — that matches the rest of this codebase's
-- migration pattern (auto-run on API boot under a transaction). On a busy
-- prod table this will hold a brief `SHARE` lock; if that becomes a problem
-- at scale, the deploy runbook should switch to manually-applied
-- `CREATE INDEX CONCURRENTLY` outside the migration runner.

-- ── orders ─────────────────────────────────────────────────────────────────

-- detectDuplicates / findRecentPhoneOrder / findHistoricalSamePhoneOrder
-- all query `WHERE customer_phone_hash = $1 AND created_at >= … AND status != 'CANCELLED'
-- ORDER BY created_at DESC LIMIT 1/5`. A plain hash index won't help because
-- of the createdAt range + ORDER BY — a composite supports both.
CREATE INDEX IF NOT EXISTS idx_orders_phone_hash_created_at
  ON orders (customer_phone_hash, created_at DESC);

-- scheduleKind=callback_due query: `callback_scheduled_at IS NOT NULL AND
-- callback_scheduled_at <= NOW() AND status IN (...)` ORDER BY callback time.
-- Partial keeps the index small — most orders never get a callback scheduled.
CREATE INDEX IF NOT EXISTS idx_orders_callback_scheduled_at
  ON orders (callback_scheduled_at)
  WHERE callback_scheduled_at IS NOT NULL;

-- scheduleKind=delivery_overdue / delivery_on_day filters + the new
-- "Overdue" + "Due today" row tags both key off preferred_delivery_date.
-- Partial since pre-confirm orders don't have a delivery date.
CREATE INDEX IF NOT EXISTS idx_orders_preferred_delivery_date
  ON orders (preferred_delivery_date)
  WHERE preferred_delivery_date IS NOT NULL;

-- CS Duplicates tab filters `WHERE is_duplicate IS NOT NULL`. Vast majority
-- of orders are NULL here, so a partial index is dramatically cheaper than
-- a full one.
CREATE INDEX IF NOT EXISTS idx_orders_is_duplicate
  ON orders (is_duplicate)
  WHERE is_duplicate IS NOT NULL;

-- TPL rider's "my deliveries" lists orders by rider_id + status set
-- (DISPATCHED, IN_TRANSIT). Existing (logistics_location_id, created_at)
-- index doesn't help when filtering by rider directly.
CREATE INDEX IF NOT EXISTS idx_orders_rider_id_status
  ON orders (rider_id, status)
  WHERE rider_id IS NOT NULL;

-- Marketing orders filtered by campaign (form picker) + Campaign detail
-- "orders from this form" rollup. campaign_id is nullable so partial keeps
-- it tight.
CREATE INDEX IF NOT EXISTS idx_orders_campaign_id_created_at
  ON orders (campaign_id, created_at DESC)
  WHERE campaign_id IS NOT NULL;

-- ── order_items ────────────────────────────────────────────────────────────

-- Every order detail page reads `SELECT * FROM order_items WHERE order_id = $1`
-- — and finance P&L / inventory / messaging clipboard summaries do the same.
-- Postgres does NOT auto-index foreign keys; the FK constraint is a separate
-- thing from a supporting index. This is the single biggest missing index.
CREATE INDEX IF NOT EXISTS idx_order_items_order_id
  ON order_items (order_id);

-- detectDuplicates() runs `EXISTS (SELECT 1 FROM order_items WHERE order_id =
-- … AND product_id IN (…))` on every edge-form submission. Also used by the
-- `productId` filter on `orders.list`.
CREATE INDEX IF NOT EXISTS idx_order_items_product_id
  ON order_items (product_id);

-- ── call_logs ──────────────────────────────────────────────────────────────

-- Order detail page lists all calls for an order, latest first. Order timeline
-- + VOIP gate also read this same shape. No index existed today.
CREATE INDEX IF NOT EXISTS idx_call_logs_order_id_started_at
  ON call_logs (order_id, started_at DESC);

-- ── cart_abandonments ──────────────────────────────────────────────────────

-- CS Cart abandonment tab + cartStats list filter by status and order by
-- updated_at DESC (most recently active cart first).
CREATE INDEX IF NOT EXISTS idx_cart_abandonments_status_updated_at
  ON cart_abandonments (status, updated_at DESC);

-- ── notifications ──────────────────────────────────────────────────────────

-- Bell list reads "my unread notifications, newest first" on every page
-- mount. Partial WHERE read = false keeps the index tiny relative to the
-- whole table (notifications accumulate forever; unread is a small tail).
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read = false;
