import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { Link, useSearchParams, useFetcher, useRevalidator } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageNotification } from '~/components/ui/page-notification';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { formatNaira } from '~/lib/format-amount';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import { TextInput } from '~/components/ui/text-input';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import { Spinner } from '~/components/ui/spinner';
import type {
  ActorMap,
  AuditActorFilterOption,
  AuditEntry,
  AuditPageProps,
  PermissionNameMap,
} from './types';
import {
  resolveActor,
  getActorDisplay,
  isActorKnown,
  ROLE_LABELS,
  STATUS_LABELS,
  formatAuditTableName,
  getAuditSummaryParts,
  generateAuditDescription,
  getAuditDescriptionPieces,
  type AuditDescriptionPiece,
} from './audit-entry-summary';

// ── Polling config ───────────────────────────────────────────────
const POLL_INTERVAL_MS = 20_000;  // 20 seconds
const SUCCESS_FLASH_MS = 2_000;   // Green for 2 seconds after fetch

// ── Corrected list matching backend AUDITABLE_TABLES ─────────────
// Tables intentionally OMITTED (skipped 2026-05 — see audit.service.ts comment
// + migration 0119): inventory_levels, stock_batches, stock_movements,
// call_logs, cart_abandonments. These had heavy churn and zero forensic
// value beyond what stock_movements / live status already shows.
const AUDITABLE_TABLES = [
  'users', 'products', 'product_categories',
  'logistics_providers', 'logistics_locations',
  'offer_templates', 'campaigns',
  'orders', 'order_items', 'stock_transfers',
  'marketing_funding', 'marketing_funding_requests', 'ad_spend_logs',
  'invoices', 'approval_requests', 'budgets', 'settlement_configs',
  'commission_plans', 'payout_records', 'earnings_adjustments',
  'stock_reconciliations',
  'email_change_requests', 'user_product_assignments',
  'permission_requests', 'system_settings',
  'permissions', 'user_permissions',
  'mirror_sessions',
];

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
  assigned_cs_id: 'Sales Closer',
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
  permission_id: 'Permission',
  permissionId: 'Permission',
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

// ── Formatting helpers ───────────────────────────────────────────

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

function formatValue(
  key: string,
  val: unknown,
  actorNames: ActorMap,
  asOf: string,
  permissionNames: PermissionNameMap,
): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';

  if (CURRENCY_FIELDS.has(key) && (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val))))) {
    return formatCurrency(val);
  }

  const strVal = String(val);

  // Status/role enum values
  if (STATUS_LABELS[strVal]) return STATUS_LABELS[strVal];
  if (ROLE_LABELS[strVal]) return ROLE_LABELS[strVal];

  if (isUUID(val) && (key === 'permission_id' || key === 'permissionId')) {
    return permissionNames[strVal] ?? `${strVal.slice(0, 8)}...`;
  }

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

function auditPieceLinkClass(variant: 'fromLoc' | 'toLoc' | 'transfer'): string {
  switch (variant) {
    case 'fromLoc':
      return 'font-medium underline underline-offset-2 text-violet-600 hover:text-violet-800 dark:text-violet-400 dark:hover:text-violet-300';
    case 'toLoc':
      return 'font-medium underline underline-offset-2 text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300';
    case 'transfer':
      return 'font-medium underline underline-offset-2 text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300';
  }
}

function describeAuditPieces(pieces: AuditDescriptionPiece[]): ReactNode {
  return (
    <>
      {pieces.map((p, idx) =>
        p.kind === 'link' ? (
          <Link key={idx} to={p.href} className={auditPieceLinkClass(p.variant)}>
            {p.text}
          </Link>
        ) : (
          <span key={idx}>{p.text}</span>
        ),
      )}
    </>
  );
}

