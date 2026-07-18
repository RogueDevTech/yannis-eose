-- ═══════════════════════════════════════════════════════════════════════════
-- YANNIS EOSE — DATA INTEGRITY AUDIT
-- Run against production database to verify order counting consistency,
-- stock accuracy, and remittance integrity.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── SECTION 1: ORDER COUNT GROUND TRUTH ─────────────────────────────────
-- What actually exists in each table, by status

\echo '══════════════════════════════════════════════════════'
\echo 'SECTION 1: ORDER COUNTS BY TABLE × STATUS'
\echo '══════════════════════════════════════════════════════'

\echo ''
\echo '--- 1a. orders table by status (excluding soft-deleted) ---'
SELECT status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NULL
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 1b. orders table by orderSource × status ---'
SELECT order_source, status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NULL
GROUP BY order_source, status
ORDER BY order_source, cnt DESC;

\echo ''
\echo '--- 1c. orders table by is_follow_up × status ---'
SELECT is_follow_up, status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NULL
GROUP BY is_follow_up, status
ORDER BY is_follow_up, cnt DESC;

\echo ''
\echo '--- 1d. follow_up_orders table by status ---'
SELECT status, COUNT(*) as cnt
FROM follow_up_orders
WHERE deleted_at IS NULL
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 1e. cart_orders table by status ---'
SELECT status, COUNT(*) as cnt
FROM cart_orders
WHERE deleted_at IS NULL
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 1f. Soft-deleted orders (orders table) ---'
SELECT status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NOT NULL
GROUP BY status
ORDER BY cnt DESC;

-- ─── SECTION 2: DASHBOARD STRIP RECONCILIATION ──────────────────────────
-- Simulate each dashboard strip's counting logic

\echo ''
\echo '══════════════════════════════════════════════════════'
\echo 'SECTION 2: DASHBOARD STRIP SIMULATION'
\echo '══════════════════════════════════════════════════════'

\echo ''
\echo '--- 2a. MARKETING FUNNEL (edge-form, exclude graduated+cart+offline) ---'
SELECT status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NULL
  AND is_follow_up = false
  AND (order_source IS NULL OR order_source = 'edge-form')
  -- excludeCartGraduated: NOT (order_source='online' OR (NULL source + cart_id + DELIVERED))
  AND NOT (order_source = 'online' OR (order_source IS NULL AND cart_id IS NOT NULL AND status IN ('DELIVERED', 'REMITTED')))
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 2b. CS FUNNEL (same as marketing but servicing branch scope) ---'
-- Same filters as marketing, just different branch column
SELECT 'CS Funnel uses same filters as Marketing Funnel (different branch scope)' as note;

\echo ''
\echo '--- 2c. OFFLINE ORDERS (orderSource IN offline, import) ---'
SELECT status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NULL
  AND is_follow_up = false
  AND order_source IN ('offline', 'import')
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 2d. FOLLOW-UP ORDERS (from follow_up_orders table) ---'
SELECT status, COUNT(*) as cnt
FROM follow_up_orders
WHERE deleted_at IS NULL
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 2e. CART ORDERS (from cart_orders table) ---'
SELECT status, COUNT(*) as cnt
FROM cart_orders
WHERE deleted_at IS NULL
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 2f. DELIVERED FOLLOW-UP (orderSource = delivered_follow_up) ---'
SELECT status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NULL
  AND order_source = 'delivered_follow_up'
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 2g. TOTAL ORDERS (onlyGraduateNonMarketing logic) ---'
\echo '    Marketing (edge-form/NULL): all statuses'
\echo '    Everything else: only DELIVERED/REMITTED'
SELECT status, COUNT(*) as cnt
FROM orders
WHERE (deleted_at IS NULL OR status IN ('DELETED', 'CANCELLED'))
  AND (
    -- Marketing orders: full funnel (all statuses)
    (order_source IS NULL OR order_source = 'edge-form')
    OR
    -- Non-marketing: only DELIVERED/REMITTED
    (status IN ('DELIVERED', 'REMITTED'))
  )
