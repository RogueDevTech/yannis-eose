import { useMemo } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { RoleBadge } from '~/components/ui/role-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import {
  type AttendanceGridData,
  type AttendanceGridRow,
  type CellStatus,
  STATUS_LABEL,
  STATUS_THEME,
} from './attendance-types';

interface Props {
  grid: AttendanceGridData | null;
  /** The report date, YYYY-MM-DD. */
  date: string;
}

/** Status of a staff member on a specific date. Missing = not marked. */
function statusOn(row: AttendanceGridRow, date: string): CellStatus {
  return (row.exceptions[date]?.status as CellStatus) ?? 'NONE';
}

function prettyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

type DayCounts = { present: number; absent: number; offDuty: number; sick: number; notMarked: number };

function tally(rows: AttendanceGridRow[], date: string): DayCounts {
  return rows.reduce<DayCounts>(
    (acc, r) => {
      const s = statusOn(r, date);
      if (s === 'PRESENT') acc.present += 1;
      else if (s === 'ABSENT') acc.absent += 1;
      else if (s === 'OFF_DUTY') acc.offDuty += 1;
      else if (s === 'SICK') acc.sick += 1;
      else acc.notMarked += 1;
      return acc;
    },
    { present: 0, absent: 0, offDuty: 0, sick: 0, notMarked: 0 },
  );
}

function StatusPill({ status }: { status: CellStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${STATUS_THEME[status].dot}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function AttendanceReportPage({ grid, date }: Props) {
  const [, setSearchParams] = useSearchParams();
  const rows = useMemo(() => grid?.staff ?? [], [grid]);

  const totals = useMemo(() => tally(rows, date), [rows, date]);
  const attendancePct = useMemo(() => {
    // Present ÷ (all marked absences + present). Not-marked excluded, mirroring
    // the grid's attendance %: only explicit records count.
    const denom = totals.present + totals.absent + totals.offDuty + totals.sick;
    return denom === 0 ? 0 : Math.round((totals.present / denom) * 100);
  }, [totals]);

  // Per-branch breakdown.
  const branches = useMemo(() => {
    const map = new Map<string, { name: string; rows: AttendanceGridRow[] }>();
    for (const r of rows) {
      const key = r.branchId ?? '__none';
      const name = r.branchName ?? 'No branch';
      if (!map.has(key)) map.set(key, { name, rows: [] });
      map.get(key)!.rows.push(r);
    }
    return [...map.values()]
      .map((b) => ({ name: b.name, counts: tally(b.rows, date) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, date]);

  // Absentees: anyone Absent / Off duty / Sick on the date (the actionable list).
  const absentees = useMemo(
    () =>
      rows
        .map((r) => ({ row: r, status: statusOn(r, date) }))
        .filter((x) => x.status === 'ABSENT' || x.status === 'SICK' || x.status === 'OFF_DUTY')
        .sort((a, b) => a.row.name.localeCompare(b.row.name)),
    [rows, date],
  );

  const absenteeColumns: CompactTableColumn<{ row: AttendanceGridRow; status: CellStatus }>[] = [
    { key: 'name', header: 'Staff', render: (x) => <span className="font-medium text-app-fg">{x.row.name}</span> },
    { key: 'role', header: 'Role', render: (x) => <RoleBadge role={x.row.role} size="sm" /> },
    { key: 'branch', header: 'Branch', render: (x) => <span className="text-app-fg-muted">{x.row.branchName ?? '—'}</span> },
    { key: 'status', header: 'Status', render: (x) => <StatusPill status={x.status} /> },
    { key: 'remark', header: 'Remark', render: (x) => <span className="text-app-fg-muted">{x.row.exceptions[date]?.remark ?? '—'}</span> },
  ];

  const allColumns: CompactTableColumn<AttendanceGridRow>[] = [
    { key: 'name', header: 'Staff', render: (r) => <span className="font-medium text-app-fg">{r.name}</span> },
    { key: 'role', header: 'Role', render: (r) => <RoleBadge role={r.role} size="sm" /> },
    { key: 'branch', header: 'Branch', render: (r) => <span className="text-app-fg-muted">{r.branchName ?? '—'}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusPill status={statusOn(r, date)} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance report"
        description={prettyDate(date)}
        backTo="/hr/attendance"
        actions={
          <input
            type="date"
            value={date}
            onChange={(e) => setSearchParams((p) => {
              const n = new URLSearchParams(p);
              if (e.target.value) n.set('date', e.target.value);
              return n;
            }, { replace: true })}
            className="h-10 rounded-lg border border-app-border bg-app-elevated px-3 text-sm text-app-fg md:h-9"
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState title="No staff" description="No attendance-tracked staff for this date." variant="card" />
      ) : (
        <>
          <OverviewStatStrip
            items={[
              { label: `Present (${totals.present})`, value: totals.present, valueClassName: 'text-green-600 dark:text-green-400 tabular-nums' },
              { label: `Absent (${totals.absent})`, value: totals.absent, valueClassName: 'text-red-600 dark:text-red-400 tabular-nums' },
              { label: `Off duty (${totals.offDuty})`, value: totals.offDuty, valueClassName: 'text-amber-600 dark:text-amber-400 tabular-nums' },
              { label: `Sick (${totals.sick})`, value: totals.sick, valueClassName: 'text-blue-600 dark:text-blue-400 tabular-nums' },
              { label: `Not marked (${totals.notMarked})`, value: totals.notMarked, valueClassName: 'text-app-fg-muted tabular-nums' },
              { label: 'Attendance', value: `${attendancePct}%`, valueClassName: 'text-app-fg tabular-nums' },
            ]}
          />

          {/* Per-branch breakdown */}
          <div className="list-panel md:p-0">
            <div className="border-b border-app-border px-4 py-2.5">
              <h2 className="text-sm font-semibold text-app-fg">By branch</h2>
            </div>
            <div className="divide-y divide-app-border/60">
              {branches.map((b) => (
                <div key={b.name} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <span className="text-sm font-medium text-app-fg">{b.name}</span>
                  <div className="flex items-center gap-3 text-xs tabular-nums">
                    <span className="text-green-600 dark:text-green-400">{b.counts.present} P</span>
                    <span className="font-semibold text-red-600 dark:text-red-400">{b.counts.absent} A</span>
                    <span className="text-amber-600 dark:text-amber-400">{b.counts.offDuty} O</span>
                    <span className="text-blue-600 dark:text-blue-400">{b.counts.sick} S</span>
                    <span className="text-app-fg-muted">{b.counts.notMarked} —</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Absentee list */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-app-fg">Absent, sick or off duty ({absentees.length})</h2>
            {absentees.length === 0 ? (
              <EmptyState title="Full attendance" description="No absences recorded for this date." variant="card" />
            ) : (
              <CompactTable<{ row: AttendanceGridRow; status: CellStatus }> rows={absentees} columns={absenteeColumns} rowKey={(x) => x.row.staffId} density="dense" />
            )}
          </div>

          {/* Full per-staff table */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-app-fg">All staff ({rows.length})</h2>
            <CompactTable<AttendanceGridRow> rows={rows} columns={allColumns} rowKey={(r) => r.staffId} density="dense" />
          </div>
        </>
      )}
    </div>
  );
}
