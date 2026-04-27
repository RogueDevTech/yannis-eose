import { useState, useEffect, useCallback } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { DeferredSection } from '~/components/ui/deferred-section';
import { FileUpload } from '~/components/ui/file-upload';
import { Tabs } from '~/components/ui/tabs';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { NairaPrice } from '~/components/ui/naira-price';
import { EmptyState } from '~/components/ui/empty-state';
import { TextInput } from '~/components/ui/text-input';
import { FormSelect } from '~/components/ui/form-select';
import { STATUS_DOT_CLASS, STATUS_LABELS } from '~/features/shared/order-status';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { buildOrderSummaryClipboardText } from '~/features/orders/build-order-summary-clipboard';
import type { OrderDetail, HistoryEntry } from '~/features/orders/types';
import type { Location } from '~/features/logistics/types';

export interface RiderOption {
  id: string;
  name: string;
  logisticsLocationId: string | null;
}

export interface LogisticsOrderDetailPageProps {
  order: OrderDetail;
  history: Promise<HistoryEntry[]>;
  locations: Location[];
  riders: RiderOption[];
  /** Back link (e.g. "/tpl/orders" for TPL, "/admin/logistics/orders" for admin) */
  backLink?: string;
  /** Breadcrumb label for back link (e.g. "Orders" for TPL, "Logistics Orders" for admin) */
  backLabel?: string;
  /** When provided (e.g. TPL), only these locations in allocate dropdown */
  allocatableLocations?: Location[];
}

const DEFAULT_BACK_LINK = '/admin/logistics/orders';

// ── Status pipeline for 3PL flow ────────────────────────────────
const TPL_PIPELINE = [
  'CONFIRMED',
  'ALLOCATED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
] as const;

// ── Helpers ─────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    month: 'short',
    day: 'numeric',
  });
}

function formatDeliveryDate(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function getStatusTimestamp(order: OrderDetail, status: string): string | null {
  switch (status) {
    case 'CONFIRMED': return order.confirmedAt ?? order.createdAt;
    case 'ALLOCATED': return order.allocatedAt ?? null;
    case 'DISPATCHED': return order.dispatchedAt ?? null;
    case 'IN_TRANSIT': return order.dispatchedAt ?? null; // approximation
    case 'DELIVERED': return order.deliveredAt ?? null;
    case 'COMPLETED': return order.deliveredAt ?? null;
    default: return null;
  }
}

function getPipelineIndex(status: string): number {
  const terminalStatuses: Record<string, number> = {
    RETURNED: 4,
    PARTIALLY_DELIVERED: 4,
    RESTOCKED: 5,
    WRITTEN_OFF: 5,
    CANCELLED: -1,
  };
  if (status in terminalStatuses) return terminalStatuses[status]!;
  return TPL_PIPELINE.indexOf(status as typeof TPL_PIPELINE[number]);
}

function isTerminalStatus(status: string): boolean {
  return ['RETURNED', 'PARTIALLY_DELIVERED', 'RESTOCKED', 'WRITTEN_OFF', 'CANCELLED'].includes(status);
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
    if (JSON.stringify(older[key]) !== JSON.stringify(newer[key])) {
      diffs.push({ field: key, oldValue: older[key], newValue: newer[key] });
    }
  }
  return diffs;
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '(empty)';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// ── Icons ───────────────────────────────────────────────────────

function UserIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 0 1 15 0Z" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H18.375m-7.5-10.5H6.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h7.5c.621 0 1.125-.504 1.125-1.125V7.875c0-.621-.504-1.125-1.125-1.125Zm6 10.125v-5.25a.375.375 0 0 0-.375-.375h-3.375a.375.375 0 0 0-.375.375v5.25c0 .207.168.375.375.375h3.375a.375.375 0 0 0 .375-.375Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    </svg>
  );
}

function CheckCircleIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 9v9.75" />
    </svg>
  );
}

function BanknotesIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
    </svg>
  );
}

// ── Status Pipeline Component ───────────────────────────────────

