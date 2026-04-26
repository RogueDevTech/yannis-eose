import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { useFetcherToast } from '~/components/ui/toast';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { DeferredSection } from '~/components/ui/deferred-section';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useAgentStateBroadcast } from '~/hooks/useSocket';
import { formatNaira } from '~/lib/format-amount';
import { previewInvoicePdf } from '~/lib/invoice-pdf';
import { OrderTimeline } from '~/components/ui/order-timeline';
import { CSMessagingPanel } from '~/components/ui/cs-messaging-panel';
import { FileUpload } from '~/components/ui/file-upload';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { shareOrderToLogistics } from '~/lib/trpc-browser';
import type { CallLogEntry, TimelineEvent, OrderDetail, OrderDetailStreamData, OrderDetailPageExtraProps, OrderInvoice } from './types';

// ── Constants ────────────────────────────────────────────────────

const STATUS_FLOW = [
  'UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'ALLOCATED',
  'DELIVERED', 'COMPLETED',
] as const;

const STATUS_DISPLAY_LABELS: Partial<Record<(typeof STATUS_FLOW)[number], string>> = {};

// Everything between ALLOCATED and DELIVERED happens offline (rider with the parcel).
// DISPATCHED + IN_TRANSIT therefore collapse back into the ALLOCATED step — the order is
// still "in 3PL hands" from the CS perspective until someone marks it delivered.
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
    label: 'Logistics provider',
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
  permissions,
  csAgentsForAssign = [],
  logisticsLocations = [],
  logisticsDispatchTemplates = [],
  invoice,
}: OrderDetailStreamData & OrderDetailPageExtraProps) {
  const fetcher = useFetcher();
  const revealFetcher = useFetcher();
  const recordCallFetcher = useFetcher();
  const scheduleFetcher = useFetcher();
  const adjustItemsFetcher = useFetcher();
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
  const [deliveryDate, setDeliveryDate] = useState('');
  const [scheduleDelayMinutes, setScheduleDelayMinutes] = useState(120);
  const [scheduleNotes, setScheduleNotes] = useState('');
  const [adjustItemsModalOpen, setAdjustItemsModalOpen] = useState(false);
  const [editedItems, setEditedItems] = useState<Array<{ productId: string; productName?: string | null; quantity: number; unitPrice: number }>>([]);
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

  const currentStatusIndex = getProgressIndex(order.status);
  const actionError = (fetcher.data as { error?: string })?.error;
  const callInitiated = (fetcher.data as { callInitiated?: boolean })?.callInitiated;
  useFetcherToast(fetcher.data, { successMessage: 'Order updated' });
  useFetcherToast(scheduleFetcher.data, { successMessage: 'Callback scheduled' });

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);
  useFetcherToast(adjustItemsFetcher.data, { successMessage: 'Order items updated' });

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
      revealFetcher.submit({ intent: 'revealPhone' }, { method: 'post' });
    }
  }, [callCustomerModalOpen, voipEnabled, revealFetcher.state, revealFetcher.data]);

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
  const isCSOrHoS = ['CS_AGENT', 'HEAD_OF_CS', 'SUPER_ADMIN', 'ADMIN'].includes(userRole);
  const isElevated = userRole === 'HEAD_OF_CS' || userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';
  // CS agent can only perform actions when order is assigned to them, or UNPROCESSED with no assignee (take from pool)
  const canPerformCSActionsOnOrder =
    isElevated ||
    (userRole === 'CS_AGENT' && (isAssignedToMe || (order.status === 'UNPROCESSED' && !order.assignedCsId)));
  const canAssignToCS = permissions.includes('orders.reassign');

  function canTransitionTo(newStatus: string): boolean {
    const allowed = order.allowedTransitions ?? [];
    if (!allowed.includes(newStatus)) return false;
    const csOnlyStatuses = ['CS_ENGAGED', 'CONFIRMED', 'CANCELLED'];
    if (!csOnlyStatuses.includes(newStatus)) return true;
    if (!isCSOrHoS) return false;
    if (userRole === 'HEAD_OF_CS' || userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') return true;
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
  // - VOIP enabled: require completed VOIP call of at least 15 seconds
  // - VOIP disabled: require at least one call log (agent clicked Call)
  const canConfirm = voipEnabled ? hasQualifyingVoipCall : hasAnyCallLog;

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

  // Close modals when fetcher returns success
  const fetcherSuccess = (fetcher.data as { success?: boolean })?.success;
  const prevFetcherState = useRef(fetcher.state);
  useEffect(() => {
    // Detect transition from submitting/loading → idle with success
    if (prevFetcherState.current !== 'idle' && fetcher.state === 'idle' && fetcherSuccess) {
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
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state, fetcherSuccess, confirmModalOpen, cancelModalOpen, allocateModalOpen, deliverModalOpen]);

  // Close confirm modal and revalidate when schedule callback succeeds
  const scheduleData = scheduleFetcher.data as { success?: boolean; scheduled?: boolean; error?: string } | undefined;
  useEffect(() => {
    if (scheduleData?.success && scheduleData?.scheduled && revalidator.state === 'idle') {
      setConfirmModalOpen(false);
      setScheduleDelayMinutes(120);
      setScheduleNotes('');
      revalidator.revalidate();
    }
  }, [scheduleData?.success, scheduleData?.scheduled, revalidator]);

  // Close adjust items modal and revalidate when update succeeds
  const adjustItemsData = adjustItemsFetcher.data as { success?: boolean; error?: string } | undefined;
  useEffect(() => {
    if (adjustItemsData?.success && revalidator.state === 'idle') {
      setAdjustItemsModalOpen(false);
      revalidator.revalidate();
    }
  }, [adjustItemsData?.success, revalidator]);

  // Escape to close adjust items modal
  useEffect(() => {
    if (!adjustItemsModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAdjustItemsModalOpen(false);
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

      {showActionError && actionError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
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
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => previewInvoicePdf(i)}
                        >
                          Preview PDF
                        </Button>
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
                they can manage upsells, delivery-coordination calls, and cancellations. */}
            {canEditOrder && isCSOrHoS && (
              order.status === 'UNPROCESSED' ||
              order.status === 'CS_ASSIGNED' ||
              order.status === 'CS_ENGAGED' ||
              order.status === 'CONFIRMED' ||
              order.status === 'ALLOCATED' ||
              order.status === 'DISPATCHED' ||
              order.status === 'IN_TRANSIT'
            ) && (
              <div className="card">
                <h2 className="text-lg font-semibold text-app-fg mb-3">Order Actions</h2>
                {!canPerformCSActionsOnOrder && (
                  <div className="rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700/50 px-4 py-3 mb-3">
                    <p className="text-sm text-warning-800 dark:text-warning-200">
                      This order is not assigned to you. You cannot perform actions until it is assigned to you by Head of CS or the system.
                    </p>
                  </div>
                )}
                <div className={`space-y-2 ${!canPerformCSActionsOnOrder ? 'pointer-events-none opacity-60' : ''}`}>
                  {/* Adjust order items — always first */}
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
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

                  {/* Confirm order — CS_ENGAGED only */}
                  {order.status === 'CS_ENGAGED' && canConfirm && canTransitionTo('CONFIRMED') && (
                    <Button
                      type="button"
                      variant="primary"
                      className="w-full"
                      onClick={() => setConfirmModalOpen(true)}
                      disabled={fetcher.state === 'submitting'}
                    >
                      Confirm order
                    </Button>
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

                  {/* Delete order — single button for all statuses */}
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
                    Delete order
                  </Button>

                  {/* Assign to agent — CS_ENGAGED only */}
                  {order.status === 'CS_ENGAGED' && canAssignToCS && csAgentsForAssign && csAgentsForAssign.length > 0 && (
                    <div className="flex gap-2">
                      <select
                        value={assignToId}
                        onChange={(e) => setAssignToId(e.target.value)}
                        className="input flex-1 min-w-0"
                        aria-label="Assign to agent"
                      >
                        <option value="">Select agent...</option>
                        {csAgentsForAssign.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      <fetcher.Form method="post" className="flex-shrink-0">
                        <input type="hidden" name="intent" value="assignToCS" />
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
                  )}
                </div>
              </div>
            )}

            {/* Logistics Actions — share/allocate when CONFIRMED or ALLOCATED, confirm delivery when IN_TRANSIT. */}
            {(() => {
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
                        Allocate to 3PL
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
                        Share to 3PL (WhatsApp)
                      </Button>
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
          </div>
        </div>

      {/* Confirm order modal — Confirm now or Schedule callback */}
      {confirmModalOpen && (
        <Modal open onClose={() => { setConfirmModalOpen(false); setDeliveryDate(''); setScheduleDelayMinutes(120); setScheduleNotes(''); }} maxWidth="max-w-md" contentClassName="p-6 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <h3 className="text-lg font-semibold text-app-fg mb-1">Confirm order</h3>
            <p className="text-sm text-app-fg-muted mb-4">
              Confirm the order now or schedule a callback for later.
            </p>
            <div className="space-y-4">
              <fetcher.Form
                method="post"
                className="block"
              >
                <input type="hidden" name="intent" value="transition" />
                <input type="hidden" name="newStatus" value="CONFIRMED" />
                <input type="hidden" name="preferredDeliveryDate" value={deliveryDate} />
                <div className="space-y-2 mb-4">
                  <label className="block text-xs font-medium text-app-fg-muted">
                    Scheduled delivery date
                  </label>
                  <input
                    type="date"
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="input w-full"
                    aria-label="Delivery date"
                  />
                  <p className="text-xs text-app-fg-muted">
                    When should logistics deliver this order? Leave empty if not specified.
                  </p>
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  disabled={fetcher.state === 'submitting'}
                  loading={fetcher.state === 'submitting'}
                  loadingText="Confirming..."
                >
                  Confirm now
                </Button>
              </fetcher.Form>
              <div className="border-t border-app-border pt-4">
                <p className="text-sm font-medium text-app-fg-muted mb-2">Schedule callback</p>
                <p className="text-xs text-app-fg-muted mb-3">
                  Move order back to queue and set a time to call again (e.g. customer not picking).
                </p>
                <div className="space-y-2 mb-3">
                  <label className="block text-xs font-medium text-app-fg-muted">Delay</label>
                  <select
                    value={scheduleDelayMinutes}
                    onChange={(e) => setScheduleDelayMinutes(parseInt(e.target.value, 10))}
                    className="input w-full"
                    aria-label="Callback delay"
                  >
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                    <option value={240}>4 hours</option>
                    <option value={480}>8 hours</option>
                    <option value={1440}>24 hours</option>
                  </select>
                  <label className="block text-xs font-medium text-app-fg-muted mt-2">Notes (optional)</label>
                  <textarea
                    value={scheduleNotes}
                    onChange={(e) => setScheduleNotes(e.target.value)}
                    placeholder="e.g. Customer not picking"
                    className="input w-full min-h-[60px]"
                    rows={2}
                  />
                </div>
                <scheduleFetcher.Form method="post" className="block">
                  <input type="hidden" name="intent" value="scheduleCallback" />
                  <input type="hidden" name="delayMinutes" value={scheduleDelayMinutes} />
                  <input type="hidden" name="notes" value={scheduleNotes} />
                  <Button
                    type="submit"
                    variant="secondary"
                    className="w-full"
                    disabled={scheduleFetcher.state === 'submitting'}
                    loading={scheduleFetcher.state === 'submitting'}
                    loadingText="Scheduling..."
                  >
                    Schedule callback
                  </Button>
                </scheduleFetcher.Form>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setConfirmModalOpen(false);
                  setDeliveryDate('');
                  setScheduleDelayMinutes(120);
                  setScheduleNotes('');
                }}
              >
                Close
              </Button>
            </div>
        </Modal>
      )}

      {/* Delete order modal (cancel with reason) */}
      {cancelModalOpen && (
        <Modal open onClose={() => { setCancelModalOpen(false); setCancelReason(''); }} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-app-fg mb-1">Delete order</h3>
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
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Customer not picking"
              className="input w-full min-h-[80px]"
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

      {/* Allocate to 3PL modal — CONFIRMED → ALLOCATED */}
      {allocateModalOpen && (
        <Modal open onClose={() => setAllocateModalOpen(false)} maxWidth="max-w-md" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-app-fg mb-1">Allocate to 3PL</h3>
          <p className="text-sm text-app-fg-muted mb-3">
            Select the 3PL location that will fulfil this order. Stock must be available at that location.
          </p>
          <label htmlFor="allocate-location-id" className="block text-sm font-medium text-app-fg-muted mb-1.5">
            Logistics location
          </label>
          <select
            id="allocate-location-id"
            value={allocateLocationId}
            onChange={(e) => setAllocateLocationId(e.target.value)}
            className="input w-full"
          >
            <option value="">Select a location...</option>
            {logisticsLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}{loc.address ? ` — ${loc.address}` : ''}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mt-4 justify-end">
            <Button type="button" variant="secondary" onClick={() => setAllocateModalOpen(false)}>
              Back
            </Button>
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="transition" />
              <input type="hidden" name="newStatus" value="ALLOCATED" />
              <input type="hidden" name="logisticsLocationId" value={allocateLocationId} />
              <Button
                type="submit"
                variant="primary"
                disabled={!allocateLocationId || fetcher.state === 'submitting'}
                loading={fetcher.state === 'submitting'}
                loadingText="Allocating..."
              >
                Allocate
              </Button>
            </fetcher.Form>
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
          <label htmlFor="delivery-note" className="block text-sm font-medium text-app-fg-muted mb-1.5">
            Delivery note (optional)
          </label>
          <textarea
            id="delivery-note"
            value={deliverNote}
            onChange={(e) => setDeliverNote(e.target.value)}
            placeholder="e.g. Customer confirmed receipt on follow-up call at 3:42pm."
            className="input w-full min-h-[80px]"
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

      {/* Share to 3PL modal (WhatsApp group) — Phase 4. Server renders the template, logs the
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
            <h3 className="text-lg font-semibold text-app-fg mb-1">Share to 3PL (WhatsApp)</h3>
            <p className="text-sm text-app-fg-muted mb-3">
              Pick a 3PL location and a template. Clicking <strong>Copy &amp; open group</strong> logs the message, copies the text to your clipboard, and opens the WhatsApp group. Paste with ⌘V / long-press then hit send.
            </p>

            <div className="space-y-3">
              <div>
                <label htmlFor="share-location" className="block text-sm font-medium text-app-fg-muted mb-1.5">
                  3PL location
                </label>
                <select
                  id="share-location"
                  value={shareLocationId}
                  onChange={(e) => setShareLocationId(e.target.value)}
                  className="input w-full"
                >
                  <option value="">Select a location...</option>
                  {locationsWithGroup.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
                {locationsWithGroup.length === 0 && (
                  <p className="text-xs text-warning-600 mt-1">
                    No 3PL locations have a WhatsApp group link configured. Ask Logistics to add one.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="share-template" className="block text-sm font-medium text-app-fg-muted mb-1.5">
                  Template
                </label>
                <select
                  id="share-template"
                  value={shareTemplateId}
                  onChange={(e) => setShareTemplateId(e.target.value)}
                  className="input w-full"
                >
                  <option value="">Select a template...</option>
                  {logisticsDispatchTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
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
                      fetcher.submit({ intent: 'initiateCall' }, { method: 'post' });
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
                      recordCallFetcher.submit(
                        { intent: 'initiateCall' },
                        { method: 'post' },
                      );
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
                      recordCallFetcher.submit(
                        { intent: 'initiateCall' },
                        { method: 'post' },
                      );
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
        <Modal open onClose={() => setAdjustItemsModalOpen(false)} maxWidth="max-w-lg" role="dialog" aria-labelledby="adjust-items-title" contentClassName="p-0 max-h-[90dvh] overflow-hidden flex flex-col">
            <h2 id="adjust-items-title" className="text-lg font-semibold text-app-fg p-6 pb-2">
              Adjust order items
            </h2>
            <p className="text-sm text-app-fg-muted px-6 pb-4">
              Update quantities or prices. This changes the order details only, not the order status.
            </p>
            {adjustItemsData?.error && (
              <p className="text-sm text-danger-600 dark:text-danger-400 mx-6 mb-2">{adjustItemsData.error}</p>
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
            <div className="p-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-app-border">
              <p className="text-sm font-semibold text-app-fg mb-4">
                Total: &#8358;
                {editedItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAdjustItemsModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={adjustItemsFetcher.state === 'submitting' || editedItems.some((i) => i.quantity < 1 || i.unitPrice < 0)}
                  loading={adjustItemsFetcher.state === 'submitting'}
                  loadingText="Saving..."
                  onClick={() => {
                    const payload = editedItems.map(({ productId, quantity, unitPrice }) => ({
                      productId,
                      quantity,
                      unitPrice,
                    }));
                    const totalAmount = payload.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
                    adjustItemsFetcher.submit(
                      {
                        intent: 'adjustOrderItems',
                        items: JSON.stringify(payload),
                        totalAmount: String(totalAmount),
                      },
                      { method: 'post' },
                    );
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
        </Modal>
      )}
    </div>
  );
}
