-- ============================================
-- 0236: Backfill ORDER_REMITTED timeline events
-- Inserts timeline entries for all REMITTED orders that don't
-- already have one, using delivery_remittances received_by/received_at.
-- Runs after 0235 which adds the ORDER_REMITTED enum value.
-- ============================================

INSERT INTO order_timeline_events (
  order_id, event_type, actor_id, actor_name, description, metadata, branch_id
)
SELECT
  o.id,
  'ORDER_REMITTED',
  dr.received_by,
  u.name,
  'Cash remittance received. Order marked as remitted. (backfilled)',
  jsonb_build_object('deliveryRemittanceId', dr.id, 'backfilled', true),
  o.branch_id
FROM delivery_remittance_orders dro
JOIN delivery_remittances dr ON dr.id = dro.delivery_remittance_id
JOIN orders o ON o.id = dro.order_id
LEFT JOIN users u ON u.id = dr.received_by
WHERE o.status = 'REMITTED'
  AND o.deleted_at IS NULL
  AND dr.received_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM order_timeline_events ote
    WHERE ote.order_id = o.id
      AND ote.event_type = 'ORDER_REMITTED'
  );
