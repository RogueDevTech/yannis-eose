import { useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher, useLocation, useRevalidator } from '@remix-run/react';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import { PageHeader } from '~/components/ui/page-header';
import { Modal } from '~/components/ui/modal';
import { RoleBadge } from '~/components/ui/role-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Button } from '~/components/ui/button';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
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
  summary: AttendanceSummaryData | null;
  canManage: boolean;
  month: string;
  startDate: string;
  endDate: string;
  /** True when this party is a contractor; forms echo it so mutations target contractorId. */
  isContractor?: boolean;
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

export function StaffAttendanceDetailPage({ summary, canManage, month, startDate, endDate, isContractor }: Props) {
  const markFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const location = useLocation();
  const [editing, setEditing] = useState<{ date: string; current: CellStatus; remark: string } | null>(null);
  // Optimistic overlay: date → the status/remark we just saved. Applied on top of
  // the loader's calendar so a marked cell updates INSTANTLY on success, before
  // the (slow) revalidation round-trip. Reconciled away once fresh data lands.
  const [overrides, setOverrides] = useState<Record<string, { status: CellStatus; remark: string | null }>>({});
  // Remembers what the in-flight submission is marking, so the success handler can
  // apply it optimistically (the fetcher result itself only returns {success}).
  const lastSubmit = useRef<{ date: string; status: CellStatus; remark: string | null } | null>(null);

  const refresh = () => {
    invalidateCachedLoader(location.pathname);
    revalidator.revalidate();
  };

  useFetcherToast(markFetcher.data, { successMessage: 'Attendance updated' });
  // On a successful mark, apply the optimistic override immediately, close the
  // modal, then kick off a background revalidate to reconcile.
  useCloseOnFetcherSuccess(
    markFetcher,
    () => {
      if (lastSubmit.current) {
        setOverrides((prev) => ({ ...prev, [lastSubmit.current!.date]: { status: lastSubmit.current!.status, remark: lastSubmit.current!.remark } }));
      }
      setEditing(null);
      refresh();
    },
    { intent: 'markAttendance' },
  );

  // Drop overrides that the freshly-loaded calendar already reflects (reconcile).
  useEffect(() => {
    setOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev; // nothing to reconcile
      const next: typeof prev = {};
      for (const [date, ov] of Object.entries(prev)) {
        const loaded = summary?.calendar.find((d) => d.date === date);
        if (!loaded || loaded.status !== ov.status) next[date] = ov;
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [summary]);

  const blanks = useMemo(() => leadingBlanks(month), [month]);

  // Calendar + counts with optimistic overrides merged in.
  const calendar = useMemo(() => {
    if (!summary) return [];
    return summary.calendar.map((d) => {
      const ov = overrides[d.date];
      return ov ? { ...d, status: ov.status, remark: ov.remark } : d;
    });
  }, [summary, overrides]);

  // Work-day layout: only configured work days are shown as columns.
  const wd = useMemo(() => workDayLayout(summary?.workDays), [summary?.workDays]);
  const workCalendar = useMemo(
    () => calendar.filter((d) => wd.colOf(new Date(`${d.date}T00:00:00Z`).getUTCDay()) !== -1),
    [calendar, wd],
  );
  // Leading blanks = the work-column index of the month's first shown work day.
  const workBlanks = useMemo(() => {
    const first = workCalendar[0];
    if (!first) return 0;
    return wd.colOf(new Date(`${first.date}T00:00:00Z`).getUTCDay());
  }, [workCalendar, wd]);

  const counts = useMemo(() => {
    let present = 0, absent = 0, offDuty = 0, sick = 0;
    for (const d of calendar) {
      if (d.status === 'PRESENT') present++;
      else if (d.status === 'ABSENT') absent++;
      else if (d.status === 'OFF_DUTY') offDuty++;
      else if (d.status === 'SICK') sick++;
    }
    const marked = present + absent + offDuty + sick;
    const pct = marked > 0 ? Math.round(((present + offDuty + sick) / marked) * 100) : 100;
    return { present, absent, offDuty, sick, attendancePct: pct };
  }, [calendar]);

  if (!summary) {
    return (
      <div className="space-y-4">
        <PageHeader title="Staff attendance" backTo="/hr/attendance" />
        <EmptyState title="Not found" description="No attendance data for this staff member." variant="card" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={summary.staffName ?? 'Staff attendance'}
        description={<RoleBadge role={summary.staffRole ?? ''} size="sm" />}
        backTo="/hr/attendance"
        mobileInlineActions
        actions={<DateFilterBar startDate={startDate} endDate={endDate} chrome="pill" />}
      />

      {/* Summary stat strip (optimistic counts) */}
      <OverviewStatStrip
        items={[
          { label: 'Present', value: counts.present, valueClassName: 'text-green-600 dark:text-green-400 tabular-nums' },
          { label: 'Absent', value: counts.absent, valueClassName: 'text-red-600 dark:text-red-400 tabular-nums' },
          { label: 'Off duty', value: counts.offDuty, valueClassName: 'text-amber-600 dark:text-amber-400 tabular-nums' },
          { label: 'Sick', value: counts.sick, valueClassName: 'text-blue-600 dark:text-blue-400 tabular-nums' },
          { label: 'Attendance', value: `${counts.attendancePct}%`, valueClassName: 'text-app-fg tabular-nums' },
        ]}
      />

      {/* Calendar: click any day to mark (HR) */}
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-app-fg">
          Daily record{canManage ? ': tap a day to mark' : ''}
        </h3>
        {/* Fixed cell size so the calendar stays compact. Only CONFIGURED work
            days are shown — non-work days are dropped as columns entirely. */}
        <div className="w-fit">
          <div className="mb-1 grid gap-1.5 text-center text-[0.65rem] font-medium text-app-fg-muted" style={{ gridTemplateColumns: `repeat(${wd.cols}, 2.5rem)` }}>
            {wd.labels.map((d) => <span key={d} className="w-10">{d}</span>)}
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${wd.cols}, 2.5rem)` }}>
            {Array.from({ length: workBlanks }, (_, i) => <div key={`b${i}`} className="h-10 w-10" />)}
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
                  className={`flex h-10 w-10 flex-col items-center justify-center rounded-md text-xs ${STATUS_THEME[status].cell} ${canManage ? 'cursor-pointer hover:ring-2 hover:ring-brand-400' : 'cursor-default'}`}
                >
                  {/* The NONE theme sets text-transparent (for the compact grid's
                      letter-only cells); force a visible colour so the day NUMBER
                      always shows here, marked or not. */}
                  <span className={`font-medium ${status === 'NONE' ? 'text-app-fg-muted' : ''}`}>{dnum}</span>
                  {status !== 'NONE' && <span className="text-[0.6rem] opacity-80">{STATUS_LETTER[status]}</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-app-fg-muted">
          {MARK_CYCLE.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded ${STATUS_THEME[s].dot}`} />
              {STATUS_LABEL[s]} ({STATUS_LETTER[s]})
            </span>
          ))}
        </div>
      </div>

      {/* Single day mark modal */}
      <Modal open={!!editing} onClose={() => { if (markFetcher.state !== 'idle') return; setEditing(null); }} maxWidth="max-w-sm">
        {editing && (
          <markFetcher.Form
            method="post"
            className="space-y-5 p-5 sm:p-6"
            onSubmit={() => {
              // Snapshot what we're marking so the success handler can apply it
              // optimistically (the action only returns {success}).
              lastSubmit.current = { date: editing.date, status: editing.current, remark: editing.remark.trim() || null };
            }}
          >
            <input type="hidden" name="intent" value="markAttendance" />
            {isContractor && <input type="hidden" name="contractor" value="1" />}
            <input type="hidden" name="attendanceDate" value={editing.date} />
            <div>
              <h2 className="text-base font-semibold text-app-fg">{summary.staffName}</h2>
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
                      <input type="radio" name="status" value={s} checked={active} onChange={() => setEditing((prev) => (prev ? { ...prev, current: s } : prev))} className="sr-only" />
                      <span className={`h-3.5 w-3.5 rounded-full ${STATUS_THEME[s].dot}`} />
                      <span className="font-medium">{STATUS_LABEL[s]}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div>
              <label className="mb-1 block text-sm font-medium text-app-fg" htmlFor="remark">Remark (optional)</label>
              <input id="remark" name="remark" type="text" maxLength={500} defaultValue={editing.remark} placeholder="e.g. approved leave" className="w-full rounded-md border border-app-border px-3 py-2 text-sm dark:bg-gray-900" />
            </div>
            {markFetcher.data?.error && <p className="text-sm text-red-600">{markFetcher.data.error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => setEditing(null)} disabled={markFetcher.state !== 'idle'}>Cancel</Button>
              <Button variant="primary" size="sm" type="submit" disabled={markFetcher.state !== 'idle'}>
                {markFetcher.state !== 'idle' ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </markFetcher.Form>
        )}
      </Modal>
    </div>
  );
}

