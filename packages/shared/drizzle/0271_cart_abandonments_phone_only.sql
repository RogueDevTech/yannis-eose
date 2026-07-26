-- Phone-only cart capture: product is progressive, not required at first save.
-- Edge form saves a cart as soon as a valid NG phone is entered; product/offer
-- (and other fields) merge in on later debounced saves. Auto-pull into
-- cart_orders still requires product_id (enforced in CartOrdersService).

ALTER TABLE cart_abandonments
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE cart_abandonments_history
  ALTER COLUMN product_id DROP NOT NULL;
