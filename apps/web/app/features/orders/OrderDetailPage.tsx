import { useState, useEffect, useCallback } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { EDGE_FORM_ACTOR_ID } from '@yannis/shared';
import { useFetcherToast } from '~/components/ui/toast';
import { AmountInput } from '~/components/ui/amount-input';
import { Button } from '~/components/ui/button';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
import { useVoipDevice } from '~/hooks/useVoipDevice';
import type { CallLogEntry, HistoryEntry, OrderDetailStreamData } from './types';

// ── Constants ────────────────────────────────────────────────────

const STATUS_FLOW = [
  'UNPROCESSED', 'CS_ENGAGED', 'CONFIRMED', 'ALLOCATED',
  'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED',
] as const;

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  UNPROCESSED: { bg: 'bg-warning-50 dark:bg-warning-700/20', text: 'text-warning-700 dark:text-warning-500', dot: 'bg-warning-500' },
  CS_ENGAGED: { bg: 'bg-info-50 dark:bg-info-700/20', text: 'text-info-700 dark:text-info-500', dot: 'bg-info-500' },
  CONFIRMED: { bg: 'bg-brand-50 dark:bg-brand-700/20', text: 'text-brand-700 dark:text-brand-400', dot: 'bg-brand-500' },
  CANCELLED: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-700 dark:text-danger-500', dot: 'bg-danger-500' },
  ALLOCATED: { bg: 'bg-info-50 dark:bg-info-700/20', text: 'text-info-700 dark:text-info-500', dot: 'bg-info-500' },
  DISPATCHED: { bg: 'bg-info-50 dark:bg-info-700/20', text: 'text-info-700 dark:text-info-500', dot: 'bg-info-500' },
  IN_TRANSIT: { bg: 'bg-brand-50 dark:bg-brand-700/20', text: 'text-brand-700 dark:text-brand-400', dot: 'bg-brand-500' },
  DELIVERED: { bg: 'bg-success-50 dark:bg-success-700/20', text: 'text-success-700 dark:text-success-500', dot: 'bg-success-500' },
  COMPLETED: { bg: 'bg-success-50 dark:bg-success-700/20', text: 'text-success-700 dark:text-success-500', dot: 'bg-success-500' },
  RETURNED: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-700 dark:text-danger-500', dot: 'bg-danger-500' },
};

const CALL_STATUS_COLORS: Record<string, { bg: string; text: string; icon: string }> = {
  INITIATED: { bg: 'bg-info-50 dark:bg-info-700/20', text: 'text-info-600 dark:text-info-400', icon: 'text-info-500' },
  RINGING: { bg: 'bg-warning-50 dark:bg-warning-700/20', text: 'text-warning-600 dark:text-warning-400', icon: 'text-warning-500' },
  IN_PROGRESS: { bg: 'bg-brand-50 dark:bg-brand-700/20', text: 'text-brand-600 dark:text-brand-400', icon: 'text-brand-500' },
  COMPLETED: { bg: 'bg-success-50 dark:bg-success-700/20', text: 'text-success-600 dark:text-success-400', icon: 'text-success-500' },
  FAILED: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-600 dark:text-danger-400', icon: 'text-danger-500' },
  NO_ANSWER: { bg: 'bg-danger-50 dark:bg-danger-700/20', text: 'text-danger-600 dark:text-danger-400', icon: 'text-danger-500' },
  BUSY: { bg: 'bg-warning-50 dark:bg-warning-700/20', text: 'text-warning-600 dark:text-warning-400', icon: 'text-warning-500' },
};

// ── History helpers ─────────────────────────────────────────────

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

function computeDiff(
  older: Record<string, unknown>,
  newer: Record<string, unknown>,
): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
  const skip = new Set(['valid_from', 'valid_to', 'valid_period', 'changed_by', '_table_name', '_row_data']);
  const allKeys = new Set([...Object.keys(older), ...Object.keys(newer)]);
  const diffs: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

  for (const key of allKeys) {
    if (skip.has(key)) continue;
    const oldVal = older[key];
    const newVal = newer[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diffs.push({ field: key, oldValue: oldVal, newValue: newVal });
    }
  }
  return diffs;
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '(null)';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
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

// ── History Timeline Component ──────────────────────────────────

