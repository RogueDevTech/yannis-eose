-- Migration 007: Backfill detailed deletion comments on already-deleted orders
--
-- Going forward, every delete site writes a detailed ORDER_DELETED timeline event
-- with a machine-readable `reason` (see OrdersService.logOrderDeletion). This
-- migration heals HISTORY: every order already in DELETED state that has no
-- ORDER_DELETED comment gets one, inferred from the best available evidence.
--
-- Inference (per row, in priority order):
--   1. TEST_ORDER   — customer name contains the whole word "test"
--   2. DUPLICATE_RULE — row already has an ORDER_DUPLICATE_FLAGGED event,
--                       or is_duplicate = 'FLAGGED'
--   3. OTHER        — reason not recorded before this audit backfill
--
-- Every backfilled event is tagged metadata.source = 'backfill-inferred' so it is
-- honest about certainty and distinguishable from events written at delete time.
-- Idempotent: skips any order that already has an ORDER_DELETED event.

BEGIN;

-- ── 1. orders table ───────────────────────────────────────────────────
INSERT INTO order_timeline_events
  (id, order_id, event_type, actor_id, actor_name, description, metadata, branch_id, created_at)
SELECT
  gen_random_uuid(),
  o.id,
  'ORDER_DELETED',
  NULL,
  'System',
  CASE
    WHEN o.customer_name ~* '\mtest\M'
      THEN 'Order deleted because it was detected as a test order (its name contains the word "test").'
    WHEN o.is_duplicate = 'FLAGGED' OR dup.order_id IS NOT NULL
      THEN 'Order deleted by the duplicate-detection rules (same customer and product as an existing order).'
    ELSE 'Order was deleted. The original reason was not recorded before deletion comments were introduced.'
  END,
  jsonb_build_object(
    'source', 'backfill-inferred',
    'reason', CASE
      WHEN o.customer_name ~* '\mtest\M' THEN 'TEST_ORDER'
      WHEN o.is_duplicate = 'FLAGGED' OR dup.order_id IS NOT NULL THEN 'DUPLICATE_RULE'
      ELSE 'OTHER'
    END
  ),
  o.branch_id,
  COALESCE(o.deleted_at, NOW())
FROM orders o
LEFT JOIN LATERAL (
  SELECT te.order_id
  FROM order_timeline_events te
  WHERE te.order_id = o.id AND te.event_type = 'ORDER_DUPLICATE_FLAGGED'
  LIMIT 1
) dup ON TRUE
WHERE o.status = 'DELETED'
  AND o.deleted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM order_timeline_events te
    WHERE te.order_id = o.id AND te.event_type = 'ORDER_DELETED'
  );

-- ── 2. cart_orders table ──────────────────────────────────────────────
INSERT INTO cart_order_timeline_events
  (id, cart_order_id, event_type, actor_id, actor_name, description, metadata, branch_id, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  'ORDER_DELETED',
  NULL,
  'System',
  CASE
    WHEN c.customer_name ~* '\mtest\M'
      THEN 'Order deleted because it was detected as a test order (its name contains the word "test").'
    WHEN c.is_duplicate = 'FLAGGED'
      THEN 'Order deleted by the duplicate-detection rules (same customer and product as an existing order).'
    ELSE 'Order was deleted. The original reason was not recorded before deletion comments were introduced.'
  END,
  jsonb_build_object(
    'source', 'backfill-inferred',
    'reason', CASE
      WHEN c.customer_name ~* '\mtest\M' THEN 'TEST_ORDER'
      WHEN c.is_duplicate = 'FLAGGED' THEN 'DUPLICATE_RULE'
      ELSE 'OTHER'
    END
  ),
  c.servicing_branch_id,
  COALESCE(c.deleted_at, NOW())
FROM cart_orders c
WHERE c.status = 'DELETED'
  AND c.deleted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cart_order_timeline_events te
    WHERE te.cart_order_id = c.id AND te.event_type = 'ORDER_DELETED'
  );

-- ── 3. follow_up_orders table ─────────────────────────────────────────
-- Follow-up orders are soft-deleted via deleted_at (status may remain e.g. CS_ENGAGED),
-- so key off deleted_at IS NOT NULL rather than status = 'DELETED'.
INSERT INTO follow_up_order_timeline_events
  (id, follow_up_order_id, event_type, actor_id, actor_name, description, metadata, branch_id, created_at)
SELECT
  gen_random_uuid(),
  f.id,
  'ORDER_DELETED',
  NULL,
  'System',
  CASE
    WHEN f.customer_name ~* '\mtest\M'
      THEN 'Order deleted because it was detected as a test order (its name contains the word "test").'
    WHEN f.is_duplicate = 'FLAGGED'
      THEN 'Order deleted by the duplicate-detection rules (same customer and product as an existing order).'
    ELSE 'Order was deleted. The original reason was not recorded before deletion comments were introduced.'
  END,
  jsonb_build_object(
    'source', 'backfill-inferred',
    'reason', CASE
      WHEN f.customer_name ~* '\mtest\M' THEN 'TEST_ORDER'
      WHEN f.is_duplicate = 'FLAGGED' THEN 'DUPLICATE_RULE'
      ELSE 'OTHER'
    END
  ),
  NULL,
  COALESCE(f.deleted_at, NOW())
FROM follow_up_orders f
WHERE f.deleted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM follow_up_order_timeline_events te
    WHERE te.follow_up_order_id = f.id AND te.event_type = 'ORDER_DELETED'
  );

COMMIT;
