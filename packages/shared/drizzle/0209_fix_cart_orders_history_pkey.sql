-- 0209: Drop inherited PK from cart_orders_history / cart_order_items_history.
--
-- Migration 0207 used `LIKE ... INCLUDING ALL` which copies the PRIMARY KEY.
-- The capture-history trigger inserts OLD.* (same id) on every update,
-- so the second update to any cart_order row hits a duplicate-key error.
-- Fix: drop the inherited PK so multiple history snapshots can share the
-- same source id — matches the pattern used by every other history table.

ALTER TABLE cart_orders_history DROP CONSTRAINT IF EXISTS cart_orders_history_pkey;
ALTER TABLE cart_order_items_history DROP CONSTRAINT IF EXISTS cart_order_items_history_pkey;

-- Also drop the inherited UNIQUE on order_number (history rows share it).
ALTER TABLE cart_orders_history DROP CONSTRAINT IF EXISTS cart_orders_history_order_number_key;
ALTER TABLE cart_orders_history DROP CONSTRAINT IF EXISTS cart_orders_order_number_key;