function stockTransferAuditRowClass(entry: AuditEntry): string {
  if (entry.tableName !== 'stock_transfers') return '';
  return 'border-l-[3px] border-l-teal-500/90 bg-teal-500/[0.06] dark:bg-teal-500/[0.09]';
}

function getEntityLink(tableName: string, recordId: string, data?: Record<string, unknown>): string | null {
  switch (tableName) {
    case 'users':
      return `/hr/users/${recordId}`;
    case 'orders':
      return `/admin/orders/${recordId}`;
    case 'products':
      return `/admin/products/${recordId}`;
    case 'stock_transfers':
      return `/admin/transfers?transferId=${encodeURIComponent(recordId)}`;
    case 'mirror_sessions': {
      // Click-through goes to the user that was mirrored, not the mirror_sessions row id.
      const targetId = data?.['target_id'];
      return typeof targetId === 'string' && targetId.length > 0 ? `/hr/users/${targetId}` : null;
    }
    default:
      return null;
  }
}

function AuditDescription({
  entry,
  actorNames,
  locationNames,
  permissionNames,
}: {
  entry: AuditEntry;
  actorNames: ActorMap;
  locationNames: Record<string, string>;
  permissionNames: PermissionNameMap;
}) {
  const warePieces = getAuditDescriptionPieces(entry, actorNames, locationNames);
  if (warePieces) {
    return <span className="break-words whitespace-normal text-app-fg">{describeAuditPieces(warePieces)}</span>;
  }

  const { prefix, entityLabel, suffix } = getAuditSummaryParts(
    entry,
    actorNames,
    locationNames,
    permissionNames,
  );
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
  permissionNames: PermissionNameMap;
  /** Audit row's `validFrom` — drives time-aware actor resolution inside the structured display. */
  asOf: string;
  depth?: number;
};

function formatLeafValue(
  key: string,
  val: unknown,
  actorNames: ActorMap,
  asOf: string,
  permissionNames: PermissionNameMap,
): React.ReactNode {
  if (val === null || val === undefined) return <span className="text-app-fg-muted">-</span>;
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (CURRENCY_FIELDS.has(key) && (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val))))) {
    return formatCurrency(val);
  }
  const strVal = String(val);
  if (STATUS_LABELS[strVal]) return STATUS_LABELS[strVal];
  if (ROLE_LABELS[strVal]) return ROLE_LABELS[strVal];
  if (isUUID(val) && (key === 'permission_id' || key === 'permissionId')) {
    return permissionNames[strVal] ?? `${strVal.slice(0, 8)}...`;
  }
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

