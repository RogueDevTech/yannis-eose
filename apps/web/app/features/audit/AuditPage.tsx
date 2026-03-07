import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams, useFetcher, useRevalidator, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { PageNotification } from '~/components/ui/page-notification';
import { Spinner } from '~/components/ui/spinner';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { exportToCsv } from '~/lib/csv-export';
import { formatNaira } from '~/lib/format-amount';
import { DeferredSection } from '~/components/ui/deferred-section';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import type { AuditEntry, AuditPageProps } from './types';

// ── Polling config ───────────────────────────────────────────────
const POLL_INTERVAL_MS = 20_000;  // 20 seconds
const SUCCESS_FLASH_MS = 2_000;   // Green for 2 seconds after fetch

// ── Corrected list matching backend AUDITABLE_TABLES ─────────────
const AUDITABLE_TABLES = [
  'users', 'products', 'product_categories', 'stock_batches',
  'logistics_providers', 'logistics_locations', 'inventory_levels',
  'offer_templates', 'campaigns',
  'orders', 'order_items', 'stock_transfers', 'stock_movements',
  'marketing_funding', 'marketing_funding_requests', 'ad_spend_logs',
  'call_logs', 'order_transfer_requests',
  'invoices', 'approval_requests', 'budgets', 'settlement_configs',
  'delivery_confirmation_requests',
  'commission_plans', 'payout_records', 'earnings_adjustments',
  'stock_reconciliations',
  'email_change_requests', 'user_product_assignments',
  'permission_requests', 'system_settings', 'cart_abandonments',
  'permissions', 'user_permissions',
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
  stock_movements: 'Stock Movements',
  marketing_funding: 'Marketing Funding',
  marketing_funding_requests: 'Marketing Funding Requests',
  ad_spend_logs: 'Ad Spend Logs',
  call_logs: 'Call Logs',
  order_transfer_requests: 'Order Transfer Requests',
  invoices: 'Invoices',
  approval_requests: 'Approval Requests',
  delivery_confirmation_requests: 'Delivery Confirmation Requests',
  budgets: 'Budgets',
  settlement_configs: 'Settlement Configs',
  commission_plans: 'Commission Plans',
  payout_records: 'Payout Records',
  earnings_adjustments: 'Earnings Adjustments',
  stock_reconciliations: 'Stock Reconciliations',
  email_change_requests: 'Email Change Requests',
  user_product_assignments: 'User Product Assignments',
  permission_requests: 'Permission Requests',
  system_settings: 'System Settings',
  cart_abandonments: 'Cart Abandonments',
  permissions: 'Permissions',
  user_permissions: 'User Permissions',
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
  offers: 'Offers',
  qty: 'Quantity',
  label: 'Label',
  price: 'Price',
  funding_request_status: 'Funding Request Status',
  ad_spend_status: 'Ad Spend Status',
  order_transfer_request_status: 'Transfer Request Status',
  reconciliation_status: 'Reconciliation Status',
  call_status: 'Call Status',
  spend_amount: 'Spend Amount',
  movement_type: 'Movement Type',
  requester_id: 'Requester',
  submitted_by: 'Submitted By',
  resolved_by: 'Resolved By',
  digital_count: 'Digital Count',
  physical_count: 'Physical Count',
  discrepancy: 'Discrepancy',
  reason_code: 'Reason Code',
  total_budget: 'Total Budget',
  department_or_campaign: 'Department / Campaign',
  window_type: 'Settlement Window',
  start_day: 'Start Day',
};

// Fields to hide from the detail modal (sensitive/internal)
const HIDDEN_FIELDS = new Set([
  'password_hash',
  'fingerprint',
  'source_ip',
  '_table_name',
  '_row_data',
]);

// Field keys that hold image/file URLs — show View + Preview in audit detail
const IMAGE_URL_FIELD_KEYS = new Set(['receipt_url', 'screenshot_url', 'image_url']);

function isImageUrlValue(val: unknown): val is string {
  return typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'));
}

