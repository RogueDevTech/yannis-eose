/**
 * Unsubmitted properly filled forms become orders (owner decision 2026-10-07).
 *
 * A cart whose customer filled every required field AND chose an offer, but
 * never pressed submit, is created as a normal order (orders.capture_source =
 * 'UNSUBMITTED_FORM') instead of a cart order. One definition, used by the
 * converter (OrdersService) and by the cart pull, which holds these carts back
 * so they are not pulled into Cart Orders first.
 */

export const UNSUBMITTED_FORM_CAPTURE_SOURCE = 'UNSUBMITTED_FORM' as const;

/**
 * Minutes after the cart was marked ABANDONED before converting. markAbandoned
 * fires ~5 min after the last keystroke and stamps updated_at, so 25 here is
 * ~30 min after the customer went quiet.
 */
export const CONVERT_AFTER_ABANDONED_MINUTES = 25;

/**
 * The pull leaves full-form carts alone this long after ABANDONED. Anything the
 * converter could not turn into an order (offer no longer exists, required
 * custom field missing, error) falls back to Cart Orders after this.
 */
export const PULL_HOLD_MINUTES = 60;

/**
 * Converter window end (minutes after ABANDONED). Kept below PULL_HOLD_MINUTES
 * so the converter and the cart pull never work on the same cart at the same
 * time. Also makes it going forward only (no backlog).
 */
export const CONVERT_WINDOW_END_MINUTES = 55;

/** Same-order window for a later submit from the same customer (see orders.create). */
export const LATER_SUBMIT_WINDOW_HOURS = 24;

/**
 * SQL predicate on a cart_abandonments row aliased `ca`: properly filled.
 * Phone validity is guaranteed upstream (the form only saves a cart for a valid
 * phone). Required custom fields are checked when the order is created.
 */
export const FULL_FORM_CART_SQL = `(
  ca.status = 'ABANDONED'
  AND ca.campaign_id IS NOT NULL
  AND ca.product_id IS NOT NULL
  AND ca.customer_phone_hash IS NOT NULL
  AND length(btrim(coalesce(ca.customer_name, ''))) >= 2
  AND btrim(coalesce(ca.offer_label, '')) <> ''
  AND btrim(coalesce(ca.delivery_address, ca.customer_address, '')) <> ''
  AND btrim(coalesce(ca.delivery_state, '')) <> ''
  -- Not converted: Pay online (the customer may still be paying; Paystack
  -- completion creates its own order) and non-naira carts (per-currency prices).
  AND coalesce(ca.payment_method::text, 'PAY_ON_DELIVERY') <> 'PAY_ONLINE'
  AND upper(coalesce(ca.currency_code, 'NGN')) = 'NGN'
)`;
