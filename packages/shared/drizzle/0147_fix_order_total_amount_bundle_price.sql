-- Migration 0147: Fix order totalAmount for bundled offers
--
-- Previously the edge worker calculated totalAmount = qty × offerPrice,
-- but offerPrice is already the bundle total (not per-unit). This doubled/
-- tripled the stored totalAmount for every offer-based order.
--
-- Fix: recalculate totalAmount = SUM(unit_price) from order_items for all
-- orders where the current totalAmount doesn't match. unit_price in
-- order_items stores the offer/bundle price (the line total), so summing
-- without multiplying by quantity gives the correct amount.

-- Step 1: Fix orders.total_amount
UPDATE orders
SET total_amount = correct.sum_price,
    updated_at = NOW()
FROM (
  SELECT oi.order_id,
         SUM(oi.unit_price) AS sum_price
  FROM order_items oi
  GROUP BY oi.order_id
) correct
WHERE orders.id = correct.order_id
  AND orders.total_amount IS NOT NULL
  AND correct.sum_price IS NOT NULL
  AND orders.total_amount != correct.sum_price;

-- Step 2: Fix invoices.total_amount to match the corrected order totals.
-- Invoices were also generated with qty × unitPrice. Recalculate from the
-- JSONB line_items array: SUM(unitPrice) per line (unitPrice is the bundle total).
UPDATE invoices
SET total_amount = recalc.correct_total
FROM (
  SELECT inv.id,
         COALESCE(SUM((li->>'unitPrice')::numeric), 0) AS correct_total
  FROM invoices inv,
       jsonb_array_elements(inv.line_items) AS li
  GROUP BY inv.id
) recalc
WHERE invoices.id = recalc.id
  AND invoices.total_amount != recalc.correct_total;
