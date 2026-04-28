import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams, useFetcher, useRevalidator } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { PageNotification } from '~/components/ui/page-notification';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { formatNaira } from '~/lib/format-amount';
import { DeferredSection } from '~/components/ui/deferred-section';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageHeader } from '~/components/ui/page-header';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { TextInput } from '~/components/ui/text-input';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import type { ActorMap, AuditEntry, AuditPageProps } from './types';

/**
 * Resolve a user's name+role at a specific point in time. The audit map carries every
 * historical version of each user (newest-first); we pick the slice covering `asOf`.
 *
 * Returns `null` when the user is not in the map (unknown actor / FK to a deleted user).
 * Returns `isHistorical: true` when the matched slice is older than the current version,
 * so the UI can render "Kabir (now Admin)" instead of just "Kabir".
 */
function resolveActor(
  map: ActorMap,
  userId: string,
  asOf: string,
): { name: string; role: string; nameNow: string; roleNow: string; isHistorical: boolean } | null {
  const entry = map[userId];
  if (!entry) return null;
  for (const version of entry.history) {
    const inRange = version.validFrom <= asOf && (version.validTo === null || asOf < version.validTo);
    if (inRange) {
      const isHistorical = version.validTo !== null;
      return {
        name: version.name,
        role: version.role,
        nameNow: entry.nameNow,
        roleNow: entry.roleNow,
        isHistorical: isHistorical || version.name !== entry.nameNow || version.role !== entry.roleNow,
      };
    }
  }
  return { name: entry.nameNow, role: entry.roleNow, nameNow: entry.nameNow, roleNow: entry.roleNow, isHistorical: false };
}

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
  'call_logs',
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
  logistics_providers: 'Logistics companies',
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
          <span className="text-app-fg-muted">|</span>
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
  ADMIN: 'Admin',
  HEAD_OF_MARKETING: 'Head of Marketing',
  MEDIA_BUYER: 'Media Buyer',
  HEAD_OF_CS: 'Head of CS',
  CS_AGENT: 'CS Agent',
  FINANCE_OFFICER: 'Finance Officer',
  HEAD_OF_LOGISTICS: 'Head of Logistics',
  STOCK_MANAGER: 'Stock Manager',
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

function formatValue(key: string, val: unknown, actorNames: ActorMap, asOf: string): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';

  if (CURRENCY_FIELDS.has(key) && (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val))))) {
    return formatCurrency(val);
  }

  const strVal = String(val);

  // Status/role enum values
  if (STATUS_LABELS[strVal]) return STATUS_LABELS[strVal];
  if (ROLE_LABELS[strVal]) return ROLE_LABELS[strVal];

  // UUID fields that reference users — resolve to name AS OF the audit row's timestamp.
  // Renamed/role-changed users still render with their identity at that moment in history.
  if (isUUID(val) && (key.endsWith('_id') || key === 'created_by' || key === 'approved_by' || key === 'locked_by')) {
    const actor = resolveActor(actorNames, strVal, asOf);
    if (actor) {
      const role = ROLE_LABELS[actor.role] ?? actor.role;
      const base = `${actor.name} (${role})`;
      return actor.isHistorical ? `${base} — now ${actor.nameNow}` : base;
    }
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
  actorNames: ActorMap,
  asOf: string,
): string {
  if (!changedBy) return 'System';
  if (changedBy === EDGE_FORM_ACTOR_ID) return 'Edge Form';
  const actor = resolveActor(actorNames, changedBy, asOf);
  if (!actor) return `${changedBy.slice(0, 8)}...`;
  return actor.isHistorical ? `${actor.name} (now ${actor.nameNow})` : actor.name;
}

function isActorKnown(
  changedBy: string | null,
  actorNames: ActorMap,
): boolean {
  if (!changedBy) return false;
  return !!actorNames[changedBy];
}

/** Resolve a user-reference field (e.g. sender_id) to a display name AS OF the audit row's
 * timestamp. Returns null if unknown. */
