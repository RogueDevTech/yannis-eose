-- 0224: Advance order_number_seq past the max existing order_number across
-- all three tables that share the sequence (orders, follow_up_orders, cart_orders).
-- Prevents duplicate key violations when the sequence falls behind after
-- backfills or restores.

DO $$
DECLARE
  max_num bigint;
  cur_val bigint;
BEGIN
  SELECT GREATEST(
    COALESCE((SELECT MAX(order_number) FROM orders), 0),
    COALESCE((SELECT MAX(order_number) FROM follow_up_orders), 0),
    COALESCE((SELECT MAX(order_number) FROM cart_orders), 0)
  ) INTO max_num;

  cur_val := currval(pg_get_serial_sequence('orders', 'order_number'));

  -- Only advance if sequence is behind
  IF cur_val <= max_num THEN
    PERFORM setval('order_number_seq', max_num + 1, false);
    RAISE NOTICE 'Advanced order_number_seq from % to % (next call returns %)', cur_val, max_num + 1, max_num + 1;
  END IF;

EXCEPTION WHEN object_not_in_prerequisite_state THEN
  -- currval() fails if nextval() hasn't been called in this session;
  -- fall back to unconditional setval.
  SELECT GREATEST(
    COALESCE((SELECT MAX(order_number) FROM orders), 0),
    COALESCE((SELECT MAX(order_number) FROM follow_up_orders), 0),
    COALESCE((SELECT MAX(order_number) FROM cart_orders), 0)
  ) INTO max_num;
  PERFORM setval('order_number_seq', max_num + 1, false);
  RAISE NOTICE 'Advanced order_number_seq to % (next call returns %)', max_num + 1, max_num + 1;
END $$;