function StatusPipeline({ status, order }: { status: string; order: OrderDetail }) {
  const currentIdx = getPipelineIndex(status);
  const isTerminal = isTerminalStatus(status);

  return (
    <div className="w-full">
      {/* Desktop pipeline */}
      <div className="hidden sm:flex items-center gap-0">
        {TPL_PIPELINE.map((step, i) => {
          const isPast = i < currentIdx;
          const isCurrent = i === currentIdx && !isTerminal;
          const isCurrentTerminal = isTerminal && i === currentIdx;
          const isFuture = i > currentIdx;
          const ts = getStatusTimestamp(order, step);
          const label = STATUS_LABELS[step] ?? step;

          let dotClass = 'bg-app-border';
          let lineClass = 'bg-app-hover';
          let textClass = 'text-app-fg-muted';

          if (isPast) {
            dotClass = 'bg-emerald-500';
            lineClass = 'bg-emerald-400 dark:bg-emerald-600';
            textClass = 'text-app-fg-muted';
          } else if (isCurrent) {
            dotClass = STATUS_DOT_CLASS[status] ?? 'bg-brand-500';
            textClass = 'text-app-fg font-semibold';
          } else if (isCurrentTerminal) {
            dotClass = STATUS_DOT_CLASS[status] ?? 'bg-red-500';
            textClass = 'text-app-fg font-semibold';
          }

          return (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center min-w-0">
                <div className="relative">
                  <div className={`w-3 h-3 rounded-full ${dotClass} transition-colors`} />
                  {(isPast || isCurrent) && !isFuture && (
                    <div className={`absolute inset-0 w-3 h-3 rounded-full ${dotClass} opacity-30 animate-ping`} style={{ animationDuration: '3s', animationIterationCount: isCurrent ? 'infinite' : '0' }} />
                  )}
                </div>
                <span className={`text-[10px] mt-1 text-center leading-tight whitespace-nowrap ${textClass}`}>
                  {label}
                </span>
                {ts && (isPast || isCurrent) && (
                  <span className="text-[9px] text-app-fg-muted tabular-nums">
                    {formatDateShort(ts)}
                  </span>
                )}
              </div>
              {i < TPL_PIPELINE.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 rounded-full ${isPast ? lineClass : 'bg-app-hover'} transition-colors`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Terminal status indicator */}
      {isTerminal && (
        <div className="mt-2 flex items-center gap-2">
          <OrderStatusBadge status={status} />
          <span className="text-xs text-app-fg-muted">
            Order diverted from standard pipeline
          </span>
        </div>
      )}

      {/* Mobile pipeline */}
      <div className="sm:hidden">
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {TPL_PIPELINE.map((step, i) => {
            const isPast = i < currentIdx;
            const isCurrent = i === currentIdx;
            let bg = 'bg-app-hover';
            if (isPast) bg = 'bg-emerald-500';
            else if (isCurrent) bg = STATUS_DOT_CLASS[status] ?? 'bg-brand-500';
            const label = STATUS_LABELS[step] ?? step;
            return (
              <div key={step} className="flex items-center gap-1 flex-shrink-0">
                <div className={`w-2 h-2 rounded-full ${bg}`} title={label} />
                {i < TPL_PIPELINE.length - 1 && (
                  <div className={`w-3 h-px ${isPast ? 'bg-emerald-400' : 'bg-app-border'}`} />
                )}
              </div>
            );
          })}
          <span className="ml-2 text-xs font-medium text-app-fg-muted">
            {STATUS_LABELS[status] ?? status}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Info Row Helper ─────────────────────────────────────────────

function InfoRow({ icon, label, value, valueClass, mono }: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  mono?: boolean;
}) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {icon && <span className="text-app-fg-muted mt-0.5 flex-shrink-0">{icon}</span>}
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-app-fg-muted font-medium">{label}</p>
        <p className={`text-sm ${mono ? 'font-mono' : ''} ${valueClass ?? 'text-app-fg'}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

// ── History Timeline ────────────────────────────────────────────

function HistoryTimeline({ history }: { history: HistoryEntry[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (history.length === 0) {
    return (
      <p className="text-sm text-app-fg-muted text-center py-6">
        No audit history available.
      </p>
    );
  }

  const chronological = [...history].reverse();

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-3 top-2 bottom-2 w-px bg-app-hover" />

      <div className="space-y-0">
        {history.map((entry, idx) => {
          const chronIdx = chronological.findIndex((e) => e.validFrom === entry.validFrom);
          const prevEntry = chronIdx > 0 ? chronological[chronIdx - 1] : null;
          const diffs = prevEntry ? computeDiff(prevEntry.data, entry.data) : [];
          const isExpanded = expandedIdx === idx;
          const isFirst = chronIdx === 0;

          // Detect status changes
          const statusChange = diffs.find((d) => d.field === 'status');

          return (
            <div key={entry.id} className="relative pl-8 py-2">
              {/* Dot on timeline */}
              <div className={`absolute left-[7px] top-3.5 w-[10px] h-[10px] rounded-full border-2 border-app-elevated ${
                statusChange
                  ? (STATUS_DOT_CLASS[String(statusChange.newValue)] ?? 'bg-brand-500')
                  : isFirst
                    ? 'bg-emerald-500'
                    : 'bg-app-border'
              }`} />

              <button
                type="button"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                className="w-full text-left hover:bg-app-hover/50 rounded-lg px-2 py-1 -mx-2 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-app-fg-muted">
                      {entry.action}
                    </span>
                    {statusChange && (
                      <span className="ml-2">
                        <OrderStatusBadge status={String(statusChange.newValue)} className="text-[10px]" />
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-app-fg-muted tabular-nums flex-shrink-0">
                    {timeAgo(entry.validFrom)}
                  </span>
                </div>
                {entry.changedBy && (
                  <p className="text-[11px] text-app-fg-muted mt-0.5">
                    by {entry.changedBy}
                  </p>
                )}
              </button>

              {/* Expanded diff view */}
              {isExpanded && diffs.length > 0 && (
                <div className="mt-1.5 ml-2 bg-app-hover rounded-lg p-2.5 text-xs space-y-1">
                  {diffs.map((d) => (
                    <div key={d.field} className="flex items-start gap-2">
                      <span className="font-mono text-app-fg-muted min-w-[100px] flex-shrink-0">
                        {d.field.replace(/_/g, ' ')}
                      </span>
                      <span className="text-red-500 dark:text-red-400 line-through">{formatValue(d.oldValue)}</span>
                      <span className="text-app-fg-muted">&rarr;</span>
                      <span className="text-emerald-600 dark:text-emerald-400">{formatValue(d.newValue)}</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-app-fg-muted pt-1 border-t border-app-border tabular-nums">
                    {formatDate(entry.validFrom)}
                  </p>
                </div>
              )}
              {isExpanded && diffs.length === 0 && isFirst && (
                <div className="mt-1.5 ml-2 bg-app-hover rounded-lg p-2.5 text-xs text-app-fg-muted">
                  Initial record creation &mdash; {formatDate(entry.validFrom)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── Main Component ──────────────────────────────────────────────

export function LogisticsOrderDetailPage({
  order,
  history,
  locations,
  riders,
  backLink = DEFAULT_BACK_LINK,
  backLabel = 'Logistics Orders',
  allocatableLocations: allocatableLocationsProp,
}: LogisticsOrderDetailPageProps) {
  const fetcher = useFetcher();
  const { toast } = useToast();
  useFetcherToast(fetcher.data, { successMessage: 'Order updated' });

  const handleCopyOrderSummary = useCallback(async () => {
    const text = buildOrderSummaryClipboardText(order);
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        toast.error('Copy failed', 'Clipboard is not available in this browser.');
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success('Copied', 'Order summary ready to paste into WhatsApp or your 3PL group.');
    } catch {
      toast.error('Copy failed', 'Could not write to the clipboard.');
    }
  }, [order, toast]);

  const [activeTab, setActiveTab] = useState('overview');
  const [deliveryProofUrl, setDeliveryProofUrl] = useState('');
  const [deliveryCost, setDeliveryCost] = useState('');
  const [deliveryDiscount, setDeliveryDiscount] = useState('');
  const [partialDeliveryProofUrl, setPartialDeliveryProofUrl] = useState('');
  const [partialDeliveryCost, setPartialDeliveryCost] = useState('');
  const [partialDeliveryDiscount, setPartialDeliveryDiscount] = useState('');

  useEffect(() => {
    setDeliveryProofUrl('');
    setDeliveryCost('');
    setDeliveryDiscount('');
    setPartialDeliveryProofUrl('');
    setPartialDeliveryCost('');
    setPartialDeliveryDiscount('');
  }, [order.id]);

  useEffect(() => {
    if (fetcher.data && (fetcher.data as { success?: boolean }).success) {
      setDeliveryProofUrl('');
      setDeliveryCost('');
      setDeliveryDiscount('');
      setPartialDeliveryProofUrl('');
      setPartialDeliveryCost('');
      setPartialDeliveryDiscount('');
    }
  }, [fetcher.data]);

  const allowed = order.allowedTransitions ?? [];
  const ridersForOrder =
    order.logisticsLocationId && order.status === 'ALLOCATED'
      ? riders.filter((r) => r.logisticsLocationId === order.logisticsLocationId)
      : riders;
  const allocatableLocations = allocatableLocationsProp ?? locations.filter((l) => l.status === 'ACTIVE');
  const isSubmitting = fetcher.state === 'submitting';

  // Compute total qty
  const totalQty = order.orderItems?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  // Delivery urgency: days since creation or since preferred date
  const daysSinceCreated = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 86400000);
  const isOverdue = order.preferredDeliveryDate && new Date(order.preferredDeliveryDate + 'T23:59:59') < new Date() &&
    !['DELIVERED', 'COMPLETED', 'RETURNED', 'RESTOCKED', 'WRITTEN_OFF', 'CANCELLED'].includes(order.status);

  // Has any active action?
  const hasAction = ['CONFIRMED', 'ALLOCATED', 'DISPATCHED', 'IN_TRANSIT', 'RETURNED'].includes(order.status);

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'items', label: `Items (${order.orderItems?.length ?? 0})` },
    ...(hasAction ? [{ value: 'actions', label: 'Actions' }] : []),
    { value: 'history', label: 'History' },
  ];

  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      <PageHeader
        title={order.customerName}
        description={
          <span className="inline-flex items-center gap-1.5">
            <OrderIdBadge id={order.id} textClassName="text-app-fg-muted" />
            <span>· Created {formatDate(order.createdAt)}</span>
          </span>
        }
        breadcrumb={
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to={backLink} className="text-app-fg-muted hover:text-brand-500">
              {backLabel}
            </Link>
            <svg className="w-4 h-4 text-app-border flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            <OrderIdBadge id={order.id} textClassName="text-app-fg font-medium truncate min-w-0" />
          </div>
        }
        actions={
          <>
            <PageRefreshButton />
            <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopyOrderSummary()}>
              Copy for WhatsApp
            </Button>
            {isOverdue && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                <ClockIcon /> OVERDUE
              </span>
            )}
            <OrderStatusBadge status={order.status} />
          </>
        }
      />

      {/* Status Pipeline */}
      <div className="card p-4">
        <StatusPipeline status={order.status} order={order} />
      </div>

      <OverviewStatStrip
        items={[
          {
            label: 'Amount',
            value: <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} zeroAsDash />,
            valueClassName: 'text-app-fg tabular-nums',
          },
          {
            label: 'Items',
            value: (
              <>
                {totalQty} <span className="text-sm font-normal text-app-fg-muted">units</span>
              </>
            ),
            valueClassName: 'text-app-fg tabular-nums',
          },
          {
            label: 'Delivery Fee',
            value: <NairaPrice amount={order.deliveryFee ? Number(order.deliveryFee) : null} zeroAsDash />,
            valueClassName: 'text-app-fg tabular-nums',
          },
          {
            label: 'Remittance',
            plainValue: true,
            value: order.remittanceStatus ? (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  order.remittanceStatus === 'RECEIVED'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : order.remittanceStatus === 'DISPUTED'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    order.remittanceStatus === 'RECEIVED'
                      ? 'bg-emerald-500'
                      : order.remittanceStatus === 'DISPUTED'
                        ? 'bg-red-500'
                        : 'bg-amber-500'
                  }`}
                />
                {order.remittanceStatus === 'SENT' ? 'Pending' : order.remittanceStatus === 'RECEIVED' ? 'Received' : order.remittanceStatus}
              </span>
            ) : (
              <span className="text-sm text-app-fg-muted">Not remitted</span>
            ),
          },
        ]}
      />

      {/* Tabs — underline variant to match OrderDetailPage */}
      <Tabs value={activeTab} onChange={setActiveTab} tabs={tabs} />

      {/* ── TAB: Overview ───────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Customer Card */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                <UserIcon />
              </div>
              <h2 className="text-lg font-semibold text-app-fg">Customer</h2>
            </div>
            <div className="space-y-0.5">
              <InfoRow icon={<UserIcon />} label="Name" value={order.customerName} />
              <InfoRow icon={<PhoneIcon />} label="Phone" value={order.customerPhoneDisplay} mono />
              {order.customerEmail && (
                <InfoRow label="Email" value={order.customerEmail} icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                  </svg>
                } />
              )}
              <InfoRow icon={<MapPinIcon />} label="Address" value={order.customerAddress} />
              {order.deliveryAddress && order.deliveryAddress !== order.customerAddress && (
                <InfoRow icon={<TruckIcon />} label="Delivery Address" value={order.deliveryAddress} />
              )}
              {order.deliveryNotes && (
                <InfoRow icon={<CubeIcon />} label="Delivery Notes" value={order.deliveryNotes} valueClass="text-amber-600 dark:text-amber-400 italic" />
              )}
              {order.deliveryState && (
                <InfoRow icon={<MapPinIcon />} label="State" value={order.deliveryState} />
              )}
            </div>
          </div>

          {/* Logistics Card */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <TruckIcon />
              </div>
              <h2 className="text-lg font-semibold text-app-fg">Logistics</h2>
            </div>
            <div className="space-y-0.5">
              {order.logisticsLocationName && (
                <InfoRow icon={<MapPinIcon />} label="Hub / Location" value={order.logisticsLocationName} valueClass="font-medium text-violet-600 dark:text-violet-400" />
              )}
              {order.logisticsProviderName && (
                <InfoRow icon={<CubeIcon />} label="Logistics company" value={order.logisticsProviderName} />
              )}
              {order.riderName && (
                <InfoRow icon={<UserIcon />} label="Rider" value={order.riderName} valueClass="font-medium text-brand-600 dark:text-brand-400" />
              )}
              {order.preferredDeliveryDate && (
                <InfoRow
                  icon={<CalendarIcon />}
                  label="Preferred Delivery"
                  value={
                    <span className={isOverdue ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
                      {formatDeliveryDate(order.preferredDeliveryDate)}
                      {isOverdue && ' (OVERDUE)'}
                    </span>
                  }
                />
              )}
              {order.deliveryOtp && (
                <InfoRow
                  icon={<CheckCircleIcon />}
                  label="Delivery OTP"
                  value={order.deliveryOtp}
                  mono
                  valueClass="font-bold text-lg text-app-fg tracking-widest"
                />
              )}
              {order.deliveryGpsLat && order.deliveryGpsLng && (
                <InfoRow
                  icon={<MapPinIcon />}
                  label="GPS Coordinates"
                  value={`${order.deliveryGpsLat}, ${order.deliveryGpsLng}`}
                  mono
                  valueClass="text-xs text-app-fg-muted"
                />
              )}
            </div>

            {/* Timestamps grid */}
            <div className="mt-3 pt-3 border-t border-app-border">
              <div className="grid grid-cols-2 gap-2">
                {order.allocatedAt && (
                  <div className="text-center py-1.5 bg-app-hover rounded-lg">
                    <p className="text-[10px] uppercase tracking-wider text-app-fg-muted">Allocated</p>
                    <p className="text-xs font-medium text-app-fg-muted tabular-nums">{formatDateShort(order.allocatedAt)}</p>
                  </div>
                )}
                {order.dispatchedAt && (
                  <div className="text-center py-1.5 bg-app-hover rounded-lg">
                    <p className="text-[10px] uppercase tracking-wider text-app-fg-muted">Dispatched</p>
                    <p className="text-xs font-medium text-app-fg-muted tabular-nums">{formatDateShort(order.dispatchedAt)}</p>
                  </div>
                )}
                {order.deliveredAt && (
                  <div className="text-center py-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                    <p className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Delivered</p>
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300 tabular-nums">{formatDateShort(order.deliveredAt)}</p>
                  </div>
                )}
                {order.confirmedAt && (
                  <div className="text-center py-1.5 bg-app-hover rounded-lg">
                    <p className="text-[10px] uppercase tracking-wider text-app-fg-muted">Confirmed</p>
                    <p className="text-xs font-medium text-app-fg-muted tabular-nums">{formatDateShort(order.confirmedAt)}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Assignment / Origin Card */}
          <div className="card p-4 lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <BanknotesIcon />
              </div>
              <h2 className="text-lg font-semibold text-app-fg">Order Origin</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6">
              {order.assignedCsName && (
                <InfoRow icon={<UserIcon />} label="CS Agent" value={order.assignedCsName} valueClass="font-medium text-sky-600 dark:text-sky-400" />
              )}
              {order.mediaBuyerName && (
                <InfoRow icon={<UserIcon />} label="Media Buyer" value={order.mediaBuyerName} valueClass="font-medium text-purple-600 dark:text-purple-400" />
              )}
              {order.campaignName && (
                <InfoRow icon={<CubeIcon />} label="Campaign" value={order.campaignName} />
              )}
              {order.paymentMethod && (
                <InfoRow icon={<BanknotesIcon />} label="Payment" value={
                  order.paymentMethod === 'PAY_ONLINE'
                    ? `Online${order.paymentStatus ? ` — ${order.paymentStatus}` : ''}`
                    : 'Pay on Delivery'
                } valueClass={
                  order.paymentMethod === 'PAY_ON_DELIVERY'
                    ? 'font-medium text-emerald-600 dark:text-emerald-400'
                    : order.paymentStatus === 'PAID'
                      ? 'font-medium text-emerald-600 dark:text-emerald-400'
                      : 'font-medium text-amber-600 dark:text-amber-400'
                } />
              )}
              <InfoRow
                icon={<ClockIcon />}
                label="Order ID"
                value={order.id}
                mono
                valueClass="text-xs text-app-fg-muted break-all"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Items ──────────────────────────────────────────── */}
      {activeTab === 'items' && (
        <div className="card overflow-hidden">
          {order.orderItems && order.orderItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-app-border">
                    <th className="text-left text-[11px] uppercase tracking-wider text-app-fg-muted font-medium px-4 py-2.5">Product</th>
                    <th className="text-center text-[11px] uppercase tracking-wider text-app-fg-muted font-medium px-4 py-2.5">Qty</th>
                    <th className="text-right text-[11px] uppercase tracking-wider text-app-fg-muted font-medium px-4 py-2.5">Unit Price</th>
                    <th className="text-right text-[11px] uppercase tracking-wider text-app-fg-muted font-medium px-4 py-2.5">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {order.orderItems.map((item, idx) => {
                    const subtotal = Number(item.unitPrice) * item.quantity;
                    return (
                      <tr key={item.id} className={idx % 2 === 0 ? 'bg-app-hover/50' : ''}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0">
                              <CubeIcon />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-app-fg">
                                {item.productName ?? `Product ${item.productId.slice(0, 8)}`}
                              </p>
                              <p className="text-[10px] text-app-fg-muted font-mono">{item.productId.slice(0, 12)}...</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-app-hover text-sm font-semibold text-app-fg">
                            {item.quantity}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm tabular-nums text-app-fg-muted">
                          <NairaPrice amount={Number(item.unitPrice)} />
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-app-fg">
                          <NairaPrice amount={subtotal} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-app-border">
                    <td className="px-4 py-3 text-sm font-bold text-app-fg" colSpan={2}>Total</td>
                    <td className="px-4 py-3 text-right text-xs text-app-fg-muted tabular-nums">
                      {totalQty} unit{totalQty !== 1 ? 's' : ''}
                    </td>
                    <td className="px-4 py-3 text-right text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} zeroAsDash />
                    </td>
                  </tr>
                  {order.deliveryFee && Number(order.deliveryFee) > 0 && (
                    <tr className="border-t border-app-border">
                      <td className="px-4 py-2 text-xs text-app-fg-muted" colSpan={3}>Delivery Fee</td>
                      <td className="px-4 py-2 text-right text-sm text-app-fg-muted tabular-nums">
                        <NairaPrice amount={Number(order.deliveryFee)} />
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyState title="No items" description="No items in this order." variant="inline" />
          )}
        </div>
      )}

      {/* ── TAB: Actions ────────────────────────────────────────── */}
      {activeTab === 'actions' && (
        <div className="space-y-4">
          {/* Allocate */}
          {order.status === 'CONFIRMED' && allowed.includes('ALLOCATED') && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                  <MapPinIcon />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-app-fg">Allocate to Location</h3>
                  <p className="text-[11px] text-app-fg-muted">Assign this order to a 3PL hub for dispatch</p>
                </div>
              </div>
              <fetcher.Form method="post" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="intent" value="allocate" />
                <div className="flex-1 min-w-[200px]">
                  <FormSelect
                    label="Location"
                    name="logisticsLocationId"
                    required
                    disabled={isSubmitting}
                    placeholder="Select location..."
                    options={allocatableLocations.map((loc) => ({ value: loc.id, label: loc.name }))}
                  />
                </div>
                <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                  Allocate Order
                </Button>
              </fetcher.Form>
            </div>
          )}

          {/* Dispatch */}
          {order.status === 'ALLOCATED' && allowed.includes('DISPATCHED') && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400">
                  <TruckIcon />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-app-fg">Dispatch to Rider</h3>
                  <p className="text-[11px] text-app-fg-muted">Assign a rider for pickup and delivery</p>
                </div>
              </div>
              <fetcher.Form method="post" className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="intent" value="dispatch" />
                <div className="flex-1 min-w-[200px]">
                  <FormSelect
                    label="Rider"
                    name="riderId"
                    required
                    disabled={isSubmitting}
                    placeholder={ridersForOrder.length === 0 ? 'No riders at this location' : 'Select rider...'}
                    options={ridersForOrder.map((r) => ({ value: r.id, label: r.name }))}
                  />
                </div>
                <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={isSubmitting || ridersForOrder.length === 0}>
                  Dispatch
                </Button>
              </fetcher.Form>
            </div>
          )}

          {/* Mark In Transit */}
          {order.status === 'DISPATCHED' && allowed.includes('IN_TRANSIT') && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <TruckIcon />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-app-fg">Mark In Transit</h3>
                  <p className="text-[11px] text-app-fg-muted">Confirm rider has departed with order</p>
                </div>
              </div>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="transition" />
                <input type="hidden" name="newStatus" value="IN_TRANSIT" />
                <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                  Confirm Departure
                </Button>
              </fetcher.Form>
            </div>
          )}

          {/* Delivery Actions */}
          {order.status === 'IN_TRANSIT' && (
            <div className="space-y-4">
              {/* Mark Delivered */}
              {allowed.includes('DELIVERED') && (
                <div className="card p-4 border-l-4 border-l-emerald-500">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                      <CheckCircleIcon />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-app-fg">Mark Delivered</h3>
                      <p className="text-[11px] text-app-fg-muted">Full delivery confirmed by rider</p>
                    </div>
                  </div>
                  <fetcher.Form method="post" className="space-y-3">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="DELIVERED" />
                    {deliveryProofUrl && <input type="hidden" name="deliveryProofUrl" value={deliveryProofUrl} />}

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <TextInput
                        label="Additional Delivery Cost"
                        type="number"
                        name="deliveryFeeAddOn"
                        min={0}
                        step="0.01"
                        value={deliveryCost}
                        onChange={(e) => setDeliveryCost(e.target.value)}
                        placeholder="0"
                        disabled={isSubmitting}
                        leftAddon="₦"
                      />
                      <TextInput
                        label="Discount at Delivery"
                        type="number"
                        name="deliveryDiscountAmount"
                        min={0}
                        step="0.01"
                        value={deliveryDiscount}
                        onChange={(e) => setDeliveryDiscount(e.target.value)}
                        placeholder="0"
                        disabled={isSubmitting}
                        leftAddon="₦"
                      />
                      <div>
                        <label className="block text-xs font-medium text-app-fg-muted mb-1">Proof Screenshot</label>
                        <FileUpload folder={S3_FOLDERS.DELIVERY_PROOF} onUpload={setDeliveryProofUrl} accept="image/*" label={deliveryProofUrl ? 'Uploaded' : 'Upload proof'} />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button type="submit" variant="primary" loading={isSubmitting} disabled={isSubmitting}>
                        Confirm Full Delivery
                      </Button>
                    </div>
                  </fetcher.Form>
                </div>
              )}

              {/* Partial Delivery */}
              {allowed.includes('PARTIALLY_DELIVERED') && (
                <div className="card p-4 border-l-4 border-l-amber-500">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600 dark:text-amber-400">
                      <CubeIcon />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-app-fg">Partial Delivery</h3>
                      <p className="text-[11px] text-app-fg-muted">Only some items delivered, rest returned</p>
                    </div>
                  </div>
                  <fetcher.Form method="post" className="space-y-3">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="PARTIALLY_DELIVERED" />
                    {partialDeliveryProofUrl && <input type="hidden" name="deliveryProofUrl" value={partialDeliveryProofUrl} />}

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <TextInput
                        label="Delivered Qty"
                        type="number"
                        name="deliveredQuantity"
                        min={0}
                        required
                        disabled={isSubmitting}
                      />
                      <TextInput
                        label="Returned Qty"
                        type="number"
                        name="returnedQuantity"
                        min={0}
                        required
                        disabled={isSubmitting}
                      />
                      <TextInput
                        label="Extra Cost"
                        type="number"
                        name="deliveryFeeAddOn"
                        min={0}
                        step="0.01"
                        value={partialDeliveryCost}
                        onChange={(e) => setPartialDeliveryCost(e.target.value)}
                        placeholder="0"
                        disabled={isSubmitting}
                        leftAddon="₦"
                      />
                      <TextInput
                        label="Discount"
                        type="number"
                        name="deliveryDiscountAmount"
                        min={0}
                        step="0.01"
                        value={partialDeliveryDiscount}
                        onChange={(e) => setPartialDeliveryDiscount(e.target.value)}
                        placeholder="0"
                        disabled={isSubmitting}
                        leftAddon="₦"
                      />
                      <div>
                        <label className="block text-xs font-medium text-app-fg-muted mb-1">Proof</label>
                        <FileUpload folder={S3_FOLDERS.DELIVERY_PROOF} onUpload={setPartialDeliveryProofUrl} accept="image/*" label={partialDeliveryProofUrl ? 'Uploaded' : 'Upload'} />
                      </div>
                    </div>

                    <TextInput
                      label="Reason for Partial Delivery"
                      type="text"
                      name="reason"
                      placeholder="Describe why only partial items were delivered..."
                      disabled={isSubmitting}
                    />

                    <div className="flex justify-end">
                      <Button type="submit" variant="secondary" loading={isSubmitting} disabled={isSubmitting}>
                        Submit Partial Delivery
                      </Button>
                    </div>
                  </fetcher.Form>
                </div>
              )}

              {/* Mark Returned */}
              {allowed.includes('RETURNED') && (
                <div className="card p-4 border-l-4 border-l-red-500">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-app-fg">Mark Returned</h3>
                      <p className="text-[11px] text-app-fg-muted">Customer rejected delivery</p>
                    </div>
                  </div>
                  <fetcher.Form method="post" className="space-y-3">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="RETURNED" />
                    <TextInput
                      label="Return Reason (required)"
                      type="text"
                      name="reason"
                      required
                      minLength={10}
                      placeholder="Describe return reason — minimum 10 characters"
                      disabled={isSubmitting}
                    />
                    <div className="flex justify-end">
                      <Button type="submit" variant="secondary" loading={isSubmitting} disabled={isSubmitting}>
                        Confirm Return
                      </Button>
                    </div>
                  </fetcher.Form>
                </div>
              )}
            </div>
          )}

          {/* Post-return actions */}
          {order.status === 'RETURNED' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {allowed.includes('RESTOCKED') && (
                <div className="card p-4 border-l-4 border-l-teal-500">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-teal-600 dark:text-teal-400">
                      <CubeIcon />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-app-fg">Restock</h3>
                      <p className="text-[11px] text-app-fg-muted">Item sellable — return to local stock</p>
                    </div>
                  </div>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="RESTOCKED" />
                    <Button type="submit" variant="primary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                      Restock Item
                    </Button>
                  </fetcher.Form>
                </div>
              )}
              {allowed.includes('WRITTEN_OFF') && (
                <div className="card p-4 border-l-4 border-l-zinc-500">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-7 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-app-fg">Write Off</h3>
                      <p className="text-[11px] text-app-fg-muted">Item damaged — log as operational loss</p>
                    </div>
                  </div>
                  <fetcher.Form method="post" className="space-y-3">
                    <input type="hidden" name="intent" value="transition" />
                    <input type="hidden" name="newStatus" value="WRITTEN_OFF" />
                    <TextInput
                      type="text"
                      name="reason"
                      required
                      minLength={10}
                      placeholder="Damage description (min 10 chars)"
                      disabled={isSubmitting}
                    />
                    <Button type="submit" variant="secondary" size="sm" loading={isSubmitting} disabled={isSubmitting}>
                      Write Off
                    </Button>
                  </fetcher.Form>
                </div>
              )}
            </div>
          )}

          {/* No actions available */}
          {!hasAction && (
            <div className="card p-6">
              <EmptyState
                icon={<CheckCircleIcon className="w-6 h-6" />}
                title="No actions available"
                description="No actions available for this order status."
                variant="inline"
              />
            </div>
          )}
        </div>
      )}

      {/* ── TAB: History ────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="card p-4">
          <h2 className="text-lg font-semibold text-app-fg mb-4">Audit Trail</h2>
          <DeferredSection resolve={history} skeleton="list">
            {(rows) => <HistoryTimeline history={rows} />}
          </DeferredSection>
        </div>
      )}
    </div>
  );
}
