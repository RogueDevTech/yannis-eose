import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { Link, useFetcher, useNavigate, useRevalidator, useSearchParams } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { InlineNotification } from '~/components/ui/inline-notification';
import { DeferredSection } from '~/components/ui/deferred-section';
import { EmptyState } from '~/components/ui/empty-state';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useAgentStateBroadcast } from '~/hooks/useSocket';
import { formatNaira } from '~/lib/format-amount';
import { formatOrderTimestamp } from '~/lib/format-date';
import { NairaPrice } from '~/components/ui/naira-price';

const OrderTimeline = lazy(() =>
  import('~/components/ui/order-timeline').then((m) => ({ default: m.OrderTimeline })),
);
const InvoicePreviewModal = lazy(() =>
  import('~/components/ui/invoice-preview-modal').then((m) => ({ default: m.InvoicePreviewModal })),
);
const DuplicateComparisonModal = lazy(() =>
  import('~/features/orders/DuplicateComparisonModal').then((m) => ({ default: m.DuplicateComparisonModal })),
);
import { CSMessagingPanel } from '~/components/ui/cs-messaging-panel';
import { FileUpload } from '~/components/ui/file-upload';
import { FormSelect } from '~/components/ui/form-select';
import { NumberInput } from '~/components/ui/number-input';
import { AmountInput } from '~/components/ui/amount-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { ASSET_FOLDERS } from '~/lib/object-storage';
import { shareOrderToLogistics, fetchOrderClipboardSummary } from '~/lib/trpc-browser';
import { canonicalPermissionCode } from '~/lib/permission-codes';
import { hasFinanceAccess, isAdminLevel, isOrgWideDepartmentHead } from '~/lib/rbac';
import { useBranchScopeActionGuard } from '~/contexts/branch-scope-action-guard';
import { STATUS_LABELS, formatStatus } from '~/features/shared/order-status';
import { ordersListPathForDetailFrom } from '~/lib/order-detail-return';
import type { CallLogEntry, TimelineEvent, OrderDetail, OrderDetailStreamData, OrderDetailPageExtraProps, OrderInvoice } from './types';

/** Matches `orders.scheduleCallback` / Remix action validation (minutes). */
const CALLBACK_DELAY_MIN_MINUTES = 5;
const CALLBACK_DELAY_MAX_MINUTES = 10080;

type CallbackCustomDelayUnit = 'minutes' | 'hours' | 'days';

function callbackCustomUnitMultiplier(unit: CallbackCustomDelayUnit): number {
  if (unit === 'minutes') return 1;
  if (unit === 'hours') return 60;
  return 1440;
}

function InvoiceCardSkeleton() {
  return (
    <div className="rounded-xl border border-app-border bg-app-elevated p-5 shadow-sm animate-pulse space-y-4" aria-hidden>
      <div className="h-3 w-28 rounded bg-app-hover" />
      <div className="h-7 w-44 rounded bg-app-hover font-mono" />
      <div className="h-4 w-56 rounded bg-app-hover" />
      <div className="flex flex-wrap gap-2 justify-end pt-2">
        <div className="h-8 w-24 rounded-lg bg-app-hover" />
        <div className="h-8 w-16 rounded-lg bg-app-hover" />
      </div>
    </div>
  );
}

