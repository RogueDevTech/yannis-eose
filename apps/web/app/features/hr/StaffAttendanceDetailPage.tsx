import { useMemo, useState } from 'react';
import { useFetcher, useLocation, useRevalidator, useSearchParams } from '@remix-run/react';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import { PageHeader } from '~/components/ui/page-header';
import { Modal } from '~/components/ui/modal';
import { StatusBadge } from '~/components/ui/status-badge';
import { RoleBadge } from '~/components/ui/role-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import {
  type AttendanceSummaryData,
  type AttendanceStatus,
  type CellStatus,
  STATUS_LETTER,
  STATUS_LABEL,
  STATUS_THEME,
  MARK_CYCLE,
  WEEKDAY_HEADERS,
} from './attendance-types';

interface Props {
  summary: AttendanceSummaryData | null;
  canManage: boolean;
  month: string;
}

function parseMonth(month: string): { y: number; m: number } {
  const parts = month.split('-');
  return { y: Number(parts[0]), m: Number(parts[1]) };
}
function monthLabel(month: string): string {
  const { y, m } = parseMonth(month);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function shiftMonth(month: string, delta: number): string {
  const { y, m } = parseMonth(month);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** Monday-index (0=Mon..6=Sun) of a day. */
function leadingBlanks(month: string): number {
  const { y, m } = parseMonth(month);
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

export function StaffAttendanceDetailPage({ summary, canManage, month }: Props) {
  const [, setSearchParams] = useSearchParams();
  const markFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const monthFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const location = useLocation();
  const [editing, setEditing] = useState<{ date: string; current: CellStatus; remark: string } | null>(null);
  const [monthOpen, setMonthOpen] = useState(false);

  const refresh = () => {
    invalidateCachedLoader(location.pathname);
    revalidator.revalidate();
  };

  useFetcherToast(markFetcher.data, { successMessage: 'Attendance updated' });
  useFetcherToast(monthFetcher.data, { successMessage: 'Month filled' });
  useCloseOnFetcherSuccess(markFetcher, () => { setEditing(null); refresh(); }, { intent: 'markAttendance' });
  useCloseOnFetcherSuccess(monthFetcher, () => { setMonthOpen(false); refresh(); }, { intent: 'markMonth' });

  function setMonth(next: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('month', next);
      return p;
    });
  }

  const blanks = useMemo(() => leadingBlanks(month), [month]);

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
        actions={
          <div className="flex items-center gap-2">
            <TableActionButton variant="neutral" onClick={() => setMonth(shiftMonth(month, -1))}>‹</TableActionButton>
            <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel(month)}</span>
            <TableActionButton variant="neutral" onClick={() => setMonth(shiftMonth(month, 1))}>›</TableActionButton>
            {canManage && <TableActionButton variant="primary" onClick={() => setMonthOpen(true)}>Mark whole month</TableActionButton>}
          </div>
        }
      />

      {/* Summary tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Present" value={summary.summary.present} />
        <Tile label="Absent" value={summary.summary.absent} tone="danger" />
        <Tile label="Off duty" value={summary.summary.offDuty} />
        <Tile label="Sick" value={summary.summary.sick} />
      </div>

      {/* Eligibility */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-app-fg">Base salary eligibility</h3>
            <p className="text-xs text-app-fg-muted">Attendance {summary.summary.attendancePct}% this month.</p>
          </div>
          {!summary.eligibility.gated ? (
            <StatusBadge status="Not affected" variant="neutral" pill label="Attendance does not affect pay" />
          ) : summary.eligibility.baseAtRisk ? (
            <StatusBadge status="At risk" variant="danger" pill label={`Base reduced ${summary.eligibility.deductionPercent}%`} />
          ) : (
            <StatusBadge status="Eligible" variant="success" pill label="Full base salary" />
          )}
        </div>
        {summary.eligibility.reason && <p className="mt-2 text-xs text-app-fg-muted">{summary.eligibility.reason}</p>}
      </div>

      {/* Calendar — click any day to mark (HR) */}
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-app-fg">
          Daily record{canManage ? ' — tap a day to mark' : ''}
        </h3>
        <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[0.65rem] font-medium text-app-fg-muted">
          {WEEKDAY_HEADERS.map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: blanks }, (_, i) => <div key={`b${i}`} />)}
          {summary.calendar.map((day) => {
            const dnum = Number(day.date.slice(8, 10));
            const status = day.status as CellStatus;
            return (
              <button
                key={day.date}
                type="button"
                disabled={!canManage}
                onClick={() => canManage && setEditing({ date: day.date, current: status, remark: day.remark ?? '' })}
                title={`${day.date}: ${STATUS_LABEL[status]}${day.remark ? ` — ${day.remark}` : ''}`}
                className={`flex aspect-square flex-col items-center justify-center rounded-md text-xs ${STATUS_THEME[status].cell} ${canManage ? 'cursor-pointer hover:ring-2 hover:ring-brand-400' : 'cursor-default'}`}
              >
                <span className="font-medium">{dnum}</span>
                <span className="text-[0.65rem] opacity-80">{STATUS_LETTER[status]}</span>
              </button>
            );
          })}
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
          <markFetcher.Form method="post" className="space-y-5 p-5 sm:p-6">
            <input type="hidden" name="intent" value="markAttendance" />
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
              <TableActionButton variant="neutral" type="button" onClick={() => setEditing(null)} disabled={markFetcher.state !== 'idle'}>Cancel</TableActionButton>
              <TableActionButton variant="primary" type="submit" disabled={markFetcher.state !== 'idle'}>
                {markFetcher.state !== 'idle' ? 'Saving…' : 'Save'}
              </TableActionButton>
            </div>
          </markFetcher.Form>
        )}
      </Modal>

      {/* Mark whole month modal */}
      <Modal open={monthOpen} onClose={() => { if (monthFetcher.state !== 'idle') return; setMonthOpen(false); }} maxWidth="max-w-sm">
        <MarkMonthForm
          fetcher={monthFetcher}
          summary={summary}
          onCancel={() => setMonthOpen(false)}
        />
      </Modal>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-app-fg-muted">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-app-fg'}`}>{value}</div>
    </div>
  );
}

