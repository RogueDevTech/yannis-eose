import { sql, type SQL } from 'drizzle-orm';

/**
 * "Is this cart order really a real order?" — one definition shared by the
 * reconcile cron, the abandonment pull guard and the Cart Orders export.
 *
 * Prod diagnostic (Oct 2026): ~8.5% of live cart orders had a real order
 * behind them that the old phone_hash + exact-product match never saw:
 *  - customer switched product before submitting (same session, other product)
 *  - same phone typed differently ("803…" vs "0803…") → different phone hash
 *  - the order carries this cart's id (orders.cart_id) / the cart was CONVERTED
 *
 * Match types, strongest first:
 *  CART_LINK       a live order carries orders.cart_id = this cart
 *  CART_CONVERTED  the source cart was converted into a live order
 *  SAME_PRODUCT    same phone + same product (the original 14-day rule)
 *  SAME_SESSION    same phone, any product, within the cart's session window
 * "Same phone" = same phone_hash OR same last 9 digits of the raw number, so a
 * hash drift between cart and order no longer hides the match. Phones never
 * leave the query.
 */
export type CartRealOrderMatchType = 'CART_LINK' | 'CART_CONVERTED' | 'SAME_PRODUCT' | 'SAME_SESSION';

export type CartRealOrderMatch = {
  cart_order_id: string;
  order_id: string;
  order_number: number;
  order_status: string;
  order_source: string | null;
  order_branch_id: string | null;
  match_type: CartRealOrderMatchType;
  /** Hours from the cart order's creation to the real order's (negative = real order first). */
  hours_from_cart_order: number;
};

/** Session window around the cart for the any-product phone match. */
export const CART_SESSION_WINDOW_SQL = `INTERVAL '2 hours'`;
/** Window for cart_id / CONVERTED links — the edge worker reuses a cart id from storage for weeks. */
export const CART_LINK_WINDOW_SQL = `INTERVAL '72 hours'`;
/** Last-N digits used for the raw-phone match (works for local and international forms). */
export const PHONE_TAIL_DIGITS = 9;

/**
 * Best real-order match per live cart order in `scope` (a condition on alias
 * `co` = cart_orders). Returns `CartRealOrderMatch` rows. Excludes the cart
 * order's own graduated copy.
 */
export function cartRealOrderMatchesQuery(scope: SQL): SQL {
  const head = `
    WITH co AS MATERIALIZED (
      SELECT co.id, co.created_at, co.customer_phone_hash, co.graduated_order_id, co.source_cart_id,
             coalesce(ca.created_at, co.created_at) AS cart_started_at,
             ca.converted_order_id,
             right(regexp_replace(coalesce(co.customer_phone, ''), '\\D', '', 'g'), ${PHONE_TAIL_DIGITS}) AS p_tail
      FROM cart_orders co
      LEFT JOIN cart_abandonments ca ON ca.id = co.source_cart_id
      WHERE co.deleted_at IS NULL
        AND co.status NOT IN ('DELETED', 'CANCELLED')
        AND (`;
  const tail = `)
    ),
    ord AS MATERIALIZED (
      SELECT o.id, o.order_number, o.status::text AS status, o.order_source, o.branch_id, o.created_at,
             o.cart_id, o.customer_phone_hash, o.source_cart_order_id,
             right(regexp_replace(coalesce(o.customer_phone, ''), '\\D', '', 'g'), ${PHONE_TAIL_DIGITS}) AS p_tail
      FROM orders o
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN ('DELETED', 'CANCELLED')
        AND o.created_at >= (SELECT min(least(cart_started_at, created_at)) FROM co) - INTERVAL '14 days'
    ),
    phone AS (
      SELECT co.id AS co_id, o.id AS o_id FROM co JOIN ord o ON o.customer_phone_hash = co.customer_phone_hash
      UNION
      SELECT co.id, o.id FROM co JOIN ord o
        ON length(co.p_tail) = ${PHONE_TAIL_DIGITS} AND o.p_tail = co.p_tail
    ),
    cand AS (
      SELECT co.id AS co_id, o.id AS o_id, 1 AS rank, 'CART_LINK' AS match_type
      FROM co JOIN ord o ON o.cart_id = co.source_cart_id
      WHERE o.created_at BETWEEN co.cart_started_at - ${CART_SESSION_WINDOW_SQL} AND co.created_at + ${CART_LINK_WINDOW_SQL}
      UNION ALL
      SELECT co.id, o.id, 2, 'CART_CONVERTED'
      FROM co JOIN ord o ON o.id = co.converted_order_id
      WHERE o.created_at BETWEEN co.cart_started_at - ${CART_SESSION_WINDOW_SQL} AND co.created_at + ${CART_LINK_WINDOW_SQL}
      UNION ALL
      SELECT co.id, o.id, 3, 'SAME_PRODUCT'
      FROM phone p JOIN co ON co.id = p.co_id JOIN ord o ON o.id = p.o_id
      WHERE o.created_at >= co.created_at - INTERVAL '14 days'
        AND EXISTS (SELECT 1 FROM order_items oi JOIN cart_order_items coi
                      ON coi.cart_order_id = co.id AND coi.product_id = oi.product_id
                    WHERE oi.order_id = o.id)
      UNION ALL
      SELECT co.id, o.id, 4, 'SAME_SESSION'
      FROM phone p JOIN co ON co.id = p.co_id JOIN ord o ON o.id = p.o_id
      WHERE o.created_at BETWEEN co.cart_started_at - ${CART_SESSION_WINDOW_SQL} AND co.created_at + ${CART_SESSION_WINDOW_SQL}
    )
    SELECT DISTINCT ON (c.co_id)
           c.co_id AS cart_order_id, o.id AS order_id, o.order_number, o.status AS order_status,
           o.order_source, o.branch_id AS order_branch_id, c.match_type,
           round((extract(epoch FROM (o.created_at - co.created_at)) / 3600)::numeric, 1)::float AS hours_from_cart_order
    FROM cand c
    JOIN co ON co.id = c.co_id
    JOIN ord o ON o.id = c.o_id
    WHERE o.id IS DISTINCT FROM co.graduated_order_id
      AND o.source_cart_order_id IS DISTINCT FROM co.id
    ORDER BY c.co_id, c.rank, abs(extract(epoch FROM (o.created_at - co.created_at)))
  `;
  return sql`${sql.raw(head)}${scope}${sql.raw(tail)}`;
}