function StructuredValueDisplay({
  value,
  fieldKey = '',
  actorNames,
  permissionNames,
  asOf,
  depth = 0,
}: StructuredValueProps): React.ReactNode {
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
    return formatLeafValue(fieldKey, resolved, actorNames, asOf, permissionNames);
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
                        <StructuredValueDisplay
                          value={v}
                          fieldKey={k}
                          actorNames={actorNames}
                          permissionNames={permissionNames}
                          asOf={asOf}
                          depth={depth + 1}
                        />
                      ) : (
                        formatLeafValue(k, v, actorNames, asOf, permissionNames)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="text-app-fg-muted">
                {typeof item === 'object' && item !== null ? (
                  <StructuredValueDisplay
                    value={item}
                    fieldKey={String(i)}
                    actorNames={actorNames}
                    permissionNames={permissionNames}
                    asOf={asOf}
                    depth={depth + 1}
                  />
                ) : (
                  formatLeafValue(String(i), item, actorNames, asOf, permissionNames)
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
                <StructuredValueDisplay
                  value={v}
                  fieldKey={k}
                  actorNames={actorNames}
                  permissionNames={permissionNames}
                  asOf={asOf}
                  depth={depth + 1}
                />
              ) : (
                formatLeafValue(k, v, actorNames, asOf, permissionNames)
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
  locationNames,
  permissionNames,
  onClose,
  onUnknownActorClick,
  onPreviewImage,
}: {
  entry: AuditEntry;
  actorNames: ActorMap;
  locationNames: Record<string, string>;
  permissionNames: PermissionNameMap;
  onClose: () => void;
  onUnknownActorClick?: (changedBy: string | null, displayName: string) => void;
  onPreviewImage?: (url: string) => void;
}) {
  const fieldRows = useMemo(
    () =>
      Object.entries(entry.data)
        .filter(([key]) => !HIDDEN_FIELDS.has(key) && key !== 'id')
        .map(([key, value]) => ({ key, value })),
    [entry.data],
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
            <p className="text-sm text-app-fg mt-1 max-w-xl leading-snug">
              {generateAuditDescription(entry, actorNames, locationNames, permissionNames)}
            </p>
            <p className="text-xs text-app-fg-muted mt-1">
              {formatAuditTableName(entry.tableName)} &middot; {entry.recordId.slice(0, 8)}...
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
          <CompactTable<{ key: string; value: unknown }>
            withCard={false}
            columns={[
              {
                key: 'field',
                header: 'Field',
                render: (r) => <span className="font-medium text-app-fg-muted">{formatFieldName(r.key)}</span>,
              },
              {
                key: 'value',
                header: 'Value',
                cellClassName: 'min-w-0',
                render: (r) => (
                  <div className="text-app-fg break-words whitespace-normal min-w-0">
                    {r.key === 'offers' ? (
                      <OffersDisplay value={r.value} />
                    ) : IMAGE_URL_FIELD_KEYS.has(r.key) && isImageUrlValue(r.value) ? (
                      <AttachedFileDisplay url={r.value} onPreview={onPreviewImage} />
                    ) : (typeof r.value === 'object' && r.value !== null) ||
                      (typeof r.value === 'string' && (r.value.startsWith('{') || r.value.startsWith('['))) ? (
                      <div className="py-1.5 min-w-0">
                        <StructuredValueDisplay
                          value={r.value}
                          fieldKey={r.key}
                          actorNames={actorNames}
                          permissionNames={permissionNames}
                          asOf={asOf}
                        />
                      </div>
                    ) : (
                      formatValue(r.key, r.value, actorNames, asOf, permissionNames)
                    )}
                  </div>
                ),
              },
            ]}
            rows={fieldRows}
            rowKey={(r) => r.key}
          />
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
  permissionNames,
  onPreviewImage,
}: {
  actorNames: ActorMap;
  permissionNames: PermissionNameMap;
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
          <SearchableSelect
            value={ttTable}
            onChange={(v) => setTtTable(v)}
            placeholder="Select table"
            searchPlaceholder="Search tables..."
            options={AUDITABLE_TABLES.map((t) => ({ value: t, label: formatAuditTableName(t) }))}
          />
          <input type="hidden" name="tableName" value={ttTable} />
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
          <CompactTable<{ key: string; value: unknown }>
            withCard={false}
            columns={[
              {
                key: 'field',
                header: 'Field',
                render: (r) => <span className="font-medium text-app-fg-muted">{formatFieldName(r.key)}</span>,
              },
              {
                key: 'value',
                header: 'Value',
                cellClassName: 'min-w-0',
                render: (r) => (
                  <div className="text-app-fg break-words whitespace-normal min-w-0">
                    {r.key === 'offers' ? (
                      <OffersDisplay value={r.value} />
                    ) : IMAGE_URL_FIELD_KEYS.has(r.key) && isImageUrlValue(r.value) ? (
                      <AttachedFileDisplay url={r.value} onPreview={onPreviewImage} />
                    ) : (typeof r.value === 'object' && r.value !== null) ||
                      (typeof r.value === 'string' && (r.value.startsWith('{') || r.value.startsWith('['))) ? (
                      <div className="py-1.5 min-w-0">
                        <StructuredValueDisplay
                          value={r.value}
                          fieldKey={r.key}
                          actorNames={actorNames}
                          permissionNames={permissionNames}
                          asOf={ttAsOf}
                        />
                      </div>
                    ) : (
                      formatValue(r.key, r.value, actorNames, ttAsOf, permissionNames)
                    )}
                  </div>
                ),
              },
            ]}
            rows={Object.entries(ttResult)
              .filter(([key]) => !HIDDEN_FIELDS.has(key))
              .map(([key, value]) => ({ key, value }))}
            rowKey={(r) => r.key}
          />
        </div>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────

export function AuditPage({
  rows,
  total,
  filters,
  actorIds,
  actorFilterOptions,
  locationNames,
  permissionNames,
  error,
  canExport = false,
}: AuditPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isFilterLoading = useLoaderRefetchBusy().busy;
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [unknownActorModal, setUnknownActorModal] = useState<{ changedBy: string | null; displayName: string } | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [dismissedError, setDismissedError] = useState(false);
  const { revalidate, state: revalidatorState } = useRevalidator();

  const actorNamesFetcher = useFetcher<
    | { ok: true; actorNames: ActorMap }
    | { ok: false; error: string; actorNames: ActorMap }
  >();
  const [actorNames, setActorNames] = useState<ActorMap>({});
  const [actorNamesError, setActorNamesError] = useState<string | null>(null);

  useEffect(() => {
    if (!actorIds || actorIds.length === 0) {
      setActorNames({});
      setActorNamesError(null);
      return;
    }
    actorNamesFetcher.submit(
      { userIdsJson: JSON.stringify(actorIds) },
      { method: 'post', action: '/api/audit-actor-names' },
    );
  }, [actorIds.join('|')]);

  useEffect(() => {
    const d = actorNamesFetcher.data;
    if (!d) return;
    if (d.ok) {
      setActorNames(d.actorNames ?? {});
      setActorNamesError(null);
      return;
    }
    setActorNames(d.actorNames ?? {});
    setActorNamesError(d.error ?? 'Failed to resolve actor names');
  }, [actorNamesFetcher.data]);

  const actorNamesLoading = actorNamesFetcher.state !== 'idle' && Object.keys(actorNames).length === 0;

  const actorPickerOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; description: string }>();

    const pushServer = (o: AuditActorFilterOption) =>
      map.set(o.id, { value: o.id, label: o.name, description: ROLE_LABELS[o.role] ?? o.role });
    actorFilterOptions.forEach(pushServer);

    for (const [id, info] of Object.entries(actorNames)) {
      if (!map.has(id)) {
        map.set(id, {
          value: id,
          label: info.nameNow,
          description: ROLE_LABELS[info.roleNow] ?? info.roleNow,
        });
      }
    }

    const selected = filters.actorId?.trim();
    if (selected && !map.has(selected)) {
      map.set(selected, {
        value: selected,
        label: `${selected.slice(0, 8)}…`,
        description: 'Not in preload list — paste UUID or widen scope',
      });
    }

    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  }, [actorFilterOptions, actorNames, filters.actorId]);

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
        mobileInlineActions
        description="Complete history of all data changes. Every mutation is permanently recorded."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Audit toolbar and date range"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime ?? false} chrome="pill" />
                <PollingStatusIndicator state={pollState} countdown={countdown} />
                {rows.length > 0 && canExport && (
                  <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                    Generate report
                  </Button>
                )}
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <div className="flex justify-center">
                  <PollingStatusIndicator state={pollState} countdown={countdown} />
                </div>
                {rows.length > 0 && canExport && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setShowExportModal(true);
                    }}
                  >
                    Generate report
                  </Button>
                )}
              </>
            )}
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime ?? false}
      />

      {error && !dismissedError && (
        <PageNotification
          variant="error"
          message={error}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Filters — Actor list is SSR-preloaded (`audit.actorFilterOptions`); names on the page
          are merged in client-side after `audit.actorNames`. */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          <SearchableSelect
            value={filters.tableName}
            onChange={(v) => updateFilter('tableName', v)}
            placeholder="All Tables"
            searchPlaceholder="Search tables..."
            options={[
              { value: '', label: 'All Tables' },
              ...AUDITABLE_TABLES.map((t) => ({ value: t, label: formatAuditTableName(t) })),
            ]}
            wrapperClassName="w-full sm:w-56"
          />
          {actorPickerOptions.length > 0 ? (
            <SearchableSelect
              id="audit-actor-filter"
              value={filters.actorId}
              onChange={(v) => updateFilter('actorId', v)}
              placeholder="All Users"
              searchPlaceholder="Search users…"
              options={actorPickerOptions}
              wrapperClassName="w-full sm:w-72"
            />
          ) : actorFilterOptions.length === 0 && actorIds.length > 0 && actorNamesLoading ? (
            <div className="flex items-center gap-2 text-xs text-app-fg-muted w-full sm:w-72 py-1">
              <Spinner className="w-4 h-4" />
              <span>Loading users…</span>
            </div>
          ) : (
            <TextInput
              type="text"
              placeholder="User UUID…"
              value={filters.actorId}
              onChange={(e) => updateFilter('actorId', e.target.value)}
              wrapperClassName="w-full sm:w-72"
            />
          )}
        </div>
        {actorNamesError ? (
          <p className="text-xs text-danger-600 dark:text-danger-400 mt-2">{actorNamesError}</p>
        ) : null}
      </div>

      <LocalExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="Export Audit Log"
        description="Choose format and columns for the current audit rows."
        filenamePrefix="audit-log"
        rows={rows.map((entry) => ({
          timestamp: formatDate(entry.validFrom),
          table: formatAuditTableName(entry.tableName),
          description: generateAuditDescription(entry, actorNames, locationNames, permissionNames),
          actor: getActorDisplay(entry.changedBy, actorNames, entry.validFrom),
          recordId: entry.recordId,
          validTo: entry.validTo ? formatDate(entry.validTo) : 'Current',
        }))}
        columns={[
          { key: 'timestamp', label: 'Timestamp' },
          { key: 'table', label: 'Table' },
          { key: 'description', label: 'Description' },
          { key: 'actor', label: 'Actor' },
          { key: 'recordId', label: 'Record ID' },
          { key: 'validTo', label: 'Valid To' },
        ]}
        defaultColumns={['timestamp', 'table', 'description', 'actor', 'recordId', 'validTo']}
      />

      {/* Results count */}
      <p className="text-sm text-app-fg-muted">
        {total} {total === 1 ? 'entry' : 'entries'} found
      </p>

      {/* Audit log table — rows render immediately, actor names stream in */}
      <TableLoadingOverlay show={isFilterLoading}>
      <div className="list-panel">
        {/* Desktop table */}
        <div className="hidden md:block">
          <CompactTable<AuditEntry>
            withCard={false}
            rows={rows}
            rowKey={(entry, idx) => `${entry.recordId}-${entry.validFrom}-${idx}`}
            rowClassName={(entry) => stockTransferAuditRowClass(entry)}
            emptyTitle="No audit entries found"
            emptyDescription="Try adjusting your filters."
            columns={[
              {
                key: 'timestamp',
                header: 'Timestamp',
                nowrap: true,
                cellClassName: 'text-xs text-app-fg-muted',
                render: (entry) => formatDate(entry.validFrom),
              },
              {
                key: 'description',
                header: 'Description',
                cellClassName:
                  'text-xs text-app-fg-muted max-w-[min(28rem,55vw)] md:max-w-xl lg:max-w-2xl break-words whitespace-normal min-w-0',
                render: (entry) =>
                  actorNamesLoading ? (
                    <span className="inline-flex items-center gap-2 text-xs text-app-fg-muted">
                      <Spinner className="w-4 h-4" />
                      <span>Loading…</span>
                    </span>
                  ) : (
                    <AuditDescription
                      entry={entry}
                      actorNames={actorNames}
                      locationNames={locationNames}
                      permissionNames={permissionNames}
                    />
                  ),
              },
              {
                key: 'actor',
                header: 'Actor',
                nowrap: true,
                cellClassName: 'text-xs text-app-fg-muted',
                render: (entry) => {
                  if (actorNamesLoading) {
                    return (
                      <span className="inline-flex items-center gap-2 text-xs text-app-fg-muted">
                        <Spinner className="w-4 h-4" />
                        <span>Loading…</span>
                      </span>
                    );
                  }
                  const display = getActorDisplay(entry.changedBy, actorNames, entry.validFrom);
                  const known = isActorKnown(entry.changedBy, actorNames);
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
                },
              },
              {
                key: 'view',
                header: 'Details',
                align: 'right',
                tight: true,
                render: (entry) => (
                  <CompactTableActionButton onClick={() => setSelectedEntry(entry)}>
                    View
                  </CompactTableActionButton>
                ),
              },
            ] satisfies CompactTableColumn<AuditEntry>[]}
          />
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3 px-1">
          {rows.length === 0 ? (
            <EmptyState title="No audit entries found" description="Try adjusting your filters." />
          ) : (
            rows.map((entry, idx) => (
              <div
                key={`${entry.recordId}-${entry.validFrom}-${idx}`}
                className={`rounded-lg border border-app-border bg-app-elevated p-4 space-y-3 ${stockTransferAuditRowClass(entry)}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-app-fg-muted">
                    {formatDate(entry.validFrom)}
                  </span>
                </div>
                <div className="text-sm text-app-fg-muted break-words min-w-0">
                  {actorNamesLoading ? (
                    <span className="inline-flex items-center gap-2 text-xs text-app-fg-muted">
                      <Spinner className="w-4 h-4" />
                      <span>Loading…</span>
                    </span>
                  ) : (
                    <AuditDescription
                      entry={entry}
                      actorNames={actorNames}
                      locationNames={locationNames}
                      permissionNames={permissionNames}
                    />
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  {(() => {
                    if (actorNamesLoading) {
                      return (
                        <span className="inline-flex items-center gap-2 text-xs text-app-fg-muted">
                          <Spinner className="w-4 h-4" />
                          <span>Loading…</span>
                        </span>
                      );
                    }
                    const display = getActorDisplay(entry.changedBy, actorNames, entry.validFrom);
                    const known = isActorKnown(entry.changedBy, actorNames);
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
                    return <div className="flex items-center gap-2 flex-wrap">{actorNode}</div>;
                  })()}
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
      <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-app-fg-muted">
          {total > 0
            ? `Showing ${(filters.page - 1) * filters.limit + 1}–${Math.min(filters.page * filters.limit, total)} of ${total} entries`
            : 'No entries'}
        </p>
        <Pagination
          page={filters.page}
          totalPages={totalPages}
          pageParam="page"
          pageSize={filters.limit}
          showWhenSinglePage
        />
      </div>

      {/* Time Travel Panel — actor names loaded post-mount */}
      <TimeTravelPanel
        actorNames={actorNames}
        permissionNames={permissionNames}
        onPreviewImage={(url) => setPreviewImageUrl(url)}
      />

      {/* Detail Modal — uses resolved actorNames */}
      {selectedEntry && (
        <DetailModal
          entry={selectedEntry}
          actorNames={actorNames}
          locationNames={locationNames}
          permissionNames={permissionNames}
          onClose={() => setSelectedEntry(null)}
          onUnknownActorClick={(changedBy, displayName) => {
            setSelectedEntry(null);
            setUnknownActorModal({ changedBy, displayName });
          }}
          onPreviewImage={(url) => setPreviewImageUrl(url)}
        />
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