function MarkMonthForm({
  fetcher,
  summary,
  onCancel,
}: {
  fetcher: ReturnType<typeof useFetcher<{ success?: boolean; error?: string }>>;
  summary: AttendanceSummaryData;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<AttendanceStatus>('PRESENT');
  const [onlyBlank, setOnlyBlank] = useState(true);

  const today = new Date().toISOString().slice(0, 10);
  // Elapsed days this month (don't fill the future) — for the preview count.
  const eligibleDays = summary.calendar.filter((d) => d.date <= today);
  const previewCount = (onlyBlank ? eligibleDays.filter((d) => d.status === 'NONE') : eligibleDays).length;
  const first = summary.calendar[0]?.date ?? `${summary.month}-01`;
  const lastElapsed = eligibleDays[eligibleDays.length - 1]?.date ?? first;

  return (
    <fetcher.Form method="post" className="space-y-5 p-5 sm:p-6">
      <input type="hidden" name="intent" value="markMonth" />
      <input type="hidden" name="startDate" value={first} />
      <input type="hidden" name="endDate" value={lastElapsed} />
      <input type="hidden" name="onlyBlank" value={String(onlyBlank)} />
      <div>
        <h2 className="text-base font-semibold text-app-fg">Mark whole month</h2>
        <p className="text-sm text-app-fg-muted">{summary.staffName} · {monthLabel(summary.month)}</p>
      </div>
      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-app-fg">Status</legend>
        <div className="grid grid-cols-2 gap-2">
          {MARK_CYCLE.map((s) => {
            const active = status === s;
            return (
              <label key={s} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${active ? `${STATUS_THEME[s].cell} border-transparent ring-2 ring-brand-400` : 'border-app-border text-app-fg hover:bg-app-muted'}`}>
                <input type="radio" name="status" value={s} checked={active} onChange={() => setStatus(s)} className="sr-only" />
                <span className={`h-3.5 w-3.5 rounded-full ${STATUS_THEME[s].dot}`} />
                <span className="font-medium">{STATUS_LABEL[s]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyBlank} onChange={(e) => setOnlyBlank(e.target.checked)} className="h-4 w-4" />
        Only fill days not already marked
      </label>
      <p className="text-xs text-app-fg-muted">
        {previewCount} day{previewCount === 1 ? '' : 's'} will be set to {STATUS_LABEL[status]} (elapsed days only).
      </p>
      {fetcher.data?.error && <p className="text-sm text-red-600">{fetcher.data.error}</p>}
      <div className="flex justify-end gap-2">
        <TableActionButton variant="neutral" type="button" onClick={onCancel} disabled={fetcher.state !== 'idle'}>Cancel</TableActionButton>
        <TableActionButton variant="primary" type="submit" disabled={fetcher.state !== 'idle' || previewCount === 0}>
          {fetcher.state !== 'idle' ? 'Applying…' : `Apply to ${previewCount}`}
        </TableActionButton>
      </div>
    </fetcher.Form>
  );
}
