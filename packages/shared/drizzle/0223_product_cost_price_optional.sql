-- Make products.cost_price optional.
--
-- Cost price is a reference value only — real COGS is the FIFO landed cost
-- captured per batch on shipment lines (factory_cost + landing). The product
-- create/edit form no longer collects cost price, so the column must allow NULL.
--
-- products_history was created with `LIKE products INCLUDING ALL`, so it
-- inherited the NOT NULL constraint and the capture trigger would fail on a
-- NULL cost_price. Sync the history table in the same migration.

ALTER TABLE products ALTER COLUMN cost_price DROP NOT NULL;
ALTER TABLE products_history ALTER COLUMN cost_price DROP NOT NULL;
