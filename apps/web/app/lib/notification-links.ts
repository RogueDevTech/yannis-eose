/**
 * Shared logic for resolving a notification to a dashboard link.
 * Used by the header drawer and the notifications list page.
 */
export interface NotificationForLink {
  type: string;
  data?: Record<string, unknown> | null;
}

export function getNotificationLink(notif: NotificationForLink): string | null {
  const action = getNotificationAction(notif);
  return action?.link ?? null;
}

/**
 * Returns the action for a notification when it requires one: link + human-readable label.
 * Use this in the detail modal to show a single primary action button only when relevant.
 */
export function getNotificationAction(notif: NotificationForLink): { link: string; label: string } | null {
  const data = notif.data as Record<string, string> | null | undefined;
  if (data) {
    if (data.orderId) return { link: `/admin/orders/${data.orderId}`, label: 'View order' };
    if (data.transferId) return { link: '/admin/inventory', label: 'View transfer' };
    if (data.productId) return { link: `/admin/products/${data.productId}`, label: 'View product' };
    if (data.fundingId) return { link: '/admin/marketing/funding', label: 'View funding' };
    if (data.payoutId) return { link: '/hr/payroll', label: 'View payroll' };
    if (data.requestId) {
      if (notif.type === 'finance:approval_required') return { link: '/admin/finance/overview', label: 'Review approval' };
      if (notif.type.includes('approval')) return { link: '/admin/permission-requests', label: 'Review permission request' };
      if (notif.type === 'funding:approved') return { link: '/admin/marketing/funding', label: 'View receipt' };
      if (notif.type === 'funding:rejected') return { link: '/admin/marketing/funding', label: 'View funding' };
    }
    if (data.approvalId) return { link: '/admin/finance/overview', label: 'View finance' };
    if (data.deliveryRemittanceId) {
      if (notif.type === 'delivery_remittance:sent') return { link: '/admin/finance/delivery-remittances', label: 'View delivery remittance' };
      if (notif.type === 'delivery_remittance:received') return { link: '/tpl/remit', label: 'View remittances' };
    }
    if (data.locationId) return { link: '/admin/logistics', label: 'View logistics' };
    if (data.link && typeof data.link === 'string') return { link: data.link, label: 'View in dashboard' };
  }
  const type = notif.type;
  if (type?.startsWith('order:')) return { link: '/admin/orders', label: 'View orders' };
  if (type?.startsWith('funding:') || type === 'marketing:high_cpa') return { link: '/admin/marketing/funding', label: 'View funding' };
  if (type?.startsWith('transfer:') || type?.startsWith('logistics:') || type?.startsWith('stock:')) return { link: '/admin/inventory', label: 'View inventory' };
  if (type?.startsWith('finance:')) return { link: '/admin/finance/overview', label: 'View finance' };
  if (type?.startsWith('payout:')) return { link: '/hr/payroll', label: 'View payroll' };
  if (type?.startsWith('approval:')) return { link: '/admin/permission-requests', label: 'Review requests' };
  if (type?.startsWith('reconciliation:')) return { link: '/admin/inventory', label: 'View inventory' };
  if (type?.startsWith('escalation:')) return { link: '/admin/orders', label: 'View orders' };
  return null;
}

export function formatNotificationTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function formatNotificationDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