GROUP BY status
ORDER BY cnt DESC;

-- ─── SECTION 3: DELIVERED RECONCILIATION ────────────────────────────────
-- The CEO's core concern: do delivered counts add up?

\echo ''
\echo '══════════════════════════════════════════════════════'
\echo 'SECTION 3: DELIVERED COUNT RECONCILIATION'
\echo '══════════════════════════════════════════════════════'

\echo ''
\echo '--- 3a. Delivered counts per funnel ---'
SELECT 'Marketing Funnel' as funnel,
  COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED')) as delivered
FROM orders
WHERE deleted_at IS NULL
  AND is_follow_up = false
  AND (order_source IS NULL OR order_source = 'edge-form')
  AND NOT (order_source = 'online' OR (order_source IS NULL AND cart_id IS NOT NULL AND status IN ('DELIVERED', 'REMITTED')))

UNION ALL

SELECT 'Offline Orders',
  COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED'))
FROM orders
WHERE deleted_at IS NULL
  AND is_follow_up = false
  AND order_source IN ('offline', 'import')

UNION ALL

SELECT 'Cart Orders (cart_orders table)',
  COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED'))
FROM cart_orders
WHERE deleted_at IS NULL

UNION ALL

SELECT 'Follow-Up Orders (follow_up_orders table)',
  COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED'))
FROM follow_up_orders
WHERE deleted_at IS NULL

UNION ALL

SELECT 'Delivered Follow-Up (orders table)',
  COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED'))
FROM orders
WHERE deleted_at IS NULL
  AND order_source = 'delivered_follow_up'

UNION ALL

SELECT 'TOTAL ORDERS (onlyGraduateNonMarketing)',
  COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED'))
FROM orders
WHERE (deleted_at IS NULL OR status IN ('DELETED', 'CANCELLED'))
  AND (
    (order_source IS NULL OR order_source = 'edge-form')
    OR (status IN ('DELIVERED', 'REMITTED'))
  );

\echo ''
\echo '--- 3b. Sum check ---'
WITH funnel_counts AS (
  SELECT COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED')) as delivered, 'marketing' as src
  FROM orders WHERE deleted_at IS NULL AND is_follow_up = false
    AND (order_source IS NULL OR order_source = 'edge-form')
    AND NOT (order_source = 'online' OR (order_source IS NULL AND cart_id IS NOT NULL AND status IN ('DELIVERED', 'REMITTED')))
  UNION ALL
  SELECT COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED')), 'offline'
  FROM orders WHERE deleted_at IS NULL AND is_follow_up = false AND order_source IN ('offline', 'import')
  UNION ALL
  SELECT COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED')), 'cart'
  FROM cart_orders WHERE deleted_at IS NULL
  UNION ALL
  SELECT COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED')), 'followup'
  FROM follow_up_orders WHERE deleted_at IS NULL
  UNION ALL
  SELECT COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED')), 'delivered_followup'
  FROM orders WHERE deleted_at IS NULL AND order_source = 'delivered_follow_up'
),
total AS (
  SELECT COUNT(*) FILTER (WHERE status IN ('DELIVERED', 'REMITTED')) as delivered
  FROM orders
  WHERE (deleted_at IS NULL OR status IN ('DELETED', 'CANCELLED'))
    AND ((order_source IS NULL OR order_source = 'edge-form') OR (status IN ('DELIVERED', 'REMITTED')))
)
SELECT
  (SELECT SUM(delivered) FROM funnel_counts) as sum_of_funnels,
  (SELECT delivered FROM total) as total_orders_delivered,
  (SELECT SUM(delivered) FROM funnel_counts) - (SELECT delivered FROM total) as discrepancy;

