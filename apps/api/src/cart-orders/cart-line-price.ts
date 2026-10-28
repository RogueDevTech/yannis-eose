/**
 * Price of one cart order line, in the CART'S OWN currency. One definition,
 * used by the cart pull (Step B) and by backfillMissingCartOrderItems, both for
 * the price and for the "has a price" guard.
 *
 * Expects the aliases `ca` (cart_abandonments) and `p` (products).
 *
 * Offer prices live in two places: the base (NGN) price on offer_group_items /
 * offer_templates, and every other currency in offer_group_item_prices /
 * offer_template_prices. Reading only the base price booked East Africa carts at
 * the naira number in local currency (Brahmi Shakti Zambia: 60,000 ZMW instead
 * of ZK1,200; found 2026-10-28).
 *
 * NGN carts keep the previous chain exactly. Non-NGN carts read only that
 * currency's prices and never fall back to a naira price: NULL means the cart is
 * skipped and retried once the offer is priced in its currency.
 */

const NGN_PRICE_SQL = `COALESCE(
  -- 1. offer_group_items, exact label match
  (SELECT ogi.price FROM offer_group_items ogi
    JOIN offer_groups og ON og.id = ogi.offer_group_id
    WHERE ogi.product_id = ca.product_id
      AND ogi.status = 'ACTIVE' AND og.status = 'ACTIVE'
      AND ogi.label = ca.offer_label
    LIMIT 1),
  -- 2. offer_templates, exact label match (legacy name column)
  (SELECT ot.price FROM offer_templates ot
    WHERE ot.product_id = ca.product_id
      AND ot.status = 'ACTIVE' AND ot.name = ca.offer_label
    LIMIT 1),
  -- 3. products.offers jsonb, exact label match
  (SELECT (o->>'price')::numeric
    FROM jsonb_array_elements(COALESCE(p.offers, '[]'::jsonb)) AS o
    WHERE o->>'label' = ca.offer_label
    LIMIT 1),
  -- 4. No label match: cheapest ACTIVE tier, same precedence order.
  (SELECT min(ogi.price) FROM offer_group_items ogi
    JOIN offer_groups og ON og.id = ogi.offer_group_id
    WHERE ogi.product_id = ca.product_id
      AND ogi.status = 'ACTIVE' AND og.status = 'ACTIVE'),
  (SELECT min(ot.price) FROM offer_templates ot
    WHERE ot.product_id = ca.product_id AND ot.status = 'ACTIVE'),
  -- 5. Base sale price, only when it is a real price (0.00 is "unset").
  NULLIF(p.base_sale_price, 0)
)`;

const LOCAL_PRICE_SQL = `COALESCE(
  (SELECT gp.price FROM offer_group_items ogi
    JOIN offer_groups og ON og.id = ogi.offer_group_id
    JOIN offer_group_item_prices gp ON gp.offer_group_item_id = ogi.id
      AND gp.currency_code = upper(ca.currency_code) AND gp.price > 0
    WHERE ogi.product_id = ca.product_id
      AND ogi.status = 'ACTIVE' AND og.status = 'ACTIVE'
      AND ogi.label = ca.offer_label
    LIMIT 1),
  (SELECT tp.price FROM offer_templates ot
    JOIN offer_template_prices tp ON tp.offer_template_id = ot.id
      AND tp.currency_code = upper(ca.currency_code) AND tp.price > 0
    WHERE ot.product_id = ca.product_id
      AND ot.status = 'ACTIVE' AND ot.name = ca.offer_label
    LIMIT 1),
  (SELECT min(gp.price) FROM offer_group_items ogi
    JOIN offer_groups og ON og.id = ogi.offer_group_id
    JOIN offer_group_item_prices gp ON gp.offer_group_item_id = ogi.id
      AND gp.currency_code = upper(ca.currency_code) AND gp.price > 0
    WHERE ogi.product_id = ca.product_id
      AND ogi.status = 'ACTIVE' AND og.status = 'ACTIVE'),
  (SELECT min(tp.price) FROM offer_templates ot
    JOIN offer_template_prices tp ON tp.offer_template_id = ot.id
      AND tp.currency_code = upper(ca.currency_code) AND tp.price > 0
    WHERE ot.product_id = ca.product_id AND ot.status = 'ACTIVE')
)`;

export const CART_LINE_PRICE_SQL = `(CASE WHEN upper(COALESCE(ca.currency_code, 'NGN')) = 'NGN'
  THEN ${NGN_PRICE_SQL}
  ELSE ${LOCAL_PRICE_SQL}
END)`;
