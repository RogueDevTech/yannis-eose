/**
 * Human-readable activity descriptions for audit entries.
 * Used on user detail pages where the actor is the profile user (actor omitted).
 */

import { formatNaira } from '~/lib/format-amount';

function formatCurrency(val: unknown): string {
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return formatNaira(num, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTableName(name: string): string {
  const labels: Record<string, string> = {
    users: 'User',
    products: 'Product',
    product_categories: 'Product Category',
    stock_batches: 'Stock Batch',
    logistics_providers: 'Logistics company',
    logistics_locations: 'Logistics Location',
    inventory_levels: 'Inventory Level',
    offer_templates: 'Offer Template',
    campaigns: 'Campaign',
    orders: 'Order',
    order_items: 'Order Item',
    stock_transfers: 'Stock Transfer',
    marketing_funding: 'Marketing Funding',
    invoices: 'Invoice',
    commission_plans: 'Commission Plan',
    payout_records: 'Payout Record',
    earnings_adjustments: 'Earnings Adjustment',
  };
  return labels[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
  UNPROCESSED: 'Unassigned',
  CS_ASSIGNED: 'Assigned',
  CS_ENGAGED: 'Unconfirmed',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  AGENT_ASSIGNED: 'Agent assigned',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  PARTIALLY_DELIVERED: 'Partially Delivered',
  RETURNED: 'Returned',
  RESTOCKED: 'Restocked',
  WRITTEN_OFF: 'Written Off',
  REMITTED: 'Remitted',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  DRAFT: 'Draft',
  SENT: 'Sent',
  DISPUTED: 'Disputed',
  RECEIVED: 'Received',
};

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  HEAD_OF_MARKETING: 'Head of Marketing',
  MEDIA_BUYER: 'Media Buyer',
  HEAD_OF_CS: 'Head of CS',
  CS_CLOSER: 'CS Closer',
  FINANCE_OFFICER: 'Finance Officer',
  HEAD_OF_LOGISTICS: 'Head of Logistics',
  STOCK_MANAGER: 'Stock Manager',
  TPL_MANAGER: '3PL Manager',
  TPL_RIDER: '3PL Rider',
  HR_MANAGER: 'HR Manager',
};

export interface ActivityEntryLike {
  action: string;
  tableName: string;
  recordId?: string;
  data?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

/**
 * Generate a human-readable description for an audit entry.
 * Assumes we're viewing the actor's own activity (e.g. user detail page), so the actor is omitted.
 */
export function formatActivityDescription(entry: ActivityEntryLike): string {
  const data = entry.data ?? entry.newValues ?? {};
  const table = entry.tableName;

  const recordLabel =
    (data.name as string) ||
    (data.customer_name as string) ||
    (data.plan_name as string) ||
    (data.campaign_name as string) ||
    (data.reference_number as string) ||
    (data.batch_number as string) ||
    (data.email as string) ||
    null;

  const label = recordLabel ? ` "${recordLabel}"` : '';

  // ── Per-table descriptions ─────────────────────────────────────
  if (table === 'users') {
    const role = data.role ? (ROLE_LABELS[data.role as string] ?? data.role) : '';
    const status = data.status as string | undefined;
    if (entry.action === 'INSERT') return `Created user${label}${role ? ` (${role})` : ''}`;
    if (status === 'INACTIVE') return `Deactivated user${label}`;
    if (status === 'ARCHIVED') return `Archived user${label}`;
    if (role) return `Updated user${label} (${role})`;
    return `Updated user${label}`;
  }

  if (table === 'orders') {
    const status = data.order_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const customer = data.customer_name ? ` for ${data.customer_name}` : '';
    if (status === 'UNPROCESSED') return `New order created${customer}`;
    if (status === 'CS_ASSIGNED') return `Order assigned to CS closer${customer}`;
    if (status === 'CS_ENGAGED') return `Started CS call on order${customer}`;
    if (status === 'CONFIRMED') return `Confirmed order${customer}`;
    if (status === 'CANCELLED') {
      const reason = data.cancel_reason ? ` — ${data.cancel_reason}` : '';
      return `Cancelled order${customer}${reason}`;
    }
    if (status === 'AGENT_ASSIGNED') return `Order${customer} assigned for delivery (logistics company)`;
    if (status === 'DISPATCHED') return `Dispatched order${customer}`;
    if (status === 'IN_TRANSIT') return `Order${customer} in transit`;
    if (status === 'DELIVERED') return `Marked order${customer} as delivered`;
    if (status === 'PARTIALLY_DELIVERED') return `Marked order${customer} as partially delivered`;
    if (status === 'RETURNED') return `Marked order${customer} as returned`;
    if (status === 'RESTOCKED') return `Restocked returned order${customer}`;
    if (status === 'WRITTEN_OFF') return `Wrote off order${customer}`;
    if (status === 'REMITTED') return `Order${customer} marked as remitted`;
    if (statusLabel) return `Updated order${customer} to ${statusLabel}`;
    return `Updated order${customer}`;
  }

  if (table === 'order_items') {
    const qty = data.quantity ?? '';
    const price = data.unit_price ? formatCurrency(data.unit_price) : '';
    if (qty && price) return `Updated order item — ${qty} units at ${price}`;
    return `Updated order item`;
  }

  if (table === 'product_categories') {
    const brand = data.brand_name ? ` (brand: ${data.brand_name})` : '';
    if (entry.action === 'INSERT') return `Created product category${label}${brand}`;
    return `Updated product category${label}${brand}`;
  }

  if (table === 'products') {
    const price = data.selling_price ? ` (${formatCurrency(data.selling_price)})` : '';
    if (entry.action === 'INSERT') return `Created product${label}${price}`;
    if (data.is_active === false) return `Deactivated product${label}${price}`;
    return `Updated product${label}${price}`;
  }

  if (table === 'stock_batches') {
    const units = data.total_units ?? '';
    const cost = data.factory_cost ? ` at ${formatCurrency(data.factory_cost)}/unit` : '';
    if (units) return `Updated stock batch${label} — ${units} units${cost}`;
    return `Updated stock batch${label}`;
  }

  if (table === 'stock_transfers') {
    const status = data.transfer_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const qty = data.sent_quantity ? `${data.sent_quantity} units` : '';
    if (status === 'RECEIVED') {
      const received = data.received_quantity ?? data.sent_quantity ?? '';
      return `Received transfer — ${received} units`;
    }
    if (status === 'DISPUTED') return `Disputed transfer — ${qty}`;
    if (statusLabel) return `Updated stock transfer to ${statusLabel} — ${qty}`;
    return `Updated stock transfer — ${qty}`;
  }

  if (table === 'inventory_levels') {
    const qty = data.available_units ?? data.quantity ?? '';
    return `Updated inventory level${qty ? ` — ${qty} units` : ''}`;
  }

  if (table === 'logistics_providers') {
    if (entry.action === 'INSERT') return `Created logistics company${label}`;
    if (entry.action === 'DELETE') return `Removed logistics company${label}`;
    return `Updated logistics company${label}`;
  }
  if (table === 'logistics_locations') return `Updated logistics location${label}`;

  if (table === 'invoices') {
    const status = data.invoice_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` for ${formatCurrency(data.amount)}` : '';
    if (statusLabel) return `Updated invoice${label}${amount} — ${statusLabel}`;
    return `Updated invoice${label}${amount}`;
  }

  if (table === 'marketing_funding') {
    const status = data.funding_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` — ${formatCurrency(data.amount)}` : '';
    if (status === 'COMPLETED') return `Confirmed funding received${amount}`;
    if (status === 'DISPUTED') return `Disputed funding${amount}`;
    if (statusLabel) return `Updated marketing funding${amount} — ${statusLabel}`;
    return `Updated marketing funding${amount}`;
  }

  if (table === 'campaigns' || table === 'offer_templates') {
    return `${entry.action === 'INSERT' ? 'Created' : 'Updated'} ${formatTableName(table).toLowerCase()}${label}`;
  }

  if (table === 'commission_plans') return `Updated commission plan${label}`;

  if (table === 'payout_records') {
    const status = data.payout_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.net_amount ? ` — ${formatCurrency(data.net_amount)}` : '';
    if (statusLabel) return `Updated payout${amount} — ${statusLabel}`;
    return `Updated payout record${amount}`;
  }

  if (table === 'earnings_adjustments') {
    const cat = data.category as string | undefined;
    const catLabel = cat ? cat.charAt(0) + (cat as string).slice(1).toLowerCase() : '';
    const amount = data.amount ? ` of ${formatCurrency(data.amount)}` : '';
    if (catLabel) return `Added ${catLabel} adjustment${amount}`;
    return `Updated earnings adjustment${amount}`;
  }

  // Generic fallback
  const action = entry.action === 'INSERT' ? 'Created' : entry.action === 'DELETE' ? 'Deleted' : 'Updated';
  return `${action} ${formatTableName(table).toLowerCase()} record${label}`;
}
