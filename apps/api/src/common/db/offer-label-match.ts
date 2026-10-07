/**
 * Offer-label filter for line-item tables (order_items, cart_order_items,
 * follow_up_order_items). Labels are free text stamped from the form's offer,
 * so stored values drift in case and padding ("Buy 2 " vs "buy 2"). Match on
 * the trimmed, lower-cased value so an export filter catches every variant.
 */
import { sql, type Column, type SQL } from 'drizzle-orm';

export function offerLabelMatches(column: Column, label: string): SQL {
  return sql`lower(trim(${column})) = lower(trim(${label}))`;
}