function OrderHistoryTimeline({ history }: { history: HistoryEntry[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (history.length === 0) {
    return (
      <div className="card">
        <p className="text-sm text-surface-800 dark:text-surface-200 text-center py-8">
          No audit history available. This may require SuperAdmin access.
        </p>
      </div>
    );
  }

  // History is ordered newest first. Reverse to compute diffs (compare each to its predecessor).
  const chronological = [...history].reverse();

  return (
    <div className="space-y-3">
      {history.map((entry, idx) => {
        // Find the chronological index for diff computation
        const chronIdx = chronological.findIndex(
          (e) => e.validFrom === entry.validFrom,
        );
        const prevEntry = chronIdx > 0 ? chronological[chronIdx - 1] : null;
        const diffs = prevEntry ? computeDiff(prevEntry.data, entry.data) : [];
        const isFirst = chronIdx === 0;
        const isExpanded = expandedIdx === idx;

        return (
          <div key={`${entry.validFrom}-${idx}`} className="relative">
            {/* Timeline connector */}
            {idx < history.length - 1 && (
              <div className="absolute left-4 top-10 bottom-0 w-0.5 bg-surface-200 dark:bg-surface-700" />
            )}

            <div className="flex gap-3">
              {/* Timeline dot */}
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-100 dark:bg-surface-800 border-2 border-surface-300 dark:border-surface-600 flex items-center justify-center mt-1">
                {isFirst ? (
                  <svg className="w-3.5 h-3.5 text-success-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 text-brand-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.134l.228.228a7 7 0 1011.549-3.078.75.75 0 10-1.313.725zM4.688 8.576a5.5 5.5 0 019.201-2.466l.312.311H11.77a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V3.537a.75.75 0 00-1.5 0V5.67l-.228-.228A7 7 0 002.875 8.576a.75.75 0 101.313-.725v-.275z" clipRule="evenodd" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  className="w-full text-left card hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-white">
                        {isFirst ? 'Record Created' : `${diffs.length} field${diffs.length !== 1 ? 's' : ''} changed`}
                      </p>
                      <p className="text-xs text-surface-800 dark:text-surface-200 mt-0.5">
                        {formatDate(entry.validFrom)}
                        {entry.changedBy && (
                          <span className="ml-2">
                            by {entry.changedBy === EDGE_FORM_ACTOR_ID ? 'Edge Form' : `${entry.changedBy.slice(0, 8)}...`}
                          </span>
                        )}
                      </p>
                    </div>
                    <svg
                      className={`w-4 h-4 text-surface-700 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>

                  {/* Expanded diff view */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-surface-200 dark:border-surface-700" onClick={(e) => e.stopPropagation()}>
                      {isFirst ? (
                        <div className="space-y-1.5">
                          {Object.entries(entry.data)
                            .filter(([key]) => !['valid_from', 'valid_to', 'valid_period', 'changed_by', '_table_name', '_row_data'].includes(key))
                            .map(([key, value]) => (
                              <div key={key} className="flex gap-2 text-xs">
                                <span className="font-medium text-surface-800 dark:text-surface-200 min-w-[120px]">{key}:</span>
                                <span className="font-mono text-surface-900 dark:text-surface-100 break-all">{formatValue(value)}</span>
                              </div>
                            ))}
                        </div>
                      ) : diffs.length > 0 ? (
                        <table className="w-full text-xs">
                          <thead>
                            <tr>
                              <th className="text-left py-1 px-2 font-medium text-surface-800 dark:text-surface-200">Field</th>
                              <th className="text-left py-1 px-2 font-medium text-surface-800 dark:text-surface-200">Old Value</th>
                              <th className="text-left py-1 px-2 font-medium text-surface-800 dark:text-surface-200">New Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diffs.map((d) => (
                              <tr key={d.field} className="border-t border-surface-100 dark:border-surface-800">
                                <td className="py-1.5 px-2 font-medium text-surface-700 dark:text-surface-300">{d.field}</td>
                                <td className="py-1.5 px-2 font-mono text-danger-600 dark:text-danger-400 break-all">
                                  {formatValue(d.oldValue)}
                                </td>
                                <td className="py-1.5 px-2 font-mono text-success-600 dark:text-success-400 break-all">
                                  {formatValue(d.newValue)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="text-xs text-surface-800 dark:text-surface-200">No field changes detected.</p>
                      )}
                    </div>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Manual Call Panel (Relaxed Mode) ────────────────────────────

function ManualCallPanel({
  order,
  fetcher,
  revealedPhone,
  phoneRevealed,
}: {
  order: OrderDetailStreamData['order'];
  fetcher: ReturnType<typeof useFetcher>;
  revealedPhone: string | null;
  phoneRevealed: boolean;
}) {
  if (order.status !== 'CS_ENGAGED') return null;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Manual Call</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 dark:bg-warning-700/20 px-2 py-0.5 text-2xs font-medium text-warning-700 dark:text-warning-400">
          Relaxed Mode
        </span>
      </div>

      {!phoneRevealed ? (
        <>
          <p className="text-xs text-surface-800 dark:text-surface-200 mb-3">
            Click below to reveal the customer phone number for manual calling.
            This action is logged in the audit trail.
          </p>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="revealPhone" />
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={fetcher.state === 'submitting'}
              loadingText="Revealing..."
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              Call Customer
            </Button>
          </fetcher.Form>
        </>
      ) : (
        <>
          <div className="rounded-lg bg-info-50 dark:bg-info-700/20 border border-info-200 dark:border-info-700/50 p-3 mb-3">
            <p className="text-xs text-info-600 dark:text-info-400 mb-1 font-medium">Customer Phone Number</p>
            <p className="text-lg font-mono font-bold text-info-700 dark:text-info-300 tracking-wider">
              {revealedPhone}
            </p>
          </div>
          <p className="text-xs text-surface-800 dark:text-surface-200 text-center">
            Call this number manually, then confirm the order below.
          </p>
          <p className="text-xs text-success-600 dark:text-success-400 mt-2 text-center">
            Phone revealed. You can now confirm the order.
          </p>
        </>
      )}
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
    <div className="rounded-xl bg-surface-900 dark:bg-surface-950 p-4 text-white animate-fade-in">
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

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        {/* Mute button */}
        <button
          onClick={onToggleMute}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
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
          onClick={onHangUp}
          className="w-14 h-14 rounded-full bg-danger-500 hover:bg-danger-600 text-white flex items-center justify-center transition-colors"
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
}: {
  order: OrderDetailStreamData['order'];
  latestCall: CallLogEntry | null;
  canConfirm: boolean;
  fetcher: ReturnType<typeof useFetcher>;
  hasActiveCall: boolean;
}) {
  const revalidator = useRevalidator();

  const voip = useVoipDevice({
    fetchTokenUrl: '/trpc/voip.generateToken',
    onCallStatusChange: (status) => {
      // Revalidate loader data when call completes to update callLogs
      if (status === 'COMPLETED' || status === 'FAILED') {
        if (revalidator.state === 'idle') {
          revalidator.revalidate();
        }
      }
    },
  });

  // Auto-init device when component mounts and order is CS_ENGAGED
  useEffect(() => {
    if (order.status === 'CS_ENGAGED' && !voip.ready && !voip.connecting) {
      voip.initDevice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.status]);

  if (order.status !== 'CS_ENGAGED') return null;

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

      {/* Device error */}
      {voip.error && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-3 py-2 mb-3">
          <p className="text-xs text-danger-600 dark:text-danger-400">{voip.error}</p>
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

      {/* Call button — sends initiateCall action to backend */}
      {!showInCallUI && (
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

// ── Main Feature Component ───────────────────────────────────────

export function OrderDetailPage({ order, latestCall, history, strictDataMode, voipEnabled }: OrderDetailStreamData) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [cancelReason, setCancelReason] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details');

  const currentStatusIndex = STATUS_FLOW.indexOf(order.status as (typeof STATUS_FLOW)[number]);
  const actionError = (fetcher.data as { error?: string })?.error;
  const callInitiated = (fetcher.data as { callInitiated?: boolean })?.callInitiated;
  // Track revealed phone from manual call action
  const revealedPhone = (fetcher.data as { phone?: string })?.phone ?? null;
  const phoneRevealed = revealedPhone !== null || (fetcher.data as { phoneRevealed?: boolean })?.phoneRevealed === true;
  useFetcherToast(fetcher.data, { successMessage: 'Order updated' });

  // Check if any call log in the order meets the confirm gate
  const anyCallMeetsConfirmGate = order.callLogs.some(
    (c) => c.callStatus === 'COMPLETED' && (c.durationSeconds ?? 0) >= 15,
  );

  // Check if any call was attempted (for No Answer button)
  const anyCallAttempted = order.callLogs.some(
    (c) => c.callStatus !== 'INITIATED',
  );

  // Check if any manual call exists (for relaxed mode confirm gate)
  const hasManualCallLog = order.callLogs.some(
    (c) => c.callStatus === 'MANUAL_CALL',
  );

  // Whether the Confirm button should be enabled — mode-aware
  const canConfirm = voipEnabled
    ? anyCallMeetsConfirmGate // VOIP mode: need VOIP call >= 15s
    : (hasManualCallLog || phoneRevealed || anyCallMeetsConfirmGate); // Manual mode: phone revealed or manual call logged

  // Poll for call status updates while a call is active
  // This is a fallback until Socket.io frontend hooks are wired.
  const revalidate = useCallback(() => {
    if (revalidator.state === 'idle') {
      revalidator.revalidate();
    }
  }, [revalidator]);

  useEffect(() => {
    // If we just initiated a call, start polling
    if (callInitiated) {
      const interval = setInterval(revalidate, 3000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [callInitiated, revalidate]);

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/admin/cs/orders" className="text-surface-800 dark:text-surface-200 hover:text-brand-500">
          Orders
        </Link>
        <svg className="w-4 h-4 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-surface-900 dark:text-white font-medium">{order.id.slice(0, 8)}...</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">{order.customerName}</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 font-mono mt-0.5">
            {order.customerPhoneDisplay}
          </p>
        </div>
        <span className={`badge ${STATUS_COLORS[order.status]?.bg ?? ''} ${STATUS_COLORS[order.status]?.text ?? ''}`}>
          <span className={`status-dot ${STATUS_COLORS[order.status]?.dot ?? ''}`} />
          {order.status.replace(/_/g, ' ')}
        </span>
      </div>

      {actionError && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionError}</p>
        </div>
      )}

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as 'details' | 'history')}
        tabs={[
          { value: 'details', label: 'Details' },
          { value: 'history', label: 'History' },
        ]}
      />

      {/* Tab content */}
      {activeTab === 'details' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status Timeline */}
            <div className="card">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-4">Order Progress</h2>
              <div className="flex items-center overflow-x-auto pb-2">
                {STATUS_FLOW.map((status, idx) => {
                  const isPast = idx < currentStatusIndex;
                  const isCurrent = idx === currentStatusIndex;

                  return (
                    <div key={status} className="flex items-center min-w-0">
                      <div className="flex flex-col items-center">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
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
                        <span className={`text-2xs mt-1 whitespace-nowrap ${
                          isCurrent ? 'text-brand-600 dark:text-brand-400 font-semibold' : isPast ? 'text-success-600 dark:text-success-500' : 'text-surface-700 dark:text-surface-300'
                        }`}>
                          {status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      {idx < STATUS_FLOW.length - 1 && (
                        <div className={`h-0.5 w-8 lg:w-12 mx-1 flex-shrink-0 ${isPast ? 'bg-success-500' : 'bg-surface-200 dark:bg-surface-700'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Order Items */}
            <div className="card">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Order Items</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header">Product</th>
                      <th className="table-header text-center">Qty</th>
                      <th className="table-header text-right">Unit Price</th>
                      <th className="table-header text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.orderItems.map((item) => (
                      <tr key={item.id} className="table-row">
                        <td className="table-cell font-medium text-surface-900 dark:text-surface-100 font-mono text-sm">
                          {item.productId.slice(0, 8)}...
                        </td>
                        <td className="table-cell text-center">{item.quantity}</td>
                        <td className="table-cell text-right">&#8358;{Number(item.unitPrice).toLocaleString()}</td>
                        <td className="table-cell text-right font-medium">
                          &#8358;{(item.quantity * Number(item.unitPrice)).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {order.totalAmount && (
                    <tfoot>
                      <tr className="border-t-2 border-surface-200 dark:border-surface-700">
                        <td colSpan={3} className="table-cell font-semibold text-surface-900 dark:text-surface-100 text-right">Total</td>
                        <td className="table-cell text-right font-bold text-surface-900 dark:text-white">
                          &#8358;{Number(order.totalAmount).toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
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
            {/* Call Panel — switches between VOIP (strict) and Manual (relaxed) */}
            {order.status === 'CS_ENGAGED' && voipEnabled && (
              <DeferredSection resolve={latestCall} skeleton="card">
                {(resolvedCall) => (
                  <VoipCallPanel
                    order={order}
                    latestCall={resolvedCall}
                    canConfirm={canConfirm}
                    fetcher={fetcher}
                    hasActiveCall={
                      resolvedCall != null &&
                      ['INITIATED', 'RINGING', 'IN_PROGRESS'].includes(resolvedCall.callStatus)
                    }
                  />
                )}
              </DeferredSection>
            )}
            {order.status === 'CS_ENGAGED' && !voipEnabled && (
              <ManualCallPanel
                order={order}
                fetcher={fetcher}
                revealedPhone={revealedPhone}
                phoneRevealed={phoneRevealed}
              />
            )}

            {/* Actions */}
            <div className="card">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Actions</h2>
              <div className="space-y-2">
                {order.allowedTransitions.includes('CS_ENGAGED') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="CS_ENGAGED" />
                    <Button type="submit" variant="primary" className="w-full" loading={fetcher.state === 'submitting'} loadingText="Engaging...">
                      Engage Customer
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('CONFIRMED') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="CONFIRMED" />
                    <Button
                      type="submit"
                      variant="primary"
                      className="w-full"
                      disabled={!canConfirm}
                      loading={fetcher.state === 'submitting'}
                      loadingText="Confirming..."
                      title={!canConfirm
                        ? voipEnabled
                          ? 'A VOIP call of at least 15 seconds is required before confirming'
                          : 'Click Call to reveal the phone number before confirming'
                        : undefined
                      }
                    >
                      Confirm Order
                      {!canConfirm && (
                        <span className="ml-1 text-xs opacity-70">(call required)</span>
                      )}
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('CANCELLED') && order.status === 'CS_ENGAGED' && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="CANCELLED" />
                    <textarea
                      name="reason"
                      placeholder="Cancellation reason (min 10 characters)..."
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="input text-sm mb-2"
                      rows={2}
                    />
                    <Button
                      type="submit"
                      variant="danger"
                      className="w-full"
                      disabled={cancelReason.length < 10 || !anyCallAttempted}
                      loading={fetcher.state === 'submitting'}
                      loadingText="Cancelling..."
                      title={!anyCallAttempted ? 'At least one call attempt is required' : undefined}
                    >
                      No Answer / Cancel
                      {!anyCallAttempted && (
                        <span className="ml-1 text-xs opacity-70">(call required)</span>
                      )}
                    </Button>
                  </fetcher.Form>
                )}
                {/* Non-CS_ENGAGED cancel */}
                {order.allowedTransitions.includes('CANCELLED') && order.status !== 'CS_ENGAGED' && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="CANCELLED" />
                    <textarea
                      name="reason"
                      placeholder="Cancellation reason (min 10 characters)..."
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="input text-sm mb-2"
                      rows={2}
                    />
                    <Button
                      type="submit"
                      variant="danger"
                      className="w-full"
                      disabled={cancelReason.length < 10}
                      loading={fetcher.state === 'submitting'}
                      loadingText="Cancelling..."
                    >
                      Cancel Order
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('ALLOCATED') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="ALLOCATED" />
                    <input name="logisticsLocationId" type="text" placeholder="Logistics Location ID" className="input text-sm mb-2" required />
                    <Button type="submit" variant="primary" className="w-full" loading={fetcher.state === 'submitting'} loadingText="Allocating...">
                      Allocate to 3PL
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('DISPATCHED') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="DISPATCHED" />
                    <input name="riderId" type="text" placeholder="Rider ID" className="input text-sm mb-2" required />
                    <Button type="submit" variant="primary" className="w-full" loading={fetcher.state === 'submitting'} loadingText="Dispatching...">
                      Dispatch to Rider
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('IN_TRANSIT') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="IN_TRANSIT" />
                    <Button type="submit" variant="primary" className="w-full" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                      Mark In Transit
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('DELIVERED') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="DELIVERED" />
                    <AmountInput name="deliveryFeeAddOn" placeholder="Delivery add-on (₦) — optional" className="input text-sm mb-2" />
                    <Button type="submit" variant="primary" className="w-full" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                      Mark Delivered
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('PARTIALLY_DELIVERED') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="PARTIALLY_DELIVERED" />
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input name="deliveredQuantity" type="number" min="0" placeholder="Delivered qty" className="input text-sm" required />
                      <input name="returnedQuantity" type="number" min="0" placeholder="Returned qty" className="input text-sm" required />
                    </div>
                    <AmountInput name="deliveryFeeAddOn" placeholder="Delivery add-on (₦) — optional" className="input text-sm mb-2" />
                    <Button type="submit" variant="warning" className="w-full" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                      Partial Delivery
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('COMPLETED') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="COMPLETED" />
                    <Button type="submit" variant="primary" className="w-full" loading={fetcher.state === 'submitting'} loadingText="Completing...">
                      Complete Order
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('RETURNED') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="RETURNED" />
                    <textarea
                      name="reason"
                      placeholder="Return reason (min 10 characters)..."
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      className="input text-sm mb-2"
                      rows={2}
                    />
                    <Button
                      type="submit"
                      variant="danger"
                      className="w-full"
                      disabled={returnReason.length < 10}
                      loading={fetcher.state === 'submitting'}
                      loadingText="Updating..."
                    >
                      Mark Returned
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('RESTOCKED') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="RESTOCKED" />
                    <Button type="submit" variant="primary" className="w-full" loading={fetcher.state === 'submitting'} loadingText="Updating...">
                      Restock (Sellable)
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.includes('WRITTEN_OFF') && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="WRITTEN_OFF" />
                    <textarea
                      name="reason"
                      placeholder="Damage note (min 10 characters)..."
                      value={writeOffReason}
                      onChange={(e) => setWriteOffReason(e.target.value)}
                      className="input text-sm mb-2"
                      rows={2}
                    />
                    <Button
                      type="submit"
                      variant="danger"
                      className="w-full"
                      disabled={writeOffReason.length < 10}
                      loading={fetcher.state === 'submitting'}
                      loadingText="Updating..."
                    >
                      Write Off (Damaged)
                    </Button>
                  </fetcher.Form>
                )}
                {order.allowedTransitions.length === 0 && (
                  <p className="text-sm text-surface-800 dark:text-surface-200 text-center py-2">
                    No actions available
                  </p>
                )}
              </div>
            </div>

            {/* Order Info */}
            <div className="card">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Details</h2>
              <dl className="space-y-3 text-sm">
                {order.customerAddress && (
                  <div>
                    <dt className="text-surface-800 dark:text-surface-200">Customer Address</dt>
                    <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{order.customerAddress}</dd>
                  </div>
                )}
                {order.deliveryAddress && (
                  <div>
                    <dt className="text-surface-800 dark:text-surface-200">Delivery Address</dt>
                    <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{order.deliveryAddress}</dd>
                  </div>
                )}
                {order.deliveryNotes && (
                  <div>
                    <dt className="text-surface-800 dark:text-surface-200">Delivery Notes</dt>
                    <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{order.deliveryNotes}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-surface-800 dark:text-surface-200">Created</dt>
                  <dd className="text-surface-900 dark:text-surface-100 mt-0.5">
                    {new Date(order.createdAt).toLocaleString('en-NG')}
                  </dd>
                </div>
                {order.confirmedAt && (
                  <div>
                    <dt className="text-surface-800 dark:text-surface-200">Confirmed</dt>
                    <dd className="text-surface-900 dark:text-surface-100 mt-0.5">
                      {new Date(order.confirmedAt).toLocaleString('en-NG')}
                    </dd>
                  </div>
                )}
                {order.deliveredAt && (
                  <div>
                    <dt className="text-surface-800 dark:text-surface-200">Delivered</dt>
                    <dd className="text-surface-900 dark:text-surface-100 mt-0.5">
                      {new Date(order.deliveredAt).toLocaleString('en-NG')}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-surface-800 dark:text-surface-200">Order ID</dt>
                  <dd className="text-surface-900 dark:text-surface-100 mt-0.5 font-mono text-xs break-all">{order.id}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      ) : (
        /* History Tab — streamed via DeferredSection */
        <div>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Change History</h2>
            <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
              Every change to this order is permanently recorded in the audit trail.
            </p>
          </div>
          <DeferredSection resolve={history} skeleton="table">
            {(resolvedHistory) => <OrderHistoryTimeline history={resolvedHistory} />}
          </DeferredSection>
        </div>
      )}
    </div>
  );
}
