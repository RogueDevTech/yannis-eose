/**
 * Small coloured dot marking HOW an order entered the system, shown beside the
 * customer name on list rows. Hovering reveals the full label.
 *
 * Today it only marks imports. A migrated historical order looks identical to a
 * live one everywhere it appears, which is misleading during (and after) a CRM
 * migration: imported rows skip dedup, CS routing and notifications, and their
 * dates are back-stamped from the source file. Marking them keeps that visible.
 *
 * A dot rather than a text pill, matching the existing Follow Up / Frozen
 * indicators: on a dense list the customer name is the thing that must stay
 * readable, and an "Imported" word-pill on thousands of migrated rows would
 * crowd out the name it sits next to.
 */
export function OrderSourceTag({
  orderSource,
  className,
}: {
  orderSource?: string | null;
  className?: string;
}) {
  if (orderSource !== 'import') return null;
  return (
    <span
      title="Imported from a previous CRM"
      aria-label="Imported from a previous CRM"
      className={`ml-1.5 inline-flex shrink-0 h-2 w-2 rounded-full bg-brand-500 align-middle ${className ?? ''}`}
    />
  );
}