function OrderTimelineSkeleton() {
  return (
    <div className="space-y-4 py-1 animate-pulse" aria-hidden>
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 items-start">
          <div className="h-2 w-2 rounded-full bg-app-hover mt-1.5 shrink-0" />
          <div className="flex-1 space-y-2 min-w-0">
            <div className="h-4 w-full max-w-lg rounded bg-app-hover" />
            <div className="h-3 w-36 rounded bg-app-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DeferredPanelError({ label }: { label: string }) {
  const { revalidate, state } = useRevalidator();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-danger-200/70 dark:border-danger-800/60 bg-danger-50/60 dark:bg-danger-900/10 px-3 py-2">
      <div className="flex items-center gap-2 text-danger-700 dark:text-danger-300">
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <span className="text-xs font-medium">Failed to load {label}.</span>
      </div>
      <button
        type="button"
        onClick={() => revalidate()}
        disabled={state === 'loading'}
        className="text-xs font-medium text-danger-700 dark:text-danger-300 hover:underline disabled:opacity-50"
      >
        {state === 'loading' ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

function canCopyOrderSummaryForChat(
  userRole: string,
  currentBranchId: string | null | undefined,
  order: OrderDetail,
): boolean {
  if (
    ['CS_CLOSER', 'HEAD_OF_CS', 'HEAD_OF_LOGISTICS', 'LOGISTICS_MANAGER', 'TPL_MANAGER'].includes(userRole)
  ) {
    return true;
  }
  if (isAdminLevel({ role: userRole })) return true;
  return (
    userRole === 'BRANCH_ADMIN' &&
    !!order.branchId &&
    !!currentBranchId &&
    order.branchId === currentBranchId
  );
}

/** After allocation: roles that can copy may still need the summary on delivered / settled orders. */
const ORDER_STATUSES_LOGISTICS_SUMMARY_COPY = new Set<string>([
  'CONFIRMED',
  'AGENT_ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'REMITTED',
]);

type AllocatableLocationDescriptor = {
  address: string | null;
  eligible: boolean;
  reason: string | null;
  availabilityByProduct: Array<{
    productId: string;
    productName: string;
    needed: number;
    available: number;
  }> | null;
  stockBandByProduct?: Array<{
    productId: string;
    productName: string;
    band: 'ABOVE_THRESHOLD' | 'BELOW_THRESHOLD';
  }> | null;
};

// Builds the row description for an entry in the allocate-location dropdown.
// When the API returns availability per product (HoCS, HoLogistics, admins,
// LogisticsManager, TPL_MANAGER, etc.), surface "Product: N available" so the
// allocator can pick the right hub without leaving the modal. CS_CLOSERs receive
// `availabilityByProduct: null` from the API and just see the address —
// remaining-stock numbers are intentionally hidden from them.
function describeAllocatableLocation(loc: AllocatableLocationDescriptor): string | undefined {
  if (!loc.eligible) return loc.reason ?? 'Unavailable';
  if (loc.availabilityByProduct && loc.availabilityByProduct.length > 0) {
    return loc.availabilityByProduct
      .map((p) => `${p.productName}: ${p.available} available`)
      .join(' \u00b7 ');
  }
  if (loc.stockBandByProduct && loc.stockBandByProduct.length > 0) {
    return loc.stockBandByProduct
      .map((p) => `${p.productName}: ${p.band === 'ABOVE_THRESHOLD' ? 'Above 50' : 'Below 50'}`)
      .join(' \u00b7 ');
  }
  return loc.address ?? undefined;
}

// ── Constants ────────────────────────────────────────────────────

/**
 * "Order Progress" stepper visible to logistics-side viewers (HEAD_OF_LOGISTICS,
 * LOGISTICS_MANAGER, STOCK_MANAGER, TPL_MANAGER, TPL_RIDER). They need the
 * `AGENT_ASSIGNED` step because that's their actionable handoff. `DISPATCHED`
 * / `IN_TRANSIT` collapse into it (sub-stages happen offline).
 */
const STATUS_FLOW_LOGISTICS = [
  'UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED',
  'DELIVERED', 'REMITTED',
] as const;

/**
 * "Order Progress" stepper when the viewer should see the finance milestone: drops
 * `AGENT_ASSIGNED`, keeps `REMITTED` (cash remittance / COD close-out).
 */
const STATUS_FLOW_STANDARD = [
  'UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'DELIVERED', 'REMITTED',
] as const;

/**
 * Default stepper for order detail — ends at **Delivered** (no `REMITTED`, no
 * `AGENT_ASSIGNED`). Used for CS, marketing, branch ops, HR, etc. unless the viewer
 * is logistics-side or has finance / cash-remittance capabilities.
 */
const STATUS_FLOW_CS = [
  'UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'DELIVERED',
] as const;

/** Logistics-side roles that need the AGENT_ASSIGNED step on the stepper. */
const LOGISTICS_VIEWER_ROLES = new Set([
  'HEAD_OF_LOGISTICS',
  'LOGISTICS_MANAGER',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
]);

/** CS / HoCS assign to external 3PL; internal warehouse hubs stay on logistics surfaces. */
function filterAllocatableLocationsForOrderHandoff<
  T extends { providerKind?: string | null },
>(rows: T[], mayIncludeInternalWarehouses: boolean): T[] {
  if (mayIncludeInternalWarehouses) return rows;
  return rows.filter((l) => (l.providerKind ?? 'THIRD_PARTY') !== 'WAREHOUSE');
}

// Everything between ALLOCATED and DELIVERED happens offline (rider with the
// parcel). DISPATCHED + IN_TRANSIT therefore collapse — for the full flow
// they fold into the AGENT_ASSIGNED step; for the CS flow they fold into
// CONFIRMED (CS already finished their part by then).
function getProgressIndex(status: string, flow: readonly string[]): number {
  if (status === 'DISPATCHED' || status === 'IN_TRANSIT' || status === 'AGENT_ASSIGNED') {
    const allocated = flow.indexOf('AGENT_ASSIGNED');
    if (allocated !== -1) return allocated;
    // CS flow has no AGENT_ASSIGNED — pin to CONFIRMED so the stepper shows
    // CS finished their work; the rider's pickup is "downstream" of the strip.
    return flow.indexOf('CONFIRMED');
  }
  // CS flow doesn't render REMITTED — if the order is in that state, show
  // the stepper as fully delivered (final visible step lit).
  if (status === 'REMITTED' && !flow.includes('REMITTED')) {
    return flow.indexOf('DELIVERED');
  }
  return flow.indexOf(status);
}

/** ISO `YYYY-MM-DD` from confirm modal → readable label (no timezone shift). */
function formatScheduleDateDisplay(value: string | null | undefined): string {
  const s = value?.trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(`${s}T12:00:00`).toLocaleDateString('en-NG', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  return s;
}

const CALL_STATUS_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  INITIATED: { bg: 'bg-info-50 dark:bg-info-700/20', text: 'text-info-600 dark:text-info-400', icon: 'text-info-500' },
  RINGING: { bg: 'bg-warning-50 dark:bg-warning-700/20', text: 'text-warning-600 dark:text-warning-400', icon: 'text-warning-500' },
  IN_PROGRESS: { bg: 'bg-brand-50 dark:bg-brand-700/20', text: 'text-brand-600 dark:text-brand-400', icon: 'text-brand-500' },
  COMPLETED: { bg: 'bg-success-50 dark:bg-success-700/20', text: 'text-success-600 dark:text-success-400', icon: 'text-success-500' },
  FAILED: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-600 dark:text-danger-400', icon: 'text-danger-500' },
  NO_ANSWER: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-600 dark:text-danger-400', icon: 'text-danger-500' },
  BUSY: { bg: 'bg-warning-50 dark:bg-warning-700/20', text: 'text-warning-600 dark:text-warning-400', icon: 'text-warning-500' },
};

// ── Order Details field config (dynamic, show-only when value present or alwaysShow) ──

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/** Value styling: static class or function for payment/status-dependent colors */
type DetailValueClass = string | ((value: unknown, order: OrderDetail) => string);

interface DetailFieldConfig {
  label: string;
  alwaysShow?: boolean;
  /** When true, hide this row once the order is confirmed — shown prominently under Order Progress instead */
  suppressAfterConfirm?: boolean;
  getValue: (order: OrderDetail) => unknown;
  format: (value: unknown, order: OrderDetail) => string;
  ddClassName?: DetailValueClass;
  /** Optional: accent border on the row (e.g. 'border-l-4 border-l-success-500') */
  rowAccent?: string;
}

const DETAIL_DATE_CLASS = 'text-app-fg-muted tabular-nums';
const DETAIL_CURRENCY_CLASS = 'font-semibold text-success-600 dark:text-success-400 tabular-nums';
const DETAIL_PERSON_CLASS = 'font-medium text-brand-600 dark:text-brand-400';
const DETAIL_ID_CLASS = 'font-mono text-xs text-app-fg-muted break-all';

const ORDER_DETAIL_FIELDS: DetailFieldConfig[] = [
  {
    label: 'Payment',
    alwaysShow: true,
    getValue: (o) => o.paymentMethod,
    format: (_, o) =>
      o.paymentMethod === 'PAY_ONLINE'
        ? `Pay online${o.paymentStatus ? ` — ${o.paymentStatus}` : ''}${o.paymentReference ? ` (ref: ${o.paymentReference})` : ''}`
        : 'Pay on delivery',
    ddClassName: (_, o) => {
      if (o.paymentMethod === 'PAY_ON_DELIVERY') return 'font-medium text-success-600 dark:text-success-400';
      const s = (o.paymentStatus ?? '').toUpperCase();
      if (s === 'PAID') return 'font-medium text-success-600 dark:text-success-400';
      if (s === 'PENDING') return 'font-medium text-warning-600 dark:text-warning-400';
      if (s === 'FAILED') return 'font-medium text-danger-600 dark:text-danger-400';
      return 'font-medium text-app-fg-muted';
    },
    rowAccent: 'border-l-4 border-l-surface-200 dark:border-l-surface-700',
  },
  {
    label: 'Created',
    alwaysShow: true,
    getValue: (o) => o.createdAt,
    format: (v) => (v ? formatOrderTimestamp(String(v)) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Confirmed',
    getValue: (o) => o.confirmedAt,
    format: (v) => (v ? formatOrderTimestamp(String(v)) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Agent assigned',
    getValue: (o) => o.allocatedAt,
    format: (v) => (v ? formatOrderTimestamp(String(v)) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Dispatched',
    getValue: (o) => o.dispatchedAt,
    format: (v) => (v ? formatOrderTimestamp(String(v)) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Delivered',
    getValue: (o) => o.deliveredAt,
    format: (v) => (v ? formatOrderTimestamp(String(v)) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Schedule date',
    getValue: (o) => o.preferredDeliveryDate,
    format: (v) => (v ? formatScheduleDateDisplay(String(v)) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Customer Address',
    getValue: (o) => o.customerAddress,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Delivery Address',
    alwaysShow: true,
    getValue: (o) => o.deliveryAddress,
    format: (v) => (v ? String(v) : '—'),
  },
  {
    label: 'Delivery Notes',
    getValue: (o) => o.deliveryNotes,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Delivery State',
    alwaysShow: true,
    getValue: (o) => o.deliveryState,
    format: (v) => (v ? String(v) : '—'),
  },
  {
    label: 'Customer Email',
    getValue: (o) => o.customerEmail,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Callback scheduled',
    getValue: (o) => o.callbackScheduledAt,
    format: (v) => (v ? formatOrderTimestamp(String(v)) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Callback attempts',
    getValue: (o) => o.callbackAttempts,
    format: (v) => (v != null && v !== '' ? String(v) : ''),
    ddClassName: (v) =>
      Number(v) > 0
        ? 'font-medium text-warning-600 dark:text-warning-400 tabular-nums'
        : 'text-app-fg-muted tabular-nums',
  },
  {
    label: 'Callback notes',
    getValue: (o) => o.callbackNotes,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Duplicate status',
    getValue: (o) => o.isDuplicate,
    format: (v) => (v ? String(v) : ''),
    ddClassName: (v) => {
      const s = String(v ?? '').toUpperCase();
      if (s === 'FLAGGED') return 'font-medium text-warning-600 dark:text-warning-400';
      if (s === 'MERGED' || s === 'DISMISSED') return 'text-app-fg-muted';
      return '';
    },
  },
  {
    label: 'Duplicate of',
    getValue: (o) => o.duplicateOfId,
    format: (v) => (v ? String(v).slice(0, 8).toUpperCase() : ''),
    ddClassName: 'font-mono text-xs text-app-fg-muted',
  },
  {
    label: 'Locked until',
    getValue: (o) => o.lockedUntil,
    format: (v) => (v ? formatOrderTimestamp(String(v)) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Locked by',
    getValue: (o) => o.lockedByName ?? o.lockedBy,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_PERSON_CLASS,
  },
  {
    label: 'Total amount',
    getValue: (o) => o.totalAmount,
    format: (v) => (v != null && v !== '' ? formatNaira(Number(v)) : ''),
    ddClassName: DETAIL_CURRENCY_CLASS,
    rowAccent: 'border-l-4 border-l-success-200 dark:border-l-success-900/40',
  },
  {
    label: 'Landed cost',
    getValue: (o) => o.landedCost,
    format: (v) => (v != null && v !== '' ? formatNaira(Number(v)) : ''),
    ddClassName: DETAIL_CURRENCY_CLASS,
  },
  {
    label: 'Delivery fee',
    getValue: (o) => o.deliveryFee,
    format: (v) => (v != null && v !== '' ? formatNaira(Number(v)) : ''),
    ddClassName: DETAIL_CURRENCY_CLASS,
  },
  {
    label: 'Assigned to (CS)',
    getValue: (o) => o.assignedCsName ?? o.assignedCsId,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_PERSON_CLASS,
  },
  {
    label: 'Media buyer',
    getValue: (o) => o.mediaBuyerName ?? o.mediaBuyerId,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_PERSON_CLASS,
  },
  {
    label: 'Campaign',
    getValue: (o) => o.campaignName ?? o.campaignId,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_PERSON_CLASS,
  },
  {
    label: 'Logistics company',
    getValue: (o) => o.logisticsProviderName ?? o.logisticsProviderId,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_PERSON_CLASS,
  },
  {
    label: 'Logistics location',
    getValue: (o) => o.logisticsLocationName ?? o.logisticsLocationId,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_PERSON_CLASS,
  },
  {
    label: 'Rider',
    getValue: (o) => o.riderName ?? o.riderId,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_PERSON_CLASS,
  },
  {
    label: 'Parent order',
    getValue: (o) => o.parentOrderId,
    format: (v) => (v ? String(v) : ''),
    ddClassName: 'font-mono text-xs text-app-fg-muted break-all',
  },
  {
    label: 'Delivery OTP',
    getValue: (o) => o.deliveryOtp,
    format: (v) => (v ? String(v) : ''),
    ddClassName: 'font-mono text-sm text-app-fg-muted',
  },
  {
    label: 'Customer gender',
    getValue: (o) => o.customerGender,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Updated',
    getValue: (o) => o.updatedAt,
    format: (v) => (v ? formatOrderTimestamp(String(v)) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Order No',
    alwaysShow: true,
    getValue: (o) => (o.orderNumber != null ? `YNS-${String(o.orderNumber).padStart(5, '0')}` : o.id),
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_ID_CLASS,
    rowAccent: 'border-l-4 border-l-surface-200 dark:border-l-surface-700',
  },
  {
    label: 'Order ID',
    alwaysShow: true,
    getValue: (o) => o.id,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_ID_CLASS,
  },
];

/** Number of detail rows visible before "Show more" */
const DETAIL_PREVIEW_COUNT = 4;

function DetailFieldRow({ field, order }: { field: DetailFieldConfig; order: OrderDetail }) {
  const value = field.getValue(order);
  const formatted = field.format(value, order);
  const valueClass =
    typeof field.ddClassName === 'function'
      ? field.ddClassName(value, order)
      : field.ddClassName ?? '';
  const ddClass = ['mt-0.5 break-words', valueClass || 'text-app-fg'].filter(Boolean).join(' ');
  const rowClass = ['min-w-0 pl-3 py-1.5 rounded-r-md -ml-px', field.rowAccent ?? ''].filter(Boolean).join(' ');
  return (
    <div className={rowClass}>
      <dt className="text-app-fg-muted text-xs font-medium uppercase tracking-wider">{field.label}</dt>
      <dd className={ddClass}>{formatted}</dd>
    </div>
  );
}

function OrderDetailsCard({ order }: { order: OrderDetail }) {
  const [expanded, setExpanded] = useState(false);

  // Filter to only visible fields
  const visibleFields = ORDER_DETAIL_FIELDS.filter((field) => {
    if (field.suppressAfterConfirm && order.confirmedAt) return false;
    const value = field.getValue(order);
    if (!field.alwaysShow && !hasValue(value)) return false;
    return true;
  });

  const previewFields = visibleFields.slice(0, DETAIL_PREVIEW_COUNT);
  const overflowFields = visibleFields.slice(DETAIL_PREVIEW_COUNT);
  const hasOverflow = overflowFields.length > 0;

  return (
    <div className="card">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => hasOverflow && setExpanded((p) => !p)}
        aria-expanded={expanded}
      >
        <h2 className="text-lg font-semibold text-app-fg">Details</h2>
        {hasOverflow && (
          <span className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400">
            {expanded ? 'Show less' : `+${overflowFields.length} more`}
            <svg
              className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        )}
      </button>

      <dl className="mt-3 space-y-2.5 text-sm">
        {previewFields.map((field) => (
          <DetailFieldRow key={field.label} field={field} order={order} />
        ))}

        {hasOverflow && expanded && overflowFields.map((field) => (
          <DetailFieldRow key={field.label} field={field} order={order} />
        ))}
      </dl>
    </div>
  );
}

// ── Call Status Indicator Component ─────────────────────────────

function CallStatusIndicator({ call }: { call: CallLogEntry }) {
  const fallback = { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-600 dark:text-danger-400', icon: 'text-danger-500' };
  const colors = CALL_STATUS_COLORS[call.callStatus] ?? fallback;
  const isActive = ['INITIATED', 'RINGING', 'IN_PROGRESS'].includes(call.callStatus);

  return (
    <div className={`rounded-lg border p-3 ${colors.bg} border-current/10`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Phone icon */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${colors.bg}`}>
            <svg className={`w-4 h-4 ${colors.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
            </svg>
          </div>
          <div>
            <p className={`text-sm font-medium ${colors.text}`}>
              {call.callStatus === 'INITIATED' && 'Connecting...'}
              {call.callStatus === 'RINGING' && 'Ringing...'}
              {call.callStatus === 'IN_PROGRESS' && 'Call in progress'}
              {call.callStatus === 'COMPLETED' && 'Call completed'}
              {call.callStatus === 'FAILED' && 'Call failed'}
              {call.callStatus === 'NO_ANSWER' && 'No answer'}
              {call.callStatus === 'BUSY' && 'Line busy'}
            </p>
            {call.durationSeconds != null && call.durationSeconds > 0 && (
              <p className="text-xs text-app-fg-muted">
                Duration: {call.durationSeconds}s
                {call.durationSeconds >= 15 && (
                  <span className="ml-1 text-success-600 dark:text-success-400 font-medium">
                    (Confirm gate met)
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
        {isActive && (
          <div className="flex items-center gap-1">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                call.callStatus === 'IN_PROGRESS' ? 'bg-brand-400' : 'bg-warning-400'
              }`} />
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                call.callStatus === 'IN_PROGRESS' ? 'bg-brand-500' : 'bg-warning-500'
              }`} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── In-Call Overlay ──────────────────────────────────────────────

function formatCallTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ── VOIP Call Panel (Africa's Talking phone-bridge) ────────────

function VoipCallPanel({
  order,
  latestCall,
  canConfirm,
  fetcher,
  hasActiveCall,
  onOpenCallModal,
  voipProviderDisplayName = "Africa's Talking",
}: {
  order: OrderDetailStreamData['order'];
  latestCall: CallLogEntry | null;
  canConfirm: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  hasActiveCall: boolean;
  onOpenCallModal?: () => void;
  /** Display name kept as a prop so future provider work can swap brands without touching the panel. */
  voipProviderDisplayName?: string;
}) {
  const canShowCallPanel = order.status === 'CS_ENGAGED' || order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED';
  if (!canShowCallPanel) return null;

  // With phone-to-phone bridging, the conversation happens on the agent's physical phone —
  // no in-browser softphone overlay. We just show a status indicator while the call is active.
  const isServerCallActive = latestCall && ['INITIATED', 'RINGING', 'IN_PROGRESS'].includes(latestCall.callStatus);

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-app-fg">VOIP Call</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-success-50 dark:bg-success-700/20 px-2 py-0.5 text-2xs font-medium text-success-700 dark:text-success-400">
          {voipProviderDisplayName}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-info-50 dark:bg-info-700/20 px-1.5 py-0.5 text-2xs font-medium text-info-700 dark:text-info-400">
          Phone bridge
        </span>
      </div>

      {/* Sets the agent's expectation about WHERE the call rings — the agent's physical phone,
          not the browser. Always shown so first-time users immediately know what to expect. */}
      <div className="mb-3 rounded-md bg-info-50 dark:bg-info-900/20 border border-info-200 dark:border-info-800/50 px-3 py-2 text-xs text-info-700 dark:text-info-300">
        <p>
          <strong>Click Call</strong> — {voipProviderDisplayName} will ring your phone first, then
          bridge you to the customer. Make sure your phone number is set in your profile and
          keep it nearby.
        </p>
      </div>

      {/* Active-call status indicator — shown while the call is INITIATED/RINGING/IN_PROGRESS. */}
      {isServerCallActive && latestCall && (
        <div className="mb-3">
          <CallStatusIndicator call={latestCall} />
        </div>
      )}

      {/* Last completed call summary */}
      {latestCall && !isServerCallActive && latestCall.callStatus === 'COMPLETED' && (
        <div className="mb-3">
          <CallStatusIndicator call={latestCall} />
        </div>
      )}

      {/* Call button — opens modal when onOpenCallModal provided; otherwise submits form (legacy). */}
      {!isServerCallActive && (
        onOpenCallModal ? (
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={hasActiveCall}
            onClick={onOpenCallModal}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
            </svg>
            {hasActiveCall ? 'Call in progress...' : 'Call Customer'}
          </Button>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="initiateCall" />
            {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={hasActiveCall}
              loading={fetcher.state === 'submitting'}
              loadingText="Connecting..."
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              {hasActiveCall ? 'Call in progress...' : 'Call Customer'}
            </Button>
          </fetcher.Form>
        )
      )}

      {/* Gate status hint */}
      {!canConfirm && order.callLogs.length > 0 && (
        <p className="text-xs text-warning-600 dark:text-warning-400 mt-2 text-center">
          A completed call of at least 15 seconds is required to confirm this order.
        </p>
      )}
      {canConfirm && (
        <p className="text-xs text-success-600 dark:text-success-400 mt-2 text-center">
          Call requirement met. You can now confirm the order.
        </p>
      )}
    </div>
  );
}

/** Wrapper that runs call-status polling only while there is an active call (INITIATED/RINGING/IN_PROGRESS). */
function VoipCallPanelWithPolling({
  order,
  resolvedCall,
  canConfirm,
  fetcher,
  revalidate,
  onOpenCallModal,
  voipProviderDisplayName,
}: {
  order: OrderDetailStreamData['order'];
  resolvedCall: CallLogEntry | null;
  canConfirm: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  revalidate: () => void;
  onOpenCallModal?: () => void;
  voipProviderDisplayName?: string;
}) {
  const isCallRelatedStatus =
    order.status === 'CS_ENGAGED' || order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED';
  const isActiveCall =
    resolvedCall != null && ['INITIATED', 'RINGING', 'IN_PROGRESS'].includes(resolvedCall.callStatus);
  const needsCallStatusPolling = isCallRelatedStatus && isActiveCall;

  useEffect(() => {
    if (!needsCallStatusPolling) return;
    const interval = setInterval(revalidate, 3000);
    return () => clearInterval(interval);
  }, [needsCallStatusPolling, revalidate]);

  return (
    <VoipCallPanel
      order={order}
      latestCall={resolvedCall}
      canConfirm={canConfirm}
      fetcher={fetcher}
      hasActiveCall={isActiveCall}
      onOpenCallModal={onOpenCallModal}
      voipProviderDisplayName={voipProviderDisplayName}
    />
  );
}

// ── Main Feature Component ───────────────────────────────────────

/**
 * Apply optimistic patches to the canonical order based on what's in flight on `fetcher`.
 *
 * The fetcher carries a single mutation at a time (status transition, CS assignment,
 * callback schedule). While `fetcher.state === 'submitting' | 'loading'`, we read its
 * `formData` and overlay the implied patch on top of the server copy so the badge,
 * assignee, and callback fields flip *immediately* — the user doesn't wait for the
 * loader revalidation.
 *
 * If the server rejects, the next render gets `fetcher.state === 'idle'` AND a `data`
 * with `error` set: we fall back to the server copy, which renders the unchanged state
 * just like a non-optimistic flow. Toast surfaces the error.
 *
 * Why we do this on a single record rather than via `useOptimisticListPatches`: that
 * hook is for list rows (keyed by id). Here the unit is a single page-level record;
 * a derived overlay computed inline is simpler and has zero dependencies.
 */
/**
 * Build a confirmed-optimistic patch from fetcher data AFTER the server has
 * responded successfully (`fetcher.state === 'idle'` + `success` in data).
 * The patch holds the expected new state until the loader revalidation lands
 * fresh data, preventing any stale-cache flash.
 */
function applyConfirmedOptimisticPatch<T extends OrderDetail>(
  serverOrder: T,
  fetcher: ReturnType<typeof useFetcher>,
  /** The formData snapshot captured while the fetcher was submitting. */
  lastFormData: FormData | null,
): T {
  // Only patch when the server confirmed success but the loader hasn't
  // caught up yet (the fresh revalidation is in flight).
  const data = fetcher.data as Record<string, unknown> | undefined;
  if (!data || !('success' in data)) return serverOrder;
  if (!lastFormData) return serverOrder;

  const intent = lastFormData.get('intent');
  if (typeof intent !== 'string') return serverOrder;

  if (intent === 'transition') {
    const newStatus = lastFormData.get('newStatus');
    if (typeof newStatus !== 'string' || !newStatus) return serverOrder;
    // Only hold if the server hasn't caught up yet.
    if (serverOrder.status === newStatus) return serverOrder;
    return { ...serverOrder, status: newStatus };
  }

  if (intent === 'assignToCS') {
    const newAssignee = lastFormData.get('toCsAgentId') ?? lastFormData.get('csCloserId');
    if (typeof newAssignee !== 'string' || !newAssignee) return serverOrder;
    if (serverOrder.assignedCsId === newAssignee) return serverOrder;
    const nextStatus = serverOrder.status === 'UNPROCESSED' ? 'CS_ASSIGNED' : serverOrder.status;
    return { ...serverOrder, assignedCsId: newAssignee, status: nextStatus };
  }

  if (intent === 'initiateCall') {
    const nextStatus =
      serverOrder.status === 'UNPROCESSED' || serverOrder.status === 'CS_ASSIGNED'
        ? 'CS_ENGAGED'
        : serverOrder.status;
    if (serverOrder.status === nextStatus) return serverOrder;
    return { ...serverOrder, status: nextStatus };
  }

  if (intent === 'editOrderDetails') {
    const patch: Partial<T> = {};
    const name = lastFormData.get('customerName');
    if (typeof name === 'string' && name) (patch as Record<string, unknown>).customerName = name;
    const addr = lastFormData.get('deliveryAddress');
    if (typeof addr === 'string') (patch as Record<string, unknown>).deliveryAddress = addr;
    const state = lastFormData.get('deliveryState');
    if (typeof state === 'string') (patch as Record<string, unknown>).deliveryState = state;
    const notes = lastFormData.get('deliveryNotes');
    if (typeof notes === 'string') (patch as Record<string, unknown>).deliveryNotes = notes;
    const dd = lastFormData.get('preferredDeliveryDate');
    if (typeof dd === 'string') (patch as Record<string, unknown>).preferredDeliveryDate = dd;
    return { ...serverOrder, ...patch };
  }

  return serverOrder;
}

export function OrderDetailPage({
  order: serverOrder,
  latestCall,
  timeline,
  voipEnabled,
  voipProviderDisplayName = "Africa's Talking",
  canEditOrder = true,
  userRole,
  userId,
  currentBranchId = null,
  permissions,
  csClosersForAssign = [],
  logisticsLocations = [],
  allocatableLocations = [],
  allocatableLocationsDeferred,
  logisticsDispatchTemplates = [],
  invoice,
  itemOffers = [],
  productsForAdjust = [],
  callablePhone,
  isFollowUpOrder = false,
  isCartOrder = false,
  isMirroring = false,
}: OrderDetailStreamData & OrderDetailPageExtraProps & { isMirroring?: boolean }) {
  const fetcher = useFetcher();
  const recordCallFetcher = useFetcher();
  const scheduleFetcher = useFetcher();
  const adjustItemsFetcher = useFetcher();
  const priceRequestFetcher = useFetcher();
  const ensureInvoiceFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const invoiceFetcher = useFetcher<{ ok: boolean; invoice: OrderInvoice | null; error?: string }>();
  const timelineFetcher = useFetcher<{ ok: boolean; timeline: TimelineEvent[]; error?: string }>();
  const csCommentFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const withdrawRequestFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  // Invalidate the clientLoader cache whenever a fetcher starts submitting so
  // the post-action revalidation hits the server instead of serving stale cache.
  useEffect(() => {
    if (fetcher.state === 'submitting' || recordCallFetcher.state === 'submitting' ||
        scheduleFetcher.state === 'submitting' || adjustItemsFetcher.state === 'submitting' ||
        priceRequestFetcher.state === 'submitting' || csCommentFetcher.state === 'submitting' ||
        ensureInvoiceFetcher.state === 'submitting' || invoiceFetcher.state === 'submitting') {
      invalidateCachedLoader(window.location.pathname);
    }
  }, [fetcher.state, recordCallFetcher.state, scheduleFetcher.state, adjustItemsFetcher.state, priceRequestFetcher.state, csCommentFetcher.state, ensureInvoiceFetcher.state, invoiceFetcher.state]);

  // Snapshot formData when each fetcher starts submitting so we can reference
  // it after the server responds (fetcher.formData is cleared when idle).
  const lastFetcherFD = useRef<FormData | null>(null);
  const lastRecordCallFD = useRef<FormData | null>(null);
  const lastScheduleFD = useRef<FormData | null>(null);
  useEffect(() => {
    if (fetcher.state === 'submitting' && fetcher.formData) {
      lastFetcherFD.current = fetcher.formData;
    }
  }, [fetcher.state, fetcher.formData]);
  useEffect(() => {
    if (recordCallFetcher.state === 'submitting' && recordCallFetcher.formData) {
      lastRecordCallFD.current = recordCallFetcher.formData;
    }
  }, [recordCallFetcher.state, recordCallFetcher.formData]);
  useEffect(() => {
    if (scheduleFetcher.state === 'submitting' && scheduleFetcher.formData) {
      lastScheduleFD.current = scheduleFetcher.formData;
    }
  }, [scheduleFetcher.state, scheduleFetcher.formData]);

  // Confirmed-optimistic order: patches are applied only AFTER the server
  // responds with success, holding the expected state until the loader
  // revalidation lands fresh data. No premature UI flip on submit.
  const order: OrderDetail = (() => {
    let patched = serverOrder;
    patched = applyConfirmedOptimisticPatch(patched, fetcher, lastFetcherFD.current);
    patched = applyConfirmedOptimisticPatch(patched, recordCallFetcher, lastRecordCallFD.current);

    // Schedule callback — hold the optimistic callbackAt after server confirms.
    if (scheduleFetcher.state === 'idle' && lastScheduleFD.current) {
      const sData = scheduleFetcher.data as Record<string, unknown> | undefined;
      if (sData && 'success' in sData) {
        const fd = lastScheduleFD.current;
        if (fd.get('intent') === 'scheduleCallback') {
          const delayMinRaw = fd.get('delayMinutes');
          const delayMin = typeof delayMinRaw === 'string' ? parseInt(delayMinRaw, 10) : NaN;
          if (Number.isFinite(delayMin) && delayMin > 0 && !patched.callbackScheduledAt) {
            const callbackAt = new Date(Date.now() + delayMin * 60_000).toISOString();
            patched = { ...patched, callbackScheduledAt: callbackAt };
          }
        }
      }
    }

    return patched;
  })();

  const [searchParams] = useSearchParams();
  const ordersListHref = useMemo(() => {
    const fromPath = ordersListPathForDetailFrom(searchParams.get('from'));
    if (fromPath) return fromPath;
    if (
      userRole === 'HEAD_OF_LOGISTICS' ||
      userRole === 'LOGISTICS_MANAGER' ||
      userRole === 'TPL_MANAGER' ||
      userRole === 'TPL_RIDER' ||
      userRole === 'STOCK_MANAGER'
    ) {
      return '/admin/logistics/orders';
    }
    if (userRole === 'HEAD_OF_MARKETING' || userRole === 'MEDIA_BUYER') {
      return '/admin/marketing/orders';
    }
    return '/admin/sales/orders';
  }, [searchParams, userRole]);

  // Team Live View — broadcast Sales closer state to cs-all room.
  const isCSCloser = userRole === 'CS_CLOSER';
  useAgentStateBroadcast(
    isCSCloser
      ? { currentRoute: `/admin/orders/${order.id}`, currentOrderId: order.id, currentPanel: 'details' }
      : { currentRoute: '' }
  );
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [deliveredDeletionModalOpen, setDeliveredDeletionModalOpen] = useState(false);
  const [deliveredDeletionReason, setDeliveredDeletionReason] = useState('');
  const deliveredDeletionFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [assignToId, setAssignToId] = useState('');
  const [lateStageTransferReason, setLateStageTransferReason] = useState('');
  const csCloserOptions = useMemo(
    () => (csClosersForAssign ?? []).map((a) => ({ value: a.id, label: a.name })),
    [csClosersForAssign],
  );
  const [callCustomerModalOpen, setCallCustomerModalOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  // After the first Copy/Call, the unmasked phone stays visible in the order header.
  const [phoneUnmasked, setPhoneUnmasked] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [rescheduleDeliveryModalOpen, setRescheduleDeliveryModalOpen] = useState(false);
  const [rescheduleDeliveryDate, setRescheduleDeliveryDate] = useState('');
  const [scheduleCallbackModalOpen, setScheduleCallbackModalOpen] = useState(false);
  const [addCommentModalOpen, setAddCommentModalOpen] = useState(false);
  const [csCommentDraft, setCsCommentDraft] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [scheduleDelaySelect, setScheduleDelaySelect] = useState<string>('120');
  const [scheduleCustomAmount, setScheduleCustomAmount] = useState<number | null>(2);
  const [scheduleCustomUnit, setScheduleCustomUnit] = useState<CallbackCustomDelayUnit>('hours');
  const [scheduleNotes, setScheduleNotes] = useState('');

  const effectiveScheduleDelayMinutes = useMemo(() => {
    if (scheduleDelaySelect !== 'custom') {
      const n = parseInt(scheduleDelaySelect, 10);
      return Number.isFinite(n) ? n : Number.NaN;
    }
    if (scheduleCustomAmount == null || !Number.isFinite(scheduleCustomAmount) || scheduleCustomAmount <= 0) {
      return Number.NaN;
    }
    return Math.round(scheduleCustomAmount * callbackCustomUnitMultiplier(scheduleCustomUnit));
  }, [scheduleDelaySelect, scheduleCustomAmount, scheduleCustomUnit]);

  const scheduleDelayInvalid =
    !Number.isFinite(effectiveScheduleDelayMinutes) ||
    effectiveScheduleDelayMinutes < CALLBACK_DELAY_MIN_MINUTES ||
    effectiveScheduleDelayMinutes > CALLBACK_DELAY_MAX_MINUTES;

  const scheduleCallbackHiddenDelayMinutes =
    !scheduleDelayInvalid && Number.isFinite(effectiveScheduleDelayMinutes)
      ? effectiveScheduleDelayMinutes
      : 120;

  const scheduleCustomAmountMin = Math.max(
    1,
    Math.ceil(CALLBACK_DELAY_MIN_MINUTES / callbackCustomUnitMultiplier(scheduleCustomUnit)),
  );
  const scheduleCustomAmountMax = Math.floor(
    CALLBACK_DELAY_MAX_MINUTES / callbackCustomUnitMultiplier(scheduleCustomUnit),
  );
  const [adjustItemsModalOpen, setAdjustItemsModalOpen] = useState(false);
  const [editStatusModalOpen, setEditStatusModalOpen] = useState(false);
  const [editStatusTarget, setEditStatusTarget] = useState('');
  const [editStatusReason, setEditStatusReason] = useState('');
  const [editDetailsModalOpen, setEditDetailsModalOpen] = useState(false);
  const [editedItems, setEditedItems] = useState<Array<{ productId: string; productName?: string | null; quantity: number; unitPrice: number; offerLabel: string | null }>>([]);
  const [priceApprovalReason, setPriceApprovalReason] = useState('');
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const [viewPendingRequestOpen, setViewPendingRequestOpen] = useState(false);
  const [callDebugLog, setCallDebugLog] = useState<string[]>([]);
  const [allocateModalOpen, setAllocateModalOpen] = useState(false);
  const [allocateLocationId, setAllocateLocationId] = useState('');
  const [deliverModalOpen, setDeliverModalOpen] = useState(false);
  const [deliverNote, setDeliverNote] = useState('');
  const [deliverProofUrl, setDeliverProofUrl] = useState('');
  const [deliverCost, setDeliverCost] = useState('');
  /** Logistics location selected at delivery time. Pre-filled with the order's
   *  current allocation (`order.logisticsLocationId`) so the common case (same provider
   *  delivered) is one click. Editable because a different provider may have stepped
   *  in to actually deliver. Server releases the original reserve and decrements the
   *  chosen location's stock when this differs from the allocation. */
  const [deliverLocationId, setDeliverLocationId] = useState('');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLocationId, setShareLocationId] = useState('');
  const [shareTemplateId, setShareTemplateId] = useState('');
  const [sharePending, setSharePending] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [invoicePreview, setInvoicePreview] = useState<OrderInvoice | null>(null);
  const [duplicateCompareOpen, setDuplicateCompareOpen] = useState(false);
  const [unfreezeModalOpen, setUnfreezeModalOpen] = useState(false);
  const [unfreezeReason, setUnfreezeReason] = useState('');
  const [optimisticallyUnfrozen, setOptimisticallyUnfrozen] = useState(false);
  const isFrozen = order.frozenForFollowUp && !optimisticallyUnfrozen;
  // Resolve the deferred allocatable-locations promise once into local state so
  // both the Assign modal AND the Mark Delivered dropdown can show per-product
  // stock counts. The sync `allocatableLocations` prop is currently empty in the
  // canonical loader path (loader streams via `allocatableLocationsDeferred`); we
  // mirror it here so dependent UIs render immediately on the next tick.
  const [resolvedAllocatableLocations, setResolvedAllocatableLocations] =
    useState<typeof allocatableLocations>(allocatableLocations);
  useEffect(() => {
    if (allocatableLocations.length > 0) {
      setResolvedAllocatableLocations(allocatableLocations);
      return;
    }
    if (!allocatableLocationsDeferred) return;
    let cancelled = false;
    Promise.resolve(allocatableLocationsDeferred)
      .then((rows) => {
        if (cancelled) return;
        if (Array.isArray(rows)) setResolvedAllocatableLocations(rows);
      })
      .catch(() => {
        // Fall back to no descriptions — never block the modal.
      });
    return () => {
      cancelled = true;
    };
  }, [allocatableLocations, allocatableLocationsDeferred]);

  const mayIncludeInternalWarehousesForHandoff =
    LOGISTICS_VIEWER_ROLES.has(userRole) || isAdminLevel({ role: userRole });

  const handoffAllocatableLocations = useMemo(
    () =>
      filterAllocatableLocationsForOrderHandoff(
        resolvedAllocatableLocations,
        mayIncludeInternalWarehousesForHandoff,
      ),
    [resolvedAllocatableLocations, mayIncludeInternalWarehousesForHandoff],
  );

  const syncHandoffAllocatableLocations = useMemo(
    () =>
      filterAllocatableLocationsForOrderHandoff(
        allocatableLocations,
        mayIncludeInternalWarehousesForHandoff,
      ),
    [allocatableLocations, mayIncludeInternalWarehousesForHandoff],
  );

  const selectedAllocatableLocation = handoffAllocatableLocations.find((l) => l.id === allocateLocationId);
  const eligibleAllocatableCount = handoffAllocatableLocations.filter((l) => l.eligible).length;

  useEffect(() => {
    if (!allocateModalOpen || !allocateLocationId) return;
    if (!handoffAllocatableLocations.some((l) => l.id === allocateLocationId)) {
      setAllocateLocationId('');
    }
  }, [allocateModalOpen, allocateLocationId, handoffAllocatableLocations]);

  const fetcherSurface = useFetcherActionSurface(fetcher);
  const scheduleSurface = useFetcherActionSurface(scheduleFetcher);
  const adjustItemsSurface = useFetcherActionSurface(adjustItemsFetcher);
  const priceRequestSurface = useFetcherActionSurface(priceRequestFetcher);
  const csCommentSurface = useFetcherActionSurface(csCommentFetcher);

  /** Disambiguates `intent: transition` (confirm / allocate / cancel / deliver share one intent). */
  type FetchSubmissionKey = {
    intent: string;
    newStatus?: string;
    /** Stamped at submit time for AGENT_ASSIGNED transitions so the post-success
     *  hand-off flow (auto-open Share-to-3PL modal) can preselect the location
     *  even after Remix has cleared `fetcher.formData`. */
    logisticsLocationId?: string;
  } | null;
  const fetcherSubmissionKeyRef = useRef<FetchSubmissionKey>(null);
  useEffect(() => {
    if (fetcher.state !== 'submitting' && fetcher.state !== 'loading') return;
    const fd = fetcher.formData;
    if (!fd) return;
    const intentRaw = fd.get('intent');
    if (typeof intentRaw !== 'string' || !intentRaw) return;
    if (intentRaw === 'transition') {
      const ns = fd.get('newStatus');
      const llid = fd.get('logisticsLocationId');
      fetcherSubmissionKeyRef.current = {
        intent: intentRaw,
        newStatus: typeof ns === 'string' ? ns : undefined,
        logisticsLocationId: typeof llid === 'string' && llid ? llid : undefined,
      };
    } else {
      fetcherSubmissionKeyRef.current = { intent: intentRaw };
    }
  }, [fetcher.state, fetcher.formData]);

  function fetcherErrorForTransition(newStatus: string): string | null {
    if (!fetcherSurface.friendlyError) return null;
    const key = fetcherSubmissionKeyRef.current;
    if (!key || key.intent !== 'transition' || key.newStatus !== newStatus) return null;
    return fetcherSurface.friendlyError;
  }

  const mainFetcherActionModalOpen =
    confirmModalOpen ||
    cancelModalOpen ||
    restoreModalOpen ||
    allocateModalOpen ||
    deliverModalOpen ||
    callCustomerModalOpen;

  // Stepper shape — Cash Remitted (`REMITTED`) only for viewers who actually operate
  // finance remittance or logistics COD tracking. Everyone else ends at Delivered so
  // CS / marketing / branch campaign views are not polluted with step 6.
  const isLogisticsViewer = LOGISTICS_VIEWER_ROLES.has(userRole);
  const viewerSeesCashRemittanceStep = useMemo(() => {
    if (isLogisticsViewer) return true;
    if (hasFinanceAccess({ role: userRole, permissions })) return true;
    const permSet = new Set((permissions ?? []).map((p) => canonicalPermissionCode(p)));
    const cashCreate = canonicalPermissionCode('finance.cashRemittance.create');
    const cashReceived = canonicalPermissionCode('finance.cashRemittance.markReceived');
    return permSet.has(cashCreate) || permSet.has(cashReceived);
  }, [userRole, permissions, isLogisticsViewer]);
  const orderProgressStripHidesCashRemitted = !viewerSeesCashRemittanceStep;
  const orderStatusFlow = isLogisticsViewer
    ? (STATUS_FLOW_LOGISTICS as readonly string[])
    : viewerSeesCashRemittanceStep
      ? (STATUS_FLOW_STANDARD as readonly string[])
      : (STATUS_FLOW_CS as readonly string[]);
  const currentStatusIndex = getProgressIndex(order.status, orderStatusFlow);
  const actionError = (fetcher.data as { error?: string })?.error;
  const callInitiated = (fetcher.data as { callInitiated?: boolean })?.callInitiated;
  useFetcherToast(fetcher.data, {
    successMessage: 'Order updated',
    skipErrorToast: mainFetcherActionModalOpen,
  });

  // Clear the inline assignToCS form once the server confirms the swap, so the
  // user sees a fresh state for the next action rather than stale picks. We
  // remember the intent of the last submission so a different fetcher action
  // (status transition, comment, etc.) doesn't accidentally wipe the picker.
  const lastFetcherIntentRef = useRef<string | null>(null);
  useEffect(() => {
    if (fetcher.state === 'submitting' && fetcher.formData) {
      const submittedIntent = fetcher.formData.get('intent');
      lastFetcherIntentRef.current = typeof submittedIntent === 'string' ? submittedIntent : null;
    } else if (
      fetcher.state === 'idle' &&
      lastFetcherIntentRef.current === 'assignToCS' &&
      (fetcher.data as { success?: boolean })?.success === true
    ) {
      setAssignToId('');
      setLateStageTransferReason('');
      lastFetcherIntentRef.current = null;
    }
  }, [fetcher.state, fetcher.formData, fetcher.data]);
  useFetcherToast(scheduleFetcher.data, {
    successMessage: 'Callback scheduled',
    skipErrorToast: scheduleCallbackModalOpen,
  });

  const { toast } = useToast();
  const { ensureBranchForAction, requiresBranchSelection } = useBranchScopeActionGuard();

  // Fetch heavy-but-non-blocking panels after mount to keep the page resilient.
  useEffect(() => {
    if (currentStatusIndex < getProgressIndex('CONFIRMED', orderStatusFlow)) return;
    if (invoice !== undefined) return; // loader provided it (streaming mode)
    if (invoiceFetcher.state !== 'idle' || invoiceFetcher.data) return;
    invoiceFetcher.load(`/api/order-invoice/${order.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, currentStatusIndex, invoice, isFollowUpOrder]);

  useEffect(() => {
    if (timeline !== undefined) return; // loader provided it (streaming mode)
    if (timelineFetcher.state !== 'idle' || timelineFetcher.data) return;
    timelineFetcher.load(`/api/order-timeline/${order.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id, timeline]);

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);
  useEffect(() => {
    if (!actionError) return;
    if (!requiresBranchSelection) return;
    if (!actionError.toLowerCase().includes('branch context required')) return;
    ensureBranchForAction({ actionLabel: 'this action' });
  }, [actionError, requiresBranchSelection, ensureBranchForAction]);
  useFetcherToast(adjustItemsFetcher.data, {
    successMessage: 'Order items updated',
    skipErrorToast: adjustItemsModalOpen,
  });
  useFetcherToast(priceRequestFetcher.data, {
    successMessage: 'Price change request submitted',
    skipErrorToast: adjustItemsModalOpen,
  });
  useFetcherToast(ensureInvoiceFetcher.data, { successMessage: 'Invoice generated' });
  useFetcherToast(csCommentFetcher.data, {
    successMessage: 'Comment added',
    skipErrorToast: addCommentModalOpen,
  });
  useFetcherToast(deliveredDeletionFetcher.data, {
    successMessage: 'Deletion request submitted — awaiting HoCS + HoL approval',
  });
  useCloseOnFetcherSuccess(deliveredDeletionFetcher, () => {
    setDeliveredDeletionModalOpen(false);
    setDeliveredDeletionReason('');
  }, { intent: 'requestDeliveredOrderDeletion' });
  const showCopyOrderSummary = canCopyOrderSummaryForChat(userRole, currentBranchId ?? null, order);
  const logisticsLocationWithGroupLink =
    order.logisticsLocationId != null
      ? logisticsLocations.find(
          (location) =>
            location.id === order.logisticsLocationId &&
            !!location.whatsappGroupLink,
        )
      : undefined;
  const showLogisticsOrderSummaryCopy =
    showCopyOrderSummary && ORDER_STATUSES_LOGISTICS_SUMMARY_COPY.has(order.status);
  const showPostAllocationWhatsAppActions =
    showLogisticsOrderSummaryCopy && !!logisticsLocationWithGroupLink;

  const handleCopyOrderSummary = useCallback(async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        toast.error('Copy failed', 'Clipboard is not available in this browser.');
        return;
      }
      const { text } = await fetchOrderClipboardSummary(order.id);
      await navigator.clipboard.writeText(text);
      toast.success('Copied', 'Order summary ready to paste into WhatsApp or your logistics company group.');
    } catch (e) {
      toast.error(
        'Copy failed',
        e instanceof Error ? e.message : 'Could not load or write the order summary.',
      );
    }
  }, [order.id, toast]);

  // When user submits again, clear dismissed so the next response error will show
  useEffect(() => {
    if (fetcher.state === 'submitting') setDismissedError(false);
  }, [fetcher.state]);

  // Phone is loaded with the page via `callablePhone` prop — no separate fetch.
  // Copy / Call read directly from it. The call-log fires in the background via
  // `recordCallFetcher`.

  // Reset call debug log when opening the call modal (VOIP path)
  useEffect(() => {
    if (callCustomerModalOpen && voipEnabled) {
      setCallDebugLog([]);
    }
  }, [callCustomerModalOpen, voipEnabled]);

  // Append response to call debug log when initiateCall returns
  const prevFetcherStateRef = useRef(fetcher.state);
  useEffect(() => {
    const data = fetcher.data as { callInitiated?: boolean; callLog?: { callStatus?: string }; providerError?: string } | undefined;
    if (prevFetcherStateRef.current === 'submitting' && fetcher.state === 'idle' && data != null && (data.callInitiated ?? data.callLog)) {
      setCallDebugLog((prev) => [
        ...prev,
        `Response received at ${new Date().toLocaleTimeString()}`,
        `Call status: ${data.callLog?.callStatus ?? '—'}${data.providerError ? ` | error: ${data.providerError}` : ''}`,
      ]);
    }
    prevFetcherStateRef.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  const showActionError = actionError && !dismissedError && !mainFetcherActionModalOpen;

  const isAssignedToMe = order.assignedCsId === userId;
  const branchAdminSameBranch =
    userRole === 'BRANCH_ADMIN' &&
    !!order.branchId &&
    !!currentBranchId &&
    order.branchId === currentBranchId;
  const isCSOrHoS =
    ['CS_CLOSER', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN', 'SUPPORT'].includes(userRole) || branchAdminSameBranch;
  const isElevated =
    userRole === 'HEAD_OF_CS' || isAdminLevel({ role: userRole }) || branchAdminSameBranch;
  const viewerIsCsTeamSupervisor = order.viewerIsCsTeamSupervisor === true;
  const canEditOrderStatus =
    userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'SUPPORT' ||
    userRole === 'HEAD_OF_LOGISTICS' || userRole === 'HEAD_OF_CS';
  const canEditLinePrices = order.viewerCanEditOrderLinePrices === true;
  // CEO directive 2026-06-10: block ALL forward transitions while item/price
  // approval is pending — not just CONFIRMED.
  const hasPendingItemApproval = !!order.pendingOrderLinePriceRequestId;
  // Campaign-scoped offer tiers keyed by product — feeds the Adjust order items
  // offer picker so a discounted bundle can be applied in one selection.
  // Also merges offers from productsForAdjust so product-swap shows the new product's offers.
  const offersByProduct = useMemo(() => {
    const m = new Map<string, Array<{ label: string; quantity: number; unitPrice: number }>>();
    // Campaign-scoped offers take priority (from listItemOffers) — but only if non-empty
    for (const entry of itemOffers) {
      if (entry.offers.length > 0) m.set(entry.productId, entry.offers);
    }
    // Fill in from productsForAdjust for products without campaign offers
    for (const p of productsForAdjust) {
      if (m.has(p.id)) continue;
      if (p.offers && Array.isArray(p.offers) && p.offers.length > 0) {
        m.set(p.id, p.offers.map((o) => ({
          label: o.label,
          quantity: typeof o.qty === 'number' ? o.qty : 1,
          unitPrice: Number(o.price),
        })));
      }
    }
    return m;
  }, [itemOffers, productsForAdjust]);
  // Product options for the product-swap SearchableSelect in Adjust modal — only products with offers
  const productOptionsForAdjust = useMemo(() => {
    return productsForAdjust
      .filter((p) => offersByProduct.has(p.id) && (offersByProduct.get(p.id)?.length ?? 0) > 0)
      .map((p) => ({ value: p.id, label: p.name }));
  }, [productsForAdjust, offersByProduct]);
  // Sales closer can only perform actions when order is assigned to them, or UNPROCESSED with no assignee (take from pool)
  const canPerformCSActionsOnOrder =
    isElevated ||
    viewerIsCsTeamSupervisor ||
    (userRole === 'CS_CLOSER' && (isAssignedToMe || (order.status === 'UNPROCESSED' && !order.assignedCsId)));
  const canAssignToCS =
    permissions.includes('orders.reassign') ||
    isAdminLevel({ role: userRole }) ||
    viewerIsCsTeamSupervisor;
  // Late-stage credit-attribution transfer — HoCS / SuperAdmin only, governed
  // by `orders.cs.transfer_any_status`. Lets them swap the assigned closer on
  // a CONFIRMED / DISPATCHED / DELIVERED / REMITTED order without resetting
  // the status (used when the wrong closer was attributed by mistake).
  const canTransferCsAnyStatus =
    permissions.includes('orders.cs.transfer_any_status') ||
    isAdminLevel({ role: userRole });
  // Pre-engagement statuses keep the normal "Assign / Reassign closer" flow.
  // Anything past CS_ENGAGED is a late-stage transfer.
  const csReassignPreEngagement =
    order.status === 'UNPROCESSED' ||
    order.status === 'CS_ASSIGNED' ||
    order.status === 'CS_ENGAGED';
  // Terminal-administrative statuses where reassignment is meaningless.
  const csReassignBlocked =
    order.status === 'CANCELLED' ||
    order.status === 'DELETED' ||
    order.status === 'RESTOCKED' ||
    order.status === 'WRITTEN_OFF';
  const showCsAssignForm =
    !csReassignBlocked &&
    ((csReassignPreEngagement && canAssignToCS) ||
      (!csReassignPreEngagement && canTransferCsAnyStatus));
  const isLateStageCsTransfer = showCsAssignForm && !csReassignPreEngagement;

  const orderAllowsLineItemEdits =
    order.status === 'UNPROCESSED' ||
    order.status === 'CS_ASSIGNED' ||
    order.status === 'CS_ENGAGED' ||
    order.status === 'CONFIRMED' ||
    order.status === 'AGENT_ASSIGNED' ||
    order.status === 'DISPATCHED' ||
    order.status === 'IN_TRANSIT';

  // Detect ANY item change (product, offer, price, quantity) from the server state.
  const itemsChanged = editedItems.some((row) => {
    const srv = order.orderItems.find((o) => o.productId === row.productId);
    if (!srv) return true;
    if (Math.abs(Number(srv.unitPrice) - row.unitPrice) > 0.0001) return true;
    if ((row.offerLabel ?? null) !== (srv.offerLabel ?? null)) return true;
    if (row.quantity !== srv.quantity) return true;
    return false;
  });
  // CS closers who lack direct edit rights must go through approval for ANY
  // item change — price, offer tier, or quantity (CEO directive 2026-05-28).
  const priceDriftProposing = !canEditLinePrices && itemsChanged;

  function canTransitionTo(newStatus: string): boolean {
    const allowed = order.allowedTransitions ?? [];
    if (!allowed.includes(newStatus)) return false;
    // DELETED: permission-gated via `orders.delete`. Admin/SuperAdmin always can;
    // others (HoCS, etc.) only if explicitly granted. CEO directive 2026-05-23.
    if (newStatus === 'DELETED') {
      return isAdminLevel({ role: userRole }) || (permissions ?? []).includes('orders.delete');
    }
    const csOnlyStatuses = ['CS_ENGAGED', 'CONFIRMED'];
    if (!csOnlyStatuses.includes(newStatus)) return true;
    if (!isCSOrHoS) return false;
    if (userRole === 'HEAD_OF_CS' || isAdminLevel({ role: userRole }) || branchAdminSameBranch) return true;
    if (userRole === 'CS_CLOSER') {
      if (newStatus === 'CS_ENGAGED') {
        return isAssignedToMe || (order.status === 'UNPROCESSED' && !order.assignedCsId);
      }
      return isAssignedToMe;
    }
    return false;
  }

  // Check call logs for confirm gate conditions
  const hasQualifyingVoipCall = order.callLogs.some(
    (c) => c.callStatus === 'COMPLETED' && (c.durationSeconds ?? 0) >= 15,
  );
  const hasAnyCallLog = order.callLogs.length > 0;

  // Whether the Confirm button should be enabled
  // - Admin-class or Branch Admin (same branch): backstop confirm without a logged call
  // - Otherwise VOIP enabled: require completed VOIP call of at least 15 seconds
  // - Otherwise manual mode: require at least one call log on the order
  const canConfirm =
    isAdminLevel({ role: userRole }) ||
    branchAdminSameBranch ||
    (voipEnabled ? hasQualifyingVoipCall : hasAnyCallLog);

  // Revalidate callback for VOIP call-status polling (used inside call panel wrapper).
  const revalidate = useCallback(() => {
    if (revalidator.state === 'idle') {
      revalidator.revalidate();
    }
  }, [revalidator]);

  // Immediate revalidate when "Call Customer" succeeds so in-call UI appears without waiting for first poll.
  const revalidatedForCallInitiatedRef = useRef(false);
  useEffect(() => {
    if (
      fetcher.state === 'idle' &&
      (fetcher.data as { callInitiated?: boolean })?.callInitiated &&
      revalidator.state === 'idle' &&
      !revalidatedForCallInitiatedRef.current
    ) {
      revalidatedForCallInitiatedRef.current = true;
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);
  useEffect(() => {
    revalidatedForCallInitiatedRef.current = false;
  }, [order.id]);
  useEffect(() => {
    if (fetcher.state === 'submitting') revalidatedForCallInitiatedRef.current = false;
  }, [fetcher.state]);

  // Revalidate when MANUAL_CALL is recorded (after Copy or Call on my phone) so Confirm order appears.
  // Use a ref to avoid revalidation loop: only revalidate once per success.
  const recordCallData = recordCallFetcher.data as { success?: boolean; error?: string } | undefined;
  const revalidatedForRecordCallRef = useRef(false);
  useEffect(() => {
    if (recordCallData?.success && revalidator.state === 'idle' && !revalidatedForRecordCallRef.current) {
      revalidatedForRecordCallRef.current = true;
      setCallCustomerModalOpen(false);
      revalidator.revalidate();
    }
  }, [recordCallData?.success, revalidator]);
  // Reset ref when order changes so a new copy on another order can trigger one revalidation
  useEffect(() => {
    revalidatedForRecordCallRef.current = false;
  }, [order.id]);

  // Revalidate after generating an invoice so the invoice card appears immediately.
  const ensureInvoiceData = ensureInvoiceFetcher.data as { success?: boolean; error?: string } | undefined;
  const revalidatedForEnsureInvoiceRef = useRef(false);
  useEffect(() => {
    if (ensureInvoiceData?.success && revalidator.state === 'idle' && !revalidatedForEnsureInvoiceRef.current) {
      revalidatedForEnsureInvoiceRef.current = true;
      revalidator.revalidate();
    }
  }, [ensureInvoiceData?.success, revalidator]);
  useEffect(() => {
    revalidatedForEnsureInvoiceRef.current = false;
  }, [order.id]);

  // Auto-generate invoice when viewing a confirmed order that has none.
  // Fires once per order — any role can trigger it (backend is idempotent).
  const PRE_CONFIRMED_STATUSES = new Set(['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED']);
  const autoEnsureInvoiceFiredRef = useRef(false);
  useEffect(() => { autoEnsureInvoiceFiredRef.current = false; }, [order.id]);
  useEffect(() => {
    if (autoEnsureInvoiceFiredRef.current) return;
    if (isMirroring) return;
    // Only auto-generate for CONFIRMED and beyond — pre-confirmed orders have no confirmedAt
    if (PRE_CONFIRMED_STATUSES.has(order.status)) return;
    // Wait for the invoice fetch to complete with a definitive "no invoice" result
    const fetchDone = invoiceFetcher.state === 'idle' && invoiceFetcher.data;
    if (!fetchDone) return;
    const hasInvoice = invoiceFetcher.data!.ok && invoiceFetcher.data!.invoice;
    if (hasInvoice) return;
    // Also skip if streamed invoice is present
    if (invoice !== undefined) return;
    // Don't double-fire if ensureInvoice is already in flight or completed
    if (ensureInvoiceFetcher.state !== 'idle' || ensureInvoiceFetcher.data) return;
    autoEnsureInvoiceFiredRef.current = true;
    const fd = new FormData();
    fd.set('intent', 'ensureInvoice');
    if (isFollowUpOrder) fd.set('isFollowUpOrder', 'true');
    if (isCartOrder) fd.set('isCartOrder', 'true');
    ensureInvoiceFetcher.submit(fd, { method: 'post' });
  }, [invoiceFetcher.state, invoiceFetcher.data, invoice, ensureInvoiceFetcher, isFollowUpOrder, isCartOrder, order.status]);

  // Close modals when their fetcher returns success — edge-triggered via the
  // shared `useCloseOnFetcherSuccess` hook so the modal closes the same React
  // tick as the toast (no waiting for loader revalidation).
  const handleStateTransitionSuccess = useCallback(() => {
    if (confirmModalOpen) {
      setConfirmModalOpen(false);
      setDeliveryDate('');
    }
    if (rescheduleDeliveryModalOpen) {
      setRescheduleDeliveryModalOpen(false);
      setRescheduleDeliveryDate('');
    }
    if (cancelModalOpen) {
      setCancelModalOpen(false);
      setCancelReason('');
    }
    if (restoreModalOpen) {
      setRestoreModalOpen(false);
    }
    const justAllocated =
      allocateModalOpen &&
      fetcherSubmissionKeyRef.current?.intent === 'transition' &&
      fetcherSubmissionKeyRef.current?.newStatus === 'AGENT_ASSIGNED';
    if (allocateModalOpen) {
      setAllocateModalOpen(false);
      setAllocateLocationId('');
    }
    if (deliverModalOpen) {
      setDeliverModalOpen(false);
      setDeliverNote('');
      setDeliverProofUrl('');
    }
    if (editStatusModalOpen) {
      setEditStatusModalOpen(false);
      setEditStatusTarget('');
      setEditStatusReason('');
    }
    if (unfreezeModalOpen) {
      setUnfreezeModalOpen(false);
      setUnfreezeReason('');
      setOptimisticallyUnfrozen(true);
    }
    // Chain assign → share: when the assignment succeeds AND a WhatsApp group
    // exists for some logistics location AND a dispatch template exists, pop
    // the Share-to-3PL modal next so the operator's hand-off is one continuous
    // flow rather than "click Assign, click Share, pick again."
    if (justAllocated) {
      const locationsWithGroup = logisticsLocations.filter((l) => !!l.whatsappGroupLink);
      if (locationsWithGroup.length > 0 && logisticsDispatchTemplates.length > 0) {
        const justAllocatedId = fetcherSubmissionKeyRef.current?.logisticsLocationId ?? null;
        const preselected =
          (justAllocatedId && locationsWithGroup.find((l) => l.id === justAllocatedId)?.id) ??
          (order.logisticsLocationId &&
            locationsWithGroup.find((l) => l.id === order.logisticsLocationId)?.id) ??
          locationsWithGroup[0]?.id ??
          '';
        setShareError(null);
        setShareLocationId(preselected);
        setShareTemplateId(logisticsDispatchTemplates[0]?.id ?? '');
        setShareModalOpen(true);
      }
    }
  }, [
    confirmModalOpen,
    rescheduleDeliveryModalOpen,
    cancelModalOpen,
    restoreModalOpen,
    allocateModalOpen,
    deliverModalOpen,
    editStatusModalOpen,
    unfreezeModalOpen,
    logisticsLocations,
    logisticsDispatchTemplates,
    order.logisticsLocationId,
  ]);
  useCloseOnFetcherSuccess(fetcher, handleStateTransitionSuccess);

  const handleScheduleSuccess = useCallback(
    (data: { success: true } & Record<string, unknown>) => {
      if (!(data as { scheduled?: boolean }).scheduled) return;
      setScheduleCallbackModalOpen(false);
      setScheduleDelaySelect('120');
      setScheduleCustomAmount(2);
      setScheduleCustomUnit('hours');
      setScheduleNotes('');
    },
    [],
  );
  useCloseOnFetcherSuccess(scheduleFetcher, handleScheduleSuccess);

  const handleAdjustItemsSuccess = useCallback(() => {
    setAdjustItemsModalOpen(false);
    setPriceApprovalReason('');
  }, []);
  useCloseOnFetcherSuccess(adjustItemsFetcher, handleAdjustItemsSuccess);
  useCloseOnFetcherSuccess(priceRequestFetcher, handleAdjustItemsSuccess);

  const handleWithdrawSuccess = useCallback(() => {
    setWithdrawConfirmOpen(false);
  }, []);
  useCloseOnFetcherSuccess(withdrawRequestFetcher, handleWithdrawSuccess, { intent: 'withdrawLinePriceRequest' });

  const handleCsCommentSuccess = useCallback(
    (_data: { success: true } & Record<string, unknown>) => {
      setAddCommentModalOpen(false);
      setCsCommentDraft('');
      void timelineFetcher.load(`/api/order-timeline/${order.id}`);
    },
    [order.id, timelineFetcher],
  );
  useCloseOnFetcherSuccess(csCommentFetcher, handleCsCommentSuccess, { intent: 'addCsOrderComment' });

  // Escape to close adjust items modal
  useEffect(() => {
    if (!adjustItemsModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAdjustItemsModalOpen(false);
        setPriceApprovalReason('');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [adjustItemsModalOpen]);

  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      {/* Back — uses browser history so users return to whichever list they came from. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-app-fg-muted hover:text-brand-500"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>
        <svg className="w-4 h-4 text-app-border flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <OrderIdBadge id={order.id} orderNumber={order.orderNumber} textClassName="text-app-fg font-medium truncate min-w-0" />
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-app-fg truncate">{order.customerName}</h1>
          <p className="text-sm text-app-fg-muted font-mono mt-0.5 break-all">
            {callablePhone?.phone ? callablePhone.phone : order.customerPhoneDisplay}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <PageRefreshButton />
          {!canEditOrder && (
            <span className="inline-flex items-center rounded-full bg-app-hover px-2.5 py-1 text-xs font-medium text-app-fg-muted">
              View only
            </span>
          )}
          <OrderStatusBadge status={order.status} />
        </div>
      </div>

      {/* Phase 18 — surface the cash-remittance association so anyone reading
          the order knows why a DELIVERED order isn't yet REMITTED, or where
          the cash receipt that closed it out lives.
          Hidden from CS and marketing (Delivered is the end of their scope). */}
      {order.remittanceId && !orderProgressStripHidesCashRemitted && (
        <Link
          to={`/admin/finance/delivery-remittances/${order.remittanceId}`}
          prefetch="intent"
          className="inline-flex items-center gap-2 rounded-md border border-app-border bg-app-elevated px-3 py-1.5 text-xs font-medium text-app-fg-muted hover:text-app-fg hover:border-brand-300 dark:hover:border-brand-700 transition-colors w-fit"
        >
          <span className="text-app-fg-muted">Cash remittance:</span>
          <span className="font-mono">{order.remittanceId.slice(0, 8)}…</span>
          <span className="text-app-fg-muted">·</span>
          <span>
            {order.remittanceStatus === 'RECEIVED'
              ? 'Settled'
              : order.remittanceStatus === 'DISPUTED'
                ? 'Disputed'
                : 'Pending'}
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}

      {showActionError && actionError && (
        <PageNotification
          variant="error"
          message={fetcherSurface.friendlyError || actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Frozen for follow-up — order was pulled by follow-up config rules.
          No further mutations allowed. */}
      {isFrozen && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:border-yellow-600/40 dark:bg-yellow-900/20 px-3 py-2.5">
          <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
            Frozen for follow-up
          </p>
          <p className="mt-0.5 text-xs text-yellow-700 dark:text-yellow-400">
            A follow-up copy was created. No further changes allowed.
          </p>
          {(isAdminLevel({ role: userRole }) || userRole === 'HEAD_OF_CS') && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-2 w-full sm:w-auto"
              onClick={() => { setUnfreezeModalOpen(true); setUnfreezeReason(''); }}
            >
              Unfreeze order
            </Button>
          )}
        </div>
      )}

      {/* Duplicate linkage — surface the cross-order tie so a Sales closer / MB
          immediately sees that this order is the merged duplicate (or the
          original it was merged into). The "Duplicate of" row in Details still
          carries the raw UUID for power users; this banner makes the
          relationship one click away regardless of where the user is on the
          page. */}
      {order.isDuplicate === 'MERGED' && order.duplicateOfId ? (
        <div className="rounded-lg border border-app-border bg-app-hover px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm text-app-fg">
              <p className="font-semibold">This order was merged into another</p>
              <p className="mt-0.5 text-app-fg-muted">
                Items and total were combined into the original. This duplicate is cancelled and kept
                for audit. Media buyer attribution stays via the cross-funnel record.
              </p>
            </div>
            <Link
              to={`/admin/orders/${order.duplicateOfId}`}
              className="btn-secondary btn-sm inline-flex shrink-0"
            >
              Open original →
            </Link>
          </div>
        </div>
      ) : null}
      {(order.isDuplicate === 'FLAGGED' || order.isDuplicate === 'POSSIBLY_DUPLICATE') && (
        <div className="rounded-lg border border-warning-300 dark:border-warning-700/60 bg-warning-50 dark:bg-warning-900/20 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm text-warning-900 dark:text-warning-100">
              <p className="font-semibold">
                {order.isDuplicate === 'FLAGGED'
                  ? 'Flagged as a duplicate'
                  : 'Possibly a duplicate'}
              </p>
              <p className="mt-0.5 text-warning-800 dark:text-warning-200/90">
                Same phone matched another non-cancelled order. Review and resolve from the Sales queue
                duplicates tab.
              </p>
            </div>
            {order.duplicateOfId && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="shrink-0"
                onClick={() => setDuplicateCompareOpen(true)}
              >
                Compare with original
              </Button>
            )}
          </div>
        </div>
      )}

      {canEditOrder && order.pendingOrderLinePriceRequestId && (
        <>
          <div className="rounded-lg border border-warning-300 dark:border-warning-700/60 bg-warning-50 dark:bg-warning-900/20 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <svg
                className="h-5 w-5 shrink-0 text-warning-600 dark:text-warning-400 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <div className="flex-1 min-w-0 text-sm text-warning-900 dark:text-warning-100">
                <p className="font-semibold">Item change pending approval</p>
                <p className="mt-0.5 text-warning-800 dark:text-warning-200/90">
                  Order actions are blocked until a Head of CS, branch admin, or admin approves the change.
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setViewPendingRequestOpen(true)}
                  >
                    View request
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setWithdrawConfirmOpen(true)}
                  >
                    Withdraw request
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* View pending request modal */}
          {viewPendingRequestOpen && (
            <Modal
              open
              onClose={() => setViewPendingRequestOpen(false)}
              maxWidth="max-w-md"
              contentClassName="p-0"
            >
              <div className="p-6 space-y-4">
                <h2 className="text-lg font-semibold text-app-fg">Pending item change request</h2>
                <div className="rounded-lg border border-warning-300 dark:border-warning-700/60 bg-warning-50/50 dark:bg-warning-900/10 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center rounded-full bg-warning-100 dark:bg-warning-800/40 px-2 py-0.5 text-xs font-medium text-warning-800 dark:text-warning-200">
                      Pending
                    </span>
                    {order.pendingLinePriceChangeProposal?.requesterName && (
                      <span className="text-xs text-app-fg-muted">
                        by {order.pendingLinePriceChangeProposal.requesterName}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-app-fg-muted">
                    Order progression is blocked until this request is approved or withdrawn.
                  </p>
                </div>

                {/* Reason */}
                {order.pendingLinePriceChangeProposal?.reason && (
                  <div>
                    <h3 className="text-sm font-medium text-app-fg mb-1">Reason</h3>
                    <p className="text-sm text-app-fg-muted bg-app-hover rounded-lg px-3 py-2">
                      {order.pendingLinePriceChangeProposal.reason}
                    </p>
                  </div>
                )}

                {/* Current items */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-app-fg">Current</h3>
                  {order.orderItems.map((item) => (
                    <div key={item.productId} className="rounded-lg border border-app-border bg-app-hover px-3 py-2 flex items-center justify-between">
                      <div className="text-sm text-app-fg min-w-0">
                        <span className="font-medium">{item.productName ?? 'Product'}</span>
                        {item.offerLabel && <span className="text-app-fg-muted"> · {item.offerLabel}</span>}
                        <span className="text-app-fg-muted"> · Qty {item.quantity}</span>
                      </div>
                      <span className="text-sm font-bold text-app-fg tabular-nums shrink-0 ml-2">
                        <NairaPrice amount={Number(item.unitPrice)} />
                      </span>
                    </div>
                  ))}
                </div>

                {/* Proposed items */}
                {order.pendingLinePriceChangeProposal && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-brand-500">Proposed</h3>
                    {order.pendingLinePriceChangeProposal.items.map((item, idx) => {
                      const productName = productsForAdjust.find((p) => p.id === item.productId)?.name
                        ?? order.orderItems.find((o) => o.productId === item.productId)?.productName
                        ?? 'Product';
                      return (
                        <div key={`${item.productId}-${idx}`} className="rounded-lg border border-brand-300 dark:border-brand-700/60 bg-brand-50/10 dark:bg-brand-900/10 px-3 py-2 flex items-center justify-between">
                          <div className="text-sm text-app-fg min-w-0">
                            <span className="font-medium">{productName}</span>
                            {item.offerLabel && <span className="text-app-fg-muted"> · {item.offerLabel}</span>}
                            <span className="text-app-fg-muted"> · Qty {item.quantity}</span>
                          </div>
                          <span className="text-sm font-bold text-brand-500 tabular-nums shrink-0 ml-2">
                            <NairaPrice amount={item.unitPrice} />
                          </span>
                        </div>
                      );
                    })}
                    <p className="text-xs text-app-fg-muted">
                      New total: <span className="font-semibold text-app-fg">&#8358;{order.pendingLinePriceChangeProposal.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="secondary" onClick={() => setViewPendingRequestOpen(false)}>
                    Close
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setViewPendingRequestOpen(false);
                      setWithdrawConfirmOpen(true);
                    }}
                  >
                    Withdraw request
                  </Button>
                </div>
              </div>
            </Modal>
          )}

          {/* Withdraw confirmation modal */}
          {withdrawConfirmOpen && (
            <Modal
              open
              onClose={() => setWithdrawConfirmOpen(false)}
              maxWidth="max-w-sm"
              contentClassName="p-0"
            >
              <div className="p-6 space-y-4">
                <h2 className="text-lg font-semibold text-app-fg">Withdraw change request?</h2>
                <p className="text-sm text-app-fg-muted">
                  The pending item change will be cancelled and the order will continue with
                  its current product and pricing. Order actions will be unblocked.
                </p>
                <ModalFetcherInlineError message={
                  withdrawRequestFetcher.data && !withdrawRequestFetcher.data.success
                    ? (withdrawRequestFetcher.data as { error?: string }).error ?? 'Failed to withdraw'
                    : undefined
                } />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setWithdrawConfirmOpen(false)}
                    disabled={withdrawRequestFetcher.state === 'submitting'}
                  >
                    Keep request
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={withdrawRequestFetcher.state === 'submitting'}
                    loading={withdrawRequestFetcher.state === 'submitting'}
                    loadingText="Withdrawing…"
                    onClick={() => {
                      withdrawRequestFetcher.submit(
                        {
                          intent: 'withdrawLinePriceRequest',
                          requestId: order.pendingOrderLinePriceRequestId!,
                        },
                        { method: 'post' },
                      );
                    }}
                  >
                    Withdraw
                  </Button>
                </div>
              </div>
            </Modal>
          )}
        </>
      )}


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column — `contents` collapses this wrapper on mobile so the
              cards inside become direct children of the outer grid; combined
              with `order-N` on individual cards, that lets us mix Order
              Actions (which lives in the right column source-wise) into the
              mobile flow without duplicating markup. `lg:block` restores the
              wrapper at desktop so the original two-column layout is intact. */}
          <div className="contents lg:block lg:col-span-2 lg:space-y-4">
            {/* Status Timeline */}
            <div className="card overflow-hidden order-[-3] lg:order-none">
              <h2 className="text-lg font-semibold text-app-fg mb-4">Order Progress</h2>
              {/* Mobile: 3-col grid wrapping; Desktop: single-row grid */}
              <div
                className={`grid grid-cols-3 gap-x-2 gap-y-3 lg:gap-x-3 lg:gap-y-4 ${
                  orderStatusFlow.length === 5
                    ? 'lg:grid-cols-5'
                    : orderStatusFlow.length === 6
                      ? 'lg:grid-cols-6'
                      : 'lg:grid-cols-7'
                }`}
              >
                {orderStatusFlow.map((status, idx) => {
                  const isPast = idx < currentStatusIndex;
                  const isCurrent = idx === currentStatusIndex;
                  const isSuccessMilestone =
                    status === 'DELIVERED' || status === 'REMITTED';
                  const renderedComplete = isPast || (isCurrent && isSuccessMilestone);
                  const showInProgressCurrent = isCurrent && !isSuccessMilestone;

                  return (
                    <div key={status} className="flex flex-col items-center">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        showInProgressCurrent
                          ? 'bg-brand-500 text-white ring-4 ring-brand-100 dark:ring-brand-900'
                          : renderedComplete
                            ? 'bg-success-500 text-white'
                            : 'bg-app-hover text-app-fg-muted'
                      }`}>
                        {renderedComplete ? (
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          idx + 1
                        )}
                      </div>
                      <span className={`text-2xs mt-1 text-center leading-tight ${
                        showInProgressCurrent
                          ? 'text-brand-600 dark:text-brand-400 font-semibold'
                          : renderedComplete
                            ? 'text-success-600 dark:text-success-500 font-semibold'
                            : 'text-app-fg-muted'
                      }`}>
                        {STATUS_LABELS[status] ?? formatStatus(status)}
                      </span>
                    </div>
                  );
                })}
              </div>
              {order.preferredDeliveryDate?.trim() ? (
                <div className="mt-4 pt-4 border-t border-app-border">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-app-fg-muted">
                    Schedule date
                  </p>
                  <p className="mt-1 text-base font-semibold text-app-fg tabular-nums">
                    {formatScheduleDateDisplay(order.preferredDeliveryDate)}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Order Items — compact horizontal rows */}
            <div className="card !p-0 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-app-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-app-fg">Order Items</h2>
                {order.totalAmount && (
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs text-app-fg-muted">Total:</span>
                    <NairaPrice amount={Number(order.totalAmount)} className="text-sm font-bold text-app-fg" />
                  </div>
                )}
              </div>
              <div className="divide-y divide-app-border">
                {order.orderItems.map((item) => (
                  <div key={item.id} className="px-4 py-2 flex items-center gap-3 min-w-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-app-fg truncate" title={item.productName ?? item.productId}>
                        {item.productName ?? `${item.productId.slice(0, 8)}...`}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-app-fg-muted">Qty: {item.quantity}</span>
                        {item.offerLabel && (
                          <span className="text-xs text-app-fg-muted">· {item.offerLabel}</span>
                        )}
                      </div>
                    </div>
                    <NairaPrice amount={Number(item.unitPrice)} className="text-sm font-semibold text-app-fg shrink-0" />
                    <Link
                      to={`/admin/products/${item.productId}`}
                      className="shrink-0 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                    >
                      View
                    </Link>
                  </div>
                ))}
              </div>
            </div>

            {/* Invoice card — auto-generated on CONFIRMED. Visible to CS, Logistics, etc.
                Some legacy orders may not have one yet; in that case we still render
                the section so it doesn't "disappear" from the page.
                Invoice auto-generated on CONFIRMED. Follow-up orders generate on demand. */}
            {currentStatusIndex >= getProgressIndex('CONFIRMED', orderStatusFlow) && (() => {
              // Loader may stream invoice, but in the "fetch after mount" mode it will be undefined.
              const invoiceLoadedViaFetcher = invoiceFetcher.data?.ok ? invoiceFetcher.data.invoice : null;
              const invoiceError = invoiceFetcher.data && !invoiceFetcher.data.ok ? invoiceFetcher.data.error : null;
              const i = invoice !== undefined ? null : invoiceLoadedViaFetcher;

              if (invoice !== undefined && invoice !== null) {
                return (
                  <DeferredSection
                    resolve={invoice}
                    skeleton="card"
                    errorElement={<DeferredPanelError label="Invoice (finance.getInvoiceByOrder)" />}
                  >
                    {(inv) => {
                      const resolved = inv as OrderInvoice | null;
                      if (!resolved) return null;
                      return (
                        <div className="rounded-xl border border-app-border bg-app-elevated p-5 shadow-sm">
                          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 space-y-2">
                              <p className="text-2xs font-semibold uppercase tracking-wider text-app-fg-muted">
                                Yannis · Invoice
                              </p>
                              <h2 className="text-xl font-semibold tracking-tight text-app-fg font-mono">
                                {resolved.referenceFormatted}
                              </h2>
                              <p className="text-sm text-app-fg-muted">
                                <span className="font-medium text-app-fg">Bill to</span>{' '}
                                {resolved.recipientInfo?.name?.trim() || '—'}
                              </p>
                            </div>
                            <div className="flex flex-col gap-3 lg:items-end shrink-0 w-full lg:w-auto">
                              <div className="lg:text-right">
                                <p className="text-2xs font-semibold uppercase tracking-wide text-app-fg-muted">Total</p>
                                <NairaPrice
                                  amount={Number(resolved.totalAmount)}
                                  className="text-2xl font-bold text-app-fg tabular-nums"
                                />
                              </div>
                              <div className="flex flex-wrap gap-2 w-full lg:justify-end">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    void import('~/lib/invoice-pdf').then((m) => m.generateInvoicePdf(resolved));
                                  }}
                                >
                                  Download
                                </Button>
                                <Button type="button" variant="primary" size="sm" onClick={() => setInvoicePreview(resolved)}>
                                  View
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }}
                  </DeferredSection>
                );
              }

              if (invoiceError) {
                return (
                  <div className="card">
                    <h2 className="text-lg font-semibold text-app-fg mb-1">Invoice</h2>
                    <InlineNotification
                      variant="danger"
                      message={`Failed to load Invoice. ${invoiceError}`}
                      actions={[
                        {
                          label: invoiceFetcher.state === 'loading' ? 'Retrying…' : 'Retry',
                          disabled: invoiceFetcher.state === 'loading',
                          onClick: () => invoiceFetcher.load(`/api/order-invoice/${order.id}`),
                        },
                      ]}
                    />
                  </div>
                );
              }

              if (invoiceFetcher.state === 'loading' && !invoiceFetcher.data) {
                return (
                  <div className="card">
                    <h2 className="text-lg font-semibold text-app-fg mb-1">Invoice</h2>
                    <p className="text-sm text-app-fg-muted mb-3">Loading invoice…</p>
                    <InvoiceCardSkeleton />
                  </div>
                );
              }

              if (!i) {
                const isAutoGenerating = ensureInvoiceFetcher.state !== 'idle';
                return (
                  <div className="card">
                    <h2 className="text-lg font-semibold text-app-fg mb-1">Invoice</h2>
                    {isAutoGenerating ? (
                      <p className="text-sm text-app-fg-muted">Generating invoice…</p>
                    ) : (
                      <>
                        <p className="text-sm text-app-fg-muted mb-3">
                          This order doesn&apos;t have an invoice yet.
                        </p>
                        {!isMirroring && (
                          <div className="flex justify-end">
                            <ensureInvoiceFetcher.Form method="post">
                              <input type="hidden" name="intent" value="ensureInvoice" />
                              {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                              {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
                              <Button
                                type="submit"
                                variant="primary"
                                size="sm"
                                disabled={ensureInvoiceFetcher.state !== 'idle'}
                              >
                                Generate invoice
                              </Button>
                            </ensureInvoiceFetcher.Form>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              }

              return (
                <div className="rounded-xl border border-app-border bg-app-elevated p-5 shadow-sm">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-2">
                          <p className="text-2xs font-semibold uppercase tracking-wider text-app-fg-muted">
                            Yannis · Invoice
                          </p>
                          <h2 className="text-xl font-semibold tracking-tight text-app-fg font-mono">
                            {i.referenceFormatted}
                          </h2>
                          <p className="text-sm text-app-fg-muted">
                            <span className="font-medium text-app-fg">Bill to</span>{' '}
                            {i.recipientInfo?.name?.trim() || '—'}
                          </p>
                          <p className="text-xs text-app-fg-muted">
                            {i.lineItems.length} line item{i.lineItems.length === 1 ? '' : 's'}
                            <span className="mx-1.5">·</span>
                            Issued{' '}
                            {formatOrderTimestamp(i.createdAt)}
                            {i.dueDate ? (
                              <>
                                <span className="mx-1.5">·</span>
                                Due{' '}
                                {new Date(i.dueDate).toLocaleDateString('en-NG', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}
                              </>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex flex-col gap-3 lg:items-end shrink-0 w-full lg:w-auto">
                          <div className="lg:text-right">
                            <p className="text-2xs font-semibold uppercase tracking-wide text-app-fg-muted">Total</p>
                            <NairaPrice
                              amount={Number(i.totalAmount)}
                              className="text-2xl font-bold text-app-fg tabular-nums"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2 w-full lg:justify-end">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                void import('~/lib/invoice-pdf').then((m) => m.generateInvoicePdf(i));
                              }}
                            >
                              Download
                            </Button>
                            <Button type="button" variant="primary" size="sm" onClick={() => setInvoicePreview(i)}>
                              View
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
            })()}

            {/* Order activity — lifecycle timeline. On mobile this lands LAST
                (`order-[99]`) so the long, scroll-heavy timeline doesn't bury
                action affordances above. Restored to source order at lg+. */}
            <div className="card order-[99] lg:order-none">
              <h2 className="text-lg font-semibold text-app-fg mb-1">Order Activity</h2>
              <p className="text-sm text-app-fg-muted mb-3">
                Every step taken on this order, with who did it and when.
              </p>
              {timeline !== undefined ? (
                <DeferredSection
                  resolve={timeline}
                  skeleton="table"
                  errorElement={<DeferredPanelError label="Order Activity (orders.getTimeline)" />}
                >
                  {(resolvedTimeline) => (
                    <Suspense fallback={<OrderTimelineSkeleton />}>
                      <OrderTimeline events={resolvedTimeline as TimelineEvent[]} />
                    </Suspense>
                  )}
                </DeferredSection>
              ) : timelineFetcher.data && !timelineFetcher.data.ok ? (
                <InlineNotification
                  variant="danger"
                  message={`Failed to load Order Activity. ${timelineFetcher.data.error ?? ''}`.trim()}
                  actions={[
                    {
                      label: timelineFetcher.state === 'loading' ? 'Retrying…' : 'Retry',
                      disabled: timelineFetcher.state === 'loading',
                      onClick: () => timelineFetcher.load(`/api/order-timeline/${order.id}`),
                    },
                  ]}
                />
              ) : timelineFetcher.state === 'loading' && !timelineFetcher.data ? (
                <OrderTimelineSkeleton />
              ) : timelineFetcher.data?.ok ? (
                <Suspense fallback={<OrderTimelineSkeleton />}>
                  <OrderTimeline events={timelineFetcher.data.timeline as TimelineEvent[]} />
                </Suspense>
              ) : (
                <OrderTimelineSkeleton />
              )}
            </div>

            {/* Call History */}
            {order.callLogs.length > 0 && (
              <div className="card">
                <h2 className="text-lg font-semibold text-app-fg mb-3">Call History</h2>
                <div className="space-y-2">
                  {order.callLogs.map((call) => (
                    <div key={call.id} className="flex items-center justify-between p-3 rounded-lg bg-app-hover">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          call.callStatus === 'COMPLETED' && (call.durationSeconds ?? 0) >= 15
                            ? 'bg-success-50 dark:bg-success-700/20 text-success-600'
                            : call.callStatus === 'COMPLETED'
                            ? 'bg-warning-50 dark:bg-warning-700/20 text-warning-600'
                            : ['INITIATED', 'RINGING', 'IN_PROGRESS'].includes(call.callStatus)
                            ? 'bg-info-50 dark:bg-info-700/20 text-info-600'
                            : 'bg-danger-50 dark:bg-danger-700/20 text-danger-600'
                        }`}>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-app-fg">
                            {call.callStatus}
                            {call.callStatus === 'COMPLETED' && (call.durationSeconds ?? 0) >= 15 && (
                              <span className="ml-2 text-xs text-success-600 dark:text-success-400 font-normal">
                                Confirm gate met
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-app-fg-muted">
                            {new Date(call.startedAt).toLocaleString('en-NG')}
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-mono text-app-fg-muted">
                        {call.durationSeconds ?? 0}s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right column — see left column note above. `contents` on mobile
              lets `order-N` reorder cards across columns without duplicating. */}
          <div className="contents lg:block lg:space-y-4">
            {/* Order Actions — CS / Head of CS only, permission-gated by the route.
                CS still owns Adjust/Call/Delete after CS_ENGAGED while goods are pre-delivery so
                they can manage upsells, delivery-coordination calls, and cancellations.
                Manual timeline comments stay available while the actor can act on the order,
                including after line-item edits are closed (e.g. DELIVERED).
                Read-only viewers keep this page for visibility only; they never see action controls. */}
            {canEditOrder && isCSOrHoS && (orderAllowsLineItemEdits || canPerformCSActionsOnOrder || isFrozen) && (
              <div className="card order-[-2] lg:order-none">
                <h2 className="text-lg font-semibold text-app-fg mb-3">Order Actions</h2>
                {/* When the order is UNPROCESSED and no closer has been assigned, ALL actions
                    other than the Assign closer dropdown are suppressed. This forces the
                    correct lifecycle entry point: someone (HoCS / admin) picks a closer first,
                    then the order moves to CS_ASSIGNED and the rest of the workflow opens up.
                    Without this, an admin could engage / confirm an order directly and the
                    "Closer" column on `/admin/sales/orders` ends up blank because no CS_CLOSER
                    is on the row. */}
                {isFrozen ? (
                  <div className="space-y-2">
                    {showCopyOrderSummary && (
                      <Button type="button" variant="secondary" className="w-full" onClick={() => void handleCopyOrderSummary()}>
                        Copy order
                      </Button>
                    )}
                    <Button type="button" variant="secondary" className="w-full" onClick={() => setAddCommentModalOpen(true)} disabled={csCommentFetcher.state === 'submitting'}>
                      Add comment
                    </Button>
                  </div>
                ) : (
                <>
                {order.status === 'UNPROCESSED' && !order.assignedCsId && (
                  <div className="rounded-lg bg-info-50 dark:bg-info-900/20 border border-info-200 dark:border-info-700/50 px-4 py-3 mb-3">
                    <p className="text-sm text-info-800 dark:text-info-200">
                      Assign a closer to begin. Other actions (call, confirm, cancel)
                      will appear once a closer is assigned.
                    </p>
                  </div>
                )}
                {!canPerformCSActionsOnOrder && !(order.status === 'UNPROCESSED' && !order.assignedCsId) && (
                  <div className="rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700/50 px-4 py-3 mb-3">
                    <p className="text-sm text-warning-800 dark:text-warning-200">
                      This order is not assigned to you. You cannot perform actions until it is assigned to you by Head of CS or the system.
                    </p>
                  </div>
                )}
                <div className={`space-y-2 ${!canPerformCSActionsOnOrder ? 'pointer-events-none opacity-60' : ''}`}>
                  {/* All actions other than the Assign closer dropdown are suppressed while
                      the order is UNPROCESSED with no closer assigned — see the info banner
                      above for rationale. */}
                  {!(order.status === 'UNPROCESSED' && !order.assignedCsId) && orderAllowsLineItemEdits && (
                  <>
                  {/* ── Schedule date — always at the top when present ── */}
                  {order.preferredDeliveryDate?.trim() && (
                    <div className="rounded-lg border border-app-border bg-app-hover px-3 py-2">
                      <p className="text-2xs font-semibold uppercase tracking-wider text-app-fg-muted">Schedule date</p>
                      <p className="mt-0.5 text-sm font-semibold text-app-fg tabular-nums">
                        {formatScheduleDateDisplay(order.preferredDeliveryDate)}
                      </p>
                    </div>
                  )}

                  {/* ── Primary action (blue/green filled) — contextual to status ── */}

                  {/* UNPROCESSED / CS_ASSIGNED → Call customer is the next step */}
                  {(order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED') && !voipEnabled && (
                    <Button
                      type="button"
                      variant="primary"
                      className="w-full"
                      onClick={() => setCallCustomerModalOpen(true)}
                      disabled={!canPerformCSActionsOnOrder}
                      loading={fetcher.state === 'submitting'}
                      loadingText="Starting..."
                    >
                      Call customer
                    </Button>
                  )}

                  {/* CS_ENGAGED → Confirm order is the next step */}
                  {order.status === 'CS_ENGAGED' && canPerformCSActionsOnOrder && canConfirm && canTransitionTo('CONFIRMED') && (
                    <>
                      {hasPendingItemApproval && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">
                          Item/price change pending approval — cannot move forward
                        </p>
                      )}
                      <Button
                        type="button"
                        variant="primary"
                        className="w-full"
                        onClick={() => setConfirmModalOpen(true)}
                        disabled={fetcher.state === 'submitting' || hasPendingItemApproval}
                      >
                        Confirm order
                      </Button>
                    </>
                  )}

                  {/* CS_ENGAGED → Call customer is secondary (already called once) */}
                  {order.status === 'CS_ENGAGED' && !voipEnabled && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => setCallCustomerModalOpen(true)}
                      disabled={!canPerformCSActionsOnOrder}
                    >
                      Call customer
                    </Button>
                  )}

                  {/* CONFIRMED → Assign for delivery is the next step */}
                  {order.status === 'CONFIRMED' && canTransitionTo('AGENT_ASSIGNED') && (
                    <>
                      {hasPendingItemApproval && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">
                          Item/price change pending approval — cannot move forward
                        </p>
                      )}
                      {logisticsLocations.length === 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">
                          No logistics locations available — add one in Logistics settings first
                        </p>
                      )}
                      <Button
                        type="button"
                        variant="primary"
                        className="w-full"
                        onClick={() => { setAllocateLocationId(''); setAllocateModalOpen(true); }}
                        disabled={fetcher.state === 'submitting' || hasPendingItemApproval || logisticsLocations.length === 0}
                      >
                        Assign for delivery
                      </Button>
                    </>
                  )}

                  {/* AGENT_ASSIGNED → Mark delivered is the next step */}
                  {(order.status === 'AGENT_ASSIGNED' || order.status === 'DISPATCHED' || order.status === 'IN_TRANSIT') && canTransitionTo('DELIVERED') && (
                    <>
                      {hasPendingItemApproval && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">
                          Item/price change pending approval — cannot move forward
                        </p>
                      )}
                      <Button
                        type="button"
                        variant="success"
                        className="w-full"
                        onClick={() => {
                          setDeliverNote('');
                          setDeliverProofUrl('');
                          setDeliverLocationId(order.logisticsLocationId ?? logisticsLocations[0]?.id ?? '');
                          setDeliverCost('');
                          setDeliverModalOpen(true);
                        }}
                        disabled={fetcher.state === 'submitting' || hasPendingItemApproval}
                      >
                        Mark delivered
                      </Button>
                    </>
                  )}

                  {/* Reassign to another location — available from AGENT_ASSIGNED through IN_TRANSIT */}
                  {['AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT'].includes(order.status) && logisticsLocations.length > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => { setAllocateLocationId(order.logisticsLocationId ?? ''); setAllocateModalOpen(true); }}
                      disabled={fetcher.state === 'submitting'}
                    >
                      Reassign to another location
                    </Button>
                  )}

                  {/* Share to logistics WhatsApp */}
                  {order.status === 'AGENT_ASSIGNED' && (() => {
                    const locationsWithGroup = logisticsLocations.filter((l) => !!l.whatsappGroupLink);
                    return locationsWithGroup.length > 0 && logisticsDispatchTemplates.length > 0 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        onClick={() => {
                          setShareError(null);
                          const alreadyAllocated = order.logisticsLocationId
                            ? locationsWithGroup.find((l) => l.id === order.logisticsLocationId)
                            : undefined;
                          setShareLocationId(alreadyAllocated?.id ?? locationsWithGroup[0]?.id ?? '');
                          setShareTemplateId(logisticsDispatchTemplates[0]?.id ?? '');
                          setShareModalOpen(true);
                        }}
                        disabled={sharePending}
                      >
                        Share to logistics (WhatsApp)
                      </Button>
                    ) : null;
                  })()}

                  {/* Post-confirm/logistics: Call customer as secondary (follow-up calls) */}
                  {(order.status === 'CONFIRMED' || order.status === 'AGENT_ASSIGNED' || order.status === 'DISPATCHED' || order.status === 'IN_TRANSIT') && !voipEnabled && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => setCallCustomerModalOpen(true)}
                      disabled={!canPerformCSActionsOnOrder}
                    >
                      Call customer
                    </Button>
                  )}

                  {/* ── Supporting actions (secondary) ── */}

                  {/* Schedule / reschedule callback */}
                  {canPerformCSActionsOnOrder &&
                    order.status !== 'DELIVERED' && order.status !== 'REMITTED' && order.status !== 'DELETED' && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => setScheduleCallbackModalOpen(true)}
                      disabled={scheduleFetcher.state === 'submitting'}
                    >
                      {(order.callbackScheduledAt || (order.callbackAttempts ?? 0) > 0) ? 'Reschedule callback' : 'Schedule callback'}
                    </Button>
                  )}

                  {/* Adjust order items */}
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      setPriceApprovalReason('');
                      setEditedItems(
                        order.orderItems.map((item) => ({
                          productId: item.productId,
                          productName: item.productName ?? null,
                          quantity: item.quantity,
                          unitPrice: Number(item.unitPrice),
                          offerLabel: item.offerLabel ?? null,
                        })),
                      );
                      setAdjustItemsModalOpen(true);
                    }}
                    disabled={!canPerformCSActionsOnOrder || order.orderItems.length === 0}
                  >
                    Adjust order items
                  </Button>

                  {/* Edit order details — address, state, name, notes */}
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => setEditDetailsModalOpen(true)}
                    disabled={!canPerformCSActionsOnOrder}
                  >
                    Edit order details
                  </Button>

                  {/* Reschedule delivery date */}
                  {order.preferredDeliveryDate?.trim() &&
                    order.status !== 'DELIVERED' && order.status !== 'REMITTED' && order.status !== 'DELETED' && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => {
                        setRescheduleDeliveryDate(order.preferredDeliveryDate?.slice(0, 10) ?? '');
                        setRescheduleDeliveryModalOpen(true);
                      }}
                      disabled={fetcher.state === 'submitting'}
                    >
                      Reschedule delivery
                    </Button>
                  )}

                  </>
                  )}

                  {canPerformCSActionsOnOrder && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => setAddCommentModalOpen(true)}
                      disabled={csCommentFetcher.state === 'submitting'}
                    >
                      Add comment
                    </Button>
                  )}

                  {showCopyOrderSummary && canPerformCSActionsOnOrder && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => void handleCopyOrderSummary()}
                    >
                      Copy order
                    </Button>
                  )}

                  {/* Retrack order status — HoCS, HoLogistics, SuperAdmin, Admin only */}
                  {canEditOrderStatus && order.status !== 'UNPROCESSED' && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => {
                        setEditStatusTarget('');
                        setEditStatusReason('');
                        setEditStatusModalOpen(true);
                      }}
                      disabled={fetcher.state === 'submitting'}
                    >
                      Retrack order status
                    </Button>
                  )}

                  {/* Delete order — before reassign */}
                  {canTransitionTo('DELETED') && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full border-danger-200 dark:border-danger-700 text-danger-700 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20"
                      onClick={() => {
                        setCancelModalOpen(true);
                        setCancelReason('Customer not picking');
                      }}
                      disabled={fetcher.state === 'submitting'}
                    >
                      Delete order
                    </Button>
                  )}

                  {/* Finance: Request delivered order deletion (dual-approval) */}
                  {(order.status === 'DELIVERED' || order.status === 'REMITTED') &&
                    (hasFinanceAccess({ role: userRole, permissions }) || isAdminLevel({ role: userRole })) &&
                    !order.pendingDeliveredOrderDeletionRequestId && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full border-danger-200 dark:border-danger-700 text-danger-700 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20"
                      onClick={() => setDeliveredDeletionModalOpen(true)}
                      disabled={deliveredDeletionFetcher.state === 'submitting'}
                    >
                      Request deletion
                    </Button>
                  )}
                  {order.pendingDeliveredOrderDeletionRequestId && (
                    <p className="text-xs text-warning-600 dark:text-warning-400 font-medium">
                      Deletion request pending approval
                    </p>
                  )}

                  {/* Assign / Reassign closer */}
                  {showCsAssignForm && csClosersForAssign && csClosersForAssign.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-app-fg-muted">
                        {order.assignedCsId ? 'Reassign closer' : 'Assign closer (Sales closer)'}
                      </p>
                      <fetcher.Form method="post" className="space-y-2">
                        <input type="hidden" name="intent" value="assignToCS" />
                        {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
                        {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
                        <input type="hidden" name="toCsAgentId" value={assignToId} />
                        <div className="flex items-stretch gap-2">
                          <SearchableSelect
                            id="order-assign-cs"
                            value={assignToId}
                            onChange={setAssignToId}
                            placeholder="Pick a closer to assign…"
                            options={csCloserOptions}
                            wrapperClassName="flex-1 min-w-0"
                            searchPlaceholder="Search closers..."
                            controlSize="lg"
                          />
                          <Button
                            type="submit"
                            variant="primary"
                            disabled={
                              !assignToId ||
                              (isLateStageCsTransfer && lateStageTransferReason.trim().length === 0) ||
                              fetcher.state === 'submitting'
                            }
                            loading={fetcher.state === 'submitting'}
                            loadingText={order.assignedCsId ? 'Reassigning…' : 'Assigning…'}
                          >
                            {order.assignedCsId ? 'Reassign' : 'Assign'}
                          </Button>
                        </div>
                        {isLateStageCsTransfer && (
                          <Textarea
                            name="reason"
                            rows={2}
                            maxLength={280}
                            required
                            placeholder="Reason for reassignment (e.g. wrong closer credited at confirm)"
                            value={lateStageTransferReason}
                            onChange={(e) => setLateStageTransferReason(e.target.value)}
                          />
                        )}
                      </fetcher.Form>
                    </div>
                  )}
                </div>
                </>
                )}
              </div>
            )}

            {/* Restore — cancelled and deleted orders stay in the database. Admin /
                Super Admin can send them back to the unprocessed queue. */}
            {canEditOrder && (order.status === 'CANCELLED' || order.status === 'DELETED') && isAdminLevel({ role: userRole }) && (
              <div className="card">
                <h2 className="text-lg font-semibold text-app-fg mb-1">
                  {order.status === 'DELETED' ? 'Deleted order' : 'Cancelled order'}
                </h2>
                <p className="text-sm text-app-fg-muted mb-3">
                  {order.status === 'DELETED'
                    ? 'This order was deleted and excluded from metrics. Restoring sends it back to the unprocessed queue.'
                    : 'This order was cancelled. Restoring sends it back to the unprocessed queue for re-assignment.'}
                </p>
                <Button
                  type="button"
                  variant="primary"
                  className="w-full"
                  onClick={() => setRestoreModalOpen(true)}
                  disabled={fetcher.state === 'submitting'}
                >
                  Restore to Unprocessed
                </Button>
              </div>
            )}

            {canEditOrder &&
              userRole === 'HEAD_OF_LOGISTICS' &&
              order.branchId &&
              orderAllowsLineItemEdits &&
              (isOrgWideDepartmentHead({ role: userRole }) ||
                (!!currentBranchId && order.branchId === currentBranchId)) && (
                <div className="card">
                  <h2 className="text-lg font-semibold text-app-fg mb-3">Line items & pricing</h2>
                  <p className="text-sm text-app-fg-muted mb-3">
                    Adjust quantities or unit prices on orders for your branch (same window as CS, before dispatch
                    completes).
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      setPriceApprovalReason('');
                      setEditedItems(
                        order.orderItems.map((item) => ({
                          productId: item.productId,
                          productName: item.productName ?? null,
                          quantity: item.quantity,
                          unitPrice: Number(item.unitPrice),
                          offerLabel: item.offerLabel ?? null,
                        })),
                      );
                      setAdjustItemsModalOpen(true);
                    }}
                    disabled={order.orderItems.length === 0}
                  >
                    Adjust order items
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => setEditDetailsModalOpen(true)}
                  >
                    Edit order details
                  </Button>
                </div>
              )}

            {/* Open Logistics Group Chat + missing-group hint — kept outside Order Actions
                because they depend on the allocated location and only make sense post-allocation. */}
            {canEditOrder && showPostAllocationWhatsAppActions && (
              <div className="card order-[-2] lg:order-none">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() =>
                    window.open(
                      logisticsLocationWithGroupLink!.whatsappGroupLink as string,
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  Open Logistics Group Chat
                </Button>
              </div>
            )}

            {/* Communication Panel — unified Call/SMS/WhatsApp panel for Sales closers.
                Hidden once the order leaves the CS lifecycle (DELIVERED / REMITTED /
                CANCELLED / DELETED / RETURNED / WRITTEN_OFF / RESTOCKED / PARTIALLY_DELIVERED) —
                customer engagement is already done at that point and the panel
                just clutters the post-delivery view. */}
            {canEditOrder &&
              canPerformCSActionsOnOrder &&
              order.assignedCsId &&
              order.status !== 'DELIVERED' &&
              order.status !== 'REMITTED' &&
              order.status !== 'CANCELLED' &&
              order.status !== 'DELETED' &&
              order.status !== 'RETURNED' &&
              order.status !== 'WRITTEN_OFF' &&
              order.status !== 'RESTOCKED' &&
              order.status !== 'PARTIALLY_DELIVERED' && (
              // Wrapper carries the mobile `order-N` so Customer Communication
              // lands immediately after Order Actions on stacked layouts. The
              // panel itself draws no card chrome — wrapper is structural only.
              <div className="order-[-1] lg:order-none">
              <CSMessagingPanel
                orderId={order.id}
                orderBranchId={order.branchId ?? null}
                customerName={order.customerName}
                deliveryAddress={order.deliveryAddress}
                productName={order.orderItems[0]?.productName ?? null}
                estimatedDate={order.preferredDeliveryDate ?? null}
                showCallTab={voipEnabled}
                callContent={
                  voipEnabled && (order.status === 'CS_ENGAGED' || ((order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED') && canTransitionTo('CS_ENGAGED'))) ? (
                    <DeferredSection resolve={latestCall} skeleton="card">
                      {(resolvedCall) => (
                        <VoipCallPanelWithPolling
                          order={order}
                          resolvedCall={resolvedCall}
                          canConfirm={canConfirm}
                          fetcher={fetcher}
                          revalidate={revalidate}
                          onOpenCallModal={() => setCallCustomerModalOpen(true)}
                          voipProviderDisplayName={voipProviderDisplayName}
                        />
                      )}
                    </DeferredSection>
                  ) : (
                    <p className="text-sm text-app-fg-muted">
                      VOIP calling is available once the order is in Unconfirmed status.
                    </p>
                  )
                }
              />
              </div>
            )}

            {/* Order Info — dynamic fields: show 4 preview rows, rest in collapsible */}
            <OrderDetailsCard order={order} />

            {/* Form-builder custom fields — only rendered when the campaign has custom
                fields defined AND the customer answered at least one. Uses the campaign's
                field definitions to map response ids back to human-readable labels. */}
            <CustomFieldsCard
              defs={order.campaignCustomFieldDefs ?? []}
              responses={order.customFields ?? null}
            />
          </div>
        </div>

      {/* Confirm order modal */}
      {confirmModalOpen && (
        <Modal
          open
          onClose={() => {
            setConfirmModalOpen(false);
            setDeliveryDate('');
          }}
          maxWidth="max-w-md"
          contentClassName="p-6 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-1">Confirm order</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            Choose when logistics should deliver, then confirm when the customer is ready.
          </p>
          <ModalFetcherInlineError message={fetcherErrorForTransition('CONFIRMED')} />
          <fetcher.Form method="post" className="block space-y-4">
            <input type="hidden" name="intent" value="transition" />
                {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
            <input type="hidden" name="newStatus" value="CONFIRMED" />
            {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
            <input type="hidden" name="preferredDeliveryDate" value={deliveryDate} />
            <div className="space-y-2">
              <TextInput
                type="date"
                label="Scheduled delivery date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                required
                aria-label="Delivery date"
              />
              <p className="text-xs text-app-fg-muted">
                When should logistics deliver this order? Required before you can confirm.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => {
                  setConfirmModalOpen(false);
                  setDeliveryDate('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="w-full sm:w-auto"
                disabled={fetcher.state === 'submitting' || !deliveryDate.trim()}
                loading={fetcher.state === 'submitting'}
                loadingText="Confirming..."
              >
                Confirm now
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Schedule callback modal */}
      {scheduleCallbackModalOpen && (
        <Modal
          open
          onClose={() => {
            setScheduleCallbackModalOpen(false);
            setScheduleDelaySelect('120');
            setScheduleCustomAmount(2);
            setScheduleCustomUnit('hours');
            setScheduleNotes('');
          }}
          maxWidth="max-w-md"
          contentClassName="p-6 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-1">Schedule callback</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            Move the order back to your queue and set a time to call again (for example when the customer is not picking up).
          </p>
          <ModalFetcherInlineError message={scheduleSurface.errorMatchingIntent('scheduleCallback')} />
          <scheduleFetcher.Form method="post" className="block space-y-4">
            <input type="hidden" name="intent" value="scheduleCallback" />
            {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
            <input type="hidden" name="delayMinutes" value={scheduleCallbackHiddenDelayMinutes} />
            <input type="hidden" name="notes" value={scheduleNotes} />
            <FormSelect
              id="schedule-callback-delay"
              label="Delay"
              value={scheduleDelaySelect}
              onChange={(e) => setScheduleDelaySelect(e.target.value)}
              aria-label="Callback delay"
              options={[
                { value: '30', label: '30 minutes' },
                { value: '60', label: '1 hour' },
                { value: '120', label: '2 hours' },
                { value: '240', label: '4 hours' },
                { value: '480', label: '8 hours' },
                { value: '1440', label: '24 hours' },
                { value: 'custom', label: 'Custom…' },
              ]}
            />
            {scheduleDelaySelect === 'custom' ? (
              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                  <NumberInput
                    label="Amount"
                    wrapperClassName="flex-1 min-w-0"
                    value={scheduleCustomAmount}
                    onValueChange={setScheduleCustomAmount}
                    min={scheduleCustomAmountMin}
                    max={scheduleCustomAmountMax}
                    coerce="integer"
                    allowEmpty
                    onValueCleared={() => setScheduleCustomAmount(null)}
                    aria-label="Custom callback delay amount"
                  />
                  <FormSelect
                    label="Unit"
                    value={scheduleCustomUnit}
                    onChange={(e) =>
                      setScheduleCustomUnit(e.target.value as CallbackCustomDelayUnit)
                    }
                    options={[
                      { value: 'minutes', label: 'Minutes' },
                      { value: 'hours', label: 'Hours' },
                      { value: 'days', label: 'Days' },
                    ]}
                    wrapperClassName="sm:w-40 shrink-0"
                    aria-label="Custom delay unit"
                  />
                </div>
                <p className="text-xs text-app-fg-muted">
                  Total delay must be between 5 minutes and 7 days.
                  {scheduleDelayInvalid ? (
                    <span className="block text-danger-600 dark:text-danger-400 mt-1">
                      Adjust the amount so the total falls in that range.
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
            <Textarea
              label="Notes (optional)"
              value={scheduleNotes}
              onChange={(e) => setScheduleNotes(e.target.value)}
              placeholder="e.g. Customer not picking"
              rows={2}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => {
                  setScheduleCallbackModalOpen(false);
                  setScheduleDelaySelect('120');
                  setScheduleCustomAmount(2);
                  setScheduleCustomUnit('hours');
                  setScheduleNotes('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="w-full sm:w-auto"
                disabled={scheduleFetcher.state === 'submitting' || scheduleDelayInvalid}
                loading={scheduleFetcher.state === 'submitting'}
                loadingText="Scheduling..."
              >
                Schedule callback
              </Button>
            </div>
          </scheduleFetcher.Form>
        </Modal>
      )}

      {/* Reschedule delivery date modal */}
      {rescheduleDeliveryModalOpen && (
        <Modal
          open
          onClose={() => {
            setRescheduleDeliveryModalOpen(false);
            setRescheduleDeliveryDate('');
          }}
          maxWidth="max-w-md"
          contentClassName="p-6 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-1">Reschedule delivery</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            Pick a new delivery date for this order.
          </p>
          <fetcher.Form method="post" className="block space-y-4">
            <input type="hidden" name="intent" value="editOrderDetails" />
            {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
            {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
            <input type="hidden" name="customerName" value={order.customerName ?? ''} />
            <TextInput
              type="date"
              label="New delivery date"
              name="preferredDeliveryDate"
              value={rescheduleDeliveryDate}
              onChange={(e) => setRescheduleDeliveryDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              required
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => {
                  setRescheduleDeliveryModalOpen(false);
                  setRescheduleDeliveryDate('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="w-full sm:w-auto"
                disabled={fetcher.state === 'submitting' || !rescheduleDeliveryDate.trim()}
                loading={fetcher.state === 'submitting'}
                loadingText="Saving..."
              >
                Update date
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Add timeline comment (does not change order status) */}
      {addCommentModalOpen && (
        <Modal
          open
          onClose={() => {
            setAddCommentModalOpen(false);
            setCsCommentDraft('');
          }}
          maxWidth="max-w-md"
          contentClassName="p-6 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-1">Add comment</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            This note appears on Order Activity. It does not change order status.
          </p>
          <ModalFetcherInlineError message={csCommentSurface.errorMatchingIntent('addCsOrderComment')} />
          <csCommentFetcher.Form method="post" className="block space-y-4">
            <input type="hidden" name="intent" value="addCsOrderComment" />
            {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
            {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
            <input type="hidden" name="comment" value={csCommentDraft} />
            <Textarea
              label="Comment"
              value={csCommentDraft}
              onChange={(e) => setCsCommentDraft(e.target.value)}
              placeholder="e.g. Customer prefers evening delivery"
              rows={4}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => {
                  setAddCommentModalOpen(false);
                  setCsCommentDraft('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="w-full sm:w-auto"
                disabled={csCommentFetcher.state === 'submitting' || !csCommentDraft.trim()}
                loading={csCommentFetcher.state === 'submitting'}
                loadingText="Saving…"
              >
                Save comment
              </Button>
            </div>
          </csCommentFetcher.Form>
        </Modal>
      )}

      {/* Delete order modal (transition to DELETED) — CEO directive 2026-05-23 */}
      {cancelModalOpen && (
        <Modal open onClose={() => { setCancelModalOpen(false); setCancelReason(''); }} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-app-fg mb-1">Delete order</h3>
            <p className="text-sm text-app-fg-muted mb-3">
              Please provide a reason (at least 10 characters). Deleted orders are removed from metrics but stay in the database.
            </p>
            <ModalFetcherInlineError message={fetcherErrorForTransition('DELETED')} />
            <div className="flex flex-wrap gap-2 mb-3">
              {['Customer not picking', 'Wrong number', 'Customer refused', 'Duplicate', 'Other'].map((preset) => {
                const isOther = preset === 'Other';
                const isActive = isOther
                  ? cancelReason.length > 0 && !['Customer not picking', 'Wrong number', 'Customer refused', 'Duplicate'].includes(cancelReason)
                  : cancelReason === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCancelReason(isOther ? '' : preset)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-700'
                        : 'bg-app-hover text-app-fg-muted border border-app-border hover:bg-app-hover'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Enter deletion reason..."
              rows={3}
            />
            <div className="flex gap-2 mt-4 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCancelModalOpen(false);
                  setCancelReason('');
                }}
              >
                Back
              </Button>
              <fetcher.Form
                method="post"
              >
                <input type="hidden" name="intent" value="transition" />
                {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
                <input type="hidden" name="newStatus" value="DELETED" />
                {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
                <input type="hidden" name="reason" value={cancelReason} />
                <Button
                  type="submit"
                  variant="primary"
                  className="border-danger-500 bg-danger-500 hover:bg-danger-600 text-white"
                  disabled={cancelReason.trim().length < 10 || fetcher.state === 'submitting'}
                  loading={fetcher.state === 'submitting'}
                  loadingText="Deleting..."
                >
                  Delete order
                </Button>
              </fetcher.Form>
            </div>
        </Modal>
      )}

      {/* Delivered order deletion request modal — Finance dual-approval */}
      {deliveredDeletionModalOpen && (
        <Modal open onClose={() => { setDeliveredDeletionModalOpen(false); setDeliveredDeletionReason(''); }} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-app-fg mb-1">Request order deletion</h3>
            <p className="text-sm text-app-fg-muted mb-3">
              This will submit a deletion request for this delivered order. Both the Head of CS and Head of Logistics must approve before it is deleted and stock is reversed.
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {['Duplicate delivery', 'Erroneous delivery', 'Duplicate order', 'Other'].map((preset) => {
                const isOther = preset === 'Other';
                const isActive = isOther
                  ? deliveredDeletionReason.length > 0 && !['Duplicate delivery', 'Erroneous delivery', 'Duplicate order'].includes(deliveredDeletionReason)
                  : deliveredDeletionReason === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDeliveredDeletionReason(isOther ? '' : preset)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-700'
                        : 'bg-app-hover text-app-fg-muted border border-app-border hover:bg-app-hover'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <Textarea
              value={deliveredDeletionReason}
              onChange={(e) => setDeliveredDeletionReason(e.target.value)}
              placeholder="Enter deletion reason..."
              rows={3}
            />
            <div className="flex gap-2 mt-4 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDeliveredDeletionModalOpen(false);
                  setDeliveredDeletionReason('');
                }}
              >
                Cancel
              </Button>
              <deliveredDeletionFetcher.Form method="post">
                <input type="hidden" name="intent" value="requestDeliveredOrderDeletion" />
                <input type="hidden" name="reason" value={deliveredDeletionReason} />
                <Button
                  type="submit"
                  variant="primary"
                  className="border-danger-500 bg-danger-500 hover:bg-danger-600 text-white"
                  disabled={deliveredDeletionReason.trim().length < 10 || deliveredDeletionFetcher.state === 'submitting'}
                  loading={deliveredDeletionFetcher.state === 'submitting'}
                  loadingText="Submitting..."
                >
                  Submit request
                </Button>
              </deliveredDeletionFetcher.Form>
            </div>
        </Modal>
      )}

      {/* Restore order modal (CANCELLED/DELETED → UNPROCESSED) — Admin / Super Admin only */}
      {restoreModalOpen && (
        <Modal open onClose={() => setRestoreModalOpen(false)} maxWidth="max-w-md" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-app-fg mb-1">
            Restore {order.status === 'DELETED' ? 'deleted' : 'cancelled'} order
          </h3>
          <p className="text-sm text-app-fg-muted mb-4">
            This order moves back to <strong>Unprocessed</strong> and returns to the
            unassigned queue. The previous closer assignment is cleared.
          </p>
          <ModalFetcherInlineError message={fetcherErrorForTransition('UNPROCESSED')} />
          <div className="flex gap-2 mt-4 justify-end">
            <Button type="button" variant="secondary" onClick={() => setRestoreModalOpen(false)}>
              Back
            </Button>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="transition" />
                {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
              <input type="hidden" name="newStatus" value="UNPROCESSED" />
              {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
              <Button
                type="submit"
                variant="primary"
                disabled={fetcher.state === 'submitting'}
                loading={fetcher.state === 'submitting'}
                loadingText="Restoring..."
              >
                Restore order
              </Button>
            </fetcher.Form>
          </div>
        </Modal>
      )}

      {/* Assign / move assignment — CONFIRMED → ALLOCATED or ALLOCATED → ALLOCATED */}
      {allocateModalOpen && (
        <Modal open onClose={() => setAllocateModalOpen(false)} maxWidth="max-w-md" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-app-fg mb-1">
            {order.status === 'AGENT_ASSIGNED'
              ? 'Reassign to another logistics location'
              : 'Assign to a logistics location'}
          </h3>
          <p className="text-sm text-app-fg-muted mb-3">
            {order.status === 'AGENT_ASSIGNED'
              ? 'Pick a different 3PL location. Shelf reservation at the current location is released and stock is reserved at the new one (both must have enough free units).'
              : 'Select the logistics company location that will fulfil this order. Stock must be available at that location.'}
          </p>
          <ModalFetcherInlineError message={fetcherErrorForTransition('AGENT_ASSIGNED')} />
          {syncHandoffAllocatableLocations.length > 0 ? (() => {
            // Only show locations with enough stock (eligible) for assignment.
            const eligibleOnly = syncHandoffAllocatableLocations.filter((l) =>
              l.eligible && !(order.status === 'AGENT_ASSIGNED' && l.id === order.logisticsLocationId),
            );
            if (eligibleOnly.length === 0) {
              return (
                <EmptyState
                  title="No locations with enough stock"
                  description="No logistics hub currently has enough free shelf stock for every line on this order. Receive stock (intake or verified transfer) and try again."
                  variant="card"
                />
              );
            }
            return (
              <>
                <SearchableSelect
                  id="allocate-location-id"
                  label="Logistics location"
                  value={allocateLocationId}
                  onChange={setAllocateLocationId}
                  placeholder="Select a location..."
                  searchPlaceholder="Search locations..."
                  options={eligibleOnly.map((loc) => ({
                    value: loc.id,
                    label: loc.providerName ? `${loc.name} ● ${loc.providerName}` : loc.name,
                    description: describeAllocatableLocation(loc),
                  }))}
                />
                <div className="flex gap-2 mt-4 justify-end">
                  <Button type="button" variant="secondary" onClick={() => setAllocateModalOpen(false)}>
                    Back
                  </Button>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
                    <input type="hidden" name="newStatus" value="AGENT_ASSIGNED" />
                    {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
                    <input type="hidden" name="logisticsLocationId" value={allocateLocationId} />
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={
                        !allocateLocationId ||
                        !selectedAllocatableLocation?.eligible ||
                        fetcher.state === 'submitting'
                      }
                      loading={fetcher.state === 'submitting'}
                      loadingText={order.status === 'AGENT_ASSIGNED' ? 'Reassigning…' : 'Assigning…'}
                    >
                      {order.status === 'AGENT_ASSIGNED' ? 'Reassign' : 'Assign'}
                    </Button>
                  </fetcher.Form>
                </div>
              </>
            );
          })() : (
            <>
              <EmptyState
                title="No locations with enough stock"
                description="No logistics hub currently has enough free shelf stock for every line on this order (or dispatch is locked). Receive stock (intake or verified transfer) and try again."
                variant="card"
              />
              <div className="flex gap-2 mt-4 justify-end">
                <Button type="button" variant="secondary" onClick={() => setAllocateModalOpen(false)}>
                  Back
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Mark delivered modal — IN_TRANSIT → DELIVERED. Mandatory note + optional proof screenshot. */}
      {deliverModalOpen && (
        <Modal
          open
          onClose={() => setDeliverModalOpen(false)}
          maxWidth="max-w-md"
          contentClassName="p-6 max-h-[90dvh] overflow-y-auto"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-1">Mark order delivered</h3>
          <p className="text-sm text-app-fg-muted mb-3">
            Confirm that the customer received the order. A note and screenshot are optional.
          </p>
          <ModalFetcherInlineError message={fetcherErrorForTransition('DELIVERED')} />
          {/* Logistics location picker — uses pre-resolved allocatable locations.
              Only locations with stock for this order's products are shown; the
              allocated location is always included and sorted first. */}
          {(() => {
              const allLocs = resolvedAllocatableLocations;
              const options = allLocs
                .filter((loc) => {
                  if (loc.id === order.logisticsLocationId) return true;
                  if (!loc.availabilityByProduct?.length) return false;
                  return loc.availabilityByProduct.some((p) => p.available > 0);
                })
                .map((loc) => {
                  const isAllocated = loc.id === order.logisticsLocationId;
                  const stockDesc = loc.availabilityByProduct
                    ?.map((p) => {
                      const total = p.available + p.needed;
                      return isAllocated
                        ? `${p.productName}: ${total} in stock (${p.needed} reserved for this order)`
                        : `${p.productName}: ${p.available} available`;
                    })
                    .join(' · ');
                  const originLabel = isAllocated ? 'Originally allocated' : undefined;
                  const description = [stockDesc, originLabel].filter(Boolean).join(' · ') || undefined;
                  return {
                    value: loc.id,
                    label: loc.providerName ? `${loc.name} ● ${loc.providerName}` : loc.name,
                    description,
                    _isAllocated: isAllocated,
                  };
                })
                .sort((a, b) => (a._isAllocated === b._isAllocated ? 0 : a._isAllocated ? -1 : 1));

              if (options.length === 0) return null;
              return (
                <div className="mb-4">
                  <p className="text-xs font-medium text-app-fg-muted mb-1.5">Logistics location</p>
                  <SearchableSelect
                    id="deliver-logistics-location"
                    value={deliverLocationId}
                    onChange={setDeliverLocationId}
                    placeholder="Select the location that delivered…"
                    options={options}
                    searchPlaceholder="Search locations..."
                    controlSize="lg"
                  />
                  {order.logisticsLocationId &&
                    deliverLocationId &&
                    deliverLocationId !== order.logisticsLocationId && (
                      <p className="mt-1.5 text-xs text-warning-700 dark:text-warning-400">
                        Different location from the original allocation — the original reserve will
                        be released and stock will be deducted at the chosen location.
                      </p>
                    )}
                </div>
              );
          })()}
          <div className="mb-4">
            <label htmlFor="delivery-cost" className="block text-sm font-medium text-app-fg mb-1">
              Cost of delivery (optional)
            </label>
            <AmountInput
              id="delivery-cost"
              placeholder="e.g. 2,500"
              value={deliverCost}
              onChange={setDeliverCost}
              prefix="₦"
              className="input w-full"
            />
          </div>
          <Textarea
            id="delivery-note"
            label="Delivery note (optional)"
            value={deliverNote}
            onChange={(e) => setDeliverNote(e.target.value)}
            placeholder="e.g. Customer confirmed receipt on follow-up call at 3:42pm."
            rows={3}
          />
          <div className="flex gap-2 mt-5 justify-end">
            <Button type="button" variant="secondary" onClick={() => setDeliverModalOpen(false)}>
              Back
            </Button>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="transition" />
                {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
              <input type="hidden" name="newStatus" value="DELIVERED" />
              {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
              {deliverLocationId && (
                <input type="hidden" name="logisticsLocationId" value={deliverLocationId} />
              )}
              {deliverCost && parseFloat(deliverCost) > 0 && (
                <input type="hidden" name="deliveryFeeAddOn" value={deliverCost} />
              )}
              {deliverNote.trim() && <input type="hidden" name="deliveryNote" value={deliverNote.trim()} />}
              {deliverProofUrl && <input type="hidden" name="deliveryProofUrl" value={deliverProofUrl} />}
              <Button
                type="submit"
                variant="success"
                disabled={
                  fetcher.state === 'submitting' ||
                  (logisticsLocations.length > 0 && !deliverLocationId)
                }
                loading={fetcher.state === 'submitting'}
                loadingText="Marking..."
              >
                Mark delivered
              </Button>
            </fetcher.Form>
          </div>
        </Modal>
      )}

      {/* Share to logistics company modal (WhatsApp group) — Phase 4. Server renders the template, logs the
          outbound message + timeline event, then we copy to clipboard and open the group link. */}
      {shareModalOpen && (() => {
        const locationsWithGroup = logisticsLocations.filter((l) => !!l.whatsappGroupLink);
        const selectedLocation = locationsWithGroup.find((l) => l.id === shareLocationId);
        const selectedTemplate = logisticsDispatchTemplates.find((t) => t.id === shareTemplateId);
        // Local preview — server is the authority on the final rendered text.
        const previewText = (selectedTemplate?.body ?? '')
          .replace(/\{\{customer_name\}\}/g, order.customerName ?? '')
          .replace(/\{\{order_id\}\}/g, order.id.slice(0, 8).toUpperCase())
          .replace(/\{\{product_name\}\}/g, order.orderItems[0]?.productName ?? '')
          .replace(/\{\{delivery_address\}\}/g, order.deliveryAddress ?? '')
          .replace(/\{\{quantity\}\}/g, order.orderItems[0]?.quantity != null ? String(order.orderItems[0]?.quantity) : '')
          .replace(/\{\{total_amount\}\}/g, order.totalAmount != null ? String(order.totalAmount) : '')
          .replace(/\{\{payment_status\}\}/g, order.paymentStatus ?? '')
          .replace(/\{\{estimated_date\}\}/g, '');
        const canSubmit = !!shareLocationId && !!shareTemplateId && !sharePending;
        return (
          <Modal
            open
            onClose={() => setShareModalOpen(false)}
            maxWidth="max-w-lg"
            contentClassName="p-6 max-h-[90dvh] overflow-y-auto"
          >
            <h3 className="text-lg font-semibold text-app-fg mb-1">Share to logistics company (WhatsApp)</h3>
            <p className="text-sm text-app-fg-muted mb-3">
              Pick a logistics company location and a template. Clicking <strong>Copy &amp; open group</strong> logs the message, copies the text to your clipboard, and opens the WhatsApp group. Paste with ⌘V / long-press then hit send.
            </p>

            <div className="space-y-3">
              <div>
                <SearchableSelect
                  label="Logistics company location"
                  value={shareLocationId}
                  onChange={(v) => setShareLocationId(v)}
                  placeholder="Select a location..."
                  searchPlaceholder="Search locations..."
                  options={locationsWithGroup.map((loc) => ({
                    value: loc.id,
                    label: loc.providerName ? `${loc.name} ● ${loc.providerName}` : loc.name,
                  }))}
                />
                {locationsWithGroup.length === 0 && (
                  <p className="text-xs text-warning-600 mt-1">
                    No logistics company locations have a WhatsApp group link configured. Ask Logistics to add one.
                  </p>
                )}
              </div>

              <div>
                <SearchableSelect
                  label="Template"
                  value={shareTemplateId}
                  onChange={(v) => setShareTemplateId(v)}
                  placeholder="Select a template..."
                  searchPlaceholder="Search templates..."
                  options={logisticsDispatchTemplates.map((t) => ({ value: t.id, label: t.name }))}
                />
              </div>

              {selectedTemplate && (
                <div>
                  <label className="block text-sm font-medium text-app-fg-muted mb-1.5">
                    Preview
                  </label>
                  <pre className="whitespace-pre-wrap text-sm p-3 rounded-lg bg-app-hover border border-app-border text-app-fg max-h-48 overflow-y-auto">
                    {previewText}
                  </pre>
                </div>
              )}

              {shareError && (
                <p className="text-sm text-danger-600 dark:text-danger-400">{shareError}</p>
              )}
            </div>

            <div className="flex gap-2 mt-5 justify-end">
              <Button type="button" variant="secondary" onClick={() => setShareModalOpen(false)} disabled={sharePending}>
                Back
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!canSubmit}
                loading={sharePending}
                loadingText="Sharing..."
                onClick={async () => {
                  if (!selectedLocation || !selectedTemplate) return;
                  setSharePending(true);
                  setShareError(null);
                  try {
                    const result = await shareOrderToLogistics({
                      orderId: order.id,
                      locationId: selectedLocation.id,
                      templateId: selectedTemplate.id,
                    });
                    // Copy rendered text to clipboard; fall back silently if the API isn't available.
                    try {
                      await navigator.clipboard.writeText(result.renderedBody);
                    } catch {
                      // ignore — user can still copy from the group if needed
                    }
                    window.open(result.groupLink, '_blank', 'noopener,noreferrer');
                    setShareModalOpen(false);
                    revalidator.revalidate();
                  } catch (err) {
                    setShareError(err instanceof Error ? err.message : 'Share failed');
                  } finally {
                    setSharePending(false);
                  }
                }}
              >
                Copy &amp; open group
              </Button>
            </div>
          </Modal>
        );
      })()}

      {/* Call customer modal — VOIP: Start call + status + debug; VOIP off: reveal number, copy, open dialer */}
      {callCustomerModalOpen && (
        <Modal open onClose={() => setCallCustomerModalOpen(false)} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-app-fg mb-1">Call customer</h3>
            {voipEnabled ? (
              <>
                <p className="text-sm text-app-fg-muted mb-3">
                  Start the call from here. The modal stays open so you can see status and debug info. Close when done.
                </p>
                <ModalFetcherInlineError message={fetcherSurface.errorMatchingIntent('initiateCall')} />
                <div className="flex flex-col gap-3 mb-4">
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full"
                    disabled={fetcher.state === 'submitting'}
                    loading={fetcher.state === 'submitting'}
                    loadingText="Connecting..."
                    onClick={() => {
                      setCallDebugLog((prev) => [...prev, `Initiate sent at ${new Date().toLocaleTimeString()}`]);
                      ensureBranchForAction({
                        actionLabel: 'starting a customer call',
                        onProceed: (branchId) =>
                          fetcher.submit(
                            {
                              intent: 'initiateCall',
                              branchId: order.branchId || branchId,
                              ...(isFollowUpOrder ? { isFollowUpOrder: 'true' } : {}),
                              ...(isCartOrder ? { isCartOrder: 'true' } : {}),
                            },
                            { method: 'post' },
                          ),
                      });
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                    </svg>
                    Start call
                  </Button>
                  {(fetcher.data as { callLog?: { callStatus?: string }; providerError?: string })?.providerError && (() => {
                    const providerError = (fetcher.data as { providerError?: string }).providerError;
                    // AT errors are plain strings (the body of the failed POST). We render them
                    // verbatim — they're typically short ("Insufficient credit", "Invalid phone").
                    return (
                      <div className="text-sm text-danger-600 dark:text-danger-400 rounded-md bg-danger-50 dark:bg-danger-900/20 p-3 space-y-2">
                        <p className="font-semibold">Call failed</p>
                        <p>{voipProviderDisplayName} error: {providerError}</p>
                      </div>
                    );
                  })()}
                  <p className="text-sm text-app-fg-muted">
                    Status: {fetcher.state === 'submitting' ? 'Connecting...' : (fetcher.data as { callLog?: { callStatus?: string } })?.callLog?.callStatus ?? order.callLogs[0]?.callStatus ?? 'Idle'}
                  </p>
                </div>
                <details className="mb-4 rounded-lg border border-app-border overflow-hidden">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-app-fg-muted bg-app-hover">
                    Logs &amp; debug
                  </summary>
                  <div className="p-3 border-t border-app-border bg-app-hover">
                    <p className="text-xs font-medium text-app-fg-muted mb-1">Last response</p>
                    <pre className="p-2 text-mini text-app-fg-muted whitespace-pre-wrap break-all overflow-x-auto max-h-32 overflow-y-auto font-mono bg-app-hover rounded mb-2">
                      {fetcher.data != null ? JSON.stringify(fetcher.data, null, 2) : '—'}
                    </pre>
                    <p className="text-xs font-medium text-app-fg-muted mb-1">Latest call</p>
                    <pre className="p-2 text-mini text-app-fg-muted whitespace-pre-wrap break-all overflow-x-auto max-h-24 overflow-y-auto font-mono bg-app-hover rounded mb-2">
                      {order.callLogs[0] != null
                        ? JSON.stringify(
                            {
                              id: order.callLogs[0].id,
                              callStatus: order.callLogs[0].callStatus,
                              durationSeconds: order.callLogs[0].durationSeconds,
                              startedAt: order.callLogs[0].startedAt,
                            },
                            null,
                            2,
                          )
                        : '—'}
                    </pre>
                    {callDebugLog.length > 0 && (
                      <>
                        <p className="text-xs font-medium text-app-fg-muted mb-1">Event log</p>
                        <ul className="list-disc list-inside text-mini text-app-fg-muted space-y-0.5">
                          {callDebugLog.map((line, i) => (
                            <li key={i}>{line}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                </details>
                <div className="flex justify-end">
                  <Button type="button" variant="secondary" onClick={() => setCallCustomerModalOpen(false)}>
                    Close
                  </Button>
                </div>
              </>
            ) : !callablePhone ? (
              /* No callable phone — VOIP is on, viewer not authorised, or order in a terminal status. */
              <>
                <p className="text-sm text-app-fg-muted mb-3">
                  The customer&apos;s number is not available. This can happen when VOIP is enabled, the order is in a terminal status, or you don&apos;t have access. Enable VOIP in Settings to call via the app, or record that you called using your own records below.
                </p>
                <div className="flex gap-2 justify-end flex-wrap">
                  <Button type="button" variant="secondary" onClick={() => setCallCustomerModalOpen(false)}>
                    Close
                  </Button>
                  <recordCallFetcher.Form method="post">
                    <input type="hidden" name="intent" value="initiateCall" />
                    {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
                    {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={recordCallFetcher.state === 'submitting'}
                      loading={recordCallFetcher.state === 'submitting'}
                      loadingText="Recording..."
                    >
                      I&apos;ve called the customer
                    </Button>
                  </recordCallFetcher.Form>
                </div>
              </>
            ) : !callablePhone.isDialable ? (
              <>
                <p className="text-sm text-app-fg-muted mb-3">
                  This order was created with phone protection. The customer&apos;s number is not stored in a dialable form and cannot be shown. Enable VOIP in Settings to call via the app, or record that you called using your own records below.
                </p>
                <div className="flex gap-2 justify-end flex-wrap">
                  <Button type="button" variant="secondary" onClick={() => setCallCustomerModalOpen(false)}>
                    Close
                  </Button>
                  <recordCallFetcher.Form method="post">
                    <input type="hidden" name="intent" value="initiateCall" />
                    {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
                    {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={recordCallFetcher.state === 'submitting'}
                      loading={recordCallFetcher.state === 'submitting'}
                      loadingText="Recording..."
                    >
                      I&apos;ve called the customer
                    </Button>
                  </recordCallFetcher.Form>
                </div>
              </>
            ) : (
              <>
                {/* Phone loaded with page — instant copy/dial, no fetch. */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const phone = callablePhone.phone;
                      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
                        toast.error('Copy failed', 'Clipboard is not available in this browser.');
                        return;
                      }
                      navigator.clipboard.writeText(phone).then(
                        () => {
                          setCopyFeedback(true);
                          setPhoneUnmasked(true);
                          setTimeout(() => setCopyFeedback(false), 2000);
                        },
                        () => toast.error('Copy failed', 'Could not copy the number — try again.'),
                      );
                      ensureBranchForAction({
                        actionLabel: 'recording customer call',
                        onProceed: (branchId) =>
                          recordCallFetcher.submit(
                            {
                              intent: 'initiateCall',
                              branchId: order.branchId || branchId,
                              ...(isFollowUpOrder ? { isFollowUpOrder: 'true' } : {}),
                              ...(isCartOrder ? { isCartOrder: 'true' } : {}),
                            },
                            { method: 'post' },
                          ),
                      });
                    }}
                  >
                    {copyFeedback ? 'Copied' : 'Copy number'}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    className="inline-flex items-center justify-center gap-2"
                    onClick={() => {
                      window.location.href = `tel:${callablePhone.phone}`;
                      setPhoneUnmasked(true);
                      ensureBranchForAction({
                        actionLabel: 'recording customer call',
                        onProceed: (branchId) =>
                          recordCallFetcher.submit(
                            {
                              intent: 'initiateCall',
                              branchId: order.branchId || branchId,
                              ...(isFollowUpOrder ? { isFollowUpOrder: 'true' } : {}),
                              ...(isCartOrder ? { isCartOrder: 'true' } : {}),
                            },
                            { method: 'post' },
                          ),
                      });
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                    </svg>
                    Call on my phone
                  </Button>
                </div>
                {(isCartOrder || isFollowUpOrder) && (
                  <div className="mt-4 pt-3 border-t border-app-border">
                    <recordCallFetcher.Form method="post">
                      <input type="hidden" name="intent" value="initiateCall" />
                      {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                      {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
                      {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
                      <Button
                        type="submit"
                        variant="secondary"
                        className="w-full"
                        disabled={recordCallFetcher.state === 'submitting'}
                        loading={recordCallFetcher.state === 'submitting'}
                        loadingText="Recording..."
                      >
                        I&apos;ve called the customer
                      </Button>
                    </recordCallFetcher.Form>
                  </div>
                )}
              </>
            )}
        </Modal>
      )}

      {/* Retrack order status modal */}
      <Modal
        open={editStatusModalOpen}
        onClose={() => setEditStatusModalOpen(false)}
        maxWidth="max-w-sm"
        contentClassName="p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-app-fg">Retrack order status</h3>
        <p className="text-sm text-app-fg-muted">
          Roll this order back to an earlier status. A reason is required for audit purposes.
        </p>
        <FormSelect
          label="Roll back to"
          value={editStatusTarget}
          onChange={(e) => setEditStatusTarget(e.target.value)}
          options={(() => {
            const lifecycle = [
              { value: 'UNPROCESSED', label: 'Unassigned' },
              { value: 'CS_ASSIGNED', label: 'Assigned' },
              { value: 'CS_ENGAGED', label: 'Unconfirmed' },
              { value: 'CONFIRMED', label: 'Confirmed' },
              { value: 'DELIVERED', label: 'Delivered' },
              { value: 'REMITTED', label: 'Cash Remitted' },
            ];
            const currentIdx = lifecycle.findIndex((s) => s.value === order.status);
            return currentIdx > 0 ? lifecycle.slice(0, currentIdx) : [];
          })()}
        />
        <Textarea
          label="Reason"
          value={editStatusReason}
          onChange={(e) => setEditStatusReason(e.target.value)}
          placeholder="Why is this status being changed?"
          rows={2}
        />
        {fetcherSurface.errorMatchingIntent('transition') && (
          <p className="text-sm text-danger-600 dark:text-danger-400">
            {fetcherSurface.errorMatchingIntent('transition')}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setEditStatusModalOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={
              fetcher.state === 'submitting' ||
              !editStatusTarget ||
              editStatusTarget === order.status ||
              !editStatusReason.trim()
            }
            loading={fetcher.state === 'submitting'}
            loadingText="Retracking…"
            onClick={() => {
              fetcher.submit(
                {
                  intent: 'transition',
                  newStatus: editStatusTarget,
                  reason: editStatusReason.trim(),
                  ...(isFollowUpOrder ? { isFollowUpOrder: 'true' } : {}),
                  ...(isCartOrder ? { isCartOrder: 'true' } : {}),
                },
                { method: 'post' },
              );
            }}
          >
            Retrack
          </Button>
        </div>
      </Modal>

      {/* Edit order details modal */}
      {editDetailsModalOpen && (
        <EditOrderDetailsModal
          order={order}
          fetcher={fetcher}
          onClose={() => setEditDetailsModalOpen(false)}
          isFollowUpOrder={isFollowUpOrder}
          isCartOrder={isCartOrder}
        />
      )}

      {/* Adjust order items modal */}
      {adjustItemsModalOpen && (
        <Modal
          open
          onClose={() => {
            setAdjustItemsModalOpen(false);
            setPriceApprovalReason('');
          }}
          maxWidth="max-w-lg"
          role="dialog"
          aria-labelledby="adjust-items-title"
          contentClassName="p-0 max-h-[90dvh] overflow-hidden flex flex-col"
        >
            <h2 id="adjust-items-title" className="text-lg font-semibold text-app-fg p-6 pb-2">
              Adjust order items
            </h2>
            <p className="text-sm text-app-fg-muted px-6 pb-4">
              {canEditLinePrices
                ? 'Change the product, offer, or price. This updates the order details only, not the status.'
                : 'Change the product or offer. Price or product changes require approval from a Head of CS, Head of Logistics, branch admin, or admin.'}
            </p>
            <div className="mx-6 mb-2 space-y-2">
              <ModalFetcherInlineError message={adjustItemsSurface.errorMatchingIntent('adjustOrderItems')} />
              <ModalFetcherInlineError message={priceRequestSurface.errorMatchingIntent('requestOrderLinePriceChange')} />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-4">
              {editedItems.map((item, index) => {
                const productOffers = offersByProduct.get(item.productId) ?? [];
                const offerLocked = item.offerLabel != null;
                return (
                  <div
                    key={`${item.productId}-${index}`}
                    className="rounded-lg border border-app-border p-3 space-y-3"
                  >
                    {/* Product selector */}
                    {productOptionsForAdjust.length > 0 ? (
                      <SearchableSelect
                        id={`adjust-product-${index}`}
                        label="Product"
                        value={item.productId}
                        onChange={(newProductId) => {
                          if (newProductId === item.productId) return;
                          const newProduct = productsForAdjust.find((p) => p.id === newProductId);
                          const newOffers = offersByProduct.get(newProductId) ?? [];
                          // Auto-select first offer if available, otherwise go to custom
                          const firstOffer = newOffers[0];
                          setEditedItems((prev) =>
                            prev.map((p, i) => {
                              if (i !== index) return p;
                              if (firstOffer) {
                                return {
                                  ...p,
                                  productId: newProductId,
                                  productName: newProduct?.name ?? null,
                                  offerLabel: firstOffer.label,
                                  quantity: firstOffer.quantity,
                                  unitPrice: firstOffer.unitPrice,
                                };
                              }
                              return {
                                ...p,
                                productId: newProductId,
                                productName: newProduct?.name ?? null,
                                offerLabel: null,
                                quantity: 1,
                                unitPrice: 0,
                              };
                            }),
                          );
                        }}
                        options={productOptionsForAdjust}
                        searchPlaceholder="Search products..."
                        wrapperClassName="w-full"
                        controlSize="sm"
                      />
                    ) : (
                      <p className="font-medium text-app-fg text-sm line-clamp-2">
                        {item.productName ?? item.productId.slice(0, 8) + '...'}
                      </p>
                    )}

                    {/* Offer cards — like the order creation flow */}
                    {productOffers.length > 0 && (
                      <div>
                        <label className="block text-xs font-medium text-app-fg-muted mb-2">
                          Select offer
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {productOffers.map((offer) => {
                            const isSelected = item.offerLabel === offer.label;
                            return (
                              <button
                                key={offer.label}
                                type="button"
                                onClick={() => {
                                  setEditedItems((prev) =>
                                    prev.map((p, i) => {
                                      if (i !== index) return p;
                                      return {
                                        ...p,
                                        offerLabel: offer.label,
                                        quantity: offer.quantity,
                                        unitPrice: offer.unitPrice,
                                      };
                                    }),
                                  );
                                }}
                                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                                  isSelected
                                    ? 'border-brand-500 bg-brand-50/10 dark:bg-brand-900/20'
                                    : 'border-app-border bg-app-elevated hover:border-app-fg-muted'
                                }`}
                              >
                                <p className="text-sm font-semibold text-app-fg">{offer.label}</p>
                                <div className="flex items-center justify-between gap-2 mt-1">
                                  <span className="text-xs text-app-fg-muted">Qty: {offer.quantity}</span>
                                  <span className="text-sm font-bold text-app-fg tabular-nums">
                                    <NairaPrice amount={offer.unitPrice} />
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                          {/* Custom option card */}
                          <button
                            type="button"
                            onClick={() => {
                              setEditedItems((prev) =>
                                prev.map((p, i) => {
                                  if (i !== index) return p;
                                  return { ...p, offerLabel: null };
                                }),
                              );
                            }}
                            className={`rounded-lg border-2 p-3 text-left transition-colors ${
                              !item.offerLabel
                                ? 'border-brand-500 bg-brand-50/10 dark:bg-brand-900/20'
                                : 'border-app-border bg-app-elevated hover:border-app-fg-muted'
                            }`}
                          >
                            <p className="text-sm font-semibold text-app-fg">Custom</p>
                            <p className="text-xs text-app-fg-muted mt-1">Set your own quantity & price — requires approval</p>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Quantity & price inputs — shown when Custom is selected or no offers exist */}
                    {!offerLocked && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-app-fg-muted mb-1">Quantity</label>
                          <NumberInput
                            min={1}
                            fallbackValue={1}
                            value={item.quantity}
                            onValueChange={(v) =>
                              setEditedItems((prev) =>
                                prev.map((p, i) => (i === index ? { ...p, quantity: v } : p)),
                              )
                            }
                            aria-label={`Quantity for ${item.productName ?? 'item'}`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-app-fg-muted mb-1">Price (&#8358;)</label>
                          <NumberInput
                            coerce="decimal"
                            min={0}
                            fallbackValue={0}
                            useGrouping
                            value={item.unitPrice}
                            onValueChange={(v) =>
                              setEditedItems((prev) =>
                                prev.map((p, i) => (i === index ? { ...p, unitPrice: v } : p)),
                              )
                            }
                            aria-label={`Price for ${item.productName ?? 'item'}`}
                          />
                        </div>
                      </div>
                    )}

                    {/* Selected summary bar */}
                    <div className="rounded-lg border border-app-border bg-app-hover px-3 py-2 flex items-center justify-between">
                      <div className="text-sm text-app-fg min-w-0">
                        <span className="font-medium truncate">{item.productName ?? 'Product'}</span>
                        {item.offerLabel && (
                          <span className="text-app-fg-muted"> · {item.offerLabel} · Qty {item.quantity}</span>
                        )}
                        {!item.offerLabel && (
                          <span className="text-app-fg-muted"> · Custom · Qty {item.quantity}</span>
                        )}
                      </div>
                      <span className="text-sm font-bold text-app-fg tabular-nums shrink-0 ml-2">
                        <NairaPrice amount={item.unitPrice} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {itemsChanged && (
              <div className="px-6 pt-3 pb-2 space-y-2">
                <label htmlFor="price-approval-reason" className="block text-xs text-app-fg-muted font-medium">
                  Reason for change (required, min 10 characters)
                </label>
                <Textarea
                  id="price-approval-reason"
                  rows={3}
                  value={priceApprovalReason}
                  onChange={(e) => setPriceApprovalReason(e.target.value)}
                  placeholder="Explain why this order's product or pricing should be changed…"
                  className="w-full"
                />
                {!canEditLinePrices && order.pendingOrderLinePriceRequestId && (
                  <p className="text-xs text-warning-700 dark:text-warning-300">
                    A change request is already pending approval. Wait for a decision or withdraw it from Permission Requests.
                  </p>
                )}
              </div>
            )}
            <div className="p-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-app-border">
              <p className="text-sm font-semibold text-app-fg mb-4">
                Total: &#8358;
                {editedItems.reduce((sum, i) => sum + i.unitPrice, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setAdjustItemsModalOpen(false);
                    setPriceApprovalReason('');
                  }}
                >
                  Cancel
                </Button>
                {!canEditLinePrices && priceDriftProposing ? (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={
                      priceRequestFetcher.state === 'submitting' ||
                      adjustItemsFetcher.state === 'submitting' ||
                      editedItems.some((i) => i.quantity < 1 || i.unitPrice < 0) ||
                      priceApprovalReason.trim().length < 10 ||
                      !!order.pendingOrderLinePriceRequestId
                    }
                    loading={priceRequestFetcher.state === 'submitting'}
                    loadingText="Submitting…"
                    onClick={() => {
                      const payload = editedItems.map(({ productId, quantity, unitPrice, offerLabel }) => ({
                        productId,
                        quantity,
                        unitPrice: Math.round(unitPrice * 100) / 100,
                        ...(offerLabel ? { offerLabel } : {}),
                      }));
                      const totalAmount = Math.round(payload.reduce((sum, i) => sum + i.unitPrice, 0) * 100) / 100;
                      const fd: Record<string, string> = {
                        intent: 'requestOrderLinePriceChange',
                        items: JSON.stringify(payload),
                        totalAmount: String(totalAmount),
                        reason: priceApprovalReason.trim(),
                      };
                      if (isFollowUpOrder) fd.isFollowUpOrder = 'true';
                      if (isCartOrder) fd.isCartOrder = 'true';
                      ensureBranchForAction({
                        actionLabel: 'submitting the change request',
                        onProceed: (branchId) => {
                          fd.branchId = order.branchId || branchId;
                          priceRequestFetcher.submit(fd, { method: 'post' });
                        },
                      });
                    }}
                  >
                    Submit change for approval
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={
                      adjustItemsFetcher.state === 'submitting' ||
                      priceRequestFetcher.state === 'submitting' ||
                      editedItems.some((i) => i.quantity < 1 || i.unitPrice < 0) ||
                      (itemsChanged && priceApprovalReason.trim().length < 10)
                    }
                    loading={adjustItemsFetcher.state === 'submitting'}
                    loadingText="Saving..."
                    onClick={() => {
                      const payload = editedItems.map(({ productId, quantity, unitPrice, offerLabel }) => ({
                        productId,
                        quantity,
                        unitPrice: Math.round(unitPrice * 100) / 100,
                        ...(offerLabel ? { offerLabel } : {}),
                      }));
                      const totalAmount = Math.round(payload.reduce((sum, i) => sum + i.unitPrice, 0) * 100) / 100;
                      ensureBranchForAction({
                        actionLabel: 'updating order items',
                        onProceed: (branchId) => {
                          const fd: Record<string, string> = {
                            intent: 'adjustOrderItems',
                            items: JSON.stringify(payload),
                            totalAmount: String(totalAmount),
                            branchId: order.branchId || branchId,
                            reason: priceApprovalReason.trim(),
                          };
                          if (isFollowUpOrder) fd.isFollowUpOrder = 'true';
                          if (isCartOrder) fd.isCartOrder = 'true';
                          adjustItemsFetcher.submit(fd, { method: 'post' });
                        },
                      });
                    }}
                  >
                    Save
                  </Button>
                )}
              </div>
            </div>
        </Modal>
      )}

      <Suspense fallback={null}>
        <InvoicePreviewModal invoice={invoicePreview} onClose={() => setInvoicePreview(null)} />
      </Suspense>

      {duplicateCompareOpen && order.duplicateOfId && (
        <Suspense fallback={null}>
          <DuplicateComparisonModal
            open
            onClose={() => setDuplicateCompareOpen(false)}
            currentOrder={order}
          />
        </Suspense>
      )}

      {/* Unfreeze confirmation modal — requires reason */}
      {unfreezeModalOpen && (
        <Modal open onClose={() => setUnfreezeModalOpen(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-app-fg">Unfreeze order</h3>
          <p className="text-sm text-app-fg-muted">
            This will allow CS to resume working on the original order. The follow-up copy will remain active. Provide a reason for the audit trail.
          </p>
          <TextInput
            label="Reason"
            id="unfreeze-reason"
            value={unfreezeReason}
            onChange={(e) => setUnfreezeReason(e.target.value)}
            placeholder="e.g. Customer called back on original number"
            required
          />
          <div className="flex justify-end gap-2 pt-2 border-t border-app-border">
            <Button variant="secondary" onClick={() => setUnfreezeModalOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!unfreezeReason.trim() || fetcher.state === 'submitting'}
              loading={fetcher.state === 'submitting'}
              loadingText="Unfreezing..."
              onClick={() => {
                fetcher.submit(
                  { intent: 'unfreezeOrder', reason: unfreezeReason.trim() },
                  { method: 'post' },
                );
              }}
            >
              Unfreeze
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Renders form-builder custom-field responses on the order detail page.
 *
 * `defs` is the campaign's `formConfig.customFields` array — provides the label, type, and
 * options for each field. `responses` is the order's `custom_fields` JSONB — `{ fieldId: value }`.
 * The card walks `defs` (so order is preserved + we don't render orphaned response keys
 * when a field was deleted post-submission) and looks up each value from `responses`.
 *
 * Hidden entirely when there are no defs OR no answered fields — empty cards add visual
 * noise without information.
 */
const NIGERIAN_STATES = [
  'Lagos', 'Abuja (FCT)', 'Rivers', 'Oyo', 'Kano', 'Delta', 'Edo', 'Ogun',
  'Anambra', 'Enugu', 'Kaduna', 'Imo', 'Abia', 'Kwara', 'Osun', 'Ondo',
  'Ekiti', 'Bayelsa', 'Cross River', 'Akwa Ibom', 'Plateau', 'Benue',
  'Nasarawa', 'Niger', 'Kogi', 'Taraba', 'Adamawa', 'Bauchi', 'Gombe',
  'Borno', 'Yobe', 'Jigawa', 'Zamfara', 'Sokoto', 'Kebbi', 'Katsina', 'Ebonyi',
];

function EditOrderDetailsModal({
  order,
  fetcher,
  onClose,
  isFollowUpOrder = false,
  isCartOrder = false,
}: {
  order: OrderDetail;
  fetcher: ReturnType<typeof useFetcher>;
  onClose: () => void;
  isFollowUpOrder?: boolean;
  isCartOrder?: boolean;
}) {
  const [customerName, setCustomerName] = useState(order.customerName ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress ?? '');
  const [deliveryState, setDeliveryState] = useState(order.deliveryState ?? '');
  const [deliveryNotes, setDeliveryNotes] = useState(order.deliveryNotes ?? '');
  const [customerEmail, setCustomerEmail] = useState(order.customerEmail ?? '');
  const [preferredDeliveryDate, setPreferredDeliveryDate] = useState(
    order.preferredDeliveryDate?.slice(0, 10) ?? '',
  );

  useCloseOnFetcherSuccess(fetcher, onClose);

  const isSubmitting = fetcher.state === 'submitting';

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="max-w-md"
      contentClassName="p-6 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <h3 className="text-lg font-semibold text-app-fg mb-1">Edit order details</h3>
      <p className="text-sm text-app-fg-muted mb-4">
        Update customer info, delivery address, or state.
      </p>
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="editOrderDetails" />
            {isFollowUpOrder && <input type="hidden" name="isFollowUpOrder" value="true" />}
                          {isCartOrder && <input type="hidden" name="isCartOrder" value="true" />}
        {order.branchId && <input type="hidden" name="branchId" value={order.branchId} />}

        <TextInput
          label="Customer name"
          name="customerName"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
          minLength={1}
        />

        <Textarea
          label="Delivery address"
          name="deliveryAddress"
          value={deliveryAddress}
          onChange={(e) => setDeliveryAddress(e.target.value)}
          rows={2}
          placeholder="Delivery address"
        />

        <FormSelect
          label="Delivery state"
          name="deliveryState"
          value={deliveryState}
          onChange={(e) => setDeliveryState(e.target.value)}
          options={[
            { value: '', label: 'Select state' },
            ...NIGERIAN_STATES.map((s) => ({ value: s, label: s })),
          ]}
        />

        <TextInput
          label="Scheduled delivery date"
          name="preferredDeliveryDate"
          type="date"
          value={preferredDeliveryDate}
          onChange={(e) => setPreferredDeliveryDate(e.target.value)}
        />

        <Textarea
          label="Delivery notes"
          name="deliveryNotes"
          value={deliveryNotes}
          onChange={(e) => setDeliveryNotes(e.target.value)}
          rows={2}
          placeholder="Special instructions"
        />

        <TextInput
          label="Customer email"
          name="customerEmail"
          type="email"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          placeholder="Optional"
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={isSubmitting}
            loadingText="Saving..."
          >
            Save changes
          </Button>
        </div>
      </fetcher.Form>
    </Modal>
  );
}

function CustomFieldsCard({
  defs,
  responses,
}: {
  defs: NonNullable<OrderDetail['campaignCustomFieldDefs']>;
  responses: NonNullable<OrderDetail['customFields']> | null;
}) {
  if (!defs || defs.length === 0) return null;
  if (!responses || Object.keys(responses).length === 0) return null;

  const rows = defs
    .map((def) => {
      const raw = responses[def.id];
      if (raw === undefined || raw === null || raw === '') return null;
      if (Array.isArray(raw) && raw.length === 0) return null;
      return { def, value: raw };
    })
    .filter((r): r is { def: typeof defs[number]; value: string | number | boolean | string[] } => r !== null);

  if (rows.length === 0) return null;

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-app-fg mb-3">Form responses</h2>
      <dl className="space-y-2.5 text-sm">
        {rows.map(({ def, value }) => (
          <div key={def.id} className="min-w-0 pl-3 py-1.5 rounded-r-md -ml-px">
            <dt className="text-app-fg-muted text-xs font-medium uppercase tracking-wider">
              {def.label}
            </dt>
            <dd className="mt-0.5 break-words text-app-fg">
              {renderCustomFieldValue(def.type, value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Per-type value formatter — toggle → Yes/No, checkbox_group → comma-joined, others stringified. */
function renderCustomFieldValue(
  type: string,
  value: string | number | boolean | string[],
): string {
  if (type === 'toggle') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