function AttachedFileDisplay({ url, onPreview }: { url: string; onPreview?: (url: string) => void }) {
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 text-sm underline underline-offset-2"
      >
        View
      </a>
      {onPreview && (
        <>
          <span className="text-surface-400 dark:text-surface-500">|</span>
          <button
            type="button"
            onClick={() => onPreview(url)}
            className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 text-sm underline underline-offset-2 cursor-pointer"
          >
            Preview
          </button>
        </>
      )}
    </span>
  );
}

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
  CS_ASSIGNED: 'CS Assigned',
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
  ACCEPTED: 'Accepted',
  INITIATED: 'Initiated',
  RINGING: 'Ringing',
  IN_PROGRESS: 'In Progress',
  FAILED: 'Failed',
  NO_ANSWER: 'No Answer',
  BUSY: 'Busy',
  MANUAL_CALL: 'Manual Call',
  RESOLVED: 'Resolved',
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
  'net_amount', 'base_sale_price', 'total_budget', 'spend_amount',
]);

function formatCurrency(val: unknown): string {
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return formatNaira(num, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseOffersArray(val: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(val)) return val.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object');
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object') : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Product offers: [{ qty, label, price }] — format as human-readable list */
function formatOffers(val: unknown): string {
  const arr = parseOffersArray(val);
  if (arr.length === 0) return '-';
  return arr.map((obj) => {
    const qty = obj.qty ?? '?';
    const label = typeof obj.label === 'string' ? obj.label : String(obj.label ?? 'Offer');
    const priceVal = obj.price;
    const price = (typeof priceVal === 'number' || (typeof priceVal === 'string' && !isNaN(Number(priceVal))))
      ? formatCurrency(priceVal)
      : String(priceVal ?? '—');
    return `  • ${label} — ${qty} qty — ${price}`;
  }).join('\n');
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

  // Product offers — human-readable list
  if (key === 'offers') return formatOffers(val);

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
          <Button variant="primary" className="w-full sm:w-auto" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function getEntityLink(tableName: string, recordId: string): string | null {
  switch (tableName) {
    case 'users':
      return `/hr/users/${recordId}`;
    case 'orders':
      return `/admin/orders/${recordId}`;
    case 'products':
      return `/admin/products/${recordId}`;
    default:
      return null;
  }
}

interface DescriptionParts {
  prefix: string;
  entityLabel: string | null;
  suffix: string;
}

function getDescriptionParts(
  entry: AuditEntry,
  actorNames: Record<string, { name: string; role: string }>,
): DescriptionParts {
  const data = entry.data;
  const table = entry.tableName;
  const actor = getActorDisplay(entry.changedBy, actorNames);

  const recordLabel =
    (data.name as string) ||
    (data.customer_name as string) ||
    (data.plan_name as string) ||
    (data.campaign_name as string) ||
    (data.reference_number as string) ||
    (data.batch_number as string) ||
    (data.email as string) ||
    null;

  // ── Per-table descriptions ──────────────────────────────────
  if (table === 'users') {
    const role = data.role ? (ROLE_LABELS[data.role as string] ?? data.role) : '';
    const status = data.status as string | undefined;
    const suffix = role ? ` (${role})` : '';
    if (entry.action === 'INSERT') return { prefix: `${actor} created user `, entityLabel: recordLabel, suffix };
    if (status === 'INACTIVE') return { prefix: `${actor} deactivated user `, entityLabel: recordLabel, suffix: '' };
    if (status === 'ARCHIVED') return { prefix: `${actor} archived user `, entityLabel: recordLabel, suffix: '' };
    return { prefix: `${actor} updated user `, entityLabel: recordLabel, suffix };
  }

  if (table === 'orders') {
    const status = data.order_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const customer = data.customer_name ? ` for ${data.customer_name}` : '';
    const entityLabel = data.reference_number
      ? String(data.reference_number)
      : data.customer_name
        ? `for ${data.customer_name}`
        : 'order';
    if (status === 'UNPROCESSED') return { prefix: 'New order created', entityLabel: data.customer_name ? `for ${data.customer_name}` : null, suffix: '' };
    if (status === 'CS_ASSIGNED') return { prefix: 'Order assigned to CS agent', entityLabel: data.customer_name ? ` for ${data.customer_name}` : null, suffix: '' };
    if (status === 'CS_ENGAGED') return { prefix: `${actor} engaged CS call on `, entityLabel: `order${customer}`, suffix: '' };
    if (status === 'CONFIRMED') return { prefix: `${actor} confirmed order `, entityLabel, suffix: '' };
    if (status === 'CANCELLED') {
      const reason = data.cancel_reason ? ` — ${data.cancel_reason}` : '';
      return { prefix: `${actor} cancelled order `, entityLabel, suffix: reason };
    }
    if (status === 'ALLOCATED') return { prefix: `${actor} allocated order `, entityLabel, suffix: ' to 3PL' };
    if (status === 'DISPATCHED') return { prefix: `${actor} dispatched order `, entityLabel, suffix: '' };
    if (status === 'IN_TRANSIT') return { prefix: 'Order', entityLabel: customer ? customer.slice(1) : null, suffix: ' is in transit' };
    if (status === 'DELIVERED') return { prefix: `${actor} marked order `, entityLabel, suffix: ' as delivered' };
    if (status === 'PARTIALLY_DELIVERED') return { prefix: `${actor} marked order `, entityLabel, suffix: ' as partially delivered' };
    if (status === 'RETURNED') return { prefix: `${actor} marked order `, entityLabel, suffix: ' as returned' };
    if (status === 'RESTOCKED') return { prefix: `${actor} restocked returned order `, entityLabel, suffix: '' };
    if (status === 'WRITTEN_OFF') return { prefix: `${actor} wrote off order `, entityLabel, suffix: '' };
    if (status === 'COMPLETED') return { prefix: 'Order', entityLabel: customer ? customer.slice(1) : null, suffix: ' marked as completed' };
    if (statusLabel) return { prefix: `${actor} updated order `, entityLabel, suffix: ` to ${statusLabel}` };
    return { prefix: `${actor} updated order `, entityLabel, suffix: '' };
  }

  if (table === 'order_items') {
    const qty = data.quantity ?? '';
    const price = data.unit_price ? formatCurrency(data.unit_price) : '';
    const full = qty && price
      ? `${actor} updated order item — ${qty} units at ${price}`
      : `${actor} updated order item`;
    return { prefix: full, entityLabel: null, suffix: '' };
  }

  if (table === 'product_categories') {
    const brand = data.brand_name ? ` (brand: ${data.brand_name})` : '';
    const prefix = entry.action === 'INSERT'
      ? `${actor} created product category `
      : `${actor} updated product category `;
    return { prefix, entityLabel: recordLabel, suffix: brand };
  }

  if (table === 'products') {
    const priceVal = data.baseSalePrice ?? data.base_sale_price;
    const price = priceVal ? ` (${formatCurrency(priceVal)})` : '';
    if (entry.action === 'INSERT') return { prefix: `${actor} created product `, entityLabel: recordLabel, suffix: price };
    if (data.status === 'INACTIVE' || data.is_active === false) return { prefix: `${actor} deactivated product `, entityLabel: recordLabel, suffix: price };
    return { prefix: `${actor} updated product `, entityLabel: recordLabel, suffix: price };
  }

  if (table === 'stock_batches') {
    const units = data.total_units ?? '';
    const cost = data.factory_cost ? ` at ${formatCurrency(data.factory_cost)}/unit` : '';
    const suffix = units ? ` — ${units} units${cost}` : '';
    return { prefix: `${actor} updated stock batch `, entityLabel: recordLabel, suffix };
  }

  if (table === 'stock_transfers') {
    const status = data.transfer_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const qty = data.sent_quantity ? `${data.sent_quantity} units` : '';
    if (status === 'RECEIVED') {
      const received = data.received_quantity ?? data.sent_quantity ?? '';
      return { prefix: `${actor} received transfer — `, entityLabel: null, suffix: `${received} units` };
    }
    if (status === 'DISPUTED') return { prefix: `${actor} disputed transfer — `, entityLabel: null, suffix: qty };
    const full = statusLabel ? `${actor} updated stock transfer to ${statusLabel} — ${qty}` : `${actor} updated stock transfer — ${qty}`;
    return { prefix: full, entityLabel: null, suffix: '' };
  }

  if (table === 'inventory_levels') {
    const qty = data.available_units ?? data.quantity ?? '';
    const full = `${actor} updated inventory level${qty ? ` — ${qty} units` : ''}`;
    return { prefix: full, entityLabel: null, suffix: '' };
  }

  if (table === 'logistics_providers') {
    return { prefix: `${actor} updated logistics provider `, entityLabel: recordLabel, suffix: '' };
  }

  if (table === 'logistics_locations') {
    return { prefix: `${actor} updated logistics location `, entityLabel: recordLabel, suffix: '' };
  }

  if (table === 'invoices') {
    const status = data.invoice_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` for ${formatCurrency(data.amount)}` : '';
    const suffix = amount + (statusLabel ? ` — ${statusLabel}` : '');
    return { prefix: `${actor} updated invoice `, entityLabel: recordLabel, suffix };
  }

  if (table === 'marketing_funding') {
    const status = data.funding_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` — ${formatCurrency(data.amount)}` : '';
    if (status === 'COMPLETED') return { prefix: `${actor} confirmed funding received`, entityLabel: null, suffix: amount };
    if (status === 'DISPUTED') return { prefix: `${actor} disputed funding`, entityLabel: null, suffix: amount };
    const full = statusLabel ? `${actor} updated marketing funding${amount} — ${statusLabel}` : `${actor} updated marketing funding${amount}`;
    return { prefix: full, entityLabel: null, suffix: '' };
  }

  if (table === 'campaigns' || table === 'offer_templates') {
    return { prefix: `${actor} updated ${formatTableName(table).toLowerCase()} `, entityLabel: recordLabel, suffix: '' };
  }

  if (table === 'commission_plans') {
    return { prefix: `${actor} updated commission plan `, entityLabel: recordLabel, suffix: '' };
  }

  if (table === 'payout_records') {
    const status = data.payout_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.net_amount ? ` — ${formatCurrency(data.net_amount)}` : '';
    const suffix = amount + (statusLabel ? ` — ${statusLabel}` : '');
    return { prefix: `${actor} updated payout`, entityLabel: null, suffix };
  }

  if (table === 'earnings_adjustments') {
    const cat = data.category as string | undefined;
    const catLabel = cat ? cat.charAt(0) + cat.slice(1).toLowerCase() : '';
    const amount = data.amount ? ` of ${formatCurrency(data.amount)}` : '';
    if (catLabel) return { prefix: `${actor} added ${catLabel} adjustment`, entityLabel: null, suffix: amount };
    return { prefix: `${actor} updated earnings adjustment`, entityLabel: null, suffix: amount };
  }

  if (table === 'marketing_funding_requests') {
    const status = (data.funding_request_status ?? data.status) as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` — ${formatCurrency(data.amount)}` : '';
    return { prefix: `${actor} updated funding request${amount}`, entityLabel: null, suffix: statusLabel ? ` — ${statusLabel}` : '' };
  }

  if (table === 'ad_spend_logs') {
    const status = (data.ad_spend_status ?? data.status) as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.spend_amount ? ` — ${formatCurrency(data.spend_amount)}` : '';
    return { prefix: `${actor} updated ad spend${amount}`, entityLabel: null, suffix: statusLabel ? ` — ${statusLabel}` : '' };
  }

  if (table === 'call_logs') {
    const status = data.call_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const duration = data.duration_seconds != null ? ` (${data.duration_seconds}s)` : '';
    return { prefix: `${actor} call log — ${statusLabel}${duration}`, entityLabel: null, suffix: '' };
  }

  if (table === 'order_transfer_requests') {
    const status = (data.order_transfer_request_status ?? data.status) as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    return { prefix: `${actor} updated order transfer request — ${statusLabel}`, entityLabel: null, suffix: '' };
  }

  if (table === 'stock_reconciliations') {
    const status = data.reconciliation_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const disc = data.discrepancy != null ? ` — discrepancy ${data.discrepancy}` : '';
    return { prefix: `${actor} updated stock reconciliation${disc}`, entityLabel: null, suffix: statusLabel ? ` — ${statusLabel}` : '' };
  }

  if (table === 'approval_requests') {
    const status = (data.approval_status ?? data.status) as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` — ${formatCurrency(data.amount)}` : '';
    return { prefix: `${actor} updated approval request${amount}`, entityLabel: null, suffix: statusLabel ? ` — ${statusLabel}` : '' };
  }

  if (table === 'budgets') {
    const amount = data.total_budget ? ` — ${formatCurrency(data.total_budget)}` : '';
    return { prefix: `${actor} updated budget${amount}`, entityLabel: recordLabel, suffix: '' };
  }

  if (table === 'settlement_configs') {
    return { prefix: `${actor} updated settlement config`, entityLabel: null, suffix: '' };
  }

  if (table === 'stock_movements') {
    const qty = data.quantity ?? '';
    const moveType = data.movement_type as string | undefined;
    const typeLabel = moveType ? moveType.replace(/_/g, ' ') : '';
    return { prefix: `${actor} stock movement — ${typeLabel}`, entityLabel: null, suffix: qty ? ` ${qty} units` : '' };
  }

  if (table === 'email_change_requests') {
    const status = data.status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    return { prefix: `${actor} updated email change request`, entityLabel: null, suffix: statusLabel ? ` — ${statusLabel}` : '' };
  }

  if (table === 'user_product_assignments') {
    return { prefix: `${actor} updated user product assignment`, entityLabel: recordLabel, suffix: '' };
  }

  if (table === 'permission_requests') {
    const status = (data.permission_request_status ?? data.status) as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const typeLabel = (data.type as string) ?? '';
    return { prefix: `${actor} updated permission request — ${typeLabel}`, entityLabel: null, suffix: statusLabel ? ` — ${statusLabel}` : '' };
  }

  if (table === 'system_settings') {
    const key = data.key as string | undefined;
    return { prefix: `${actor} updated system setting`, entityLabel: key ?? null, suffix: '' };
  }

  if (table === 'cart_abandonments') {
    const status = (data.cart_status ?? data.status) as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    return { prefix: `${actor} updated cart abandonment`, entityLabel: recordLabel, suffix: statusLabel ? ` — ${statusLabel}` : '' };
  }

  if (table === 'permissions') {
    const code = data.code as string | undefined;
    return { prefix: `${actor} updated permission`, entityLabel: code ?? null, suffix: '' };
  }

  if (table === 'user_permissions') {
    return { prefix: `${actor} updated user permission`, entityLabel: recordLabel, suffix: '' };
  }

  const full = `${actor} updated ${formatTableName(table).toLowerCase()} record`;
  return { prefix: full, entityLabel: null, suffix: '' };
}

function generateDescription(
  entry: AuditEntry,
  actorNames: Record<string, { name: string; role: string }>,
): string {
  const { prefix, entityLabel, suffix } = getDescriptionParts(entry, actorNames);
  const label = entityLabel ? `"${entityLabel}"` : '';
  return prefix + label + suffix;
}

function AuditDescription({
  entry,
  actorNames,
}: {
  entry: AuditEntry;
  actorNames: Record<string, { name: string; role: string }>;
}) {
  const { prefix, entityLabel, suffix } = getDescriptionParts(entry, actorNames);
  const href = getEntityLink(entry.tableName, entry.recordId);

  if (href && entityLabel) {
    return (
      <span className="break-words whitespace-normal">
        {prefix}
        <Link
          to={href}
          className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 font-medium underline underline-offset-2"
        >
          {entityLabel}
        </Link>
        {suffix}
      </span>
    );
  }

  const label = entityLabel ? `"${entityLabel}"` : '';
  return <span className="break-words whitespace-normal">{prefix}{label}{suffix}</span>;
}

// ── Structured display for deep objects/arrays (no raw JSON) ──────

type StructuredValueProps = {
  value: unknown;
  fieldKey?: string;
  actorNames: Record<string, { name: string; role: string }>;
  depth?: number;
};

function formatLeafValue(
  key: string,
  val: unknown,
  actorNames: Record<string, { name: string; role: string }>,
): React.ReactNode {
  if (val === null || val === undefined) return <span className="text-surface-500">-</span>;
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (CURRENCY_FIELDS.has(key) && (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val))))) {
    return formatCurrency(val);
  }
  const strVal = String(val);
  if (STATUS_LABELS[strVal]) return STATUS_LABELS[strVal];
  if (ROLE_LABELS[strVal]) return ROLE_LABELS[strVal];
  if (isUUID(val) && (key.endsWith('_id') || key === 'created_by' || key === 'approved_by' || key === 'locked_by')) {
    const actor = actorNames[strVal];
    if (actor) return `${actor.name} (${ROLE_LABELS[actor.role] ?? actor.role})`;
    return `${strVal.slice(0, 8)}...`;
  }
  if (isISODate(val)) return formatDate(strVal);
  if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) return 'Uploaded file';
  return strVal;
}