-- ─── SECTION 4: DOUBLE-COUNTING DETECTION ───────────────────────────────
-- Orders that exist in multiple tables (graduated orders)

\echo ''
\echo '══════════════════════════════════════════════════════'
\echo 'SECTION 4: DOUBLE-COUNTING DETECTION'
\echo '══════════════════════════════════════════════════════'

\echo ''
\echo '--- 4a. Graduated follow-up orders (in orders table with is_follow_up=true) ---'
SELECT status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NULL
  AND is_follow_up = true
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 4b. Graduated cart orders (in orders table with order_source=online) ---'
SELECT status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NULL
  AND order_source = 'online'
GROUP BY status
ORDER BY cnt DESC;

\echo ''
\echo '--- 4c. Orders with cart_id set (possible cart-graduated without order_source=online) ---'
SELECT order_source, status, COUNT(*) as cnt
FROM orders
WHERE deleted_at IS NULL
  AND cart_id IS NOT NULL
GROUP BY order_source, status
ORDER BY order_source, cnt DESC;

\echo ''
\echo '--- 4d. Follow-up orders in follow_up_orders table that ALSO have a graduated copy in orders ---'
SELECT COUNT(*) as duplicated_followup_graduates
FROM follow_up_orders fo
WHERE fo.deleted_at IS NULL
  AND fo.status IN ('DELIVERED', 'REMITTED')
  AND fo.source_order_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM orders o
    WHERE o.is_follow_up = true
      AND o.status IN ('DELIVERED', 'REMITTED')
      AND o.deleted_at IS NULL
      AND o.follow_up_source_order_id = fo.source_order_id
  );

-- ─── SECTION 5: STOCK INTEGRITY ────────────────────────────────────────
-- Do delivered orders match stock movements?

\echo ''
\echo '══════════════════════════════════════════════════════'
\echo 'SECTION 5: STOCK INTEGRITY'
\echo '══════════════════════════════════════════════════════'

\echo ''
\echo '--- 5a. Total units delivered (from order_items of DELIVERED/REMITTED orders) ---'
SELECT SUM(oi.quantity) as total_units_delivered
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.status IN ('DELIVERED', 'REMITTED')
  AND o.deleted_at IS NULL;

\echo ''
\echo '--- 5b. Total units delivered by product (top 20) ---'
SELECT
  p.name as product,
  SUM(oi.quantity) as units_delivered
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN products p ON p.id = oi.product_id
WHERE o.status IN ('DELIVERED', 'REMITTED')
  AND o.deleted_at IS NULL
GROUP BY p.name
ORDER BY units_delivered DESC
LIMIT 20;

\echo ''
\echo '--- 5c. Current inventory levels by product ---'
SELECT
  p.name as product,
  SUM(il.quantity) as current_stock
FROM inventory_levels il
LEFT JOIN products p ON p.id = il.product_id
GROUP BY p.name
ORDER BY current_stock DESC
LIMIT 20;

\echo ''
\echo '--- 5d. Total units received via shipments ---'
SELECT SUM(sl.quantity) as total_units_received
FROM shipment_lines sl
JOIN shipments s ON s.id = sl.shipment_id
WHERE s.status = 'VERIFIED';

-- ─── SECTION 6: REMITTANCE INTEGRITY ────────────────────────────────────

\echo ''
\echo '══════════════════════════════════════════════════════'
\echo 'SECTION 6: REMITTANCE INTEGRITY'
\echo '══════════════════════════════════════════════════════'

\echo ''
\echo '--- 6a. Orders at DELIVERED vs REMITTED ---'
SELECT status, COUNT(*) as cnt,
  COALESCE(SUM(total_amount::numeric), 0) as total_value
FROM orders
WHERE deleted_at IS NULL
  AND status IN ('DELIVERED', 'REMITTED')
GROUP BY status;

\echo ''
\echo '--- 6b. Delivery remittance totals ---'
SELECT status,
  COUNT(*) as cnt,
  COALESCE(SUM(total_amount::numeric), 0) as total_value
