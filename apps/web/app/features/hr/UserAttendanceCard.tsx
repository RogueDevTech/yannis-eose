import { useEffect, useState } from 'react';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import type { AttendanceSummaryData } from './attendance-types';
import { UserAttendanceModal } from './UserAttendanceModal';

interface Props {
  staffId: string;
  /** HR may mark; a staff member viewing their own record is read-only. */
  canManage?: boolean;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  const parts = month.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** One-line summary shown under the title, matching the sibling section cards. */
function summaryLine(month: string, data: AttendanceSummaryData | null): string {
  const label = monthLabel(month);
  if (!data) return label;
  const { present, absent } = data.summary;
  if (present === 0 && absent === 0) return `${label}, no records yet`;
  const parts: string[] = [];
  if (present > 0) parts.push(`${present} present`);
  if (absent > 0) parts.push(`${absent} absent`);
  return `${label}, ${parts.join(', ')}`;
}

/**
 * Attendance summary card for a staff member's detail page. Matches the shared
 * `SectionCard` shell (title + one-line description + arrow). Tapping opens the
 * attendance calendar in a modal instead of navigating away. Fetches the current
 * month's `attendance.summary` client-side to build the description (HR may view
 * anyone; a staff member may view their own). Renders nothing on error.
 */
export function UserAttendanceCard({ staffId, canManage = false }: Props) {
  const [data, setData] = useState<AttendanceSummaryData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modalOpen, setModalOpen] = useState(false);
  const month = currentMonth();

  useEffect(() => {
    let cancelled = false;
    const base = getBrowserApiBaseUrl();
    const input = encodeURIComponent(JSON.stringify({ month, staffId }));
    fetch(`${base}/trpc/attendance.summary?input=${input}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: { result?: { data?: AttendanceSummaryData } }) => {
        if (cancelled) return;
        setData(json?.result?.data ?? null);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [staffId, month]);

  if (state === 'error') return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="group text-left rounded-xl border border-app-border bg-app-elevated px-4 py-4 hover:border-brand-400/50 hover:bg-app-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-colors w-full"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-app-fg">Attendance</span>
            <span className="block text-xs text-app-fg-muted mt-1 leading-snug">
              {summaryLine(month, state === 'ready' ? data : null)}
            </span>
          </div>
          <span className="shrink-0 text-brand-600 dark:text-brand-400 text-sm font-medium opacity-70 group-hover:opacity-100 transition-opacity">
            →
          </span>
        </div>
      </button>

      <UserAttendanceModal
        staffId={staffId}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        month={month}
        canManage={canManage}
      />
    </>
  );
}