const MAX_STRUCTURED_DEPTH = 10;

function StructuredValueDisplay({ value, fieldKey = '', actorNames, depth = 0 }: StructuredValueProps): React.ReactNode {
  if (depth > MAX_STRUCTURED_DEPTH) {
    return <span className="text-surface-500 italic">(nested too deep)</span>;
  }
  // Parse JSON strings
  let resolved = value;
  if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
    try {
      resolved = JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  if (resolved === null || resolved === undefined) {
    return <span className="text-surface-500">-</span>;
  }

  if (typeof resolved === 'boolean') {
    return resolved ? 'Yes' : 'No';
  }

  if (typeof resolved === 'number') {
    return CURRENCY_FIELDS.has(fieldKey) ? formatCurrency(resolved) : resolved.toLocaleString('en-NG');
  }

  if (typeof resolved === 'string') {
    return formatLeafValue(fieldKey, resolved, actorNames);
  }

  if (Array.isArray(resolved)) {
    if (resolved.length === 0) return <span className="text-surface-500">(empty)</span>;
    return (
      <ul className="list-none space-y-2 pl-0 mt-1">
        {resolved.map((item, i) => (
          <li key={i} className="flex flex-col gap-0.5 pl-3 border-l-2 border-surface-200 dark:border-surface-600">
            {item !== null && typeof item === 'object' && !Array.isArray(item) ? (
              <dl className="space-y-1 text-sm">
                {Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-2 gap-y-0.5">
                    <dt className="font-medium text-surface-600 dark:text-surface-400 shrink-0">
                      {formatFieldName(k)}:
                    </dt>
                    <dd className="text-surface-900 dark:text-surface-100">
                      {typeof v === 'object' && v !== null ? (
                        <StructuredValueDisplay value={v} fieldKey={k} actorNames={actorNames} depth={depth + 1} />
                      ) : (
                        formatLeafValue(k, v, actorNames)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="text-surface-800 dark:text-surface-200">
                {typeof item === 'object' && item !== null ? (
                  <StructuredValueDisplay value={item} fieldKey={String(i)} actorNames={actorNames} depth={depth + 1} />
                ) : (
                  formatLeafValue(String(i), item, actorNames)
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (typeof resolved === 'object') {
    const entries = Object.entries(resolved as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-surface-500">(empty)</span>;
    return (
      <dl className="space-y-1.5 text-sm mt-1">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium text-surface-600 dark:text-surface-400 text-xs uppercase tracking-wide">
              {formatFieldName(k)}
            </dt>
            <dd className="mt-0.5 pl-2 border-l-2 border-surface-100 dark:border-surface-700">
              {typeof v === 'object' && v !== null ? (
                <StructuredValueDisplay value={v} fieldKey={k} actorNames={actorNames} depth={depth + 1} />
              ) : (
                formatLeafValue(k, v, actorNames)
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return String(resolved);
}

// ── Offers display (product bundle pricing) ──────────────────────

function OffersDisplay({ value }: { value: unknown }) {
  const offers = parseOffersArray(value);
  if (offers.length === 0) return <span className="text-surface-600 dark:text-surface-400">-</span>;
  return (
    <div className="text-sm space-y-1.5 py-1">
      {offers.map((obj, i) => {
        const qty = obj.qty ?? '?';
        const label = typeof obj.label === 'string' ? obj.label : String(obj.label ?? 'Offer');
        const priceVal = obj.price;
        const price = (typeof priceVal === 'number' || (typeof priceVal === 'string' && !isNaN(Number(priceVal))))
          ? formatCurrency(priceVal)
          : String(priceVal ?? '—');
        return (
          <div key={i} className="flex flex-wrap gap-x-2 gap-y-0.5 text-surface-800 dark:text-surface-200">
            <span className="font-medium">{label}</span>
            <span className="text-surface-600 dark:text-surface-400">— {String(qty)} qty</span>
            <span className="text-success-600 dark:text-success-400 font-medium">{price}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Detail Modal ────────────────────────────────────────────────

function DetailModal({
  entry,
  actorNames,
  onClose,
  onUnknownActorClick,
  onPreviewImage,
}: {
  entry: AuditEntry;
  actorNames: Record<string, { name: string; role: string }>;
  onClose: () => void;
  onUnknownActorClick?: (changedBy: string | null, displayName: string) => void;
  onPreviewImage?: (url: string) => void;
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
      <div className="relative bg-white dark:bg-surface-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80dvh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 dark:border-surface-700 shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
              Record Detail
            </h3>
            <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
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
        <div className="px-6 py-3 bg-surface-50 dark:bg-surface-800/50 border-b border-surface-200 dark:border-surface-700 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-surface-800 dark:text-surface-200">Changed By</span>
              {actorKnown && entry.changedBy ? (
                <Link
                  to={`/hr/users/${entry.changedBy}`}
                  className="block font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 text-xs mt-0.5 underline underline-offset-2"
                >
                  {actorDisplay}
                </Link>
              ) : onUnknownActorClick ? (
                <button
                  type="button"
                  onClick={() => onUnknownActorClick(entry.changedBy, actorDisplay)}
                  className="block font-medium text-surface-600 hover:text-surface-900 dark:text-surface-200 dark:hover:text-surface-100 text-xs mt-0.5 underline underline-offset-2 cursor-pointer text-left"
                >
                  {actorDisplay}
                </button>
              ) : (
                <p className="font-medium text-surface-900 dark:text-surface-100 text-xs mt-0.5">
                  {actorDisplay}
                </p>
              )}
              {actorInfo && (
                <p className="text-xs text-surface-700 dark:text-surface-300">
                  {ROLE_LABELS[actorInfo.role] ?? actorInfo.role}
                </p>
              )}
            </div>
            <div>
              <span className="text-surface-800 dark:text-surface-200">Valid From</span>
              <p className="text-surface-900 dark:text-surface-100 text-xs mt-0.5">
                {formatDate(entry.validFrom)}
              </p>
            </div>
            <div>
              <span className="text-surface-800 dark:text-surface-200">Valid To</span>
              <p className="text-surface-900 dark:text-surface-100 text-xs mt-0.5">
                {entry.validTo ? formatDate(entry.validTo) : 'Current'}
              </p>
            </div>
          </div>
        </div>

        {/* Data fields */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
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
                  <td className="table-cell text-surface-900 dark:text-surface-100 break-words whitespace-normal min-w-0">
                    {key === 'offers' ? (
                      <OffersDisplay value={value} />
                    ) : IMAGE_URL_FIELD_KEYS.has(key) && isImageUrlValue(value) ? (
                      <AttachedFileDisplay url={value} onPreview={onPreviewImage} />
                    ) : (typeof value === 'object' && value !== null) || (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) ? (
                      <div className="py-1.5 min-w-0">
                        <StructuredValueDisplay value={value} fieldKey={key} actorNames={actorNames} />
                      </div>
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
        <span className="text-surface-700 dark:text-surface-200">Update</span>
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
      <span className="text-surface-700 dark:text-surface-200">
        Next refresh in {countdown}s
      </span>
    </span>
  );
}

// ── Time Travel Panel ───────────────────────────────────────────

function TimeTravelPanel({
  actorNames,
  onPreviewImage,
}: {
  actorNames: Record<string, { name: string; role: string }>;
  onPreviewImage?: (url: string) => void;
}) {
  const fetcher = useFetcher();
  const [ttTable, setTtTable] = useState(AUDITABLE_TABLES[0]);
  const [ttRecordId, setTtRecordId] = useState('');
  const [ttTimestamp, setTtTimestamp] = useState('');

  const fetcherData = fetcher.data as { result?: Record<string, unknown>; error?: string } | undefined;
  const ttResult = fetcherData?.result ?? null;
  const ttError = fetcherData?.error ?? '';
  const ttLoading = fetcher.state === 'submitting';
  const [dismissedTtError, setDismissedTtError] = useState(false);

  useEffect(() => {
    if (ttError) setDismissedTtError(false);
  }, [ttError]);

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">
        Time Travel
      </h2>
      <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
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
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={ttLoading || !ttRecordId || !ttTimestamp}
            loading={ttLoading}
            loadingText="Loading..."
          >
            View State
          </Button>
        </div>
      </fetcher.Form>

      {ttError && !dismissedTtError && (
        <PageNotification
          variant="error"
          message={ttError}
          durationMs={5000}
          onDismiss={() => setDismissedTtError(true)}
          className="mt-3"
        />
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
                  <td className="table-cell text-surface-900 dark:text-surface-100 break-words whitespace-normal min-w-0">
                    {key === 'offers' ? (
                      <OffersDisplay value={value} />
                    ) : IMAGE_URL_FIELD_KEYS.has(key) && isImageUrlValue(value) ? (
                      <AttachedFileDisplay url={value} onPreview={onPreviewImage} />
                    ) : (typeof value === 'object' && value !== null) || (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) ? (
                      <div className="py-1.5 min-w-0">
                        <StructuredValueDisplay value={value} fieldKey={key} actorNames={actorNames} />
                      </div>
                    ) : (
                      formatValue(key, value, actorNames)
                    )}
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
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [unknownActorModal, setUnknownActorModal] = useState<{ changedBy: string | null; displayName: string } | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);
  const { revalidate, state: revalidatorState } = useRevalidator();

  useEffect(() => {
    if (error) setDismissedError(false);
  }, [error]);

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
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-1">
            Complete history of all data changes. Every mutation is permanently recorded.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PageRefreshButton />
          <PollingStatusIndicator state={pollState} countdown={countdown} />
        </div>
      </div>

      {error && !dismissedError && (
        <PageNotification
          variant="error"
          message={error}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Filters — Actor dropdown streams in via DeferredSection */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-surface-800 dark:text-surface-200 mb-1">
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
            <label className="block text-xs font-medium text-surface-800 dark:text-surface-200 mb-1">
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
            <label className="block text-xs font-medium text-surface-800 dark:text-surface-200 mb-1">
              Date range
            </label>
            <DateFilterBar
              startDate={filters.startDate}
              endDate={filters.endDate}
              periodAllTime={filters.periodAllTime ?? false}
            />
          </div>
          {isFilterLoading && (
            <div className="flex items-end">
              <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
                <Spinner size="sm" className="shrink-0" />
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Results count + Export */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-surface-800 dark:text-surface-200">
          {total} {total === 1 ? 'entry' : 'entries'} found
        </p>
        {rows.length > 0 && (
          <DeferredSection resolve={actorNames} skeleton="inline">
            {(resolvedActorNames) => (
              <Button
                variant="secondary"
                size="sm"
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
              >
                Export CSV
              </Button>
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
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-surface-800 dark:text-surface-200">
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
                  <td className="table-cell text-xs text-surface-700 dark:text-surface-300 max-w-[180px] sm:max-w-xs md:max-w-sm break-words whitespace-normal min-w-0">
                    <DeferredSection resolve={actorNames} skeleton="inline">
                      {(resolvedActorNames) => (
                        <AuditDescription entry={entry} actorNames={resolvedActorNames} />
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
                              to={`/hr/users/${entry.changedBy}`}
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
                            className="text-surface-600 hover:text-surface-900 dark:text-surface-200 dark:hover:text-surface-100 font-medium underline underline-offset-2 cursor-pointer"
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedEntry(entry)}
                      className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 font-medium h-auto py-0"
                    >
                      View
                    </Button>
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => goToPage(filters.page - 1)}
            disabled={filters.page <= 1}
          >
            Previous
          </Button>
          <span className="text-sm text-surface-800 dark:text-surface-200">
            Page {filters.page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => goToPage(filters.page + 1)}
            disabled={filters.page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}

      {/* Time Travel Panel — uses resolved actorNames */}
      <DeferredSection resolve={actorNames} skeleton="card">
        {(resolvedActorNames) => (
          <TimeTravelPanel
            actorNames={resolvedActorNames}
            onPreviewImage={(url) => setPreviewImageUrl(url)}
          />
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
              onPreviewImage={(url) => setPreviewImageUrl(url)}
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

      {/* Image preview modal — for receipt_url, screenshot_url, image_url in audit detail */}
      {previewImageUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setPreviewImageUrl(null)}>
          <div className="fixed inset-0 bg-black/70" />
          <div className="relative max-w-2xl max-h-[90dvh] w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end mb-2">
              <button type="button" onClick={() => setPreviewImageUrl(null)} className="text-surface-100 hover:text-white p-1 rounded">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <img src={previewImageUrl} alt="Attachment" className="w-full h-auto max-h-[85dvh] object-contain rounded-lg bg-white shadow-xl" />
          </div>
        </div>
      )}
    </div>
  );
}
