-- Drop the FK constraint on invoices.order_id so it can reference follow-up
-- orders and cart orders (which live in separate tables). The column remains
-- a UUID — the application layer handles lookup across all three order tables.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_order_id_orders_id_fk;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_order_id_fkey;
