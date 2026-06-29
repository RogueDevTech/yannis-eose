-- 0226: Change cart_orders stamp_actor trigger to UPDATE-only.
--
-- The stamp_actor trigger fires on INSERT OR UPDATE and sets
-- NEW.valid_from / NEW.modified_by. When postgres.js sends the
-- INSERT via extended query protocol, the trigger fails with
-- "column valid_from does not exist" because the protocol's column
-- metadata conflicts with the trigger's column reference.
--
-- The trigger is only needed on UPDATE (to track who changed the row).
-- On INSERT, valid_from defaults to NOW() and modified_by is NULL,
-- which is correct for system-created rows (cron pulls).
--
-- Same fix applied to cart_order_items.

DROP TRIGGER IF EXISTS trg_cart_orders_stamp_actor ON cart_orders;
CREATE TRIGGER trg_cart_orders_stamp_actor
  BEFORE UPDATE ON cart_orders
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

DROP TRIGGER IF EXISTS trg_cart_order_items_stamp_actor ON cart_order_items;
CREATE TRIGGER trg_cart_order_items_stamp_actor
  BEFORE UPDATE ON cart_order_items
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();
