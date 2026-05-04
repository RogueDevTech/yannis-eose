/**
 * FundingFlowTimeline — chronological "back-and-forth" view of one funding flow.
 *
 * Pass either `transferId` or `requestId`. The component fetches
 * `trpc.marketing.getFundingFlow.query(...)` and renders a vertical timeline:
 * Requested → Approved → Sent → Received (or Rejected / Disputed branches).
 *
 * Lives inside detail modals on the funding page; small enough to drop into other
 * surfaces (CEO dashboard, audit cross-references) without modification.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import { NairaPrice } from '~/components/ui/naira-price';
import { Spinner } from '~/components/ui/spinner';
import { RoleBadge } from '~/components/ui/role-badge';

type FlowEventKind =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'received'
  | 'disputed';

interface FlowEvent {
  kind: FlowEventKind;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  note: string | null;
}

interface FundingFlow {
  request: {
    id: string;
    status: string;
    amount: string;
    requesterId: string;
    requesterName: string | null;
    reason: string | null;
    createdAt: string;
    resolvedAt: string | null;
  } | null;
  transfer: {
    id: string;
    status: string;
    amount: string;
    senderId: string;
    senderName: string | null;
    receiverId: string;
    receiverName: string | null;
    sentAt: string;
    verifiedAt: string | null;
    receiptUrl: string | null;
    sourceFundingRequestId: string | null;
  } | null;
  events: FlowEvent[];
}

const EVENT_LABEL: Record<FlowEventKind, string> = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  sent: 'Transfer sent',
  received: 'Marked received',
  disputed: 'Disputed',
};

const EVENT_TONE: Record<FlowEventKind, { dot: string; ring: string; text: string }> = {
  requested: {
    dot: 'bg-info-500',
    ring: 'ring-info-200 dark:ring-info-900/40',
    text: 'text-info-700 dark:text-info-400',
  },
  approved: {
    dot: 'bg-success-500',
    ring: 'ring-success-200 dark:ring-success-900/40',
    text: 'text-success-700 dark:text-success-400',
  },
  rejected: {
    dot: 'bg-danger-500',
    ring: 'ring-danger-200 dark:ring-danger-900/40',
    text: 'text-danger-700 dark:text-danger-400',
  },
  sent: {
    dot: 'bg-brand-500',
    ring: 'ring-brand-200 dark:ring-brand-900/40',
    text: 'text-brand-700 dark:text-brand-400',
  },
  received: {
    dot: 'bg-success-500',
    ring: 'ring-success-200 dark:ring-success-900/40',
    text: 'text-success-700 dark:text-success-400',
  },
  disputed: {
    dot: 'bg-warning-500',
    ring: 'ring-warning-200 dark:ring-warning-900/40',
    text: 'text-warning-700 dark:text-warning-400',
  },
};

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface FundingFlowTimelineProps {
  transferId?: string;
  requestId?: string;
  /** Hide the summary block (amount + parties) — useful when the parent already shows it. */
  hideSummary?: boolean;
}

export function FundingFlowTimeline({
  transferId,
  requestId,
  hideSummary = false,
}: FundingFlowTimelineProps) {
  const [data, setData] = useState<FundingFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!transferId && !requestId) return;
    const base = getBrowserApiBaseUrl();
    if (!base) {
      setError('API base URL not configured');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const payload: Record<string, string> = {};
    if (transferId) payload.transferId = transferId;
    if (requestId) payload.requestId = requestId;
    const url = `${base}/trpc/marketing.getFundingFlow?input=${encodeURIComponent(JSON.stringify(payload))}`;

    fetch(url, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed to load funding flow');
        }
        const json = (await res.json()) as { result?: { data?: FundingFlow } };
        if (cancelled) return;
        setData(json?.result?.data ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load timeline');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transferId, requestId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-app-fg-muted">
        <Spinner size="sm" />
        Loading flow…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-800/50 dark:bg-danger-900/20 dark:text-danger-300">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const summaryParties: ReactNode = (() => {
    if (data.transfer) {
      return (
        <>
          <span className="font-medium text-app-fg">{data.transfer.senderName ?? 'Unknown'}</span>
          <span className="mx-1.5 text-app-fg-muted">→</span>
          <span className="font-medium text-app-fg">{data.transfer.receiverName ?? 'Unknown'}</span>
        </>
      );
    }
    if (data.request) {
      return (
        <span className="font-medium text-app-fg">
          Requested by {data.request.requesterName ?? 'Unknown'}
        </span>
      );
    }
    return null;
  })();

  const amount = data.transfer?.amount ?? data.request?.amount ?? '0';

  return (
    <div className="space-y-3">
      {!hideSummary && (
        <div className="rounded-md border border-app-border bg-app-canvas px-3 py-2 text-sm">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>{summaryParties}</div>
            <NairaPrice amount={Number(amount)} className="font-semibold text-app-fg" />
          </div>
          {data.request?.reason && (
            <p className="mt-1 text-xs text-app-fg-muted italic">
              &ldquo;{data.request.reason}&rdquo;
            </p>
          )}
        </div>
      )}

      <ol className="relative space-y-3 pl-6">
        {/* Vertical rail behind the dots */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-[7px] top-2 bottom-2 w-px bg-app-border"
        />
        {data.events.map((event, idx) => {
          const tone = EVENT_TONE[event.kind];
          return (
            <li key={`${event.kind}-${event.at}-${idx}`} className="relative">
              <span
                aria-hidden
                className={`absolute left-[-22px] top-1 inline-block h-3 w-3 rounded-full ring-2 ${tone.dot} ${tone.ring}`}
              />
              <div className="space-y-0.5 text-sm">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${tone.text}`}>
                    {EVENT_LABEL[event.kind]}
                  </span>
                  <span className="text-xs text-app-fg-muted whitespace-nowrap">
                    {formatStamp(event.at)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-app-fg">
                  <span className="font-medium">{event.actorName ?? 'System'}</span>
                  {event.actorRole && <RoleBadge role={event.actorRole} />}
                </div>
                {event.note && (
                  <p className="text-xs text-app-fg-muted italic">{event.note}</p>
                )}
              </div>
            </li>
          );
        })}
        {data.events.length === 0 && (
          <li className="text-sm text-app-fg-muted italic">No events yet.</li>
        )}
      </ol>
    </div>
  );
}