function lookupName(
  value: unknown,
  actorNames: ActorMap,
  asOf: string,
): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const actor = resolveActor(actorNames, value, asOf);
  return actor?.name ?? null;
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
    <Modal open onClose={onClose} maxWidth="max-w-md" contentClassName="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
          <h3 className="text-lg font-semibold text-app-fg">
            Unknown Actor
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <svg className="w-5 h-5 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-app-fg-muted">
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
            <p className="text-sm text-app-fg-muted">
              <strong>Display:</strong> {displayName}
              <br />
              <strong>Actor ID:</strong> <code className="text-xs bg-app-hover px-1.5 py-0.5 rounded">{changedBy}</code>
              <br />
              The user may have been deactivated or removed from the system. Historical audit entries preserve the original actor ID for traceability.
            </p>
          )}
          {!changedBy && (
            <p className="text-sm text-app-fg-muted">
              <strong>Display:</strong> System
              <br />
              This change was performed automatically by the system (e.g. scheduled job, migration, or other background process).
            </p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-app-border">
          <Button variant="primary" className="w-full sm:w-auto" onClick={onClose}>
            Close
          </Button>
        </div>
    </Modal>
  );
}

function getEntityLink(tableName: string, recordId: string, data?: Record<string, unknown>): string | null {
  switch (tableName) {
    case 'users':
      return `/hr/users/${recordId}`;
    case 'orders':
      return `/admin/orders/${recordId}`;
    case 'products':
      return `/admin/products/${recordId}`;
    case 'mirror_sessions': {
      // Click-through goes to the user that was mirrored, not the mirror_sessions row id.
      const targetId = data?.['target_id'];
      return typeof targetId === 'string' && targetId.length > 0 ? `/hr/users/${targetId}` : null;
    }
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
  actorNames: ActorMap,
): DescriptionParts {
  const data = entry.data;
  const table = entry.tableName;
  const asOf = entry.validFrom;
  const actor = getActorDisplay(entry.changedBy, actorNames, asOf);

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
  if (table === 'mirror_sessions') {
    // Mirror sessions are surfaced inline alongside row-history entries. The "actor" is
    // the original admin (data.actor_id), the "target" is the user whose perspective they
    // viewed (data.target_id). action === 'INSERT' means active session; 'UPDATE' means
    // ended_at was just stamped (i.e. session closed).
    const targetId = (data.target_id as string | undefined) ?? null;
    const targetInfo = targetId ? resolveActor(actorNames, targetId, asOf) : null;
    const targetLabel = targetInfo?.name ?? (targetId ? `${targetId.slice(0, 8)}…` : 'user');
    const isActive = entry.action === 'INSERT';
    if (isActive) {
      return { prefix: `${actor} started mirroring `, entityLabel: targetLabel, suffix: '' };
    }
    // Ended session — try to compute duration for context
    const startedRaw = data.started_at as string | undefined;
    const endedRaw = data.ended_at as string | undefined;
    let durationLabel = '';
    if (startedRaw && endedRaw) {
      const ms = new Date(endedRaw).getTime() - new Date(startedRaw).getTime();
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      durationLabel = mins > 0 ? ` (${mins}m ${secs}s)` : ` (${secs}s)`;
    }
    return { prefix: `${actor} mirrored `, entityLabel: targetLabel, suffix: durationLabel };
  }

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
    return { prefix: `${actor} updated logistics company `, entityLabel: recordLabel, suffix: '' };
  }

  if (table === 'logistics_locations') {
    return { prefix: `${actor} updated logistics location `, entityLabel: recordLabel, suffix: '' };
  }

  if (table === 'invoices') {
    const status = data.invoice_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` for ${formatCurrency(data.amount)}` : '';
    const recipient = (data.recipient_info as { name?: string } | undefined)?.name;
    const recipientLine = recipient ? ` to ${recipient}` : '';
    const suffix = amount + recipientLine + (statusLabel ? ` — ${statusLabel}` : '');
    return { prefix: `${actor} updated invoice `, entityLabel: recordLabel, suffix };
  }

  if (table === 'marketing_funding') {
    const status = data.funding_status as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` — ${formatCurrency(data.amount)}` : '';
    const sender = lookupName(data.sender_id, actorNames, asOf);
    const receiver = lookupName(data.receiver_id, actorNames, asOf);
    const parties = sender && receiver
      ? ` (${sender} → ${receiver})`
      : sender ? ` (from ${sender})` : receiver ? ` (to ${receiver})` : '';
    if (status === 'COMPLETED') return { prefix: `${actor} confirmed funding received`, entityLabel: null, suffix: parties + amount };
    if (status === 'DISPUTED') return { prefix: `${actor} disputed funding`, entityLabel: null, suffix: parties + amount };
    const full = statusLabel ? `${actor} updated marketing funding${parties}${amount} — ${statusLabel}` : `${actor} updated marketing funding${parties}${amount}`;
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
    const staff = lookupName(data.staff_id ?? data.user_id, actorNames, asOf);
    const staffLine = staff ? ` for ${staff}` : '';
    const suffix = staffLine + amount + (statusLabel ? ` — ${statusLabel}` : '');
    return { prefix: `${actor} updated payout`, entityLabel: null, suffix };
  }

  if (table === 'earnings_adjustments') {
    const cat = data.category as string | undefined;
    const catLabel = cat ? cat.charAt(0) + cat.slice(1).toLowerCase() : '';
    const amount = data.amount ? ` of ${formatCurrency(data.amount)}` : '';
    const staff = lookupName(data.user_id ?? data.staff_id, actorNames, asOf);
    const staffLine = staff ? ` for ${staff}` : '';
    if (catLabel) return { prefix: `${actor} added ${catLabel} adjustment`, entityLabel: null, suffix: staffLine + amount };
    return { prefix: `${actor} updated earnings adjustment`, entityLabel: null, suffix: staffLine + amount };
  }

  if (table === 'marketing_funding_requests') {
    const status = (data.funding_request_status ?? data.status) as string | undefined;
    const statusLabel = status ? (STATUS_LABELS[status] ?? status) : '';
    const amount = data.amount ? ` — ${formatCurrency(data.amount)}` : '';
    const requester = lookupName(data.requester_id, actorNames, asOf);
    const requesterLine = requester ? ` from ${requester}` : '';
    return { prefix: `${actor} updated funding request${requesterLine}${amount}`, entityLabel: null, suffix: statusLabel ? ` — ${statusLabel}` : '' };
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
    const requester = lookupName(data.requester_id, actorNames, asOf);
    const approver = lookupName(data.approver_id, actorNames, asOf);
    const parties = requester && approver
      ? ` (${requester} → ${approver})`
      : requester ? ` (from ${requester})` : approver ? ` (to ${approver})` : '';
    return { prefix: `${actor} updated approval request${parties}${amount}`, entityLabel: null, suffix: statusLabel ? ` — ${statusLabel}` : '' };
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
    const requester = lookupName(data.requested_by ?? data.requester_id, actorNames, asOf);
    const approver = lookupName(data.approved_by ?? data.approver_id, actorNames, asOf);
    const parties = requester && approver
      ? ` (${requester} → ${approver})`
      : requester ? ` (from ${requester})` : '';
    return { prefix: `${actor} updated permission request${parties} — ${typeLabel}`, entityLabel: null, suffix: statusLabel ? ` — ${statusLabel}` : '' };
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
  actorNames: ActorMap,
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
  actorNames: ActorMap;
}) {
  const { prefix, entityLabel, suffix } = getDescriptionParts(entry, actorNames);
  const href = getEntityLink(entry.tableName, entry.recordId, entry.data);

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
  actorNames: ActorMap;
  /** Audit row's `validFrom` — drives time-aware actor resolution inside the structured display. */
  asOf: string;
  depth?: number;
};

