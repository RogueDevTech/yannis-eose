import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams, useFetcher, useRevalidator } from '@remix-run/react';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { exportToCsv } from '~/lib/csv-export';
import { DeferredSection } from '~/components/ui/deferred-section';
import type { AuditEntry, AuditPageProps } from './types';

// ── Polling config ───────────────────────────────────────────────
const POLL_INTERVAL_MS = 20_000;  // 20 seconds
const SUCCESS_FLASH_MS = 2_000;   // Green for 2 seconds after fetch

// ── Corrected list matching backend AUDITABLE_TABLES ─────────────
const AUDITABLE_TABLES = [
  'users', 'products', 'product_categories', 'stock_batches',
  'logistics_providers', 'logistics_locations', 'inventory_levels',
  'offer_templates', 'campaigns',
  'orders', 'order_items', 'stock_transfers',
  'marketing_funding', 'invoices',
  'commission_plans', 'payout_records', 'earnings_adjustments',
];

// ── Human-friendly table labels ──────────────────────────────────
const TABLE_LABELS: Record<string, string> = {
  users: 'Users',
  products: 'Products',
  product_categories: 'Product Categories',
  stock_batches: 'Stock Batches',
  logistics_providers: 'Logistics Providers',
  logistics_locations: 'Logistics Locations',
  inventory_levels: 'Inventory Levels',
  offer_templates: 'Offer Templates',
  campaigns: 'Campaigns',
  orders: 'Orders',
  order_items: 'Order Items',
  stock_transfers: 'Stock Transfers',
  marketing_funding: 'Marketing Funding',
  invoices: 'Invoices',
  commission_plans: 'Commission Plans',
  payout_records: 'Payout Records',
  earnings_adjustments: 'Earnings Adjustments',
};

// ── Human-friendly field labels ──────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  id: 'ID',
  name: 'Name',
  email: 'Email',
  role: 'Role',
  status: 'Status',
  capacity: 'Capacity',
  phone: 'Phone',
  password_hash: 'Password',
  logistics_location_id: 'Logistics Location',
  commission_plan_id: 'Commission Plan',
  visible_order_statuses: 'Visible Statuses',
  restrict_product_access: 'Restrict Product Access',
  last_action_at: 'Last Active',
  created_at: 'Created At',
  updated_at: 'Updated At',
  customer_name: 'Customer Name',
  customer_phone: 'Customer Phone',
  customer_address: 'Customer Address',
  customer_city: 'City',
  customer_state: 'State',
  customer_notes: 'Notes',
  product_id: 'Product',
  offer_template_id: 'Offer Template',
  quantity: 'Quantity',
  unit_price: 'Unit Price',
  total_price: 'Total Price',
  delivery_fee: 'Delivery Fee',
  order_status: 'Order Status',
  assigned_cs_id: 'CS Agent',
  assigned_rider_id: 'Rider',
  locked_by: 'Locked By',
  locked_until: 'Lock Expires',
  confirmed_at: 'Confirmed At',
  dispatched_at: 'Dispatched At',
  delivered_at: 'Delivered At',
  cancelled_at: 'Cancelled At',
  cancel_reason: 'Cancel Reason',
  media_buyer_id: 'Media Buyer',
  source_campaign_id: 'Campaign',
  source_ip: 'Source IP',
  fingerprint: 'Fingerprint',
  edge_received_at: 'Received At',
  sku: 'SKU',
  description: 'Description',
  cost_price: 'Cost Price',
  selling_price: 'Selling Price',
  landing_cost: 'Landing Cost',
  tpl_handling_fee: '3PL Handling Fee',
  image_url: 'Image',
  is_active: 'Active',
  batch_number: 'Batch Number',
  factory_cost: 'Factory Cost',
  freight_duty: 'Freight & Duty',
  total_units: 'Total Units',
  available_units: 'Available Units',
  location_id: 'Location',
  reference_number: 'Reference Number',
  invoice_status: 'Invoice Status',
  amount: 'Amount',
  due_date: 'Due Date',
  paid_at: 'Paid At',
  from_location_id: 'From Location',
  to_location_id: 'To Location',
  sent_quantity: 'Sent Quantity',
  received_quantity: 'Received Quantity',
  transfer_status: 'Transfer Status',
  funding_status: 'Funding Status',
  receipt_url: 'Receipt',
  daily_spend: 'Daily Spend',
  screenshot_url: 'Screenshot',
  plan_name: 'Plan Name',
  rules: 'Commission Rules',
  effective_from: 'Effective From',
  effective_to: 'Effective To',
  created_by: 'Created By',
  payout_status: 'Payout Status',
  period_start: 'Period Start',
  period_end: 'Period End',
  base_salary: 'Base Salary',
  commission_total: 'Total Commission',
  deductions: 'Deductions',
  net_amount: 'Net Amount',
  approved_by: 'Approved By',
  approved_at: 'Approved At',
  category: 'Category',
  reason: 'Reason',
  campaign_name: 'Campaign Name',
  category_id: 'Category',
  brand_name: 'Brand Name',
  brand_phone: 'Brand Phone',
  brand_email: 'Brand Email',
  brand_whatsapp: 'Brand WhatsApp',
  sms_sender_id: 'SMS Sender ID',
  slug: 'Slug',
  deployment_type: 'Deployment Type',
  form_config: 'Form Config',
};

