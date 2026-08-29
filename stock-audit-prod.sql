-- ============================================================================
-- STOCK DISCREPANCY AUDIT — PRODUCTION (READ ONLY)
-- Finance reports on-site stock < CRM stock.
-- Hypothesis: orders that reached DELIVERED/REMITTED without ever being
-- allocated never ran stock deduction, so the CRM still counts those units.
-- Every statement below is a SELECT. Nothing is written or modified.
-- ============================================================================


-- ── Q1. HEADLINE: how many delivered orders never deducted stock? ───────────
-- The single number to give Finance first.
SELECT
  COUNT(*)                                                        AS delivered_orders_total,
  COUNT(*) FILTER (WHERE sm.id IS NULL)                           AS never_deducted,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sm.id IS NULL) / NULLIF(COUNT(*),0), 1) AS pct_missing
FROM orders o
LEFT JOIN LATERAL (
  SELECT 1 AS id FROM stock_movements m
  WHERE m.reference_id = o.id AND m.movement_type = 'DELIVERY' LIMIT 1
) sm ON TRUE
WHERE o.status IN ('DELIVERED','REMITTED')
  AND o.deleted_at IS NULL;


-- ── Q2. ROOT-CAUSE PROOF: allocation is the discriminator ──────────────────
-- Expect: deducted orders ~100% allocated; undeducted ~0% allocated.
-- If that split holds, the cause is confirmed (unallocated => no fulfilment
-- location => deduction cannot run).
SELECT
  CASE WHEN sm.id IS NULL THEN 'NEVER DEDUCTED' ELSE 'deducted OK' END AS bucket,
  COUNT(*)                                                          AS orders,
  COUNT(*) FILTER (WHERE o.allocated_at IS NOT NULL)                AS ever_allocated,
  COUNT(*) FILTER (WHERE o.logistics_location_id IS NOT NULL)       AS has_fulfilment_location
FROM orders o
LEFT JOIN LATERAL (
  SELECT 1 AS id FROM stock_movements m
  WHERE m.reference_id = o.id AND m.movement_type = 'DELIVERY' LIMIT 1
) sm ON TRUE
WHERE o.status IN ('DELIVERED','REMITTED')
  AND o.deleted_at IS NULL
GROUP BY 1;


-- ── Q3. THE VARIANCE REPORT FOR FINANCE ────────────────────────────────────
-- Units the CRM still counts that have physically shipped, per product.
-- NOTE: bundle-naive. A bundle line counts as its parent SKU, not its
-- components, so bundle products may be understated here. Q3b handles bundles.
SELECT
  p.name AS product,
  COUNT(DISTINCT o.id)          AS affected_orders,
  SUM(oi.quantity)              AS units_overstated_in_crm
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products    p  ON p.id = oi.product_id
WHERE o.status IN ('DELIVERED','REMITTED')
  AND o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements m
    WHERE m.reference_id = o.id AND m.movement_type = 'DELIVERY'
  )
GROUP BY p.name
ORDER BY units_overstated_in_crm DESC;


-- ── Q3b. BUNDLE-AWARE VARIANCE ─────────────────────────────────────────────
-- Expands bundle lines into their component SKUs (one level deep, matching
-- how the app expands bundles). Run this alongside Q3; where a product is a
-- bundle, THIS is the figure that matches the physical shelf.
-- If you have no bundles configured, this returns the same as Q3.
SELECT
  p.name AS product,
  SUM(x.units)                             AS units_overstated_in_crm
FROM (
  -- non-bundle lines (and bundle parents that have no components defined)
  SELECT oi.product_id, oi.quantity AS units
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status IN ('DELIVERED','REMITTED') AND o.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM stock_movements m
                    WHERE m.reference_id=o.id AND m.movement_type='DELIVERY')
    AND NOT EXISTS (SELECT 1 FROM product_bundle_components pbi
                    WHERE pbi.bundle_product_id = oi.product_id)
  UNION ALL
  -- bundle lines exploded into components
  SELECT pbi.component_product_id, oi.quantity * pbi.quantity
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN product_bundle_components pbi ON pbi.bundle_product_id = oi.product_id
  WHERE o.status IN ('DELIVERED','REMITTED') AND o.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM stock_movements m
                    WHERE m.reference_id=o.id AND m.movement_type='DELIVERY')
) x
JOIN products p ON p.id = x.product_id
GROUP BY p.name
ORDER BY units_overstated_in_crm DESC;


-- ── Q4. WHICH CHANNEL IS LEAKING, AND SINCE WHEN ───────────────────────────
-- Splits the gap by order_source and month so you can see whether it is the
-- bulk importer, cart/follow-up graduation, or the normal delivery path.
SELECT
  COALESCE(o.order_source,'(none)')                   AS order_source,
  date_trunc('month', COALESCE(o.delivered_at, o.updated_at))::date AS month,
  COUNT(*)                                            AS never_deducted
