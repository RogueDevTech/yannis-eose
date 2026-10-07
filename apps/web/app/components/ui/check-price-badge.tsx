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
