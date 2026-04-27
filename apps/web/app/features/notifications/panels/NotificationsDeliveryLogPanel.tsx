import { useFetcher } from '@remix-run/react';
import { useState, useCallback } from 'react';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';

export interface DeliveryLogEntry {
  id: string;
  userId: string;
  userName: string;
  title: string;
  triggerType: 'MIRROR' | 'BROADCAST' | 'AUTOMATION';
  sentAt: string;
  status: 'SENT' | 'FAILED' | 'SHOWN' | 'CLICKED';
  shownAt?: string | null;
  clickedAt?: string | null;
}

export interface DeliveryLogPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isResendVisible(entry: DeliveryLogEntry): boolean {
  if (entry.status === 'FAILED') return true;
  if (entry.status === 'SENT') {
    const ageMs = Date.now() - new Date(entry.sentAt).getTime();
    return ageMs > 30 * 60 * 1000;
  }
  return false;
}

function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function StatusBadge({ status }: { status: DeliveryLogEntry['status'] }) {
  const map: Record<DeliveryLogEntry['status'], { label: string; cls: string }> = {
    SENT: { label: 'Sent', cls: 'bg-app-hover text-app-fg-muted' },
    FAILED: { label: 'Failed', cls: 'bg-danger-500/15 text-danger-700 dark:text-danger-400' },
    SHOWN: { label: 'Shown', cls: 'bg-info-500/15 text-info-700 dark:text-info-400' },
    CLICKED: { label: 'Clicked', cls: 'bg-success-500/15 text-success-700 dark:text-success-400' },
  };
  const { label, cls } = map[status] ?? map.SENT;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

function TriggerBadge({ type }: { type: DeliveryLogEntry['triggerType'] }) {
  const map: Record<DeliveryLogEntry['triggerType'], { label: string; cls: string }> = {
    MIRROR: { label: 'Mirror', cls: 'bg-info-500/15 text-info-700 dark:text-info-400' },
    BROADCAST: { label: 'Broadcast', cls: 'bg-brand-500/15 text-brand-700 dark:text-brand-400' },
    AUTOMATION: { label: 'Automation', cls: 'bg-warning-500/15 text-warning-800 dark:text-warning-400' },
  };
  const { label, cls } = map[type] ?? map.BROADCAST;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

const STATUS_PILLS = ['', 'SENT', 'FAILED', 'SHOWN', 'CLICKED'] as const;
const STATUS_LABELS: Record<string, string> = {
  '': 'All',
  SENT: 'Sent',
  FAILED: 'Failed',
  SHOWN: 'Shown',
  CLICKED: 'Clicked',
};

const TRIGGER_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'MIRROR', label: 'Mirror' },
  { value: 'BROADCAST', label: 'Broadcast' },
  { value: 'AUTOMATION', label: 'Automation' },
];

type SearchParamsSetter = (
  nextInit: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
  opts?: { replace?: boolean; preventScrollReset?: boolean },
) => void;

export interface NotificationsDeliveryLogPanelProps {
  logs: DeliveryLogEntry[];
  pagination: DeliveryLogPagination;
  searchParams: URLSearchParams;
  setSearchParams: SearchParamsSetter;
}

