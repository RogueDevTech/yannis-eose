import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { DeferredSection } from '~/components/ui/deferred-section';
import { EmptyState } from '~/components/ui/empty-state';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useAgentStateBroadcast } from '~/hooks/useSocket';
import { formatNaira } from '~/lib/format-amount';
import { generateInvoicePdf, previewInvoicePdf } from '~/lib/invoice-pdf';
import { OrderTimeline } from '~/components/ui/order-timeline';
import { CSMessagingPanel } from '~/components/ui/cs-messaging-panel';
import { FileUpload } from '~/components/ui/file-upload';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { shareOrderToLogistics } from '~/lib/trpc-browser';
import { isAdminLevel, isOrgWideDepartmentHead } from '~/lib/rbac';
import { useBranchScopeActionGuard } from '~/contexts/branch-scope-action-guard';
import { buildOrderSummaryClipboardText } from './build-order-summary-clipboard';
import type { CallLogEntry, TimelineEvent, OrderDetail, OrderDetailStreamData, OrderDetailPageExtraProps, OrderInvoice } from './types';

function canCopyOrderSummaryForChat(
  userRole: string,
  currentBranchId: string | null | undefined,
  order: OrderDetail,
): boolean {
  if (
    ['CS_AGENT', 'HEAD_OF_CS', 'HEAD_OF_LOGISTICS', 'LOGISTICS_MANAGER', 'TPL_MANAGER'].includes(userRole)
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
};

// Builds the row description for an entry in the allocate-location dropdown.
// When the API returns availability per product (HoCS, HoLogistics, admins,
// LogisticsManager, TPL_MANAGER, etc.), surface "Product: N available" so the
// allocator can pick the right hub without leaving the modal. CS_AGENTs receive
// `availabilityByProduct: null` from the API and just see the address —
// remaining-stock numbers are intentionally hidden from them.
function describeAllocatableLocation(loc: AllocatableLocationDescriptor): string | undefined {
  if (!loc.eligible) return loc.reason ?? 'Unavailable';
  if (loc.availabilityByProduct && loc.availabilityByProduct.length > 0) {
    return loc.availabilityByProduct
      .map((p) => `${p.productName}: ${p.available} available`)
      .join(' \u00b7 ');
  }
  return loc.address ?? undefined;
}

// ── Constants ────────────────────────────────────────────────────

const STATUS_FLOW = [
  'UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'ALLOCATED',
  'DELIVERED', 'COMPLETED',
] as const;

const STATUS_DISPLAY_LABELS: Partial<Record<(typeof STATUS_FLOW)[number], string>> = {};

// Everything between ALLOCATED and DELIVERED happens offline (rider with the parcel).
// DISPATCHED + IN_TRANSIT therefore collapse back into the ALLOCATED step — the order is
// still with the logistics company from the CS perspective until someone marks it delivered.
function getProgressIndex(status: string): number {
  if (status === 'DISPATCHED' || status === 'IN_TRANSIT') {
    return STATUS_FLOW.indexOf('ALLOCATED');
  }
  return STATUS_FLOW.indexOf(status as (typeof STATUS_FLOW)[number]);
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
    format: (v) => (v ? new Date(String(v)).toLocaleString('en-NG') : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Confirmed',
    getValue: (o) => o.confirmedAt,
    format: (v) => (v ? new Date(String(v)).toLocaleString('en-NG') : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Allocated',
    getValue: (o) => o.allocatedAt,
    format: (v) => (v ? new Date(String(v)).toLocaleString('en-NG') : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Dispatched',
    getValue: (o) => o.dispatchedAt,
    format: (v) => (v ? new Date(String(v)).toLocaleString('en-NG') : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Delivered',
    getValue: (o) => o.deliveredAt,
    format: (v) => (v ? new Date(String(v)).toLocaleString('en-NG') : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Preferred delivery date',
    getValue: (o) => o.preferredDeliveryDate,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Customer Address',
    getValue: (o) => o.customerAddress,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Delivery Address',
    getValue: (o) => o.deliveryAddress,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Delivery Notes',
    getValue: (o) => o.deliveryNotes,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Delivery State',
    getValue: (o) => o.deliveryState,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Customer Email',
    getValue: (o) => o.customerEmail,
    format: (v) => (v ? String(v) : ''),
  },
  {
    label: 'Callback scheduled',
    getValue: (o) => o.callbackScheduledAt,
    format: (v) => (v ? new Date(String(v)).toLocaleString('en-NG') : ''),
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
    format: (v) => (v ? String(v) : ''),
    ddClassName: 'font-mono text-xs text-app-fg-muted break-all',
  },
  {
    label: 'Locked until',
    getValue: (o) => o.lockedUntil,
    format: (v) => (v ? new Date(String(v)).toLocaleString('en-NG') : ''),
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
    format: (v) => (v ? new Date(String(v)).toLocaleString('en-NG') : ''),
    ddClassName: DETAIL_DATE_CLASS,
  },
  {
    label: 'Order ID',
    alwaysShow: true,
    getValue: (o) => o.id,
    format: (v) => (v ? String(v) : ''),
    ddClassName: DETAIL_ID_CLASS,
    rowAccent: 'border-l-4 border-l-surface-200 dark:border-l-surface-700',
  },
];

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

export function OrderDetailPage({
  order,
  latestCall,
  timeline,
  voipEnabled,
  voipProviderDisplayName = "Africa's Talking",
  canEditOrder = true,
  userRole,
  userId,
  currentBranchId = null,
  permissions,
  csAgentsForAssign = [],
  logisticsLocations = [],
  allocatableLocations = [],
  logisticsDispatchTemplates = [],
  invoice,
}: OrderDetailStreamData & OrderDetailPageExtraProps) {
  const fetcher = useFetcher();
  const revealFetcher = useFetcher();
  const recordCallFetcher = useFetcher();
  const scheduleFetcher = useFetcher();
  const adjustItemsFetcher = useFetcher();
  const priceRequestFetcher = useFetcher();
  const revalidator = useRevalidator();

  // Team Live View — broadcast CS agent state to cs-all room.
  const isCSAgent = userRole === 'CS_AGENT';
  useAgentStateBroadcast(
    isCSAgent
      ? { currentRoute: `/admin/orders/${order.id}`, currentOrderId: order.id, currentPanel: 'details' }
      : { currentRoute: '' }
  );
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [assignToId, setAssignToId] = useState('');
  const [callCustomerModalOpen, setCallCustomerModalOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [dismissedError, setDismissedError] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [scheduleCallbackModalOpen, setScheduleCallbackModalOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState('');
  const [scheduleDelayMinutes, setScheduleDelayMinutes] = useState(120);
  const [scheduleNotes, setScheduleNotes] = useState('');
  const [adjustItemsModalOpen, setAdjustItemsModalOpen] = useState(false);
  const [editedItems, setEditedItems] = useState<Array<{ productId: string; productName?: string | null; quantity: number; unitPrice: number }>>([]);
  const [priceApprovalReason, setPriceApprovalReason] = useState('');
  const [callDebugLog, setCallDebugLog] = useState<string[]>([]);
  const [allocateModalOpen, setAllocateModalOpen] = useState(false);
  const [allocateLocationId, setAllocateLocationId] = useState('');
  const [deliverModalOpen, setDeliverModalOpen] = useState(false);
  const [deliverNote, setDeliverNote] = useState('');
  const [deliverProofUrl, setDeliverProofUrl] = useState('');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLocationId, setShareLocationId] = useState('');
  const [shareTemplateId, setShareTemplateId] = useState('');
  const [sharePending, setSharePending] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const selectedAllocatableLocation = allocatableLocations.find((l) => l.id === allocateLocationId);
  const eligibleAllocatableCount = allocatableLocations.filter((l) => l.eligible).length;

  const currentStatusIndex = getProgressIndex(order.status);
  const actionError = (fetcher.data as { error?: string })?.error;
  const callInitiated = (fetcher.data as { callInitiated?: boolean })?.callInitiated;
  useFetcherToast(fetcher.data, { successMessage: 'Order updated' });
  useFetcherToast(scheduleFetcher.data, { successMessage: 'Callback scheduled' });

  const { toast } = useToast();
  const { ensureBranchForAction, requiresBranchSelection } = useBranchScopeActionGuard();

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);
  useEffect(() => {
    if (!actionError) return;
    if (!requiresBranchSelection) return;
    if (!actionError.toLowerCase().includes('branch context required')) return;
    ensureBranchForAction({ actionLabel: 'this action' });
  }, [actionError, requiresBranchSelection, ensureBranchForAction]);
  useFetcherToast(adjustItemsFetcher.data, { successMessage: 'Order items updated' });
  useFetcherToast(priceRequestFetcher.data, { successMessage: 'Price change request submitted' });
  const showCopyOrderSummary = canCopyOrderSummaryForChat(userRole, currentBranchId ?? null, order);
  const logisticsLocationWithGroupLink =
    order.logisticsLocationId != null
      ? logisticsLocations.find(
          (location) =>
            location.id === order.logisticsLocationId &&
            !!location.whatsappGroupLink,
        )
      : undefined;
  const showPostAllocationWhatsAppActions =
    showCopyOrderSummary &&
    (order.status === 'ALLOCATED' ||
      order.status === 'DISPATCHED' ||
      order.status === 'IN_TRANSIT') &&
    !!logisticsLocationWithGroupLink;

  const handleCopyOrderSummary = useCallback(async () => {
    const text = buildOrderSummaryClipboardText(order);
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        toast.error('Copy failed', 'Clipboard is not available in this browser.');
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success('Copied', 'Order summary ready to paste into WhatsApp or your logistics company group.');
    } catch {
      toast.error('Copy failed', 'Could not write to the clipboard.');
    }
  }, [order, toast]);

  // When user submits again, clear dismissed so the next response error will show
  useEffect(() => {
    if (fetcher.state === 'submitting') setDismissedError(false);
  }, [fetcher.state]);

  // When call customer modal opens (VOIP off), auto-reveal the phone in one shot.
  // `revealPhoneForManualCall` on the server handles the CS_ENGAGED transition itself,
  // so the user skips the "Reveal number" middle step and lands straight on the dialer buttons.
  useEffect(() => {
    if (
      callCustomerModalOpen &&
      !voipEnabled &&
      revealFetcher.state === 'idle' &&
      !revealFetcher.data
    ) {
      ensureBranchForAction({
        actionLabel: 'revealing phone for call',
        onProceed: () =>
          revealFetcher.submit(
            {
              intent: 'revealPhone',
              ...(order.branchId ? { branchId: order.branchId } : {}),
            },
            { method: 'post' },
          ),
      });
    }
  }, [callCustomerModalOpen, voipEnabled, revealFetcher.state, revealFetcher.data, ensureBranchForAction, order.branchId]);

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

  const showActionError = actionError && !dismissedError;

  const isAssignedToMe = order.assignedCsId === userId;
  const branchAdminSameBranch =
    userRole === 'BRANCH_ADMIN' &&
    !!order.branchId &&
    !!currentBranchId &&
    order.branchId === currentBranchId;
  const isCSOrHoS =
    ['CS_AGENT', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN'].includes(userRole) || branchAdminSameBranch;
  const isElevated =
    userRole === 'HEAD_OF_CS' || isAdminLevel({ role: userRole }) || branchAdminSameBranch;
  const viewerIsCsTeamSupervisor = order.viewerIsCsTeamSupervisor === true;
  const canEditLinePrices = order.viewerCanEditOrderLinePrices === true;
  // CS agent can only perform actions when order is assigned to them, or UNPROCESSED with no assignee (take from pool)
  const canPerformCSActionsOnOrder =
    isElevated ||
    viewerIsCsTeamSupervisor ||
    (userRole === 'CS_AGENT' && (isAssignedToMe || (order.status === 'UNPROCESSED' && !order.assignedCsId)));
  const canAssignToCS =
    permissions.includes('orders.reassign') ||
    isAdminLevel({ role: userRole }) ||
    viewerIsCsTeamSupervisor;

  const orderAllowsLineItemEdits =
    order.status === 'UNPROCESSED' ||
    order.status === 'CS_ASSIGNED' ||
    order.status === 'CS_ENGAGED' ||
    order.status === 'CONFIRMED' ||
    order.status === 'ALLOCATED' ||
    order.status === 'DISPATCHED' ||
    order.status === 'IN_TRANSIT';

  const priceDriftProposing =
    !canEditLinePrices &&
    editedItems.some((row) => {
      const srv = order.orderItems.find((o) => o.productId === row.productId);
      if (!srv) return true;
      return Math.abs(Number(srv.unitPrice) - row.unitPrice) > 0.0001;
    });

  function canTransitionTo(newStatus: string): boolean {
    const allowed = order.allowedTransitions ?? [];
    if (!allowed.includes(newStatus)) return false;
    const csOnlyStatuses = ['CS_ENGAGED', 'CONFIRMED', 'CANCELLED'];
    if (!csOnlyStatuses.includes(newStatus)) return true;
    if (!isCSOrHoS) return false;
    if (userRole === 'HEAD_OF_CS' || isAdminLevel({ role: userRole }) || branchAdminSameBranch) return true;
    if (userRole === 'CS_AGENT') {
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

  const revealData = revealFetcher.data as {
    phoneRevealed?: boolean;
    phone?: string;
    isDialable?: boolean;
    error?: string;
  } | undefined;

  // Revalidate when MANUAL_CALL is recorded (after Copy or Call on my phone) so Confirm order appears.
  // Use a ref to avoid revalidation loop: only revalidate once per success.
  const recordCallData = recordCallFetcher.data as { success?: boolean; error?: string } | undefined;
  const revalidatedForRecordCallRef = useRef(false);
  useEffect(() => {
    if (recordCallData?.success && revalidator.state === 'idle' && !revalidatedForRecordCallRef.current) {
      revalidatedForRecordCallRef.current = true;
      revalidator.revalidate();
    }
  }, [recordCallData?.success, revalidator]);
  // Reset ref when order changes so a new copy on another order can trigger one revalidation
  useEffect(() => {
    revalidatedForRecordCallRef.current = false;
  }, [order.id]);

  // Close modals when their fetcher returns success — edge-triggered via the
  // shared `useCloseOnFetcherSuccess` hook so the modal closes the same React
  // tick as the toast (no waiting for loader revalidation).
  const handleStateTransitionSuccess = useCallback(() => {
    if (confirmModalOpen) {
      setConfirmModalOpen(false);
      setDeliveryDate('');
    }
    if (cancelModalOpen) {
      setCancelModalOpen(false);
      setCancelReason('');
    }
    if (allocateModalOpen) {
      setAllocateModalOpen(false);
      setAllocateLocationId('');
    }
    if (deliverModalOpen) {
      setDeliverModalOpen(false);
      setDeliverNote('');
      setDeliverProofUrl('');
    }
  }, [confirmModalOpen, cancelModalOpen, allocateModalOpen, deliverModalOpen]);
  useCloseOnFetcherSuccess(fetcher, handleStateTransitionSuccess);

  const handleScheduleSuccess = useCallback(
    (data: { success: true } & Record<string, unknown>) => {
      if (!(data as { scheduled?: boolean }).scheduled) return;
      setScheduleCallbackModalOpen(false);
      setScheduleDelayMinutes(120);
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
  // Inline error accessors — the modal renders these as PageNotification rows.
  const adjustItemsData = adjustItemsFetcher.data as { success?: boolean; error?: string } | undefined;
  const priceRequestData = priceRequestFetcher.data as { success?: boolean; error?: string } | undefined;

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
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Link to="/admin/cs/orders" className="text-app-fg-muted hover:text-brand-500">
          Orders
        </Link>
        <svg className="w-4 h-4 text-app-border flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <OrderIdBadge id={order.id} textClassName="text-app-fg font-medium truncate min-w-0" />
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-app-fg truncate">{order.customerName}</h1>
          <p className="text-sm text-app-fg-muted font-mono mt-0.5 break-all">
            {order.customerPhoneDisplay}
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
          the order knows why a DELIVERED order isn't yet COMPLETED, or where
          the cash receipt that closed it out lives. */}
      {order.remittanceId && (
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
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {canEditOrder && order.pendingOrderLinePriceRequestId && (
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
            <div className="text-sm text-warning-900 dark:text-warning-100">
              <p className="font-semibold">Line price change pending approval</p>
              <p className="mt-0.5 text-warning-800 dark:text-warning-200/90">
                The order shows the original prices until a Head of CS, branch admin, or admin
                approves the change. See the order timeline below for full context, or{' '}
                <Link
                  to="/admin/permission-requests"
                  className="font-medium text-warning-900 dark:text-warning-100 underline underline-offset-2"
                >
                  open the request
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      )}


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status Timeline */}
            <div className="card overflow-hidden">
              <h2 className="text-lg font-semibold text-app-fg mb-4">Order Progress</h2>
              <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden pb-2 -mx-1 px-1 touch-pan-x overscroll-contain lg:overflow-x-visible lg:mx-0 lg:px-0 lg:pb-0">
                <div className="flex items-center flex-nowrap gap-0 min-w-max lg:min-w-0 lg:grid lg:grid-cols-5 lg:gap-x-3 lg:gap-y-4">
                {STATUS_FLOW.map((status, idx) => {
                  const isPast = idx < currentStatusIndex;
                  const isCurrent = idx === currentStatusIndex;

                  return (
                    <div key={status} className="flex items-center flex-shrink-0 lg:justify-center">
                      <div className="flex flex-col items-center lg:w-full">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                          isCurrent
                            ? 'bg-brand-500 text-white ring-4 ring-brand-100 dark:ring-brand-900'
                            : isPast
                            ? 'bg-success-500 text-white'
                            : 'bg-app-hover text-app-fg-muted'
                        }`}>
                          {isPast ? (
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            idx + 1
                          )}
                        </div>
                        <span className={`text-2xs mt-1 whitespace-nowrap lg:whitespace-normal lg:text-center lg:leading-tight ${
                          isCurrent ? 'text-brand-600 dark:text-brand-400 font-semibold' : isPast ? 'text-success-600 dark:text-success-500' : 'text-app-fg-muted'
                        }`}>
                          {STATUS_DISPLAY_LABELS[status] ?? status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      {idx < STATUS_FLOW.length - 1 && (
                        <div className={`h-0.5 w-8 mx-1 flex-shrink-0 lg:hidden ${isPast ? 'bg-success-500' : 'bg-app-hover'}`} />
                      )}
                    </div>
                  );
                })}
                </div>
              </div>
            </div>

            {/* Order Items — card layout (typically 3–4 items) */}
            <div className="card">
              <h2 className="text-lg font-semibold text-app-fg mb-3">Order Items</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {order.orderItems.map((item) => {
                  const subtotal = item.quantity * Number(item.unitPrice);
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border border-app-border bg-app-hover p-3 flex flex-col"
                    >
                      <p className="font-medium text-app-fg line-clamp-2" title={item.productName ?? item.productId}>
                        {item.productName ?? `${item.productId.slice(0, 8)}...`}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-sm text-app-fg-muted">
                        <span>Qty: {item.quantity}</span>
                        <span>&#8358;{Number(item.unitPrice).toLocaleString()} each</span>
                      </div>
                      <p className="mt-1.5 text-sm font-semibold text-app-fg">
                        Subtotal: &#8358;{subtotal.toLocaleString()}
                      </p>
                      <Link
                        to={`/admin/products/${item.productId}`}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        View product
                      </Link>
                    </div>
                  );
                })}
              </div>
              {order.totalAmount && (
                <div className="mt-3 pt-3 border-t border-app-border flex justify-end">
                  <p className="text-base font-bold text-app-fg">
                    Total: &#8358;{Number(order.totalAmount).toLocaleString()}
                  </p>
                </div>
              )}
            </div>

            {/* Invoice card — auto-generated on CONFIRMED. Visible to CS, Logistics, etc.
                Renders nothing while pending or when no invoice exists yet. */}
            {invoice !== undefined && invoice !== null && (
              <DeferredSection resolve={invoice} skeleton="card">
                {(inv) => {
                  const i = inv as OrderInvoice | null;
                  if (!i) return null;
                  return (
                    <div className="card">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          <h2 className="text-lg font-semibold text-app-fg">Invoice</h2>
                          <p className="text-sm text-app-fg-muted">
                            <span className="font-mono">{i.referenceFormatted}</span>
                            <span className="mx-1.5">·</span>
                            <span className="font-medium text-app-fg">{formatNaira(Number(i.totalAmount))}</span>
                            <span className="mx-1.5">·</span>
                            <span className="capitalize">{i.status.toLowerCase()}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => generateInvoicePdf(i, 'download')}
                          >
                            Download PDF
                          </Button>
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => previewInvoicePdf(i)}
                          >
                            Preview PDF
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-app-fg-muted">
                        Auto-generated when this order was confirmed. Edit the recipient, line items, tax, or due date from the Finance page before sending.
                      </p>
                    </div>
                  );
                }}
              </DeferredSection>
            )}

            {/* Order activity — lifecycle timeline */}
            <div className="card">
              <h2 className="text-lg font-semibold text-app-fg mb-1">Order Activity</h2>
              <p className="text-sm text-app-fg-muted mb-3">
                Every step taken on this order, with who did it and when.
              </p>
              {timeline ? (
                <DeferredSection resolve={timeline} skeleton="table">
                  {(resolvedTimeline) => <OrderTimeline events={resolvedTimeline as TimelineEvent[]} />}
                </DeferredSection>
              ) : (
                <p className="text-sm text-app-fg-muted py-4 text-center">No timeline data.</p>
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

          {/* Right column */}
          <div className="space-y-4">
            {/* Order Actions — CS / Head of CS only, role-based.
                CS still owns Adjust/Call/Delete after CS_ENGAGED while goods are pre-delivery so
                they can manage upsells, delivery-coordination calls, and cancellations.
                Media Buyers use this page read-only (campaign performance); never show CS actions. */}
            {canEditOrder && userRole !== 'MEDIA_BUYER' && isCSOrHoS && orderAllowsLineItemEdits && (
              <div className="card">
                <h2 className="text-lg font-semibold text-app-fg mb-3">Order Actions</h2>
                {/* When the order is UNPROCESSED and no closer has been assigned, ALL actions
                    other than the Assign closer dropdown are suppressed. This forces the
                    correct lifecycle entry point: someone (HoCS / admin) picks a closer first,
                    then the order moves to CS_ASSIGNED and the rest of the workflow opens up.
                    Without this, an admin could engage / confirm an order directly and the
                    "Closer" column on `/admin/cs/orders` ends up blank because no CS_AGENT
                    is on the row. */}
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
                  {!(order.status === 'UNPROCESSED' && !order.assignedCsId) && (
                  <>
                  {/* Adjust order items — always first */}
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
                        })),
                      );
                      setAdjustItemsModalOpen(true);
                    }}
                    disabled={!canPerformCSActionsOnOrder || order.orderItems.length === 0}
                  >
                    Adjust order items
                  </Button>

                  {/* Confirm order / Schedule callback — CS_ENGAGED */}
                  {order.status === 'CS_ENGAGED' && canPerformCSActionsOnOrder && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      {canConfirm && canTransitionTo('CONFIRMED') && (
                        <Button
                          type="button"
                          variant="primary"
                          className="w-full sm:flex-1"
                          onClick={() => setConfirmModalOpen(true)}
                          disabled={fetcher.state === 'submitting'}
                        >
                          Confirm order
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full sm:flex-1"
                        onClick={() => setScheduleCallbackModalOpen(true)}
                        disabled={scheduleFetcher.state === 'submitting'}
                      >
                        Schedule callback
                      </Button>
                    </div>
                  )}

                  {/* Call customer — available pre-delivery. For pre-CS_ENGAGED statuses, opening
                      the modal also triggers CS_ENGAGED on the server (one click to dial).
                      Post-CS_ENGAGED statuses (CONFIRMED/ALLOCATED/…) use the same modal for
                      delivery-coordination / follow-up calls without changing order state. */}
                  {!voipEnabled ? (
                    <div className="space-y-2">
                      {(order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED' || !canConfirm) && order.status !== 'CS_ENGAGED' && !(order.status === 'CONFIRMED' || order.status === 'ALLOCATED' || order.status === 'DISPATCHED' || order.status === 'IN_TRANSIT') && (
                        <p className="text-xs text-warning-600 dark:text-warning-400 text-center">
                          Call the customer manually, then confirm the order.
                        </p>
                      )}
                      <Button
                        type="button"
                        variant={order.status === 'CS_ENGAGED' && canConfirm ? 'secondary' : 'primary'}
                        className="w-full"
                        onClick={() => setCallCustomerModalOpen(true)}
                        disabled={!canPerformCSActionsOnOrder || (order.status === 'CS_ENGAGED' && fetcher.state === 'submitting')}
                        loading={(order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED') && fetcher.state === 'submitting'}
                        loadingText="Starting..."
                      >
                        Call customer
                      </Button>
                    </div>
                  ) : null}

                  {/* Cancel order — lifecycle transition to CANCELLED */}
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full border-danger-200 dark:border-danger-700 text-danger-700 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20"
                    onClick={() => {
                      setCancelModalOpen(true);
                      setCancelReason('Customer not picking');
                    }}
                    disabled={fetcher.state === 'submitting' || !canTransitionTo('CANCELLED')}
                  >
                    Cancel order
                  </Button>

                  </>
                  )}

                  {/* Assign to closer — queue (UNPROCESSED / CS_ASSIGNED) or reassign while CS_ENGAGED.
                      The CS agent (closer) drives the order from queue → call → confirm; assignment
                      happens BEFORE confirmation per the locked Order Lifecycle (CLAUDE.md). */}
                  {(order.status === 'UNPROCESSED' ||
                    order.status === 'CS_ASSIGNED' ||
                    order.status === 'CS_ENGAGED') &&
                    canAssignToCS &&
                    csAgentsForAssign &&
                    csAgentsForAssign.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-app-fg-muted">
                        {order.assignedCsId ? 'Reassign closer' : 'Assign closer (CS agent)'}
                      </p>
                      <div className="flex items-stretch gap-2">
                        <SearchableSelect
                          id="order-assign-cs"
                          value={assignToId}
                          onChange={setAssignToId}
                          placeholder="Pick a closer to assign…"
                          options={csAgentsForAssign.map((a) => ({ value: a.id, label: a.name }))}
                          wrapperClassName="flex-1 min-w-0"
                          searchPlaceholder="Search closers..."
                          controlSize="lg"
                        />
                        <fetcher.Form method="post" className="flex-shrink-0">
                          <input type="hidden" name="intent" value="assignToCS" />
                          {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
                          <input type="hidden" name="toCsAgentId" value={assignToId} />
                          <Button
                            type="submit"
                            variant="primary"
                            disabled={!assignToId || fetcher.state === 'submitting'}
                            loading={fetcher.state === 'submitting'}
                            loadingText="Assigning..."
                          >
                            Assign
                          </Button>
                        </fetcher.Form>
                      </div>
                    </div>
                  )}
                </div>
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
                        })),
                      );
                      setAdjustItemsModalOpen(true);
                    }}
                    disabled={order.orderItems.length === 0}
                  >
                    Adjust order items
                  </Button>
                </div>
              )}

            {/* Logistics Actions — share/allocate when CONFIRMED or ALLOCATED, confirm delivery when IN_TRANSIT.
                Same read-only rule as Order Actions: Media Buyers must not allocate or run logistics ops here. */}
            {(() => {
              if (!canEditOrder || userRole === 'MEDIA_BUYER') return null;
              const locationsWithGroup = logisticsLocations.filter((l) => !!l.whatsappGroupLink);
              const canShareToWhatsApp =
                (order.status === 'CONFIRMED' || order.status === 'ALLOCATED') &&
                locationsWithGroup.length > 0 &&
                logisticsDispatchTemplates.length > 0;
              const canMarkDelivered =
                (order.status === 'ALLOCATED' || order.status === 'DISPATCHED' || order.status === 'IN_TRANSIT') &&
                canTransitionTo('DELIVERED');
              const showCard =
                (order.status === 'CONFIRMED' && canTransitionTo('ALLOCATED') && logisticsLocations.length > 0) ||
                canMarkDelivered ||
                canShareToWhatsApp;
              if (!showCard) return null;
              return (
                <div className="card">
                  <h2 className="text-lg font-semibold text-app-fg mb-3">Logistics</h2>
                  <div className="space-y-2">
                    {order.status === 'CONFIRMED' && canTransitionTo('ALLOCATED') && logisticsLocations.length > 0 && (
                      <Button
                        type="button"
                        variant="primary"
                        className="w-full"
                        onClick={() => {
                          setAllocateLocationId('');
                          setAllocateModalOpen(true);
                        }}
                        disabled={fetcher.state === 'submitting'}
                      >
                        Allocate to logistics company
                      </Button>
                    )}
                    {canShareToWhatsApp && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full"
                        onClick={() => {
                          setShareError(null);
                          // Default to the already-allocated location if set; else the first with a group link.
                          const alreadyAllocated = order.logisticsLocationId
                            ? locationsWithGroup.find((l) => l.id === order.logisticsLocationId)
                            : undefined;
                          const preselected = alreadyAllocated?.id ?? locationsWithGroup[0]?.id ?? '';
                          setShareLocationId(preselected);
                          setShareTemplateId(logisticsDispatchTemplates[0]?.id ?? '');
                          setShareModalOpen(true);
                        }}
                        disabled={sharePending}
                      >
                        Share to logistics company (WhatsApp)
                      </Button>
                    )}
                    {showPostAllocationWhatsAppActions && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          onClick={() => void handleCopyOrderSummary()}
                        >
                          Copy for WhatsApp
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full"
                          onClick={() =>
                            window.open(
                              logisticsLocationWithGroupLink.whatsappGroupLink as string,
                              '_blank',
                              'noopener,noreferrer',
                            )
                          }
                        >
                          Open Logistics Group Chat
                        </Button>
                      </>
                    )}
                    {showCopyOrderSummary &&
                      (order.status === 'ALLOCATED' ||
                        order.status === 'DISPATCHED' ||
                        order.status === 'IN_TRANSIT') &&
                      !logisticsLocationWithGroupLink && (
                        // Don't tell CS to add the group link — that's the
                        // Logistics admin's job (set on the location at create
                        // time). CS just needs to know the link isn't there
                        // yet so the "Open group" button is missing for a
                        // reason.
                        <p className="text-xs text-app-fg-muted">
                          WhatsApp group not configured for this logistics location yet — ask Logistics to add it.
                        </p>
                      )}
                    {canMarkDelivered && (
                      <Button
                        type="button"
                        variant="primary"
                        className="w-full"
                        onClick={() => {
                          setDeliverNote('');
                          setDeliverProofUrl('');
                          setDeliverModalOpen(true);
                        }}
                        disabled={fetcher.state === 'submitting'}
                      >
                        Mark delivered
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Communication Panel — unified Call/SMS/WhatsApp panel for CS agents */}
            {canEditOrder && canPerformCSActionsOnOrder && (
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
                      VOIP calling is available once the order is in CS Engaged status.
                    </p>
                  )
                }
              />
            )}

            {/* Order Info — dynamic fields: show when value present or alwaysShow */}
            <div className="card">
              <h2 className="text-lg font-semibold text-app-fg mb-3">Details</h2>
              <dl className="space-y-2.5 text-sm">
                {ORDER_DETAIL_FIELDS.map((field) => {
                  const value = field.getValue(order);
                  if (!field.alwaysShow && !hasValue(value)) return null;
                  const formatted = field.format(value, order);
                  const valueClass =
                    typeof field.ddClassName === 'function'
                      ? field.ddClassName(value, order)
                      : field.ddClassName ?? '';
                  const ddClass = [
                    'mt-0.5 break-words',
                    valueClass || 'text-app-fg',
                  ].filter(Boolean).join(' ');
                  const rowClass = [
                    'min-w-0 pl-3 py-1.5 rounded-r-md -ml-px',
                    field.rowAccent ?? '',
                  ].filter(Boolean).join(' ');
                  return (
                    <div key={field.label} className={rowClass}>
                      <dt className="text-app-fg-muted text-xs font-medium uppercase tracking-wider">
                        {field.label}
                      </dt>
                      <dd className={ddClass}>{formatted}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>

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
            Set an optional delivery date and confirm when the customer is ready.
          </p>
          <fetcher.Form method="post" className="block space-y-4">
            <input type="hidden" name="intent" value="transition" />
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
                aria-label="Delivery date"
              />
              <p className="text-xs text-app-fg-muted">
                When should logistics deliver this order? Leave empty if not specified.
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
                disabled={fetcher.state === 'submitting'}
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
            setScheduleDelayMinutes(120);
            setScheduleNotes('');
          }}
          maxWidth="max-w-md"
          contentClassName="p-6 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-1">Schedule callback</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            Move the order back to your queue and set a time to call again (for example when the customer is not picking up).
          </p>
          <scheduleFetcher.Form method="post" className="block space-y-4">
            <input type="hidden" name="intent" value="scheduleCallback" />
            {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
            <input type="hidden" name="delayMinutes" value={scheduleDelayMinutes} />
            <input type="hidden" name="notes" value={scheduleNotes} />
            <FormSelect
              id="schedule-callback-delay"
              label="Delay"
              value={String(scheduleDelayMinutes)}
              onChange={(e) => setScheduleDelayMinutes(parseInt(e.target.value, 10))}
              aria-label="Callback delay"
              options={[
                { value: '30', label: '30 minutes' },
                { value: '60', label: '1 hour' },
                { value: '120', label: '2 hours' },
                { value: '240', label: '4 hours' },
                { value: '480', label: '8 hours' },
                { value: '1440', label: '24 hours' },
              ]}
            />
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
                  setScheduleDelayMinutes(120);
                  setScheduleNotes('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="w-full sm:w-auto"
                disabled={scheduleFetcher.state === 'submitting'}
                loading={scheduleFetcher.state === 'submitting'}
                loadingText="Scheduling..."
              >
                Schedule callback
              </Button>
            </div>
          </scheduleFetcher.Form>
        </Modal>
      )}

      {/* Cancel order modal (transition to CANCELLED) */}
      {cancelModalOpen && (
        <Modal open onClose={() => { setCancelModalOpen(false); setCancelReason(''); }} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-app-fg mb-1">Cancel order</h3>
            <p className="text-sm text-app-fg-muted mb-3">
              Please provide a reason (at least 10 characters). This will move the order to Cancelled.
            </p>
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
              placeholder="Customer not picking"
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
                <input type="hidden" name="newStatus" value="CANCELLED" />
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

      {/* Allocate to logistics company modal — CONFIRMED → ALLOCATED */}
      {allocateModalOpen && (
        <Modal open onClose={() => setAllocateModalOpen(false)} maxWidth="max-w-md" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-app-fg mb-1">Allocate to logistics company</h3>
          <p className="text-sm text-app-fg-muted mb-3">
            Select the logistics company location that will fulfil this order. Stock must be available at that location.
          </p>
          {eligibleAllocatableCount === 0 ? (
            <EmptyState
              title="No allocatable locations"
              description="No logistics company location currently has enough stock for this order. Receive stock (intake or verified transfer) and try again."
              variant="card"
            />
          ) : (
            <SearchableSelect
              id="allocate-location-id"
              label="Logistics location"
              value={allocateLocationId}
              onChange={setAllocateLocationId}
              placeholder="Select a location..."
              searchPlaceholder="Search locations..."
              options={allocatableLocations.map((loc) => ({
                value: loc.id,
                label: loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name,
                description: describeAllocatableLocation(loc),
                disabled: !loc.eligible,
              }))}
            />
          )}
          <div className="flex gap-2 mt-4 justify-end">
            <Button type="button" variant="secondary" onClick={() => setAllocateModalOpen(false)}>
              Back
            </Button>
            {eligibleAllocatableCount > 0 && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="transition" />
              <input type="hidden" name="newStatus" value="ALLOCATED" />
              {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
              <input type="hidden" name="logisticsLocationId" value={allocateLocationId} />
              <Button
                type="submit"
                variant="primary"
                disabled={!allocateLocationId || !selectedAllocatableLocation?.eligible || fetcher.state === 'submitting'}
                loading={fetcher.state === 'submitting'}
                loadingText="Allocating..."
              >
                Allocate
              </Button>
            </fetcher.Form>
            )}
          </div>
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
          <Textarea
            id="delivery-note"
            label="Delivery note (optional)"
            value={deliverNote}
            onChange={(e) => setDeliverNote(e.target.value)}
            placeholder="e.g. Customer confirmed receipt on follow-up call at 3:42pm."
            rows={3}
          />
          <div className="mt-4">
            <label className="block text-sm font-medium text-app-fg-muted mb-1.5">
              Screenshot (optional)
            </label>
            <FileUpload
              folder={S3_FOLDERS.DELIVERY_PROOF}
              onUpload={(url) => setDeliverProofUrl(url)}
              accept="image/*"
              maxSizeMB={10}
            />
          </div>
          <div className="flex gap-2 mt-5 justify-end">
            <Button type="button" variant="secondary" onClick={() => setDeliverModalOpen(false)}>
              Back
            </Button>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="transition" />
              <input type="hidden" name="newStatus" value="DELIVERED" />
              {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
              {deliverNote.trim() && <input type="hidden" name="deliveryNote" value={deliverNote.trim()} />}
              {deliverProofUrl && <input type="hidden" name="deliveryProofUrl" value={deliverProofUrl} />}
              <Button
                type="submit"
                variant="primary"
                disabled={fetcher.state === 'submitting'}
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
                <FormSelect
                  id="share-location"
                  label="Logistics company location"
                  value={shareLocationId}
                  onChange={(e) => setShareLocationId(e.target.value)}
                  placeholder="Select a location..."
                  options={locationsWithGroup.map((loc) => ({
                    value: loc.id,
                    label: loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name,
                  }))}
                />
                {locationsWithGroup.length === 0 && (
                  <p className="text-xs text-warning-600 mt-1">
                    No logistics company locations have a WhatsApp group link configured. Ask Logistics to add one.
                  </p>
                )}
              </div>

              <div>
                <FormSelect
                  id="share-template"
                  label="Template"
                  value={shareTemplateId}
                  onChange={(e) => setShareTemplateId(e.target.value)}
                  placeholder="Select a template..."
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
                        onProceed: () =>
                          fetcher.submit(
                            {
                              intent: 'initiateCall',
                              ...(order.branchId ? { branchId: order.branchId } : {}),
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
                    <pre className="p-2 text-[11px] text-app-fg-muted whitespace-pre-wrap break-all overflow-x-auto max-h-32 overflow-y-auto font-mono bg-app-hover rounded mb-2">
                      {fetcher.data != null ? JSON.stringify(fetcher.data, null, 2) : '—'}
                    </pre>
                    <p className="text-xs font-medium text-app-fg-muted mb-1">Latest call</p>
                    <pre className="p-2 text-[11px] text-app-fg-muted whitespace-pre-wrap break-all overflow-x-auto max-h-24 overflow-y-auto font-mono bg-app-hover rounded mb-2">
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
                        <ul className="list-disc list-inside text-[11px] text-app-fg-muted space-y-0.5">
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
            ) : !revealData?.phoneRevealed ? (
              <>
                {revealData?.error ? (
                  <>
                    <p className="text-sm text-danger-600 dark:text-danger-400 mb-3">{revealData.error}</p>
                    <div className="flex gap-2 justify-end">
                      <Button type="button" variant="secondary" onClick={() => setCallCustomerModalOpen(false)}>
                        Close
                      </Button>
                      <revealFetcher.Form method="post">
                        <input type="hidden" name="intent" value="revealPhone" />
                        {order.branchId ? <input type="hidden" name="branchId" value={order.branchId} /> : null}
                        <Button
                          type="submit"
                          variant="primary"
                          disabled={revealFetcher.state === 'submitting'}
                          loading={revealFetcher.state === 'submitting'}
                          loadingText="Retrying..."
                        >
                          Retry
                        </Button>
                      </revealFetcher.Form>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-6">
                    <Spinner size="sm" />
                    <span className="ml-3 text-sm text-app-fg-muted">Preparing call…</span>
                  </div>
                )}
              </>
            ) : !revealData?.isDialable ? (
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
                <p className="text-sm text-app-fg-muted mb-3">
                  Click &quot;Copy number&quot; or &quot;Call on my phone&quot; to record the call, then use the number to contact the customer.
                </p>
                <div className="rounded-lg bg-app-hover p-4 mb-4">
                  <p className="text-sm text-app-fg-muted">
                    Number is loaded. Click &quot;Copy number&quot; or &quot;Call on my phone&quot; to use it — the number is not shown in the app.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      ensureBranchForAction({
                        actionLabel: 'recording customer call',
                        onProceed: () =>
                          recordCallFetcher.submit(
                            {
                              intent: 'initiateCall',
                              ...(order.branchId ? { branchId: order.branchId } : {}),
                            },
                            { method: 'post' },
                          ),
                      });
                      const phone = revealData.phone ?? '';
                      if (phone && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(phone);
                        setCopyFeedback(true);
                        setTimeout(() => setCopyFeedback(false), 2000);
                      }
                    }}
                    disabled={recordCallFetcher.state === 'submitting'}
                  >
                    {copyFeedback ? 'Copied' : 'Copy number'}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    className="inline-flex items-center justify-center gap-2"
                    disabled={recordCallFetcher.state === 'submitting'}
                    onClick={() => {
                      ensureBranchForAction({
                        actionLabel: 'recording customer call',
                        onProceed: () =>
                          recordCallFetcher.submit(
                            {
                              intent: 'initiateCall',
                              ...(order.branchId ? { branchId: order.branchId } : {}),
                            },
                            { method: 'post' },
                          ),
                      });
                      const phone = revealData.phone ?? '';
                      if (phone) {
                        window.location.href = `tel:${phone}`;
                      }
                    }}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                    </svg>
                    Call on my phone
                  </Button>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCallCustomerModalOpen(false)}
                  >
                    Close
                  </Button>
                </div>
              </>
            )}
        </Modal>
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
                ? 'Update quantities or unit prices. This changes the order details only, not the order status.'
                : 'You can change quantities anytime. To change unit prices, enter the new prices and submit a request — a Head of CS, Head of Logistics, branch admin, or admin will approve or reject it.'}
            </p>
            {adjustItemsData?.error && (
              <p className="text-sm text-danger-600 dark:text-danger-400 mx-6 mb-2">{adjustItemsData.error}</p>
            )}
            {priceRequestData?.error && (
              <p className="text-sm text-danger-600 dark:text-danger-400 mx-6 mb-2">{priceRequestData.error}</p>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-4">
              {editedItems.map((item, index) => (
                <div
                  key={`${item.productId}-${index}`}
                  className="rounded-lg border border-app-border p-3 space-y-2"
                >
                  <p className="font-medium text-app-fg text-sm line-clamp-2">
                    {item.productName ?? item.productId.slice(0, 8) + '...'}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-app-fg-muted mb-1">Quantity</label>
                      <input
                        type="number"
                        min={1}
                        className="input w-full"
                        value={item.quantity}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!Number.isNaN(v) && v >= 1) {
                            setEditedItems((prev) =>
                              prev.map((p, i) => (i === index ? { ...p, quantity: v } : p)),
                            );
                          }
                        }}
                        aria-label={`Quantity for ${item.productName ?? 'item'}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-app-fg-muted mb-1">Unit price (&#8358;)</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        className="input w-full"
                        value={item.unitPrice}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isNaN(v) && v >= 0) {
                            setEditedItems((prev) =>
                              prev.map((p, i) => (i === index ? { ...p, unitPrice: v } : p)),
                            );
                          }
                        }}
                        aria-label={`Unit price for ${item.productName ?? 'item'}`}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {!canEditLinePrices && priceDriftProposing && (
              <div className="px-6 pb-2 space-y-2">
                <label htmlFor="price-approval-reason" className="block text-xs text-app-fg-muted font-medium">
                  Reason for price change (required, min 10 characters)
                </label>
                <Textarea
                  id="price-approval-reason"
                  rows={3}
                  value={priceApprovalReason}
                  onChange={(e) => setPriceApprovalReason(e.target.value)}
                  placeholder="Explain why the line prices should change…"
                  className="w-full"
                />
                {order.pendingOrderLinePriceRequestId && (
                  <p className="text-xs text-warning-700 dark:text-warning-300">
                    A price change is already pending approval. Wait for a decision or withdraw it from Permission requests.
                  </p>
                )}
              </div>
            )}
            <div className="p-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-app-border">
              <p className="text-sm font-semibold text-app-fg mb-4">
                Total: &#8358;
                {editedItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
                      const payload = editedItems.map(({ productId, quantity, unitPrice }) => ({
                        productId,
                        quantity,
                        unitPrice: Math.round(unitPrice * 100) / 100,
                      }));
                      const totalAmount = Math.round(payload.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) * 100) / 100;
                      const fd: Record<string, string> = {
                        intent: 'requestOrderLinePriceChange',
                        items: JSON.stringify(payload),
                        totalAmount: String(totalAmount),
                        reason: priceApprovalReason.trim(),
                      };
                      if (order.branchId) {
                        fd.branchId = order.branchId;
                      }
                      ensureBranchForAction({
                        actionLabel: 'submitting the price change request',
                        onProceed: () => priceRequestFetcher.submit(fd, { method: 'post' }),
                      });
                    }}
                  >
                    Submit price change for approval
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={
                      adjustItemsFetcher.state === 'submitting' ||
                      priceRequestFetcher.state === 'submitting' ||
                      editedItems.some((i) => i.quantity < 1 || i.unitPrice < 0)
                    }
                    loading={adjustItemsFetcher.state === 'submitting'}
                    loadingText="Saving..."
                    onClick={() => {
                      const payload = editedItems.map(({ productId, quantity, unitPrice }) => ({
                        productId,
                        quantity,
                        unitPrice: Math.round(unitPrice * 100) / 100,
                      }));
                      const totalAmount = Math.round(payload.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0) * 100) / 100;
                      ensureBranchForAction({
                        actionLabel: 'updating order items',
                        onProceed: () =>
                          adjustItemsFetcher.submit(
                            {
                              intent: 'adjustOrderItems',
                              items: JSON.stringify(payload),
                              totalAmount: String(totalAmount),
                              ...(order.branchId ? { branchId: order.branchId } : {}),
                            },
                            { method: 'post' },
                          ),
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