function formatLeafValue(
  key: string,
  val: unknown,
  actorNames: ActorMap,
  asOf: string,
): React.ReactNode {
  if (val === null || val === undefined) return <span className="text-app-fg-muted">-</span>;
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (CURRENCY_FIELDS.has(key) && (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val))))) {
    return formatCurrency(val);
  }
  const strVal = String(val);
  if (STATUS_LABELS[strVal]) return STATUS_LABELS[strVal];
  if (ROLE_LABELS[strVal]) return ROLE_LABELS[strVal];
  if (isUUID(val) && (key.endsWith('_id') || key === 'created_by' || key === 'approved_by' || key === 'locked_by')) {
    const actor = resolveActor(actorNames, strVal, asOf);
    if (actor) {
      const role = ROLE_LABELS[actor.role] ?? actor.role;
      const label = `${actor.name} (${role})`;
      if (actor.isHistorical) return `${label} — now ${actor.nameNow}`;
      return label;
    }
    // Linkable ID keys — audit detail shows the truncated UUID that jumps straight to the record.
    // Keep the truncated visual for density; the <Link> carries the full id via the URL.
    if (key === 'product_id') {
      return (
        <Link
          to={`/admin/products/${strVal}`}
          className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
          title={strVal}
        >
          {strVal.slice(0, 8)}...
        </Link>
      );
    }
    return `${strVal.slice(0, 8)}...`;
  }
  if (isISODate(val)) return formatDate(strVal);
  if (typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'))) return 'Uploaded file';
  return strVal;
}