// Fields to hide from the detail modal (sensitive/internal)
const HIDDEN_FIELDS = new Set([
  'password_hash',
  'fingerprint',
  'source_ip',
  '_table_name',
  '_row_data',
]);

// ── Role labels ──────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  HEAD_OF_MARKETING: 'Head of Marketing',
  MEDIA_BUYER: 'Media Buyer',
  HEAD_OF_CS: 'Head of CS',
  CS_AGENT: 'CS Agent',
  FINANCE_OFFICER: 'Finance Officer',
  HEAD_OF_LOGISTICS: 'Head of Logistics',
  WAREHOUSE_MANAGER: 'Warehouse Manager',
  TPL_MANAGER: '3PL Manager',
  TPL_RIDER: '3PL Rider',
  HR_MANAGER: 'HR Manager',
};

// ── Status labels ────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
  UNPROCESSED: 'Unprocessed',
  CS_ENGAGED: 'CS Engaged',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  ALLOCATED: 'Allocated',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  PARTIALLY_DELIVERED: 'Partially Delivered',
  RETURNED: 'Returned',
  RESTOCKED: 'Restocked',
  WRITTEN_OFF: 'Written Off',
  COMPLETED: 'Completed',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAID: 'Paid',
  DRAFT: 'Draft',
  SENT: 'Sent',
  DISPUTED: 'Disputed',
  RECEIVED: 'Received',
  OVERDUE: 'Overdue',
  PENDING_APPROVAL: 'Pending Approval',
  QUERIED: 'Queried',
};

// ── Formatting helpers ───────────────────────────────────────────

