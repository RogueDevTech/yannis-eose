-- Reprice cart order lines that were booked at 0.00 by the broken price lookup.
--
-- CAUSE: `pullFromAbandonedCarts` (Step B) and `backfillMissingCartOrderItems`
-- resolved a line price from `products.offers` (jsonb) then
-- `COALESCE(p.base_sale_price, 0)`. Current pricing lives in
-- `offer_group_items` — the catalog itself reads that first (see
-- `products.service.ts::loadActiveOfferTemplatesByProductIds`). A product priced
-- that way has an empty `offers` jsonb and a 0.00 base, so every recovered cart
-- for it booked at 0.00 and would have flowed through CS -> delivery ->
-- remittance as a free order. The code fix is in the same PR series; this
-- migration repairs the rows already written.
--
-- WHAT IT REPAIRS — ONLY lines where the customer's tier is RECORDED:
-- the cart's `offer_label` is matched against `offer_group_items.label`. That is
-- the customer's actual selection, not an inference.
--
-- WHAT IT DELIBERATELY LEAVES ALONE: carts with `offer_label IS NULL`. Those
-- customers dropped off BEFORE choosing a tier, so no correct price exists to
-- recover. Three sources were checked and all came up empty: the cart's
-- `custom_field_values` blob is `{}`, no matching priced order exists for the
-- customer's phone hash, and `cart_abandonments` lost its history triggers in
-- migration 0119 so there is no temporal trail. Those lines stay at 0.00 for CS
-- to establish with the customer during recovery.
--
-- NOTE ON QUANTITY: `cart_abandonments.quantity` is NULL on every affected row;
-- the `quantity = 1` on the line was invented by `COALESCE(ca.quantity, 1)` at
-- pull time. It therefore carries NO information about the tier and is NOT used
-- here. Pricing by quantity would have billed a recorded "2 Bottles" cart at the
-- 1-bottle price.
--
-- SAFETY: scoped to lines that are currently 0/NULL, whose cart row still
-- exists, whose label resolves to exactly ONE active tier, and whose order has
-- not been delivered or remitted. Settled financials are never rewritten.
--
-- HISTORY TWIN (trigger-trap rule): `cart_orders` and `cart_order_items` both
-- have positional temporal triggers (mig 0207). This migration only UPDATEs
-- existing rows and adds NO columns, so both twins stay positionally aligned.
-- The UPDATEs fire the triggers and write history rows, which is correct — this
-- is an audited correction like any other mutation.
--
-- ACTOR: `yannis_stamp_actor()` reads `yannis.current_user_id`, unset during a
-- migration, which since 0066 safely stamps modified_by = NULL. NULL is right
-- here: the correction was made by a deploy, not a person. Matches 0341.

-- 1. Reprice the line items from the customer's recorded tier.
UPDATE cart_order_items coi
SET unit_price = src.price
FROM (
  SELECT coi2.id AS item_id,
         (SELECT ogi.price
            FROM offer_group_items ogi
            JOIN offer_groups og ON og.id = ogi.offer_group_id
           WHERE ogi.product_id = coi2.product_id
             AND ogi.status = 'ACTIVE'
             AND og.status = 'ACTIVE'
             AND ogi.label = ca.offer_label
           LIMIT 1) AS price
    FROM cart_order_items coi2
    JOIN cart_orders co        ON co.id = coi2.cart_order_id
    JOIN cart_abandonments ca  ON ca.id = co.source_cart_id
   WHERE (coi2.unit_price IS NULL OR coi2.unit_price = 0)
     AND ca.offer_label IS NOT NULL
     AND co.status NOT IN ('DELIVERED', 'REMITTED', 'DELETED', 'CANCELLED')
     -- Exactly one active tier must match the label, or we do not touch it.
     AND (SELECT count(*)
            FROM offer_group_items ogi
            JOIN offer_groups og ON og.id = ogi.offer_group_id
           WHERE ogi.product_id = coi2.product_id
             AND ogi.status = 'ACTIVE'
             AND og.status = 'ACTIVE'
             AND ogi.label = ca.offer_label) = 1
) src
WHERE coi.id = src.item_id
  AND src.price IS NOT NULL
  AND src.price > 0;

-- 2. Recompute the parent order totals from the repaired lines.
--    unitPrice IS the offer/line total — sum directly, never multiply by
--    quantity (a "2 Bottles" tier is one 180,000 line, not 2 x 180,000).
UPDATE cart_orders co
SET total_amount = sub.line_total,
    updated_at = now()
FROM (
  SELECT coi.cart_order_id, SUM(coi.unit_price) AS line_total
    FROM cart_order_items coi
   GROUP BY coi.cart_order_id
) sub
WHERE co.id = sub.cart_order_id
  AND (co.total_amount IS NULL OR co.total_amount = 0)
  AND sub.line_total > 0
  AND co.status NOT IN ('DELIVERED', 'REMITTED', 'DELETED', 'CANCELLED');

DO $$
DECLARE
  remaining INT;
BEGIN
  SELECT count(*) INTO remaining
    FROM cart_orders co
    JOIN cart_order_items coi ON coi.cart_order_id = co.id
   WHERE (coi.unit_price IS NULL OR coi.unit_price = 0)
     AND co.status NOT IN ('DELIVERED', 'REMITTED', 'DELETED', 'CANCELLED');
  RAISE NOTICE '0345: % cart order line(s) still unpriced — customer never selected a tier; CS must set these during recovery.', remaining;
END $$;
