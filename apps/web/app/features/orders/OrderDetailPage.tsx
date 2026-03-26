import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { useFetcherToast } from '~/components/ui/toast';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageNotification } from '~/components/ui/page-notification';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useVoipDevice } from '~/hooks/useVoipDevice';
import { useAgentStateBroadcast } from '~/hooks/useSocket';
import { formatNaira } from '~/lib/format-amount';
import { OrderTimeline } from '~/components/ui/order-timeline';
import { CSMessagingPanel } from '~/components/ui/cs-messaging-panel';
import type { CallLogEntry, TimelineEvent, OrderDetail, OrderDetailStreamData, OrderDetailPageExtraProps } from './types';

// ── Constants ────────────────────────────────────────────────────

const STATUS_FLOW = [
  'UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'ALLOCATED',
  'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
] as const;

const CALL_STATUS_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  INITIATED: { bg: 'bg-info-50 dark:bg-info-700/20', text: 'text-info-600 dark:text-info-400', icon: 'text-info-500' },
  RINGING: { bg: 'bg-warning-50 dark:bg-warning-700/20', text: 'text-warning-600 dark:text-warning-400', icon: 'text-warning-500' },
  IN_PROGRESS: { bg: 'bg-brand-50 dark:bg-brand-700/20', text: 'text-brand-600 dark:text-brand-400', icon: 'text-brand-500' },
  COMPLETED: { bg: 'bg-success-50 dark:bg-success-700/20', text: 'text-success-600 dark:text-success-400', icon: 'text-success-500' },
  FAILED: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-600 dark:text-danger-400', icon: 'text-danger-500' },
  NO_ANSWER: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-600 dark:text-danger-400', icon: 'text-danger-500' },
  BUSY: { bg: 'bg-warning-50 dark:bg-warning-700/20', text: 'text-warning-600 dark:text-warning-400', icon: 'text-warning-500' },
};

// ── Twilio error formatting (call modal + event log) ──

interface ParsedTwilioError {
  code?: number;
  message?: string;
  more_info?: string;
  status?: number;
}

function parseTwilioError(raw: string | undefined): ParsedTwilioError | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...(typeof parsed.code === 'number' && { code: parsed.code }),
      ...(typeof parsed.message === 'string' && { message: parsed.message }),
      ...(typeof parsed.more_info === 'string' && { more_info: parsed.more_info }),
      ...(typeof parsed.status === 'number' && { status: parsed.status }),
    };
  } catch {
    return null;
  }
}

function formatTwilioErrorForLog(raw: string | undefined): string {
  const parsed = parseTwilioError(raw);
  if (parsed?.message != null) {
    const codePart = parsed.code != null ? `Twilio ${parsed.code}: ` : 'Twilio: ';
    const morePart = parsed.more_info ? ` (More info: ${parsed.more_info})` : '';
    return codePart + parsed.message + morePart;
  }
  return raw != null ? `Twilio error: ${raw}` : 'Twilio error';
}

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

