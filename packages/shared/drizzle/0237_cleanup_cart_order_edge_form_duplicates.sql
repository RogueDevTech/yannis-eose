-- 0237: Clean up duplicate cart orders that mirror existing edge-form orders.
--
-- Bug: pullFromAbandonedCarts() did not check the orders table before creating
-- a cart_order, so the same customer+product ended up in both pipelines.
-- ~616 duplicate cart orders on prod, 37 graduated into orders table, 24 remitted.
--
-- Cleanup strategy:
--   Step 1: Soft-delete all duplicate cart_orders, flag as CART_EDGE_FORM_DUPE.
--   Step 2a: Graduated copies NOT remitted → soft-delete the graduated copy.
--   Step 2b: Graduated copies that ARE remitted, edge-form is NOT → keep remitted,
--            soft-delete the edge-form original.
--   Step 2c: BOTH remitted → soft-delete the graduated copy (later one).
--   Step 3: Reverse stock (DELIVERY movements) for all soft-deleted orders.
--   Step 4: Audit log — record what was cleaned up.
--
-- All soft-deleted rows get is_duplicate='CART_EDGE_FORM_DUPE' and
-- duplicate_of_id pointing to the surviving order.

-- Sync history tables before cleanup (belt-and-suspenders: ensure
-- temporal triggers don't fail on column mismatch).
DO $sync$
DECLARE
  col RECORD;
BEGIN
  FOR col IN
    SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable
    FROM information_schema.columns c
    WHERE c.table_name = 'cart_orders'
      AND c.column_name NOT IN (
        SELECT column_name FROM information_schema.columns WHERE table_name = 'cart_orders_history'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE cart_orders_history ADD COLUMN IF NOT EXISTS %I %s',
      col.column_name,
      CASE
        WHEN col.udt_name = 'uuid' THEN 'uuid'
        WHEN col.udt_name = 'text' THEN 'text'
        WHEN col.udt_name = 'int4' THEN 'integer'
        WHEN col.udt_name = 'numeric' THEN 'numeric'
        WHEN col.udt_name = 'bool' THEN 'boolean'
        WHEN col.udt_name = 'timestamptz' THEN 'timestamptz'
        WHEN col.udt_name = 'timestamp' THEN 'timestamp'
        WHEN col.udt_name = 'jsonb' THEN 'jsonb'
        ELSE col.udt_name
      END
    );
    RAISE NOTICE 'Synced missing column % to cart_orders_history', col.column_name;
  END LOOP;
END $sync$;

DO $$
DECLARE
  v_actor_id uuid;
  v_step1_count int := 0;
  v_step2a_count int := 0;
  v_step2b_count int := 0;
  v_step2c_count int := 0;
  v_stock_reversals int := 0;
BEGIN
  -- Resolve system actor for stock movements
  SELECT id INTO v_actor_id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'No SUPER_ADMIN user found for actor_id';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 1: Soft-delete duplicate cart_orders
  -- ═══════════════════════════════════════════════════════════════════
  -- Find the edge-form order to link as duplicate_of_id (pick the one
  -- with the highest status weight, then oldest).
  WITH duplicate_carts AS (
    SELECT DISTINCT ON (co.id)
      co.id AS cart_order_id,
      o.id AS edge_form_order_id
    FROM cart_orders co
    JOIN cart_order_items coi ON coi.cart_order_id = co.id
    JOIN order_items oi ON oi.product_id = coi.product_id
    JOIN orders o ON o.id = oi.order_id
      AND o.customer_phone_hash = co.customer_phone_hash
      AND (o.order_source IS NULL OR o.order_source = 'edge-form')
    WHERE co.deleted_at IS NULL
    ORDER BY co.id,
      CASE o.status WHEN 'REMITTED' THEN 3 WHEN 'DELIVERED' THEN 2 ELSE 1 END DESC,
      o.created_at ASC
  )
  UPDATE cart_orders co
  SET deleted_at = NOW(),
      status = 'DELETED',
      is_duplicate = 'CART_EDGE_FORM_DUPE',
      duplicate_of_id = dc.edge_form_order_id
  FROM duplicate_carts dc
  WHERE co.id = dc.cart_order_id
    AND co.deleted_at IS NULL;

  GET DIAGNOSTICS v_step1_count = ROW_COUNT;
  RAISE NOTICE 'Step 1: Soft-deleted % duplicate cart_orders', v_step1_count;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 2a: Graduated copies NOT remitted → soft-delete graduated
  -- ═══════════════════════════════════════════════════════════════════
  WITH graduated_not_remitted AS (
    SELECT DISTINCT ON (grad.id)
      grad.id AS graduated_id,
      orig.id AS original_id
    FROM orders grad
    JOIN order_items gi ON gi.order_id = grad.id
    JOIN order_items oi ON oi.product_id = gi.product_id
    JOIN orders orig ON orig.id = oi.order_id
      AND orig.customer_phone_hash = grad.customer_phone_hash
      AND (orig.order_source IS NULL OR orig.order_source = 'edge-form')
      AND orig.deleted_at IS NULL
      AND orig.id != grad.id
    WHERE grad.order_source = 'online'
      AND grad.is_follow_up = false
      AND grad.deleted_at IS NULL
      AND grad.status NOT IN ('REMITTED', 'DELETED', 'CANCELLED')
    ORDER BY grad.id,
      CASE orig.status WHEN 'REMITTED' THEN 3 WHEN 'DELIVERED' THEN 2 ELSE 1 END DESC,
      orig.created_at ASC
  )
  UPDATE orders o
  SET deleted_at = NOW(),
      status = 'DELETED',
      is_duplicate = 'CART_EDGE_FORM_DUPE',
      duplicate_of_id = gnr.original_id
  FROM graduated_not_remitted gnr
  WHERE o.id = gnr.graduated_id
    AND o.deleted_at IS NULL;

  GET DIAGNOSTICS v_step2a_count = ROW_COUNT;
  RAISE NOTICE 'Step 2a: Soft-deleted % graduated orders (not remitted)', v_step2a_count;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 2b: Graduated IS remitted, edge-form is NOT → keep graduated,
  --          soft-delete the edge-form original
  -- ═══════════════════════════════════════════════════════════════════
  WITH graduated_remitted_orig_not AS (
    SELECT DISTINCT ON (orig.id)
      orig.id AS edge_form_id,
      grad.id AS graduated_id
    FROM orders grad
    JOIN order_items gi ON gi.order_id = grad.id
    JOIN order_items oi ON oi.product_id = gi.product_id
    JOIN orders orig ON orig.id = oi.order_id
      AND orig.customer_phone_hash = grad.customer_phone_hash
      AND (orig.order_source IS NULL OR orig.order_source = 'edge-form')
      AND orig.deleted_at IS NULL
      AND orig.status != 'REMITTED'
    WHERE grad.order_source = 'online'
      AND grad.is_follow_up = false
      AND grad.deleted_at IS NULL
      AND grad.status = 'REMITTED'
    ORDER BY orig.id, grad.created_at ASC
  )
  UPDATE orders o
  SET deleted_at = NOW(),
      status = 'DELETED',
      is_duplicate = 'CART_EDGE_FORM_DUPE',
      duplicate_of_id = gro.graduated_id
  FROM graduated_remitted_orig_not gro
  WHERE o.id = gro.edge_form_id
    AND o.deleted_at IS NULL;

  GET DIAGNOSTICS v_step2b_count = ROW_COUNT;
  RAISE NOTICE 'Step 2b: Soft-deleted % edge-form originals (graduated is remitted)', v_step2b_count;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 2c: BOTH remitted → soft-delete the graduated copy (later one)
  -- ═══════════════════════════════════════════════════════════════════
  WITH both_remitted AS (
    SELECT DISTINCT ON (grad.id)
      grad.id AS graduated_id,
      orig.id AS original_id
    FROM orders grad
    JOIN order_items gi ON gi.order_id = grad.id
    JOIN order_items oi ON oi.product_id = gi.product_id
    JOIN orders orig ON orig.id = oi.order_id
      AND orig.customer_phone_hash = grad.customer_phone_hash
      AND (orig.order_source IS NULL OR orig.order_source = 'edge-form')
      AND orig.deleted_at IS NULL
      AND orig.status = 'REMITTED'
    WHERE grad.order_source = 'online'
      AND grad.is_follow_up = false
      AND grad.deleted_at IS NULL
      AND grad.status = 'REMITTED'
    ORDER BY grad.id, orig.created_at ASC
  )
  UPDATE orders o
  SET deleted_at = NOW(),
      status = 'DELETED',
      is_duplicate = 'CART_EDGE_FORM_DUPE',
      duplicate_of_id = br.original_id
  FROM both_remitted br
  WHERE o.id = br.graduated_id
    AND o.deleted_at IS NULL;

  GET DIAGNOSTICS v_step2c_count = ROW_COUNT;
  RAISE NOTICE 'Step 2c: Soft-deleted % graduated orders (both were remitted)', v_step2c_count;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 3: Reverse stock movements for all soft-deleted orders
  -- ═══════════════════════════════════════════════════════════════════
  -- Create ADJUSTMENT movements to offset DELIVERY movements for every
  -- order we just soft-deleted that had stock deducted.
  INSERT INTO stock_movements (
    id, product_id, movement_type, quantity,
    to_location_id, reference_id, reason, actor_id
  )
  SELECT
    gen_random_uuid(),
    sm.product_id,
    'ADJUSTMENT',
    ABS(sm.quantity),  -- DELIVERY has negative qty, reverse with positive
    sm.from_location_id,
    sm.reference_id,
    'Stock reversal: cart/edge-form duplicate cleanup (migration 0237). Reversing ' || ABS(sm.quantity) || ' units.',
    v_actor_id
  FROM stock_movements sm
  JOIN orders o ON o.id = sm.reference_id
  WHERE sm.movement_type = 'DELIVERY'
    AND o.is_duplicate = 'CART_EDGE_FORM_DUPE'
    AND o.deleted_at IS NOT NULL;

  GET DIAGNOSTICS v_stock_reversals = ROW_COUNT;
  RAISE NOTICE 'Step 3: Created % stock reversal ADJUSTMENT movements', v_stock_reversals;

  -- Restore inventory levels for reversed deliveries
  UPDATE inventory_levels il
  SET stock_count = il.stock_count + rev.total_reversed,
      updated_at = NOW()
  FROM (
    SELECT
      sm.product_id,
      sm.from_location_id AS location_id,
      SUM(ABS(sm.quantity)) AS total_reversed
    FROM stock_movements sm
    JOIN orders o ON o.id = sm.reference_id
    WHERE sm.movement_type = 'DELIVERY'
      AND o.is_duplicate = 'CART_EDGE_FORM_DUPE'
      AND o.deleted_at IS NOT NULL
      AND sm.from_location_id IS NOT NULL
    GROUP BY sm.product_id, sm.from_location_id
  ) rev
  WHERE il.product_id = rev.product_id
    AND il.location_id = rev.location_id;

  -- ═══════════════════════════════════════════════════════════════════
  -- STEP 4: Summary log
  -- ═══════════════════════════════════════════════════════════════════
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE 'Migration 0237 — Cart/Edge-Form Duplicate Cleanup Summary';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE 'Cart orders soft-deleted:                    %', v_step1_count;
  RAISE NOTICE 'Graduated orders deleted (not remitted):     %', v_step2a_count;
  RAISE NOTICE 'Edge-form originals deleted (grad remitted): %', v_step2b_count;
  RAISE NOTICE 'Graduated orders deleted (both remitted):    %', v_step2c_count;
  RAISE NOTICE 'Stock reversal movements created:            %', v_stock_reversals;
  RAISE NOTICE 'All deleted rows flagged: is_duplicate=CART_EDGE_FORM_DUPE';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