FROM orders o
WHERE o.status IN ('DELIVERED','REMITTED')
  AND o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements m
    WHERE m.reference_id = o.id AND m.movement_type = 'DELIVERY'
  )
GROUP BY 1,2
ORDER BY 2 DESC, 3 DESC;


-- ── Q5. IS THE EXISTING SELF-HEAL SWEEP ABLE TO FIX THESE? ─────────────────
-- The sweep in cart-orders.service.ts only matches cart/follow-up graduates
-- AND skips rows with no fulfilment location. This shows how many are
-- permanently stuck vs. auto-healable.
SELECT
  CASE
    WHEN o.logistics_location_id IS NULL THEN 'STUCK — no fulfilment location (sweep skips)'
    WHEN EXISTS (SELECT 1 FROM cart_orders co     WHERE co.graduated_order_id=o.id AND co.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM follow_up_orders f WHERE f.graduated_order_id=o.id AND f.deleted_at IS NULL)
      THEN 'healable by existing sweep'
    ELSE 'STUCK — ordinary order, sweep does not match'
  END                     AS repair_status,
  COUNT(*)                AS orders
FROM orders o
WHERE o.status IN ('DELIVERED','REMITTED')
  AND o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements m
    WHERE m.reference_id = o.id AND m.movement_type = 'DELIVERY'
  )
GROUP BY 1
ORDER BY 2 DESC;


-- ── Q6. SANITY CHECK: any DOUBLE deductions? ───────────────────────────────
-- Expect ZERO rows. If rows appear, stock is ALSO being under-stated
-- somewhere, which is a separate bug from the one above.
SELECT reference_id AS order_id, COUNT(*) AS delivery_movements
FROM stock_movements
WHERE movement_type = 'DELIVERY'
GROUP BY reference_id
HAVING COUNT(*) > 1
ORDER BY 2 DESC
LIMIT 20;


-- ── Q7. NEGATIVE / IMPOSSIBLE STOCK ────────────────────────────────────────
-- Expect zero rows. Negative on-hand or reserved > on-hand indicates a
-- separate integrity problem worth flagging.
SELECT p.name, il.location_id, il.stock_count, il.reserved_count
FROM inventory_levels il
JOIN products p ON p.id = il.product_id
WHERE il.stock_count < 0
   OR il.reserved_count < 0
   OR il.reserved_count > il.stock_count
ORDER BY il.stock_count;


-- ── Q8. CURRENT CRM ON-HAND (the number Finance is comparing against) ──────
-- Give this to Finance next to their physical count. Subtract the Q3b figure
-- from `crm_on_hand` to get the expected true on-hand.
SELECT
  p.name AS product,
  SUM(il.stock_count)                           AS crm_on_hand,
  SUM(il.reserved_count)                        AS reserved,
  SUM(il.stock_count - il.reserved_count)       AS available
FROM inventory_levels il
JOIN products p ON p.id = il.product_id
GROUP BY p.name
ORDER BY crm_on_hand DESC;


-- ── Q9. RECONCILED VIEW: CRM vs expected-true on-hand, per product ─────────
-- The one table to hand Finance. `expected_true_on_hand` is what the shelf
-- should physically hold once the missing deductions are accounted for.
WITH missing AS (
  SELECT x.product_id, SUM(x.units) AS units_missing
  FROM (
    SELECT oi.product_id, oi.quantity AS units
    FROM orders o JOIN order_items oi ON oi.order_id=o.id
    WHERE o.status IN ('DELIVERED','REMITTED') AND o.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM stock_movements m
                      WHERE m.reference_id=o.id AND m.movement_type='DELIVERY')
      AND NOT EXISTS (SELECT 1 FROM product_bundle_components pbi
                      WHERE pbi.bundle_product_id = oi.product_id)
    UNION ALL
    SELECT pbi.component_product_id, oi.quantity * pbi.quantity
    FROM orders o
    JOIN order_items oi ON oi.order_id=o.id
    JOIN product_bundle_components pbi ON pbi.bundle_product_id = oi.product_id
    WHERE o.status IN ('DELIVERED','REMITTED') AND o.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM stock_movements m
                      WHERE m.reference_id=o.id AND m.movement_type='DELIVERY')
  ) x
  GROUP BY x.product_id
)
SELECT
  p.name AS product,
  COALESCE(SUM(il.stock_count),0)                     AS crm_on_hand,
  COALESCE(MAX(ms.units_missing),0)                   AS units_never_deducted,
  COALESCE(SUM(il.stock_count),0) - COALESCE(MAX(ms.units_missing),0)
                                                      AS expected_true_on_hand
FROM products p
LEFT JOIN inventory_levels il ON il.product_id = p.id
LEFT JOIN missing ms          ON ms.product_id = p.id
GROUP BY p.name
HAVING COALESCE(MAX(ms.units_missing),0) > 0
    OR COALESCE(SUM(il.stock_count),0) <> 0
ORDER BY units_never_deducted DESC, crm_on_hand DESC;
