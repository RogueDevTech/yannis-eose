import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TableActionButton } from '~/components/ui/table-action-button';
import {
  type AttendanceSummaryData,
  STATUS_LETTER,
  STATUS_LABEL,
  STATUS_THEME,
  MARK_CYCLE,
} from './attendance-types';

interface Props {
  summary: AttendanceSummaryData | null;
  month: string;
}

function parseMonth(month: string): { y: number; m: number } {
  const parts = month.split('-');
  return { y: Number(parts[0]), m: Number(parts[1]) };
}

function monthLabel(month: string): string {
  const { y, m } = parseMonth(month);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function shiftMonth(month: string, delta: number): string {
  const { y, m } = parseMonth(month);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function MyAttendancePage({ summary, month }: Props) {
  const [, setSearchParams] = useSearchParams();

  function setMonth(next: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('month', next);
      return p;
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Attendance"
        description="Your attendance record and base salary eligibility for the month."
        mobileInlineActions
        actions={
          <div className="flex items-center gap-2">
            <TableActionButton variant="neutral" onClick={() => setMonth(shiftMonth(month, -1))}>
              ‹
            </TableActionButton>
            <span className="min-w-[9rem] text-center text-sm font-medium">{monthLabel(month)}</span>
            <TableActionButton variant="neutral" onClick={() => setMonth(shiftMonth(month, 1))}>
              ›
            </TableActionButton>
          </div>
        }
      />

      {!summary ? (
        <EmptyState title="No attendance yet" description="No attendance has been recorded for this month." variant="card" />
      ) : (
        <>
          {/* Summary + eligibility */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile label="Present" value={summary.summary.present} />
            <SummaryTile label="Absent" value={summary.summary.absent} tone="danger" />
            <SummaryTile label="Off duty" value={summary.summary.offDuty} />
            <SummaryTile label="Sick" value={summary.summary.sick} />
          </div>

          <div className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-app-fg">Base salary eligibility</h3>
                <p className="text-xs text-app-fg-muted">
                  Attendance {summary.summary.attendancePct}% this month.
                </p>
              </div>
              {!summary.eligibility.gated ? (
                <StatusBadge status="Not affected" variant="neutral" pill label="Attendance does not affect your pay" />
              ) : summary.eligibility.baseAtRisk ? (
                <StatusBadge
                  status="At risk"
                  variant="danger"
                  pill
                  label={`Base reduced ${summary.eligibility.deductionPercent}%`}
                />
              ) : (
                <StatusBadge status="Eligible" variant="success" pill label="Full base salary" />
              )}
            </div>
            {summary.eligibility.reason && (
              <p className="mt-2 text-xs text-app-fg-muted">{summary.eligibility.reason}</p>
            )}
          </div>

          {/* Calendar */}
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-app-fg">Daily record</h3>
            <div className="grid grid-cols-7 gap-1.5">
              {summary.calendar.map((day) => {
                const d = Number(day.date.slice(8, 10));
                return (
                  <div
                    key={day.date}
                    title={`${day.date}: ${STATUS_LABEL[day.status]}${day.remark ? ` — ${day.remark}` : ''}`}
                    className={`flex aspect-square flex-col items-center justify-center rounded-md text-xs ${STATUS_THEME[day.status].cell}`}
                  >
                    <span className="font-medium">{d}</span>
                    <span className="text-[0.65rem] opacity-80">{STATUS_LETTER[day.status]}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-app-fg-muted">
              {MARK_CYCLE.map((s) => (
                <LegendDot key={s} label={`${STATUS_LABEL[s]} (${STATUS_LETTER[s]})`} className={STATUS_THEME[s].dot} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-app-fg-muted">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-app-fg'}`}>
        {value}
      </div>
    </div>
  );
}

function LegendDot({ label, className }: { label: string; className: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded ${className}`} />
      {label}
    </span>
  );
}