const MAX_STRUCTURED_DEPTH = 10;

function StructuredValueDisplay({ value, fieldKey = '', actorNames, asOf, depth = 0 }: StructuredValueProps): React.ReactNode {
  if (depth > MAX_STRUCTURED_DEPTH) {
    return <span className="text-app-fg-muted italic">(nested too deep)</span>;
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
    return <span className="text-app-fg-muted">-</span>;
  }

  if (typeof resolved === 'boolean') {
    return resolved ? 'Yes' : 'No';
  }

  if (typeof resolved === 'number') {
    return CURRENCY_FIELDS.has(fieldKey) ? formatCurrency(resolved) : resolved.toLocaleString('en-NG');
  }

  if (typeof resolved === 'string') {
    return formatLeafValue(fieldKey, resolved, actorNames, asOf);
  }

  if (Array.isArray(resolved)) {
    if (resolved.length === 0) return <span className="text-app-fg-muted">(empty)</span>;
    return (
      <ul className="list-none space-y-2 pl-0 mt-1">
        {resolved.map((item, i) => (
          <li key={i} className="flex flex-col gap-0.5 pl-3 border-l-2 border-app-border">
            {item !== null && typeof item === 'object' && !Array.isArray(item) ? (
              <dl className="space-y-1 text-sm">
                {Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                  <div key={k} className="flex flex-wrap gap-x-2 gap-y-0.5">
                    <dt className="font-medium text-app-fg-muted shrink-0">
                      {formatFieldName(k)}:
                    </dt>
                    <dd className="text-app-fg">
                      {typeof v === 'object' && v !== null ? (
                        <StructuredValueDisplay value={v} fieldKey={k} actorNames={actorNames} asOf={asOf} depth={depth + 1} />
                      ) : (
                        formatLeafValue(k, v, actorNames, asOf)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="text-app-fg-muted">
                {typeof item === 'object' && item !== null ? (
                  <StructuredValueDisplay value={item} fieldKey={String(i)} actorNames={actorNames} asOf={asOf} depth={depth + 1} />
                ) : (
                  formatLeafValue(String(i), item, actorNames, asOf)
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
    if (entries.length === 0) return <span className="text-app-fg-muted">(empty)</span>;
    return (
      <dl className="space-y-1.5 text-sm mt-1">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium text-app-fg-muted text-xs uppercase tracking-wide">
              {formatFieldName(k)}
            </dt>
            <dd className="mt-0.5 pl-2 border-l-2 border-app-border">
              {typeof v === 'object' && v !== null ? (
                <StructuredValueDisplay value={v} fieldKey={k} actorNames={actorNames} asOf={asOf} depth={depth + 1} />
              ) : (
                formatLeafValue(k, v, actorNames, asOf)
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
  if (offers.length === 0) return <span className="text-app-fg-muted">-</span>;
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
          <div key={i} className="flex flex-wrap gap-x-2 gap-y-0.5 text-app-fg-muted">
            <span className="font-medium">{label}</span>
            <span className="text-app-fg-muted">— {String(qty)} qty</span>
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
  actorNames: ActorMap;
  onClose: () => void;
  onUnknownActorClick?: (changedBy: string | null, displayName: string) => void;
  onPreviewImage?: (url: string) => void;
}) {
  const fields = Object.entries(entry.data).filter(
    ([key]) => !HIDDEN_FIELDS.has(key) && key !== 'id',
  );
  const asOf = entry.validFrom;

  const actorInfo = entry.changedBy ? resolveActor(actorNames, entry.changedBy, asOf) : null;
  const actorDisplay = getActorDisplay(entry.changedBy, actorNames, asOf);
  const actorKnown = isActorKnown(entry.changedBy, actorNames);

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl" contentClassName="p-0 max-h-[80dvh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-app-border shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-app-fg">
              Record Detail
            </h3>
            <p className="text-sm text-app-fg-muted mt-0.5">
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
        <div className="px-6 py-3 bg-app-hover border-b border-app-border shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <span className="text-app-fg-muted">Changed By</span>
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
                  className="block font-medium text-surface-600 hover:text-app-fg dark:hover:text-surface-100 text-xs mt-0.5 underline underline-offset-2 cursor-pointer text-left"
                >
                  {actorDisplay}
                </button>
              ) : (
                <p className="font-medium text-app-fg text-xs mt-0.5">
                  {actorDisplay}
                </p>
              )}
              {actorInfo && (
                <p className="text-xs text-app-fg-muted">
                  {ROLE_LABELS[actorInfo.role] ?? actorInfo.role}
                </p>
              )}
            </div>
            <div>
              <span className="text-app-fg-muted">Valid From</span>
              <p className="text-app-fg text-xs mt-0.5">
                {formatDate(entry.validFrom)}
              </p>
            </div>
            <div>
              <span className="text-app-fg-muted">Valid To</span>
              <p className="text-app-fg text-xs mt-0.5">
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
                  <td className="table-cell font-medium text-app-fg-muted">
                    {formatFieldName(key)}
                  </td>
                  <td className="table-cell text-app-fg break-words whitespace-normal min-w-0">
                    {key === 'offers' ? (
                      <OffersDisplay value={value} />
                    ) : IMAGE_URL_FIELD_KEYS.has(key) && isImageUrlValue(value) ? (
                      <AttachedFileDisplay url={value} onPreview={onPreviewImage} />
                    ) : (typeof value === 'object' && value !== null) || (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) ? (
                      <div className="py-1.5 min-w-0">
                        <StructuredValueDisplay value={value} fieldKey={key} actorNames={actorNames} asOf={asOf} />
                      </div>
                    ) : (
                      formatValue(key, value, actorNames, asOf)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    </Modal>
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
        <span className="text-app-fg-muted">Update</span>
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
      <span className="text-app-fg-muted">
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
  actorNames: ActorMap;
  onPreviewImage?: (url: string) => void;
}) {
  const fetcher = useFetcher();
  const [ttTable, setTtTable] = useState(AUDITABLE_TABLES[0]);
  const [ttRecordId, setTtRecordId] = useState('');
  const [ttTimestamp, setTtTimestamp] = useState('');
  // Time-travel resolves names/roles AS OF the user-selected timestamp. Fall back to "now" while
  // the picker is empty so initial paint doesn't crash actor resolution.
  const ttAsOf = ttTimestamp || new Date().toISOString();

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
      <h2 className="text-lg font-semibold text-app-fg mb-3">
        Time Travel
      </h2>
      <p className="text-sm text-app-fg-muted mb-4">
        View the state of any record at a specific point in time.
      </p>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="timeTravel" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <FormSelect
            name="tableName"
            value={ttTable}
            onChange={(e) => setTtTable(e.target.value)}
            options={AUDITABLE_TABLES.map((t) => ({ value: t, label: formatTableName(t) }))}
          />
          <TextInput
            name="recordId"
            type="text"
            placeholder="Record ID (UUID)"
            value={ttRecordId}
            onChange={(e) => setTtRecordId(e.target.value)}
          />
          <TextInput
            name="asOf"
            type="datetime-local"
            value={ttTimestamp}
            onChange={(e) => setTtTimestamp(e.target.value)}
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
                  <td className="table-cell font-medium text-app-fg-muted">
                    {formatFieldName(key)}
                  </td>
                  <td className="table-cell text-app-fg break-words whitespace-normal min-w-0">
                    {key === 'offers' ? (
                      <OffersDisplay value={value} />
                    ) : IMAGE_URL_FIELD_KEYS.has(key) && isImageUrlValue(value) ? (
                      <AttachedFileDisplay url={value} onPreview={onPreviewImage} />
                    ) : (typeof value === 'object' && value !== null) || (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) ? (
                      <div className="py-1.5 min-w-0">
                        <StructuredValueDisplay value={value} fieldKey={key} actorNames={actorNames} asOf={ttAsOf} />
                      </div>
                    ) : (
                      formatValue(key, value, actorNames, ttAsOf)
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
  const isFilterLoading = useLoaderRefetchBusy();
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title="Audit Trail"
        description="Complete history of all data changes. Every mutation is permanently recorded."
        actions={
          <div className="flex items-center gap-2">
            <PageRefreshButton />
            <PollingStatusIndicator state={pollState} countdown={countdown} />
          </div>
        }
      />

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
            <FormSelect
              label="Table"
              value={filters.tableName}
              onChange={(e) => updateFilter('tableName', e.target.value)}
              placeholder="All Tables"
              options={AUDITABLE_TABLES.map((t) => ({ value: t, label: formatTableName(t) }))}
            />
          </div>
          <div>
            <DeferredSection resolve={actorNames} skeleton="inline">
              {(resolvedActorNames) => {
                // Filter dropdown shows actors by their CURRENT identity — when an admin renames
                // themselves, the filter follows the new name. (Resolved-at-time only matters
                // when rendering historical rows, not when picking who to filter on now.)
                const uniqueActors = Object.entries(resolvedActorNames).map(([id, info]) => ({
                  id,
                  name: info.nameNow,
                  role: info.roleNow,
                }));
                return uniqueActors.length > 0 ? (
                  <SearchableSelect
                    id="audit-actor-filter"
                    label="Actor"
                    value={filters.actorId}
                    onChange={(v) => updateFilter('actorId', v)}
                    placeholder="All Users"
                    searchPlaceholder="Search users..."
                    options={uniqueActors.map((a) => ({
                      value: a.id,
                      label: a.name,
                      description: ROLE_LABELS[a.role] ?? a.role,
                    }))}
                  />
                ) : (
                  <TextInput
                    label="Actor"
                    type="text"
                    placeholder="User UUID..."
                    value={filters.actorId}
                    onChange={(e) => updateFilter('actorId', e.target.value)}
                  />
                );
              }}
            </DeferredSection>
          </div>
          <div>
            <label className="block text-xs font-medium text-app-fg-muted mb-1">
              Date range
            </label>
            <DateFilterBar
              startDate={filters.startDate}
              endDate={filters.endDate}
              periodAllTime={filters.periodAllTime ?? false}
            />
          </div>
        </div>
      </div>

      <DeferredSection resolve={actorNames} skeleton="inline">
        {(resolvedActorNames) => (
          <LocalExportModal
            open={showExportModal}
            onClose={() => setShowExportModal(false)}
            title="Export Audit Log"
            description="Choose format and columns for the current audit rows."
            filenamePrefix="audit-log"
            rows={rows.map((entry) => ({
              timestamp: formatDate(entry.validFrom),
              table: formatTableName(entry.tableName),
              description: generateDescription(entry, resolvedActorNames),
              actor: getActorDisplay(entry.changedBy, resolvedActorNames, entry.validFrom),
              action: entry.action,
              recordId: entry.recordId,
              validTo: entry.validTo ? formatDate(entry.validTo) : 'Current',
            }))}
            columns={[
              { key: 'timestamp', label: 'Timestamp' },
              { key: 'table', label: 'Table' },
              { key: 'description', label: 'Description' },
              { key: 'actor', label: 'Actor' },
              { key: 'action', label: 'Action' },
              { key: 'recordId', label: 'Record ID' },
              { key: 'validTo', label: 'Valid To' },
            ]}
            defaultColumns={['timestamp', 'table', 'description', 'actor', 'action', 'recordId', 'validTo']}
          />
        )}
      </DeferredSection>

      {/* Results count + Export */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-app-fg-muted">
          {total} {total === 1 ? 'entry' : 'entries'} found
        </p>
        {rows.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
            Generate report
          </Button>
        )}
      </div>

      {/* Audit log table — rows render immediately, actor names stream in */}
      <TableLoadingOverlay show={isFilterLoading}>
      <div className="card p-0">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Timestamp</th>
                <th className="table-header">Description</th>
                <th className="table-header">Actor</th>
                <th className="table-header">Action</th>
                <th className="table-header text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6}><EmptyState title="No audit entries found" description="Try adjusting your filters." /></td>
                </tr>
              )}
              {rows.map((entry, idx) => (
                <tr key={`${entry.recordId}-${entry.validFrom}-${idx}`} className="table-row">
                  <td className="table-cell text-xs text-app-fg-muted whitespace-nowrap">
                    {formatDate(entry.validFrom)}
                  </td>
                  <td className="table-cell text-xs text-app-fg-muted max-w-[180px] sm:max-w-xs md:max-w-sm break-words whitespace-normal min-w-0">
                    <DeferredSection resolve={actorNames} skeleton="inline">
                      {(resolvedActorNames) => (
                        <AuditDescription entry={entry} actorNames={resolvedActorNames} />
                      )}
                    </DeferredSection>
                  </td>
                  <td className="table-cell text-xs text-app-fg-muted whitespace-nowrap">
                    <DeferredSection resolve={actorNames} skeleton="inline">
                      {(resolvedActorNames) => {
                        const display = getActorDisplay(entry.changedBy, resolvedActorNames, entry.validFrom);
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
                            className="text-surface-600 hover:text-app-fg dark:hover:text-surface-100 font-medium underline underline-offset-2 cursor-pointer"
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

        {/* Mobile cards */}
        <div className="md:hidden space-y-3 px-1">
          {rows.length === 0 ? (
            <EmptyState title="No audit entries found" description="Try adjusting your filters." />
          ) : (
            rows.map((entry, idx) => (
              <div
                key={`${entry.recordId}-${entry.validFrom}-${idx}`}
                className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-app-fg-muted">
                    {formatDate(entry.validFrom)}
                  </span>
                </div>
                <div className="text-sm text-app-fg-muted break-words min-w-0">
                  <DeferredSection resolve={actorNames} skeleton="inline">
                    {(resolvedActorNames) => (
                      <AuditDescription entry={entry} actorNames={resolvedActorNames} />
                    )}
                  </DeferredSection>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <DeferredSection resolve={actorNames} skeleton="inline">
                    {(resolvedActorNames) => {
                      const display = getActorDisplay(entry.changedBy, resolvedActorNames, entry.validFrom);
                      const known = isActorKnown(entry.changedBy, resolvedActorNames);
                      const actorNode = known && entry.changedBy ? (
                        <Link
                          to={`/hr/users/${entry.changedBy}`}
                          className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 font-medium underline underline-offset-2 text-sm"
                        >
                          {display}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setUnknownActorModal({ changedBy: entry.changedBy, displayName: display })}
                          className="text-surface-600 hover:text-app-fg dark:hover:text-surface-100 font-medium underline underline-offset-2 cursor-pointer text-sm"
                        >
                          {display}
                        </button>
                      );
                      return (
                        <div className="flex items-center gap-2 flex-wrap">
                          {actorNode}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                            entry.action === 'INSERT'
                              ? 'bg-success-50 dark:bg-success-700/20 text-success-700 dark:text-success-500'
                              : entry.action === 'DELETE'
                              ? 'bg-danger-50 dark:bg-danger-700/20 text-danger-700 dark:text-danger-500'
                              : 'bg-warning-50 dark:bg-warning-700/20 text-warning-700 dark:text-warning-500'
                          }`}>
                            {entry.action === 'INSERT' ? 'Created' : entry.action === 'DELETE' ? 'Deleted' : 'Updated'}
                          </span>
                        </div>
                      );
                    }}
                  </DeferredSection>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedEntry(entry)}
                    className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 font-medium h-auto py-0 shrink-0"
                  >
                    View
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      </TableLoadingOverlay>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination page={filters.page} totalPages={totalPages} pageParam="page" />
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
        <Modal open onClose={() => setPreviewImageUrl(null)} maxWidth="max-w-2xl" contentClassName="p-0 bg-transparent shadow-none max-h-[90dvh]">
          <div className="flex justify-end mb-2">
            <button type="button" onClick={() => setPreviewImageUrl(null)} className="text-surface-100 hover:text-white p-1 rounded">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <img src={previewImageUrl} alt="Attachment" className="w-full h-auto max-h-[85dvh] object-contain rounded-lg bg-white shadow-xl" />
        </Modal>
      )}
    </div>
  );
}
