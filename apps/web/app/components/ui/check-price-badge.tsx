/**
 * "Check price" pill: the order-form submit did not match an active offer
 * (orders.offer_check). The order cannot be confirmed until CS clears it.
 * Renders nothing when the flag is not set.
 */
export function CheckPriceBadge({ offerCheck }: { offerCheck?: string | null }) {
  if (!offerCheck) return null;
  return (
    <span
      className="inline-flex items-center rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:bg-warning-900/30 dark:text-warning-300"
      title="Price did not match an active offer. Check it before confirming."
    >
      Check price
    </span>
  );
}

/**
 * "Already a cart order" pill: the customer already has a cart order CS is
 * working or has delivered for the same product (orders.cart_order_check). The
 * order cannot be confirmed until CS checks with the customer and clears it.
 * Renders nothing when the flag is not set.
 */
export function AlreadyCartOrderBadge({ cartOrderCheck }: { cartOrderCheck?: string | null }) {
  if (!cartOrderCheck) return null;
  return (
    <span
      className="inline-flex items-center rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:bg-warning-900/30 dark:text-warning-300"
      title="This customer already has a cart order for this product. Check with them before confirming."
    >
      Already a cart order
    </span>
  );
}