function formatTableName(name: string): string {
  return TABLE_LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldName(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function isISODate(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(val);
}

function isUUID(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

const CURRENCY_FIELDS = new Set([
  'cost_price', 'selling_price', 'landing_cost', 'unit_price', 'total_price',
  'delivery_fee', 'tpl_handling_fee', 'factory_cost', 'freight_duty',
  'amount', 'daily_spend', 'base_salary', 'commission_total', 'deductions',
  'net_amount',
]);

function formatCurrency(val: unknown): string {
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return `\u20A6${num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatValue(key: string, val: unknown, actorNames: Record<string, { name: string; role: string }>): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';

  if (CURRENCY_FIELDS.has(key) && (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val))))) {
    return formatCurrency(val);
  }

  const strVal = String(val);

  // Status/role enum values
  if (STATUS_LABELS[strVal]) return STATUS_LABELS[strVal];
  if (ROLE_LABELS[strVal]) return ROLE_LABELS[strVal];

  // UUID fields that reference users — resolve to name
  if (isUUID(val) && (key.endsWith('_id') || key === 'created_by' || key === 'approved_by' || key === 'locked_by')) {
    const actor = actorNames[strVal];
    if (actor) return `${actor.name} (${ROLE_LABELS[actor.role] ?? actor.role})`;
    return `${strVal.slice(0, 8)}...`;
  }

  // Timestamps
  if (isISODate(val)) return formatDate(strVal);

  // JSON objects
  if (typeof val === 'object') {
    try {
      const str = JSON.stringify(val, null, 2);
      if (str.length > 200) return str.slice(0, 200) + '...';
      return str;
    } catch {
      return String(val);
    }
  }

  // URLs — just show "Uploaded file"
  if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) {
    return 'Uploaded file';
  }

  return strVal;
}

function getActorDisplay(
  changedBy: string | null,
  actorNames: Record<string, { name: string; role: string }>,
): string {
  if (!changedBy) return 'System';
  if (changedBy === EDGE_FORM_ACTOR_ID) return 'Edge Form';
  const actor = actorNames[changedBy];
  if (actor) return actor.name;
  return `${changedBy.slice(0, 8)}...`;
}

function isActorKnown(
  changedBy: string | null,
  actorNames: Record<string, { name: string; role: string }>,
): boolean {
  if (!changedBy) return false;
  return !!actorNames[changedBy];
}

// ── Unknown Actor Modal ──────────────────────────────────────────

function UnknownActorModal({
  changedBy,
  displayName,
  onClose,
}: {
  changedBy: string | null;
  displayName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-surface-900 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
            Unknown Actor
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-5 h-5 text-surface-800 dark:text-surface-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-surface-700 dark:text-surface-300">
            {changedBy === EDGE_FORM_ACTOR_ID ? (
              <>
                <strong>Edge Form</strong> — This change was performed by the sales form hosted on the Cloudflare Edge.
                Orders created via the Edge form are captured without a logged-in user; the audit trail uses this reserved
                actor ID to distinguish them from other system actions (e.g. scheduled jobs, migrations).
              </>
            ) : (
              <>
                This change was performed by an actor that could not be resolved to a user in the system.
              </>
            )}
          </p>
          {changedBy && changedBy !== EDGE_FORM_ACTOR_ID && (
            <p className="text-sm text-surface-700 dark:text-surface-300">
              <strong>Display:</strong> {displayName}
              <br />
              <strong>Actor ID:</strong> <code className="text-xs bg-surface-100 dark:bg-surface-800 px-1.5 py-0.5 rounded">{changedBy}</code>
              <br />
              The user may have been deactivated or removed from the system. Historical audit entries preserve the original actor ID for traceability.
            </p>
          )}
          {!changedBy && (
            <p className="text-sm text-surface-700 dark:text-surface-300">
              <strong>Display:</strong> System
              <br />
              This change was performed automatically by the system (e.g. scheduled job, migration, or other background process).
            </p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-surface-200 dark:border-surface-700">
          <button onClick={onClose} className="btn-primary w-full sm:w-auto">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function generateDescription(
  entry: AuditEntry,
  actorNames: Record<string, { name: string; role: string }>,
): string {
  const data = entry.data;
  const table = entry.tableName;
  const actor = getActorDisplay(entry.changedBy, actorNames);

  // Try to get a recognizable label for the record
  const recordLabel =
    (data.name as string) ||
    (data.customer_name as string) ||
    (data.plan_name as string) ||
    (data.campaign_name as string) ||
    (data.reference_number as string) ||
    (data.batch_number as string) ||
    (data.name as string) ||
    (data.email as string) ||
    null;

  const label = recordLabel ? `"${recordLabel}"` : '';

  // ── Per-table descriptions ──────────────────────────────────
  if (table === 'users') {
    const role = data.role ? (ROLE_LABELS[data.role as string] ?? data.role) : '';
    const status = data.status as string | undefined;
    if (entry.action === 'INSERT') return `${actor} created user ${label}${role ? ` (${role})` : ''}`;
    if (status === 'INACTIVE') return `${actor} deactivated user ${label}`;
    if (status === 'ARCHIVED') return `${actor} archived user ${label}`;
    if (role) return `${actor} updated user ${label} (${role})`;
    return `${actor} updated user ${label}`;
  }

  if (table === 'orders') {
    const status = data.order_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const customer = data.customer_name ? ` for ${data.customer_name}` : '';
    if (status === 'UNPROCESSED') return `New order created${customer}`;
    if (status === 'CS_ENGAGED') return `${actor} engaged CS call on order${customer}`;
    if (status === 'CONFIRMED') return `${actor} confirmed order${customer}`;
    if (status === 'CANCELLED') {
      const reason = data.cancel_reason ? ` — ${data.cancel_reason}` : '';
      return `${actor} cancelled order${customer}${reason}`;
    }
    if (status === 'ALLOCATED') return `${actor} allocated order${customer} to 3PL`;
    if (status === 'DISPATCHED') return `${actor} dispatched order${customer}`;
    if (status === 'IN_TRANSIT') return `Order${customer} is in transit`;
    if (status === 'DELIVERED') return `${actor} marked order${customer} as delivered`;
    if (status === 'PARTIALLY_DELIVERED') return `${actor} marked order${customer} as partially delivered`;
    if (status === 'RETURNED') return `${actor} marked order${customer} as returned`;
    if (status === 'RESTOCKED') return `${actor} restocked returned order${customer}`;
    if (status === 'WRITTEN_OFF') return `${actor} wrote off order${customer}`;
    if (status === 'COMPLETED') return `Order${customer} marked as completed`;
    if (statusLabel) return `${actor} updated order${customer} to ${statusLabel}`;
    return `${actor} updated order${customer}`;
  }

  if (table === 'order_items') {
    const qty = data.quantity ?? '';
    const price = data.unit_price ? formatCurrency(data.unit_price) : '';
    if (qty && price) return `${actor} updated order item — ${qty} units at ${price}`;
    return `${actor} updated order item`;
  }

  if (table === 'product_categories') {
    const brand = data.brand_name ? ` (brand: ${data.brand_name})` : '';
    if (entry.action === 'INSERT') return `${actor} created product category ${label}${brand}`;
    return `${actor} updated product category ${label}${brand}`;
  }

  if (table === 'products') {
    const price = data.selling_price ? ` (${formatCurrency(data.selling_price)})` : '';
    if (entry.action === 'INSERT') return `${actor} created product ${label}${price}`;
    if (data.is_active === false) return `${actor} deactivated product ${label}${price}`;
    return `${actor} updated product ${label}${price}`;
  }

  if (table === 'stock_batches') {
    const units = data.total_units ?? '';
    const cost = data.factory_cost ? ` at ${formatCurrency(data.factory_cost)}/unit` : '';
    if (units) return `${actor} updated stock batch ${label} — ${units} units${cost}`;
    return `${actor} updated stock batch ${label}`;
  }

  if (table === 'stock_transfers') {
    const status = data.transfer_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const qty = data.sent_quantity ? `${data.sent_quantity} units` : '';
    if (status === 'RECEIVED') {
      const received = data.received_quantity ?? data.sent_quantity ?? '';
      return `${actor} received transfer — ${received} units`;
    }
    if (status === 'DISPUTED') return `${actor} disputed transfer — ${qty}`;
    if (statusLabel) return `${actor} updated stock transfer to ${statusLabel} — ${qty}`;
    return `${actor} updated stock transfer — ${qty}`;
  }

  if (table === 'inventory_levels') {
    const qty = data.available_units ?? data.quantity ?? '';
    return `${actor} updated inventory level${qty ? ` — ${qty} units` : ''}`;
  }

  if (table === 'logistics_providers') {
    return `${actor} updated logistics provider ${label}`;
  }

  if (table === 'logistics_locations') {
    return `${actor} updated logistics location ${label}`;
  }

  if (table === 'invoices') {
    const status = data.invoice_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` for ${formatCurrency(data.amount)}` : '';
    if (statusLabel) return `${actor} updated invoice ${label}${amount} — ${statusLabel}`;
    return `${actor} updated invoice ${label}${amount}`;
  }

  if (table === 'marketing_funding') {
    const status = data.funding_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` — ${formatCurrency(data.amount)}` : '';
    if (status === 'COMPLETED') return `${actor} confirmed funding received${amount}`;
    if (status === 'DISPUTED') return `${actor} disputed funding${amount}`;
    if (statusLabel) return `${actor} updated marketing funding${amount} — ${statusLabel}`;
    return `${actor} updated marketing funding${amount}`;
  }

  if (table === 'campaigns' || table === 'offer_templates') {
    return `${actor} updated ${formatTableName(table).toLowerCase()} ${label}`;
  }

  if (table === 'commission_plans') {
    return `${actor} updated commission plan ${label}`;
  }

  if (table === 'payout_records') {
    const status = data.payout_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.net_amount ? ` — ${formatCurrency(data.net_amount)}` : '';
    if (statusLabel) return `${actor} updated payout${amount} — ${statusLabel}`;
    return `${actor} updated payout record${amount}`;
  }

  if (table === 'earnings_adjustments') {
    const cat = data.category as string | undefined;
    const catLabel = cat ? cat.charAt(0) + cat.slice(1).toLowerCase() : '';
    const amount = data.amount ? ` of ${formatCurrency(data.amount)}` : '';
    if (catLabel) return `${actor} added ${catLabel} adjustment${amount}`;
    return `${actor} updated earnings adjustment${amount}`;
  }

  // Generic fallback
  return `${actor} updated ${formatTableName(table).toLowerCase()} record`;
}

// ── Detail Modal ────────────────────────────────────────────────

function DetailModal({
  entry,
  actorNames,
  onClose,
  onUnknownActorClick,
}: {
  entry: AuditEntry;
  actorNames: Record<string, { name: string; role: string }>;
  onClose: () => void;
  onUnknownActorClick?: (changedBy: string | null, displayName: string) => void;
}) {
  const fields = Object.entries(entry.data).filter(
    ([key]) => !HIDDEN_FIELDS.has(key) && key !== 'id',
  );

  const actorInfo = entry.changedBy ? actorNames[entry.changedBy] : null;
  const actorDisplay = getActorDisplay(entry.changedBy, actorNames);
  const actorKnown = isActorKnown(entry.changedBy, actorNames);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-surface-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700">
          <div>
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
              Record Detail
            </h3>
            <p className="text-sm text-surface-800 dark:text-surface-400 mt-0.5">
              {formatTableName(entry.tableName)} &middot; {entry.recordId.slice(0, 8)}...
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-5 h-5 text-surface-800" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Meta */}
        <div className="px-6 py-3 bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-700">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-surface-800 dark:text-surface-400">Changed By</span>
              {actorKnown && entry.changedBy ? (
                <Link
                  to={`/admin/users/${entry.changedBy}`}
                  className="block font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 text-xs mt-0.5 underline underline-offset-2"
                >
                  {actorDisplay}
                </Link>
              ) : onUnknownActorClick ? (
                <button
                  type="button"
                  onClick={() => onUnknownActorClick(entry.changedBy, actorDisplay)}
                  className="block font-medium text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100 text-xs mt-0.5 underline underline-offset-2 cursor-pointer text-left"
                >
                  {actorDisplay}
                </button>
              ) : (
                <p className="font-medium text-surface-900 dark:text-surface-100 text-xs mt-0.5">
                  {actorDisplay}
                </p>
              )}
              {actorInfo && (
                <p className="text-xs text-surface-700 dark:text-surface-500">
                  {ROLE_LABELS[actorInfo.role] ?? actorInfo.role}
                </p>
              )}
            </div>
            <div>
              <span className="text-surface-800 dark:text-surface-400">Valid From</span>
              <p className="text-surface-900 dark:text-surface-100 text-xs mt-0.5">
                {formatDate(entry.validFrom)}
              </p>
            </div>
            <div>
              <span className="text-surface-800 dark:text-surface-400">Valid To</span>
              <p className="text-surface-900 dark:text-surface-100 text-xs mt-0.5">
                {entry.validTo ? formatDate(entry.validTo) : 'Current'}
              </p>
            </div>
          </div>
        </div>

        {/* Data fields */}
        <div className="px-6 py-4 overflow-y-auto max-h-[50vh]">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header">Field</th>
                <th className="table-header">Value</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(([key, value]) => (
                <tr key={key} className="table-row">
                  <td className="table-cell font-medium text-surface-700 dark:text-surface-300">
                    {formatFieldName(key)}
                  </td>
                  <td className="table-cell text-surface-900 dark:text-surface-100 break-all">
                    {(key === 'rules' || (typeof value === 'object' && value !== null)) ? (
                      <pre className="text-xs font-mono bg-surface-50 dark:bg-surface-800 rounded p-2 overflow-x-auto max-w-sm whitespace-pre-wrap">
                        {formatValue(key, value, actorNames)}
                      </pre>
                    ) : (
                      formatValue(key, value, actorNames)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Polling Status Indicator ────────────────────────────────────

type PollState = 'idle' | 'fetching' | 'success';

function PollingStatusIndicator({
  state,
  countdown,
}: {
  state: PollState;
  countdown: number;
}) {
  if (state === 'fetching') {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <svg
          className="h-4 w-4 animate-spin text-brand-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <span className="text-surface-700 dark:text-surface-400">Update</span>
      </span>
    );
  }

  if (state === 'success') {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <span className="h-3 w-3 rounded-full bg-success-500 animate-pulse" title="Data updated" />
        <span className="text-success-700 dark:text-success-400 font-medium">Updated</span>
      </span>
    );
  }

  // idle — yellow, countdown to next poll
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        className="h-3 w-3 rounded-full bg-warning-500"
        title={`Next refresh in ${countdown}s`}
      />
      <span className="text-surface-700 dark:text-surface-400">
        Next refresh in {countdown}s
      </span>
    </span>
  );
}

// ── Time Travel Panel ───────────────────────────────────────────

function TimeTravelPanel({
  actorNames,
}: {
  actorNames: Record<string, { name: string; role: string }>;
}) {
  const fetcher = useFetcher();
  const [ttTable, setTtTable] = useState(AUDITABLE_TABLES[0]);
  const [ttRecordId, setTtRecordId] = useState('');
  const [ttTimestamp, setTtTimestamp] = useState('');

  const fetcherData = fetcher.data as { result?: Record<string, unknown>; error?: string } | undefined;
  const ttResult = fetcherData?.result ?? null;
  const ttError = fetcherData?.error ?? '';
  const ttLoading = fetcher.state === 'submitting';

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">
        Time Travel
      </h2>
      <p className="text-sm text-surface-800 dark:text-surface-400 mb-4">
        View the state of any record at a specific point in time.
      </p>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="timeTravel" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select
            name="tableName"
            value={ttTable}
            onChange={(e) => setTtTable(e.target.value)}
            className="input text-sm"
          >
            {AUDITABLE_TABLES.map((t) => (
              <option key={t} value={t}>{formatTableName(t)}</option>
            ))}
          </select>
          <input
            name="recordId"
            type="text"
            placeholder="Record ID (UUID)"
            value={ttRecordId}
            onChange={(e) => setTtRecordId(e.target.value)}
            className="input text-sm"
          />
          <input
            name="asOf"
            type="datetime-local"
            value={ttTimestamp}
            onChange={(e) => setTtTimestamp(e.target.value)}
            className="input text-sm"
          />
          <button
            type="submit"
            disabled={ttLoading || !ttRecordId || !ttTimestamp}
            className="btn-primary text-sm"
          >
            {ttLoading ? 'Loading...' : 'View State'}
          </button>
        </div>
      </fetcher.Form>

      {ttError && (
        <div className="mt-3 rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{ttError}</p>
        </div>
      )}

      {ttResult && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header">Field</th>
                <th className="table-header">Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(ttResult)
                .filter(([key]) => !HIDDEN_FIELDS.has(key))
                .map(([key, value]) => (
                <tr key={key} className="table-row">
                  <td className="table-cell font-medium text-surface-700 dark:text-surface-300">
                    {formatFieldName(key)}
                  </td>
                  <td className="table-cell text-surface-900 dark:text-surface-100 break-all">
                    {formatValue(key, value, actorNames)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────

export function AuditPage({ rows, total, filters, actorNames, error }: AuditPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [unknownActorModal, setUnknownActorModal] = useState<{ changedBy: string | null; displayName: string } | null>(null);
  const { revalidate, state: revalidatorState } = useRevalidator();

  // Polling state: idle (yellow) → fetching (spinner) → success (green 2s) → idle
  const [pollState, setPollState] = useState<PollState>('idle');
  const [countdown, setCountdown] = useState(POLL_INTERVAL_MS / 1000);
  const prevLoadingRef = useRef(false);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalPages = Math.ceil(total / filters.limit);

  // Polling interval — trigger revalidate every POLL_INTERVAL_MS
  useEffect(() => {
    const interval = setInterval(() => {
      setPollState('fetching');
      setCountdown(POLL_INTERVAL_MS / 1000);
      revalidate();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [revalidate]);

  // Detect when revalidation completes → show green for 2s
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    const isLoading = revalidatorState === 'loading';

    if (wasLoading && !isLoading && pollState === 'fetching') {
      setPollState('success');
    }
    prevLoadingRef.current = isLoading;
  }, [revalidatorState, pollState]);

  // After 2s in success state → back to yellow (idle), polling continues
  useEffect(() => {
    if (pollState !== 'success') return;
    const t = setTimeout(() => {
      setPollState('idle');
      setCountdown(POLL_INTERVAL_MS / 1000);
    }, SUCCESS_FLASH_MS);
    return () => clearTimeout(t);
  }, [pollState]);

  // Countdown when idle
  useEffect(() => {
    if (pollState !== 'idle') return;
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((c) => (c <= 1 ? POLL_INTERVAL_MS / 1000 : c - 1));
    }, 1000);
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [pollState]);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set('page', '1');
    setSearchParams(params);
  };

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', String(page));
    setSearchParams(params);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Audit Trail</h1>
          <p className="text-sm text-surface-800 dark:text-surface-400 mt-1">
            Complete history of all data changes. Every mutation is permanently recorded.
          </p>
        </div>
        <div className="flex items-center shrink-0">
          <PollingStatusIndicator state={pollState} countdown={countdown} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{error}</p>
        </div>
      )}

      {/* Filters — Actor dropdown streams in via DeferredSection */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-surface-800 dark:text-surface-400 mb-1">
              Table
            </label>
            <select
              value={filters.tableName}
              onChange={(e) => updateFilter('tableName', e.target.value)}
              className="input text-sm"
            >
              <option value="">All Tables</option>
              {AUDITABLE_TABLES.map((t) => (
                <option key={t} value={t}>{formatTableName(t)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-800 dark:text-surface-400 mb-1">
              Actor
            </label>
            <DeferredSection resolve={actorNames} skeleton="inline">
              {(resolvedActorNames) => {
                const uniqueActors = Object.entries(resolvedActorNames).map(([id, info]) => ({
                  id,
                  name: info.name,
                  role: info.role,
                }));
                return uniqueActors.length > 0 ? (
                  <select
                    value={filters.actorId}
                    onChange={(e) => updateFilter('actorId', e.target.value)}
                    className="input text-sm"
                  >
                    <option value="">All Users</option>
                    {uniqueActors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({ROLE_LABELS[a.role] ?? a.role})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="User UUID..."
                    value={filters.actorId}
                    onChange={(e) => updateFilter('actorId', e.target.value)}
                    className="input text-sm"
                  />
                );
              }}
            </DeferredSection>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-800 dark:text-surface-400 mb-1">
              Start Date
            </label>
            <input
              type="datetime-local"
              value={filters.startDate}
              onChange={(e) => updateFilter('startDate', e.target.value)}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-800 dark:text-surface-400 mb-1">
              End Date
            </label>
            <input
              type="datetime-local"
              value={filters.endDate}
              onChange={(e) => updateFilter('endDate', e.target.value)}
              className="input text-sm"
            />
          </div>
        </div>
      </div>

      {/* Results count + Export */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-surface-800 dark:text-surface-400">
          {total} {total === 1 ? 'entry' : 'entries'} found
        </p>
        {rows.length > 0 && (
          <DeferredSection resolve={actorNames} skeleton="inline">
            {(resolvedActorNames) => (
              <button
                onClick={() => exportToCsv(
                  rows.map((entry) => ({
                    timestamp: formatDate(entry.validFrom),
                    table: formatTableName(entry.tableName),
                    description: generateDescription(entry, resolvedActorNames),
                    actor: getActorDisplay(entry.changedBy, resolvedActorNames),
                    action: entry.action,
                    recordId: entry.recordId,
                    validTo: entry.validTo ? formatDate(entry.validTo) : 'Current',
                  })),
                  [
                    { key: 'timestamp', label: 'Timestamp' },
                    { key: 'table', label: 'Table' },
                    { key: 'description', label: 'Description' },
                    { key: 'actor', label: 'Actor' },
                    { key: 'action', label: 'Action' },
                    { key: 'recordId', label: 'Record ID' },
                    { key: 'validTo', label: 'Valid To' },
                  ],
                  `audit-log-${new Date().toISOString().split('T')[0]}.csv`,
                )}
                className="btn-secondary btn-sm"
              >
                Export CSV
              </button>
            )}
          </DeferredSection>
        )}
      </div>

      {/* Audit log table — rows render immediately, actor names stream in */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Timestamp</th>
                <th className="table-header">Table</th>
                <th className="table-header">Description</th>
                <th className="table-header">Actor</th>
                <th className="table-header">Action</th>
                <th className="table-header text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-surface-800 dark:text-surface-400">
                    No audit entries found. Try adjusting your filters.
                  </td>
                </tr>
              )}
              {rows.map((entry, idx) => (
                <tr key={`${entry.recordId}-${entry.validFrom}-${idx}`} className="table-row">
                  <td className="table-cell text-xs text-surface-700 dark:text-surface-300 whitespace-nowrap">
                    {formatDate(entry.validFrom)}
                  </td>
                  <td className="table-cell">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300">
                      {formatTableName(entry.tableName)}
                    </span>
                  </td>
                  <td className="table-cell text-xs text-surface-700 dark:text-surface-300 max-w-xs">
                    <DeferredSection resolve={actorNames} skeleton="inline">
                      {(resolvedActorNames) => (
                        <>{generateDescription(entry, resolvedActorNames)}</>
                      )}
                    </DeferredSection>
                  </td>
                  <td className="table-cell text-xs text-surface-700 dark:text-surface-300 whitespace-nowrap">
                    <DeferredSection resolve={actorNames} skeleton="inline">
                      {(resolvedActorNames) => {
                        const display = getActorDisplay(entry.changedBy, resolvedActorNames);
                        const known = isActorKnown(entry.changedBy, resolvedActorNames);
                        if (known && entry.changedBy) {
                          return (
                            <Link
                              to={`/admin/users/${entry.changedBy}`}
                              className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 font-medium underline underline-offset-2"
                            >
                              {display}
                            </Link>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => setUnknownActorModal({ changedBy: entry.changedBy, displayName: display })}
                            className="text-surface-600 hover:text-surface-900 dark:text-surface-400 dark:hover:text-surface-100 font-medium underline underline-offset-2 cursor-pointer"
                          >
                            {display}
                          </button>
                        );
                      }}
                    </DeferredSection>
                  </td>
                  <td className="table-cell">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                      entry.action === 'INSERT'
                        ? 'bg-success-50 dark:bg-success-700/20 text-success-700 dark:text-success-500'
                        : entry.action === 'DELETE'
                        ? 'bg-danger-50 dark:bg-danger-700/20 text-danger-700 dark:text-danger-500'
                        : 'bg-warning-50 dark:bg-warning-700/20 text-warning-700 dark:text-warning-500'
                    }`}>
                      {entry.action === 'INSERT' ? 'Created' : entry.action === 'DELETE' ? 'Deleted' : 'Updated'}
                    </span>
                  </td>
                  <td className="table-cell text-right">
                    <button
                      onClick={() => setSelectedEntry(entry)}
                      className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 text-sm font-medium"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => goToPage(filters.page - 1)}
            disabled={filters.page <= 1}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-surface-800 dark:text-surface-400">
            Page {filters.page} of {totalPages}
          </span>
          <button
            onClick={() => goToPage(filters.page + 1)}
            disabled={filters.page >= totalPages}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}

      {/* Time Travel Panel — uses resolved actorNames */}
      <DeferredSection resolve={actorNames} skeleton="card">
        {(resolvedActorNames) => (
          <TimeTravelPanel actorNames={resolvedActorNames} />
        )}
      </DeferredSection>

      {/* Detail Modal — uses resolved actorNames */}
      {selectedEntry && (
        <DeferredSection resolve={actorNames} skeleton="card">
          {(resolvedActorNames) => (
            <DetailModal
              entry={selectedEntry}
              actorNames={resolvedActorNames}
              onClose={() => setSelectedEntry(null)}
              onUnknownActorClick={(changedBy, displayName) => {
                setSelectedEntry(null);
                setUnknownActorModal({ changedBy, displayName });
              }}
            />
          )}
        </DeferredSection>
      )}

      {/* Unknown Actor Modal */}
      {unknownActorModal && (
        <UnknownActorModal
          changedBy={unknownActorModal.changedBy}
          displayName={unknownActorModal.displayName}
          onClose={() => setUnknownActorModal(null)}
        />
      )}
    </div>
  );
}
