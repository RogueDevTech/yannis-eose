import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { EmptyState } from '~/components/ui/empty-state';
import { useToast } from '~/components/ui/toast';
import {
  type AttendanceSummaryData,
  type CellStatus,
  STATUS_LETTER,
  STATUS_LABEL,
  STATUS_THEME,
  MARK_CYCLE,
  WEEKDAY_HEADERS,
  workDayLayout,
} from './attendance-types';

interface Props {
  staffId: string;
  open: boolean;
  onClose: () => void;
  /** Current month, YYYY-MM. */
  month: string;
  /** HR may mark; a staff member viewing their own record cannot. */
  canManage: boolean;
}

function parseMonth(month: string): { y: number; m: number } {
  const parts = month.split('-');
  return { y: Number(parts[0]), m: Number(parts[1]) };
}

/** Monday-index (0=Mon..6=Sun) of the 1st: leading blank cells before day 1. */
function leadingBlanks(month: string): number {
  const { y, m } = parseMonth(month);
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

function monthLabel(month: string): string {
  const { y, m } = parseMonth(month);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Attendance calendar shown in a modal from the user profile (replaces the
 * standalone detail page). Fetches `attendance.summary` client-side and marks a
 * day via a direct `attendance.mark` tRPC POST, refetching on success. HR may
 * mark; a staff self-view is read-only.
 */
export function UserAttendanceModal({ staffId, open, onClose, month: initialMonth, canManage }: Props) {
  const { toast } = useToast();
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<AttendanceSummaryData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState<{ date: string; current: CellStatus; remark: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset to the current month each time the modal is opened afresh.
  useEffect(() => {
    if (open) setMonth(initialMonth);
  }, [open, initialMonth]);

  const blanks = useMemo(() => leadingBlanks(month), [month]);

  // Work-day layout: only configured work days are shown as columns.
  const wd = useMemo(() => workDayLayout(data?.workDays), [data?.workDays]);
  const workCalendar = useMemo(
    () => (data?.calendar ?? []).filter((d) => wd.colOf(new Date(`${d.date}T00:00:00Z`).getUTCDay()) !== -1),
    [data?.calendar, wd],
  );
  const workBlanks = useMemo(() => {
    const first = workCalendar[0];
    if (!first) return 0;
    return wd.colOf(new Date(`${first.date}T00:00:00Z`).getUTCDay());
  }, [workCalendar, wd]);

  const load = useCallback(() => {
    let cancelled = false;
    setState('loading');
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
  }, [month, staffId]);

  // Fetch when the modal opens (and refetch if staff/month changes while open).
  useEffect(() => {
    if (!open) return;
    const cancel = load();
    return cancel;
  }, [open, load]);

  const saveMark = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const base = getBrowserApiBaseUrl();
      const body: Record<string, unknown> = {
        staffId,
        attendanceDate: editing.date,
        status: editing.current,
      };
      const remark = editing.remark.trim();
      if (remark) body.remark = remark;
      const res = await fetch(`${base}/trpc/attendance.mark`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      toast.success('Attendance updated');
      setEditing(null);
      load();
    } catch {
      toast.error('Failed to mark attendance');
    } finally {
      setSaving(false);
    }
  }, [editing, staffId, toast, load]);

  return (
    <>
      <Modal open={open} onClose={onClose} maxWidth="max-w-lg">
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-app-fg">
              {data?.staffName ? `${data.staffName}: attendance` : 'Attendance'}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-app-fg-muted hover:text-app-fg text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-elevated pl-3 pr-2 py-1">
              <span className="text-xs font-medium text-app-fg-muted shrink-0">Period</span>
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                aria-label="Attendance period"
                className="h-7 w-[9.75rem] border-0 bg-transparent p-0 text-sm font-medium text-app-fg focus:outline-none focus:ring-0 [color-scheme:light] dark:[color-scheme:dark]"
              />
            </label>
            <p className="text-xs text-app-fg-muted shrink-0">{monthLabel(month)}</p>
          </div>

          {state === 'error' ? (
            <EmptyState title="Unavailable" description="Could not load attendance for this staff member." variant="card" />
          ) : state === 'loading' || !data ? (
            <div className="h-64 animate-pulse rounded-md bg-app-muted/40" />
          ) : (
            <>
              {/* Summary counts */}
              <div className="mb-4 grid grid-cols-5 gap-2 text-center">
                <SummaryStat label="Present" value={data.summary.present} className="text-green-600 dark:text-green-400" />
                <SummaryStat label="Absent" value={data.summary.absent} className="text-red-600 dark:text-red-400" />
                <SummaryStat label="Off duty" value={data.summary.offDuty} className="text-amber-600 dark:text-amber-400" />
                <SummaryStat label="Sick" value={data.summary.sick} className="text-blue-600 dark:text-blue-400" />
                <SummaryStat label="Rate" value={`${data.summary.attendancePct}%`} className="text-app-fg" />
              </div>

              {/* Calendar */}
              <h3 className="mb-3 text-sm font-semibold text-app-fg">
                Daily record{canManage ? ': tap a day to mark' : ''}
              </h3>
              <div className="w-full">
                <div className="mb-1 grid gap-1 text-center text-[0.6rem] font-medium text-app-fg-muted sm:gap-1.5 sm:text-[0.65rem]" style={{ gridTemplateColumns: `repeat(${wd.cols}, minmax(0, 1fr))` }}>
                  {wd.labels.map((d) => (
                    // Single-letter weekday on mobile to keep the columns roomy.
                    <span key={d}><span className="sm:hidden">{d.charAt(0)}</span><span className="hidden sm:inline">{d}</span></span>
                  ))}
                </div>
                <div className="grid gap-1 sm:gap-1.5" style={{ gridTemplateColumns: `repeat(${wd.cols}, minmax(0, 1fr))` }}>
                  {Array.from({ length: workBlanks }, (_, i) => <div key={`b${i}`} className="aspect-square" />)}
                  {workCalendar.map((day) => {
                    const dnum = Number(day.date.slice(8, 10));
                    const status = day.status as CellStatus;
                    return (
                      <button
                        key={day.date}
                        type="button"
                        disabled={!canManage}
                        onClick={() => canManage && setEditing({ date: day.date, current: status, remark: day.remark ?? '' })}
                        title={`${day.date}: ${STATUS_LABEL[status]}${day.remark ? ` (${day.remark})` : ''}`}
                        className={`flex aspect-square w-full flex-col items-center justify-center rounded-md text-xs sm:text-sm ${STATUS_THEME[status].cell} ${canManage ? 'cursor-pointer hover:ring-2 hover:ring-brand-400' : 'cursor-default'}`}
                      >
                        <span className={`font-medium leading-none ${status === 'NONE' ? 'text-app-fg-muted' : ''}`}>{dnum}</span>
                        {status !== 'NONE' && <span className="text-[0.6rem] leading-none opacity-80 sm:text-[0.65rem]">{STATUS_LETTER[status]}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Legend */}
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-app-fg-muted">
                {MARK_CYCLE.map((s) => (
                  <span key={s} className="flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded ${STATUS_THEME[s].dot}`} />
                    {STATUS_LABEL[s]} ({STATUS_LETTER[s]})
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Single-day mark modal (stacked above the calendar modal) */}
      <Modal open={!!editing} onClose={() => { if (!saving) setEditing(null); }} maxWidth="max-w-sm">
        {editing && (
          <div className="space-y-5 p-5 sm:p-6">
            <div>
              <h2 className="text-base font-semibold text-app-fg">{data?.staffName ?? 'Staff'}</h2>
              <p className="text-sm text-app-fg-muted">{editing.date}</p>
            </div>
            <fieldset>
              <legend className="mb-1.5 block text-sm font-medium text-app-fg">Status</legend>
              <div className="grid grid-cols-2 gap-2">
                {MARK_CYCLE.map((s) => {
                  const active = editing.current === s;
                  return (
                    <label
                      key={s}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                        active ? `${STATUS_THEME[s].cell} border-transparent ring-2 ring-brand-400` : 'border-app-border text-app-fg hover:bg-app-muted'
                      }`}
                    >
                      <input
                        type="radio"
                        name="status"
                        value={s}
                        checked={active}
                        onChange={() => setEditing((prev) => (prev ? { ...prev, current: s } : prev))}
                        className="sr-only"
                      />
                      <span className={`h-3.5 w-3.5 rounded-full ${STATUS_THEME[s].dot}`} />
                      <span className="font-medium">{STATUS_LABEL[s]}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div>
              <label className="mb-1 block text-sm font-medium text-app-fg" htmlFor="attendance-remark">Remark (optional)</label>
              <input
                id="attendance-remark"
                type="text"
                maxLength={500}
                value={editing.remark}
                onChange={(e) => setEditing((prev) => (prev ? { ...prev, remark: e.target.value } : prev))}
                placeholder="e.g. approved leave"
                className="w-full rounded-md border border-app-border px-3 py-2 text-sm dark:bg-gray-900"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
              <Button variant="primary" size="sm" type="button" onClick={saveMark} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function SummaryStat({ label, value, className }: { label: string; value: number | string; className: string }) {
  return (
    <div>
      <div className={`text-lg font-semibold tabular-nums ${className}`}>{value}</div>
      <div className="text-[0.6rem] uppercase tracking-wide text-app-fg-muted">{label}</div>
    </div>
  );
}