FROM delivery_remittances
GROUP BY status
ORDER BY status;

\echo ''
\echo '--- 6c. Orders marked REMITTED without a remittance record ---'
SELECT COUNT(*) as remitted_without_remittance
FROM orders o
WHERE o.status = 'REMITTED'
  AND o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM delivery_remittance_orders dro
    WHERE dro.order_id = o.id
  );

-- ─── SECTION 7: BRANCH / COMPANY INTEGRITY ─────────────────────────────

\echo ''
\echo '══════════════════════════════════════════════════════'
\echo 'SECTION 7: BRANCH & COMPANY INTEGRITY'
\echo '══════════════════════════════════════════════════════'

\echo ''
\echo '--- 7a. Orders with NULL branch_id ---'
SELECT order_source, status, COUNT(*) as cnt
FROM orders
WHERE branch_id IS NULL
  AND deleted_at IS NULL
GROUP BY order_source, status
ORDER BY cnt DESC;

\echo ''
\echo '--- 7b. Orders with NULL servicing_branch_id ---'
SELECT order_source, status, COUNT(*) as cnt
FROM orders
WHERE servicing_branch_id IS NULL
  AND deleted_at IS NULL
GROUP BY order_source, status
ORDER BY cnt DESC;

\echo ''
\echo '--- 7c. Orders where branch_id references a non-existent branch ---'
SELECT COUNT(*) as orphaned_branch_orders
FROM orders o
WHERE o.branch_id IS NOT NULL
  AND o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = o.branch_id);

\echo ''
\echo '--- 7d. Orders per company (branch_group) ---'
SELECT
  bg.name as company,
  COUNT(o.id) as order_count,
  COUNT(*) FILTER (WHERE o.status IN ('DELIVERED', 'REMITTED')) as delivered_count
FROM orders o
JOIN branches b ON b.id = o.branch_id
LEFT JOIN branch_groups bg ON bg.id = b.group_id
WHERE o.deleted_at IS NULL
GROUP BY bg.name
ORDER BY order_count DESC;

-- ─── SECTION 8: ORPHAN / ANOMALY DETECTION ──────────────────────────────

\echo ''
\echo '══════════════════════════════════════════════════════'
\echo 'SECTION 8: ANOMALY DETECTION'
\echo '══════════════════════════════════════════════════════'

\echo ''
\echo '--- 8a. Orders with no order_items ---'
SELECT COUNT(*) as orders_without_items
FROM orders o
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id);

\echo ''
\echo '--- 8b. Order items referencing non-existent products ---'
SELECT COUNT(*) as orphaned_product_refs
FROM order_items oi
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.id = oi.product_id);

\echo ''
\echo '--- 8c. Orders assigned to non-existent CS closers ---'
SELECT COUNT(*) as orphaned_cs_assignments
FROM orders o
WHERE o.assigned_cs_id IS NOT NULL
  AND o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.assigned_cs_id);

\echo ''
\echo '--- 8d. Orders with media_buyer_id referencing non-existent users ---'
SELECT COUNT(*) as orphaned_mb_refs
FROM orders o
WHERE o.media_buyer_id IS NOT NULL
  AND o.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.media_buyer_id);

\echo ''
\echo '--- 8e. Duplicate phone+product within 24h (cross-funnel candidates) ---'
SELECT COUNT(*) as potential_duplicates
FROM (
  SELECT customer_phone_hash, created_at,
    LAG(created_at) OVER (PARTITION BY customer_phone_hash ORDER BY created_at) as prev_created
  FROM orders
  WHERE deleted_at IS NULL
    AND status NOT IN ('DELETED', 'CANCELLED')
) sub
WHERE prev_created IS NOT NULL
  AND created_at - prev_created < interval '24 hours';

\echo ''
\echo '══════════════════════════════════════════════════════'
\echo 'AUDIT COMPLETE'
\echo '══════════════════════════════════════════════════════'
