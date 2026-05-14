/**
 * Unified `/admin/orders/:id` is opened from several list pages. The breadcrumb "Orders"
 * link uses `?from=` so SuperAdmin / HoCS / etc. return to the list they came from,
 * instead of inferring only from role (which defaulted CS for admins).
 */
export type OrderDetailListFrom = 'logistics' | 'cs' | 'marketing';

const FROM_TO_PATH: Record<OrderDetailListFrom, string> = {
  logistics: '/admin/logistics/orders',
  cs: '/admin/cs/orders',
  marketing: '/admin/marketing/orders',
};

export function ordersListPathForDetailFrom(from: string | null): string | null {
  if (from === 'logistics' || from === 'cs' || from === 'marketing') {
    return FROM_TO_PATH[from];
  }
  return null;
}

/** Order detail URL; when `from` is set, appends `?from=` for breadcrumb return navigation. */
export function orderDetailHref(
  basePath: string,
  orderId: string,
  from?: OrderDetailListFrom | null,
): string {
  const base = basePath.replace(/\/$/, '');
  const path = `${base}/${orderId}`;
  if (!from) return path;
  return `${path}?from=${encodeURIComponent(from)}`;
}