export function NotificationsDeliveryLogPanel({
  logs,
  pagination,
  searchParams,
  setSearchParams,
}: NotificationsDeliveryLogPanelProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const currentStatus = searchParams.get('logStatus') ?? '';
  const currentTrigger = searchParams.get('logTrigger') ?? '';
  const currentFrom = searchParams.get('logFrom') ?? '';
  const currentTo = searchParams.get('logTo') ?? '';
  const currentPage = Math.max(1, parseInt(searchParams.get('logPage') ?? '1', 10));

  const updateParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('logPage');
      setSearchParams(next, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );

  function goToPage(p: number) {
    const next = new URLSearchParams(searchParams);
    next.set('logPage', String(p));
    setSearchParams(next, { preventScrollReset: true });
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === logs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(logs.map((l) => l.id)));
    }
  }

  function handleResend(logId: string) {
    const fd = new FormData();
    fd.set('intent', 'resend');
    fd.set('logId', logId);
    fetcher.submit(fd, { method: 'post' });
  }

  function handleBulkResend() {
    const fd = new FormData();
    fd.set('intent', 'bulkResend');
    fd.set('logIds', JSON.stringify(Array.from(selected)));
    fetcher.submit(fd, { method: 'post' });
    setSelected(new Set());
  }

  const isSubmitting = fetcher.state !== 'idle';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-app-fg">Push delivery log</h2>
        <p className="mt-0.5 text-sm text-app-fg-muted">Track push notification delivery status across all recipients.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Status pills */}
        <div className="flex items-center gap-1 rounded-lg border border-app-border bg-app-elevated p-1 overflow-x-auto shrink-0" style={{ scrollbarWidth: 'none' }}>
          {STATUS_PILLS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => updateParam('logStatus', s)}
              className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                currentStatus === s
                  ? 'bg-brand-600 text-white'
                  : 'text-app-fg-muted hover:bg-app-hover'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Trigger + date row */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <FormSelect
            id="delivery-log-trigger"
            value={currentTrigger}
            onChange={(e) => updateParam('logTrigger', e.target.value)}
            options={TRIGGER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            controlSize="sm"
            wrapperClassName="min-w-0 w-[160px] sm:w-auto"
          />

          <div className="flex items-center gap-1.5 min-w-0">
            <TextInput
              type="date"
              value={currentFrom}
              onChange={(e) => updateParam('logFrom', e.target.value)}
              controlSize="sm"
              wrapperClassName="min-w-0 w-[130px]"
            />
            <span className="text-xs text-app-fg-muted shrink-0">to</span>
            <TextInput
              type="date"
              value={currentTo}
              onChange={(e) => updateParam('logTo', e.target.value)}
              controlSize="sm"
              wrapperClassName="min-w-0 w-[130px]"
            />
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-brand-500/30 bg-brand-500/10 px-4 py-2.5">
          <span className="text-sm font-medium text-brand-800 dark:text-brand-200">{selected.size} selected</span>
          <button
            type="button"
            onClick={handleBulkResend}
            disabled={isSubmitting}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Resending…' : `Resend selected (${selected.size})`}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-brand-600 hover:text-brand-800 dark:text-brand-400"
          >
            Clear
          </button>
        </div>
      )}

      {fetcher.data?.error && (
        <p className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-2 text-sm text-danger-800 dark:text-danger-200">
          {fetcher.data.error}
        </p>
      )}

      <div className="card p-0">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-app-fg-muted">
            <svg className="mb-3 h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
              />
            </svg>
            <p className="text-sm font-medium text-app-fg">No push deliveries found</p>
            <p className="mt-1 text-xs">Try adjusting your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-app-border">
              <thead>
                <tr>
                  <th className="table-header w-12 text-center">
                    <input
                      type="checkbox"
                      checked={selected.size === logs.length && logs.length > 0}
                      onChange={toggleAll}
                      className="rounded border-app-border accent-brand-600"
                    />
                  </th>
                  {['User', 'Message', 'Trigger', 'Sent', 'Status', 'Shown at', 'Clicked at', ''].map((h) => (
                    <th
                      key={h}
                      className="table-header"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {logs.map((entry) => (
                  <tr key={entry.id} className="transition-colors hover:bg-app-hover/40">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(entry.id)}
                        onChange={() => toggleRow(entry.id)}
                        className="rounded border-app-border accent-brand-600"
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-app-fg">{entry.userName}</td>
                    <td className="max-w-[200px] px-4 py-3 text-sm text-app-fg-muted">{truncate(entry.title, 40)}</td>
                    <td className="px-4 py-3">
                      <TriggerBadge type={entry.triggerType} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-app-fg-muted">{relativeTime(entry.sentAt)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-app-fg-muted">{formatTime(entry.shownAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-app-fg-muted">{formatTime(entry.clickedAt)}</td>
                    <td className="px-4 py-3">
                      {isResendVisible(entry) && (
                        <button
                          type="button"
                          onClick={() => handleResend(entry.id)}
                          disabled={isSubmitting}
                          className="text-xs font-medium text-brand-600 hover:text-brand-800 disabled:opacity-50 dark:text-brand-400"
                        >
                          Resend
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-app-fg-muted">
          <span>
            Page {pagination.page} of {pagination.totalPages} — {pagination.total} total
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium hover:bg-app-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= pagination.totalPages}
              className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium hover:bg-app-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