const DETAIL_DATE_CLASS = 'text-surface-600 dark:text-surface-400 tabular-nums';
const DETAIL_CURRENCY_CLASS = 'font-semibold text-success-600 dark:text-success-400 tabular-nums';
const DETAIL_PERSON_CLASS = 'font-medium text-brand-600 dark:text-brand-400';
const DETAIL_ID_CLASS = 'font-mono text-xs text-surface-500 dark:text-surface-400 break-all';

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
      return 'font-medium text-surface-700 dark:text-surface-300';
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
        : 'text-surface-600 dark:text-surface-400 tabular-nums',
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
      if (s === 'MERGED' || s === 'DISMISSED') return 'text-surface-600 dark:text-surface-400';
      return '';
    },
  },
  {
    label: 'Duplicate of',
    getValue: (o) => o.duplicateOfId,
    format: (v) => (v ? String(v) : ''),
    ddClassName: 'font-mono text-xs text-surface-600 dark:text-surface-400 break-all',
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
    ddClassName: 'font-mono text-xs text-surface-600 dark:text-surface-400 break-all',
  },
  {
    label: 'Delivery OTP',
    getValue: (o) => o.deliveryOtp,
    format: (v) => (v ? String(v) : ''),
    ddClassName: 'font-mono text-sm text-surface-700 dark:text-surface-300',
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
              <p className="text-xs text-surface-800 dark:text-surface-200">
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

function InCallOverlay({
  duration,
  muted,
  callStatus,
  onToggleMute,
  onHangUp,
}: {
  duration: number;
  muted: boolean;
  callStatus: string | null;
  onToggleMute: () => void;
  onHangUp: () => void;
}) {
  const statusLabel =
    callStatus === 'INITIATED' ? 'Connecting...' :
    callStatus === 'RINGING' ? 'Ringing...' :
    callStatus === 'IN_PROGRESS' ? 'On Call' :
    callStatus ?? 'Unknown';

  const isActive = callStatus === 'INITIATED' || callStatus === 'RINGING' || callStatus === 'IN_PROGRESS';

  return (
    <div className="rounded-xl bg-surface-900 dark:bg-surface-950 p-4 sm:p-5 text-white animate-fade-in w-full max-w-sm mx-auto max-h-[90dvh] overflow-y-auto">
      {/* Status + pulsing dot */}
      <div className="flex items-center justify-center gap-2 mb-3">
        {isActive && (
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success-500" />
          </span>
        )}
        <span className="text-sm font-medium">{statusLabel}</span>
      </div>

      {/* Timer */}
      <div className="text-center mb-4">
        <p className="text-3xl font-mono font-bold tracking-wider">{formatCallTimer(duration)}</p>
        {duration >= 15 && (
          <p className="text-xs text-success-400 mt-1">Confirm gate met</p>
        )}
      </div>

      {/* Controls — touch-friendly min sizes */}
      <div className="flex items-center justify-center gap-4">
        {/* Mute button */}
        <button
          type="button"
          onClick={onToggleMute}
          className={`min-w-[48px] min-h-[48px] w-12 h-12 rounded-full flex items-center justify-center transition-colors touch-manipulation ${
            muted
              ? 'bg-danger-500 hover:bg-danger-600 text-white'
              : 'bg-surface-700 hover:bg-surface-600 text-surface-300'
          }`}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.531V19.94a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.506-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
            </svg>
          )}
        </button>

        {/* Hang up button */}
        <button
          type="button"
          onClick={onHangUp}
          className="min-w-[56px] min-h-[56px] w-14 h-14 rounded-full bg-danger-500 hover:bg-danger-600 text-white flex items-center justify-center transition-colors touch-manipulation"
          title="Hang up"
        >
          <svg className="w-6 h-6 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── VOIP Call Panel (with WebRTC integration) ───────────────────

function VoipCallPanel({
  order,
  latestCall,
  canConfirm,
  fetcher,
  hasActiveCall,
  onOpenCallModal,
}: {
  order: OrderDetailStreamData['order'];
  latestCall: CallLogEntry | null;
  canConfirm: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  hasActiveCall: boolean;
  onOpenCallModal?: () => void;
}) {
  const revalidator = useRevalidator();

  const voip = useVoipDevice({
    onCallStatusChange: (status) => {
      // Revalidate loader data when call completes to update callLogs
      if (status === 'COMPLETED' || status === 'FAILED') {
        if (revalidator.state === 'idle') {
          revalidator.revalidate();
        }
      }
    },
  });

  const canShowCallPanel = order.status === 'CS_ENGAGED' || order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED';

  // Auto-init device when Call panel is shown (CS_ENGAGED or assignable pre-engage)
  useEffect(() => {
    if (canShowCallPanel && !voip.ready && !voip.connecting) {
      voip.initDevice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.status]);

  if (!canShowCallPanel) return null;

  const isServerCallActive = latestCall && ['INITIATED', 'RINGING', 'IN_PROGRESS'].includes(latestCall.callStatus);
  const isLocalCallActive = voip.onCall;
  const showInCallUI = isLocalCallActive || isServerCallActive;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white">VOIP Call</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-success-50 dark:bg-success-700/20 px-2 py-0.5 text-2xs font-medium text-success-700 dark:text-success-400">
          VOIP Enabled
        </span>
        {voip.ready && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-50 dark:bg-success-700/20 px-1.5 py-0.5 text-2xs font-medium text-success-600 dark:text-success-400">
            <span className="w-1.5 h-1.5 rounded-full bg-success-500" />
            Device Ready
          </span>
        )}
        {voip.connecting && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 dark:bg-warning-700/20 px-1.5 py-0.5 text-2xs font-medium text-warning-600 dark:text-warning-400">
            Connecting...
          </span>
        )}
      </div>

      {/* Device error — friendly message + technical details for debugging */}
      {voip.error && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-3 py-2.5 mb-3 flex items-start gap-2">
          <svg className="w-4 h-4 text-danger-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-danger-700 dark:text-danger-300">Call service unavailable</p>
            <p className="text-xs text-danger-600 dark:text-danger-400 mt-0.5">{voip.error}</p>
            <Button
              type="button"
              variant="secondary"
              className="mt-2 text-xs"
              onClick={() => voip.initDevice()}
            >
              Try again
            </Button>
            {(voip.error?.toLowerCase().includes('31202') || voip.error?.toLowerCase().includes('jwt signature')) && (
              <div className="mt-3 rounded-md border border-warning-300 dark:border-warning-600 bg-warning-50 dark:bg-warning-900/30 px-2 py-2 text-xs text-surface-700 dark:text-surface-300">
                <p className="font-semibold text-warning-800 dark:text-warning-200 mb-1">Twilio 31202 — JWT signature validation failed</p>
                <p className="mb-1">Use an <strong>API Key Secret</strong> in <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">TWILIO_API_KEY_SECRET</code>, not the account Auth Token. In Twilio Console: Account → API keys → Create API Key, then copy the <strong>Secret</strong> (not the SID) into your API env.</p>
                <p className="text-surface-600 dark:text-surface-400">API Key SID should start with <code>SK</code>; Account SID starts with <code>AC</code>.</p>
              </div>
            )}
            {(voip.debugInfo?.raw?.includes('53000') || voip.debugInfo?.phase === 'device_init') && (
              <div className="mt-3 rounded-md border border-warning-300 dark:border-warning-600 bg-warning-50 dark:bg-warning-900/30 px-2 py-2 text-xs text-surface-700 dark:text-surface-300">
                <p className="font-semibold text-warning-800 dark:text-warning-200 mb-1">Error 53000 / device init — things to check:</p>
                <ul className="list-disc list-inside space-y-0.5 ml-1">
                  <li><strong>31202 in browser console?</strong> Use <strong>API Key Secret</strong> in <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">TWILIO_API_KEY_SECRET</code> (Console → API keys → Create → copy <strong>Secret</strong>), not the account Auth Token.</li>
                  <li><code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">TWILIO_API_KEY_SID</code> must start with <code>SK</code>; <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">TWILIO_TWIML_APP_SID</code> with <code>AP</code>.</li>
                  <li>Identity uses only letters, numbers, underscore (no hyphens).</li>
                  <li>If not in the US: set <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">TWILIO_VOICE_REGION=ie1</code> or <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">au1</code>.</li>
                  <li>Network: firewall must allow WebSocket (wss) to Twilio.</li>
                </ul>
              </div>
            )}
            {voip.debugInfo && (
              <details className="mt-3 border border-danger-200 dark:border-danger-700/50 rounded-md bg-danger-100/50 dark:bg-danger-800/30">
                <summary className="cursor-pointer select-none px-2 py-1.5 text-xs font-medium text-danger-700 dark:text-danger-300">
                  Technical details (for debugging)
                </summary>
                <pre className="p-2 text-[11px] text-surface-700 dark:text-surface-300 whitespace-pre-wrap break-all overflow-x-auto max-h-48 overflow-y-auto font-mono">
                  {JSON.stringify(
                    {
                      phase: voip.debugInfo.phase,
                      status: voip.debugInfo.status,
                      errorMessage: voip.debugInfo.errorMessage,
                      responseBody: voip.debugInfo.responseBody,
                      raw: voip.debugInfo.raw,
                      stack: voip.debugInfo.stack,
                      timestamp: voip.debugInfo.timestamp,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}

      {/* In-call overlay with timer, mute, hangup */}
      {showInCallUI && (
        <div className="mb-3">
          <InCallOverlay
            duration={voip.callDuration}
            muted={voip.muted}
            callStatus={voip.callStatus ?? latestCall?.callStatus ?? null}
            onToggleMute={voip.toggleMute}
            onHangUp={voip.hangUp}
          />
        </div>
      )}

      {/* Server-side call status when no local WebRTC active */}
      {latestCall && !showInCallUI && latestCall.callStatus === 'COMPLETED' && (
        <div className="mb-3">
          <CallStatusIndicator call={latestCall} />
        </div>
      )}

      {/* Call button — opens modal when onOpenCallModal provided; otherwise submits form (legacy) */}
      {!showInCallUI && (
        onOpenCallModal ? (
          <Button
            type="button"
            variant="primary"
            className="w-full"
            disabled={hasActiveCall || !voip.ready}
            title={!voip.ready ? 'VOIP device is initializing...' : undefined}
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
              disabled={hasActiveCall || !voip.ready}
              loading={fetcher.state === 'submitting'}
              loadingText="Connecting..."
              title={!voip.ready ? 'VOIP device is initializing...' : undefined}
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
}: {
  order: OrderDetailStreamData['order'];
  resolvedCall: CallLogEntry | null;
  canConfirm: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  revalidate: () => void;
  onOpenCallModal?: () => void;
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
    />
  );
}

// ── Main Feature Component ───────────────────────────────────────

export function OrderDetailPage({
  order,
  latestCall,
  timeline,
  voipEnabled,
  canEditOrder = true,
  userRole,
  userId,
  permissions,
  csAgentsForAssign = [],
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
      ? { currentRoute: `/admin/orders/${order.id}`, currentOrderId: order.id, currentPanel: activeTab }
      : { currentRoute: '' }
  );

  const [activeTab, setActiveTab] = useState<'details' | 'timeline'>('details');
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

  const currentStatusIndex = STATUS_FLOW.indexOf(order.status as (typeof STATUS_FLOW)[number]);
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

  // When call customer modal opens and order is not yet engaged, transition to CS_ENGAGED so user only clicks once
  useEffect(() => {
    if (
      callCustomerModalOpen &&
      (order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED') &&
      canTransitionTo('CS_ENGAGED') &&
      fetcher.state === 'idle'
    ) {
      fetcher.submit(
        { intent: 'transition', newStatus: 'CS_ENGAGED' },
        { method: 'post' },
      );
    }
  }, [callCustomerModalOpen, order.status, fetcher.state]);

  // Reset call debug log when opening the call modal (VOIP path)
  useEffect(() => {
    if (callCustomerModalOpen && voipEnabled) {
      setCallDebugLog([]);
    }
  }, [callCustomerModalOpen, voipEnabled]);

  // Append response to call debug log when initiateCall returns
  const prevFetcherStateRef = useRef(fetcher.state);
  useEffect(() => {
    const data = fetcher.data as { callInitiated?: boolean; callLog?: { callStatus?: string }; twilioError?: string } | undefined;
    if (prevFetcherStateRef.current === 'submitting' && fetcher.state === 'idle' && data != null && (data.callInitiated ?? data.callLog)) {
      setCallDebugLog((prev) => [
        ...prev,
        `Response received at ${new Date().toLocaleTimeString()}`,
        `Call status: ${data.callLog?.callStatus ?? '—'}${data.twilioError ? ` | ${formatTwilioErrorForLog(data.twilioError)}` : ''}`,
      ]);
    }
    prevFetcherStateRef.current = fetcher.state;
  }, [fetcher.state, fetcher.data]);

  const showActionError = actionError && !dismissedError;

  const isAssignedToMe = order.assignedCsId === userId;
  const isCSOrHoS = ['CS_AGENT', 'HEAD_OF_CS', 'SUPER_ADMIN'].includes(userRole);
  const isElevated = userRole === 'HEAD_OF_CS' || userRole === 'SUPER_ADMIN';
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
    if (userRole === 'HEAD_OF_CS' || userRole === 'SUPER_ADMIN') return true;
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
    }
    prevFetcherState.current = fetcher.state;
  }, [fetcher.state, fetcherSuccess, confirmModalOpen, cancelModalOpen]);

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
        <Link to="/admin/cs/orders" className="text-surface-800 dark:text-surface-200 hover:text-brand-500">
          Orders
        </Link>
        <svg className="w-4 h-4 text-surface-300 dark:text-surface-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-surface-900 dark:text-white font-medium truncate min-w-0">{order.id.slice(0, 8)}...</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-900 dark:text-white truncate">{order.customerName}</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 font-mono mt-0.5 break-all">
            {order.customerPhoneDisplay}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <PageRefreshButton />
          {!canEditOrder && (
            <span className="inline-flex items-center rounded-full bg-surface-100 dark:bg-surface-800 px-2.5 py-1 text-xs font-medium text-surface-600 dark:text-surface-400">
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

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as 'details' | 'timeline')}
        tabs={[
          { value: 'details', label: 'Details' },
          { value: 'timeline', label: 'Activity' },
        ]}
      />

      {/* Tab content */}
      {activeTab === 'details' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status Timeline */}
            <div className="card overflow-hidden">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Order Progress</h2>
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
                            : 'bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300'
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
                          isCurrent ? 'text-brand-600 dark:text-brand-400 font-semibold' : isPast ? 'text-success-600 dark:text-success-500' : 'text-surface-700 dark:text-surface-300'
                        }`}>
                          {status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      {idx < STATUS_FLOW.length - 1 && (
                        <div className={`h-0.5 w-8 mx-1 flex-shrink-0 lg:hidden ${isPast ? 'bg-success-500' : 'bg-surface-200 dark:bg-surface-700'}`} />
                      )}
                    </div>
                  );
                })}
                </div>
              </div>
            </div>

            {/* Order Items — card layout (typically 3–4 items) */}
            <div className="card">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Order Items</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {order.orderItems.map((item) => {
                  const subtotal = item.quantity * Number(item.unitPrice);
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 p-3 flex flex-col"
                    >
                      <p className="font-medium text-surface-900 dark:text-surface-100 line-clamp-2" title={item.productName ?? item.productId}>
                        {item.productName ?? `${item.productId.slice(0, 8)}...`}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-sm text-surface-800 dark:text-surface-200">
                        <span>Qty: {item.quantity}</span>
                        <span>&#8358;{Number(item.unitPrice).toLocaleString()} each</span>
                      </div>
                      <p className="mt-1.5 text-sm font-semibold text-surface-900 dark:text-white">
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
                <div className="mt-3 pt-3 border-t border-surface-200 dark:border-surface-700 flex justify-end">
                  <p className="text-base font-bold text-surface-900 dark:text-white">
                    Total: &#8358;{Number(order.totalAmount).toLocaleString()}
                  </p>
                </div>
              )}
            </div>

            {/* Call History */}
            {order.callLogs.length > 0 && (
              <div className="card">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Call History</h2>
                <div className="space-y-2">
                  {order.callLogs.map((call) => (
                    <div key={call.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
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
                          <p className="text-sm font-medium text-surface-900 dark:text-surface-100">
                            {call.callStatus}
                            {call.callStatus === 'COMPLETED' && (call.durationSeconds ?? 0) >= 15 && (
                              <span className="ml-2 text-xs text-success-600 dark:text-success-400 font-normal">
                                Confirm gate met
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-surface-800 dark:text-surface-200">
                            {new Date(call.startedAt).toLocaleString('en-NG')}
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-mono text-surface-600 dark:text-surface-300">
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
            {/* Order Actions — CS / Head of CS only, role-based */}
            {canEditOrder && isCSOrHoS && (order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED' || order.status === 'CS_ENGAGED') && (
              <div className="card">
                <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Order Actions</h2>
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

                  {/* Call customer + helper — one button opens modal; transition to CS_ENGAGED runs when modal opens if needed (VOIP off) */}
                  {!voipEnabled &&
                  (((order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED') && canTransitionTo('CS_ENGAGED')) ||
                    order.status === 'CS_ENGAGED') ? (
                    <div className="space-y-2">
                      {(order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED' || !canConfirm) && (
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
                        />
                      )}
                    </DeferredSection>
                  ) : (
                    <p className="text-sm text-surface-500 dark:text-surface-400">
                      VOIP calling is available once the order is in CS Engaged status.
                    </p>
                  )
                }
              />
            )}

            {/* Order Info — dynamic fields: show when value present or alwaysShow */}
            <div className="card">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Details</h2>
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
                    valueClass || 'text-surface-900 dark:text-surface-100',
                  ].filter(Boolean).join(' ');
                  const rowClass = [
                    'min-w-0 pl-3 py-1.5 rounded-r-md -ml-px',
                    field.rowAccent ?? '',
                  ].filter(Boolean).join(' ');
                  return (
                    <div key={field.label} className={rowClass}>
                      <dt className="text-surface-600 dark:text-surface-400 text-xs font-medium uppercase tracking-wider">
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
      ) : (
        /* Timeline Tab — order lifecycle events */
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Order Activity</h2>
            <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
              Every step taken on this order, with who did it and when.
            </p>
          </div>
          <div className="card">
            {timeline ? (
              <DeferredSection resolve={timeline} skeleton="table">
                {(resolvedTimeline) => <OrderTimeline events={resolvedTimeline as TimelineEvent[]} />}
              </DeferredSection>
            ) : (
              <p className="text-sm text-surface-600 dark:text-surface-400 py-4 text-center">No timeline data.</p>
            )}
          </div>
        </div>
      )}

      {/* Confirm order modal — Confirm now or Schedule callback */}
      {confirmModalOpen && (
        <Modal open onClose={() => { setConfirmModalOpen(false); setDeliveryDate(''); setScheduleDelayMinutes(120); setScheduleNotes(''); }} maxWidth="max-w-md" contentClassName="p-6 max-h-[90dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">Confirm order</h3>
            <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
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
                  <label className="block text-xs font-medium text-surface-600 dark:text-surface-400">
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
                  <p className="text-xs text-surface-600 dark:text-surface-400">
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
              <div className="border-t border-surface-200 dark:border-surface-700 pt-4">
                <p className="text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Schedule callback</p>
                <p className="text-xs text-surface-600 dark:text-surface-400 mb-3">
                  Move order back to queue and set a time to call again (e.g. customer not picking).
                </p>
                <div className="space-y-2 mb-3">
                  <label className="block text-xs font-medium text-surface-600 dark:text-surface-400">Delay</label>
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
                  <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mt-2">Notes (optional)</label>
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
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">Delete order</h3>
            <p className="text-sm text-surface-800 dark:text-surface-200 mb-3">
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
                        : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 border border-surface-200 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-700'
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

      {/* Call customer modal — VOIP: Start call + status + debug; VOIP off: reveal number, copy, open dialer */}
      {callCustomerModalOpen && (
        <Modal open onClose={() => setCallCustomerModalOpen(false)} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">Call customer</h3>
            {voipEnabled ? (
              <>
                <p className="text-sm text-surface-800 dark:text-surface-200 mb-3">
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
                  {(fetcher.data as { callLog?: { callStatus?: string }; twilioError?: string })?.twilioError && (() => {
                    const twilioError = (fetcher.data as { twilioError?: string }).twilioError;
                    const parsed = parseTwilioError(twilioError);
                    return (
                      <div className="text-sm text-danger-600 dark:text-danger-400 rounded-md bg-danger-50 dark:bg-danger-900/20 p-3 space-y-2">
                        <p className="font-semibold">Call failed</p>
                        {parsed ? (
                          <>
                            {parsed.message != null && <p>{parsed.message}</p>}
                            {parsed.code != null && (
                              <p className="text-xs opacity-90">Error code: {parsed.code}</p>
                            )}
                            {parsed.more_info && (
                              <a
                                href={parsed.more_info}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-xs underline hover:no-underline"
                              >
                                More info
                              </a>
                            )}
                            {parsed.code === 21211 && (
                              <p className="text-xs mt-2 pt-2 border-t border-danger-200 dark:border-danger-700">
                                Tip: Phone numbers must be in E.164 format (e.g. +2348021300202 for Nigeria).
                              </p>
                            )}
                            {parsed.code === 21219 && (
                              <p className="text-xs mt-2 pt-2 border-t border-danger-200 dark:border-danger-700">
                                Tip: Trial accounts can only call verified numbers. Add this number in Twilio Console under Phone Numbers → Verified Caller IDs, or upgrade your Twilio account.
                              </p>
                            )}
                          </>
                        ) : (
                          <p>Twilio error: {twilioError}</p>
                        )}
                      </div>
                    );
                  })()}
                  <p className="text-sm text-surface-600 dark:text-surface-400">
                    Status: {fetcher.state === 'submitting' ? 'Connecting...' : (fetcher.data as { callLog?: { callStatus?: string } })?.callLog?.callStatus ?? order.callLogs[0]?.callStatus ?? 'Idle'}
                  </p>
                </div>
                <details className="mb-4 rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-surface-700 dark:text-surface-300 bg-surface-50 dark:bg-surface-800/50">
                    Logs &amp; debug
                  </summary>
                  <div className="p-3 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/30">
                    <p className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Last response</p>
                    <pre className="p-2 text-[11px] text-surface-700 dark:text-surface-300 whitespace-pre-wrap break-all overflow-x-auto max-h-32 overflow-y-auto font-mono bg-surface-100 dark:bg-surface-800 rounded mb-2">
                      {fetcher.data != null ? JSON.stringify(fetcher.data, null, 2) : '—'}
                    </pre>
                    <p className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Latest call</p>
                    <pre className="p-2 text-[11px] text-surface-700 dark:text-surface-300 whitespace-pre-wrap break-all overflow-x-auto max-h-24 overflow-y-auto font-mono bg-surface-100 dark:bg-surface-800 rounded mb-2">
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
                        <p className="text-xs font-medium text-surface-600 dark:text-surface-400 mb-1">Event log</p>
                        <ul className="list-disc list-inside text-[11px] text-surface-600 dark:text-surface-400 space-y-0.5">
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
                <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
                  Reveal the customer&apos;s number to call them manually. The call is recorded when you click &quot;Copy number&quot; or &quot;Call on my phone&quot;.
                </p>
                {revealData?.error && (
                  <p className="text-sm text-danger-600 dark:text-danger-400 mb-3">{revealData.error}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCallCustomerModalOpen(false)}
                  >
                    Close
                  </Button>
                  <revealFetcher.Form method="post">
                    <input type="hidden" name="intent" value="revealPhone" />
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={revealFetcher.state === 'submitting'}
                      loading={revealFetcher.state === 'submitting'}
                      loadingText="Revealing..."
                    >
                      Reveal number
                    </Button>
                  </revealFetcher.Form>
                </div>
              </>
            ) : !revealData?.isDialable ? (
              <>
                <p className="text-sm text-surface-800 dark:text-surface-200 mb-3">
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
                <p className="text-sm text-surface-800 dark:text-surface-200 mb-3">
                  Click &quot;Copy number&quot; or &quot;Call on my phone&quot; to record the call, then use the number to contact the customer.
                </p>
                <div className="rounded-lg bg-surface-100 dark:bg-surface-800 p-4 mb-4">
                  <p className="text-sm text-surface-600 dark:text-surface-400">
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
            <h2 id="adjust-items-title" className="text-lg font-semibold text-surface-900 dark:text-white p-6 pb-2">
              Adjust order items
            </h2>
            <p className="text-sm text-surface-600 dark:text-surface-400 px-6 pb-4">
              Update quantities or prices. This changes the order details only, not the order status.
            </p>
            {adjustItemsData?.error && (
              <p className="text-sm text-danger-600 dark:text-danger-400 mx-6 mb-2">{adjustItemsData.error}</p>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 space-y-4">
              {editedItems.map((item, index) => (
                <div
                  key={`${item.productId}-${index}`}
                  className="rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-2"
                >
                  <p className="font-medium text-surface-900 dark:text-surface-100 text-sm line-clamp-2">
                    {item.productName ?? item.productId.slice(0, 8) + '...'}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-surface-500 dark:text-surface-400 mb-1">Quantity</label>
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
                      <label className="block text-xs text-surface-500 dark:text-surface-400 mb-1">Unit price (&#8358;)</label>
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
            <div className="p-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-surface-200 dark:border-surface-700">
              <p className="text-sm font-semibold text-surface-900 dark:text-white mb-4">
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
