-- Migration 0354: database backstop for impossible order values (2026-10-14).
--
-- Bulk import skips the orders.create Zod validators and has written orders
-- dated 1969 (an empty cell parsed as epoch), totals of -50,000 and line
-- quantities of -2. The app now rejects these, but nothing in the database
-- did. This guard does.
--
-- Why a trigger and not CHECK constraints:
--   * A CHECK (even NOT VALID) applies to every UPDATE of a row, so a legacy
--     bad row (e.g. a CS_ENGAGED order dated 1969) could never be confirmed
--     again. CS would be stuck on a real order.
--   * A VALIDATEd CHECK scans the table at boot and crashes startup if any
--     legacy row violates it.
--   This trigger only checks a value that is being inserted or changed, so
--   legacy rows keep working until they are cleaned up.
--
-- Intake safety (Order Capture rule): every bound below is already enforced by
-- the orders.create validators (quantity >= 1, price/total >= 0) or set by the
-- server (created_at default now(), status timestamps = now()), so the guard
-- adds no new rejection on the customer submit path.
--
-- Bounds match parsePlausibleOrderDate / normalizeImportDate: [2000, 2100).
-- No column changes, so the *_history tables need no sync.

-- True when a timestamp is being set (insert, or changed on update) to a value
-- outside [2000, 2100).
CREATE OR REPLACE FUNCTION yannis_ts_out_of_range(new_ts timestamptz, old_ts timestamptz, is_insert boolean)
RETURNS boolean AS $$
  SELECT new_ts IS NOT NULL
    AND (is_insert OR new_ts IS DISTINCT FROM old_ts)
    AND (new_ts < '2000-01-01'::timestamptz OR new_ts >= '2100-01-01'::timestamptz);
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION yannis_orders_sanity_guard() RETURNS trigger AS $$
DECLARE
  ins boolean := TG_OP = 'INSERT';
  bad text;
BEGIN
  bad := CASE
    WHEN yannis_ts_out_of_range(NEW.created_at,    CASE WHEN ins THEN NULL ELSE OLD.created_at END,    ins) THEN 'created_at = ' || NEW.created_at
    WHEN yannis_ts_out_of_range(NEW.confirmed_at,  CASE WHEN ins THEN NULL ELSE OLD.confirmed_at END,  ins) THEN 'confirmed_at = ' || NEW.confirmed_at
    WHEN yannis_ts_out_of_range(NEW.allocated_at,  CASE WHEN ins THEN NULL ELSE OLD.allocated_at END,  ins) THEN 'allocated_at = ' || NEW.allocated_at
    WHEN yannis_ts_out_of_range(NEW.dispatched_at, CASE WHEN ins THEN NULL ELSE OLD.dispatched_at END, ins) THEN 'dispatched_at = ' || NEW.dispatched_at
    WHEN yannis_ts_out_of_range(NEW.delivered_at,  CASE WHEN ins THEN NULL ELSE OLD.delivered_at END,  ins) THEN 'delivered_at = ' || NEW.delivered_at
    WHEN yannis_ts_out_of_range(NEW.deleted_at,    CASE WHEN ins THEN NULL ELSE OLD.deleted_at END,    ins) THEN 'deleted_at = ' || NEW.deleted_at
  END;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'orders.% is out of range (2000 to 2100)', bad USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.total_amount < 0
     AND (ins OR NEW.total_amount IS DISTINCT FROM OLD.total_amount) THEN
    RAISE EXCEPTION 'orders.total_amount cannot be negative: %', NEW.total_amount USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION yannis_order_items_sanity_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.quantity < 1
     AND (TG_OP = 'INSERT' OR NEW.quantity IS DISTINCT FROM OLD.quantity) THEN
    RAISE EXCEPTION 'order_items.quantity must be at least 1: %', NEW.quantity USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.unit_price < 0
     AND (TG_OP = 'INSERT' OR NEW.unit_price IS DISTINCT FROM OLD.unit_price) THEN
    RAISE EXCEPTION 'order_items.unit_price cannot be negative: %', NEW.unit_price USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_sanity_guard ON orders;
CREATE TRIGGER orders_sanity_guard
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION yannis_orders_sanity_guard();

DROP TRIGGER IF EXISTS order_items_sanity_guard ON order_items;
CREATE TRIGGER order_items_sanity_guard
  BEFORE INSERT OR UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION yannis_order_items_sanity_guard();
