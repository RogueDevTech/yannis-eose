import { useMemo, useState } from 'react';
import { PageHeader } from '~/components/ui/page-header';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { RoleBadge } from '~/components/ui/role-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { FormSelect } from '~/components/ui/form-select';
import {
  type AttendanceGridData,
  type AttendanceGridRow,
  type CellStatus,
  STATUS_LABEL,
  STATUS_THEME,
  isWorkDayDate,
} from './attendance-types';

interface Props {
  grid: AttendanceGridData | null;
  /** 'range' = period/monthly report (priority); 'day' = single-date report. */
  mode: 'range' | 'day';
  /** The report date (range start), YYYY-MM-DD. */
  date: string;
  /** Global DateFilterBar bounds. */
  startDate: string;
  endDate: string;
  /** The month the grid was fetched for (YYYY-MM). */
  month: string;
  /** Work-day weekday numbers (0=Sun..6=Sat). Non-work days are excluded. */
  workDays: number[];
}

/** Status of a staff member on a specific date. Missing = not marked. */
function statusOn(row: AttendanceGridRow, date: string): CellStatus {
  return (row.exceptions[date]?.status as CellStatus) ?? 'NONE';
}

/**
 * Per-staff P/A/O/S counts across an inclusive [start, end] date range. Non-work
 * days (per `workDays`, 0=Sun..6=Sat) are excluded — they don't appear or count.
 */
function rangeCounts(row: AttendanceGridRow, start: string, end: string, workDays: number[]): DayCounts {
  const c: DayCounts = { present: 0, absent: 0, offDuty: 0, sick: 0, notMarked: 0 };
  for (const [d, cell] of Object.entries(row.exceptions)) {
    if (d < start || d > end) continue;
    if (!isWorkDayDate(d, workDays)) continue;
    const s = cell.status as CellStatus;
    if (s === 'PRESENT') c.present += 1;
    else if (s === 'ABSENT') c.absent += 1;
    else if (s === 'OFF_DUTY') c.offDuty += 1;
    else if (s === 'SICK') c.sick += 1;
  }
  return c;
}

/** Attendance % from counts: (present+off+sick) / marked. */
function pctOf(c: DayCounts): number {
  const marked = c.present + c.absent + c.offDuty + c.sick;
  return marked === 0 ? 0 : Math.round(((c.present + c.offDuty + c.sick) / marked) * 100);
}

function prettyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/** "1 – 31 August 2026" (or full range when it spans months). */
function periodLabel(start: string, end: string): string {
  const s = start.split('-').map(Number);
  const e = end.split('-').map(Number);
  const sd = new Date(Date.UTC(s[0]!, s[1]! - 1, s[2]!));
  const ed = new Date(Date.UTC(e[0]!, e[1]! - 1, e[2]!));
  const sameMonth = s[0] === e[0] && s[1] === e[1];
  if (sameMonth) {
    const monthYear = ed.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `${s[2]} – ${e[2]} ${monthYear}`;
  }
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${fmt(sd)} – ${fmt(ed)}`;
}

/** Short marked-at time in Nigeria time, e.g. "9:14 AM". Empty when null. */
function markedTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos',
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

/** One P/A/O/S/blank stat inside a branch card. */
function BranchStat({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-md bg-app-muted/40 py-1.5">
      <div className={`text-sm tabular-nums ${className}`}>{value}</div>
      <div className="text-[0.6rem] text-app-fg-muted">{label}</div>
    </div>
  );
}

type StatusFilter = 'ALL' | CellStatus;

export function AttendanceReportPage({ grid, mode, date, startDate, endDate, month, workDays }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const rows = useMemo(() => grid?.staff ?? [], [grid]);
  const isRange = mode === 'range';

  // Range mode: a status filter keeps staff who have >=1 day of that status in the
  // period. Day mode: staff whose status ON the date matches.
  const filteredRows = useMemo(() => {
    if (statusFilter === 'ALL') return rows;
    if (isRange) {
      return rows.filter((r) => {
        const c = rangeCounts(r, startDate, endDate, workDays);
        if (statusFilter === 'PRESENT') return c.present > 0;
        if (statusFilter === 'ABSENT') return c.absent > 0;
        if (statusFilter === 'OFF_DUTY') return c.offDuty > 0;
        if (statusFilter === 'SICK') return c.sick > 0;
        // NONE = staff with no marks at all in the range.
        return c.present + c.absent + c.offDuty + c.sick === 0;
      });
    }
    return rows.filter((r) => statusOn(r, date) === statusFilter);
  }, [rows, date, statusFilter, isRange, startDate, endDate]);

  // Group the (filtered) staff by branch for the accordion sections, mirroring
  // the main attendance page. Named branches first (alpha), "No branch" last.
  const staffGroups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; rows: AttendanceGridRow[] }>();
    for (const row of filteredRows) {
      const key = row.branchId ?? '__none';
      if (!map.has(key)) map.set(key, { key, name: row.branchName ?? 'No branch', rows: [] });
      map.get(key)!.rows.push(row);
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === '__none') return 1;
      if (b.key === '__none') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredRows]);

  // Expand/collapse per branch section. All open by default so the report reads
  // top-to-bottom; re-seed whenever the branch set changes.
  const groupKeysSig = staffGroups.map((g) => g.key).join(',');
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());
  const [seededSig, setSeededSig] = useState<string | undefined>(undefined);
  if (groupKeysSig !== seededSig) {
    setSeededSig(groupKeysSig);
    setExpandedBranches(new Set(staffGroups.map((g) => g.key)));
  }
  function toggleBranch(key: string) {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Period totals across all staff. Range mode sums each staff's range counts;
  // day mode tallies the single date.
  const totals = useMemo(() => {
    if (!isRange) return tally(rows, date);
    const acc: DayCounts = { present: 0, absent: 0, offDuty: 0, sick: 0, notMarked: 0 };
    for (const r of rows) {
      const c = rangeCounts(r, startDate, endDate, workDays);
      acc.present += c.present;
      acc.absent += c.absent;
      acc.offDuty += c.offDuty;
      acc.sick += c.sick;
    }
    return acc;
  }, [rows, date, isRange, startDate, endDate]);
  const attendancePct = useMemo(() => pctOf(totals), [totals]);

  // Mode-aware group tally: sum a set of staff rows over the range (range mode)
  // or tally their single-date status (day mode).
  const groupCounts = (grp: AttendanceGridRow[]): DayCounts => {
    if (!isRange) return tally(grp, date);
    const acc: DayCounts = { present: 0, absent: 0, offDuty: 0, sick: 0, notMarked: 0 };
    for (const r of grp) {
      const c = rangeCounts(r, startDate, endDate, workDays);
      acc.present += c.present;
      acc.absent += c.absent;
      acc.offDuty += c.offDuty;
      acc.sick += c.sick;
    }
    return acc;
  };

  // Per-branch breakdown cards.
  const branches = useMemo(() => {
    const map = new Map<string, { name: string; rows: AttendanceGridRow[] }>();
    for (const r of rows) {
      const key = r.branchId ?? '__none';
      const name = r.branchName ?? 'No branch';
      if (!map.has(key)) map.set(key, { name, rows: [] });
      map.get(key)!.rows.push(r);
    }
    return [...map.values()]
      .map((b) => ({ name: b.name, counts: groupCounts(b.rows) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, date, isRange, startDate, endDate]);


  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance report"
        description={isRange ? periodLabel(startDate, endDate) : prettyDate(date)}
        backTo="/hr/attendance"
        actions={<DateFilterBar startDate={startDate} endDate={endDate} chrome="pill" />}
      />

      {rows.length === 0 ? (
        <EmptyState title="No staff" description="No attendance-tracked staff for this date." variant="card" />
      ) : (
        <>
          <OverviewStatStrip
            items={[
              { label: 'Total staff', value: rows.length, valueClassName: 'text-app-fg tabular-nums' },
              { label: isRange ? 'Present days' : 'Present', value: totals.present, valueClassName: 'text-green-600 dark:text-green-400 tabular-nums' },
              { label: isRange ? 'Absent days' : 'Absent', value: totals.absent, valueClassName: 'text-red-600 dark:text-red-400 tabular-nums' },
              { label: isRange ? 'Off days' : 'Off duty', value: totals.offDuty, valueClassName: 'text-amber-600 dark:text-amber-400 tabular-nums' },
              { label: isRange ? 'Sick days' : 'Sick', value: totals.sick, valueClassName: 'text-blue-600 dark:text-blue-400 tabular-nums' },
              ...(isRange ? [] : [{ label: 'Not marked', value: totals.notMarked, valueClassName: 'text-app-fg-muted tabular-nums' }]),
              { label: 'Attendance', value: `${attendancePct}%`, valueClassName: 'text-app-fg tabular-nums' },
            ]}
          />

          {/* Per-branch breakdown cards */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-app-fg">By branch</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {branches.map((b) => {
                const marked = b.counts.present + b.counts.absent + b.counts.offDuty + b.counts.sick;
                const pct = marked === 0 ? 0 : Math.round((b.counts.present / marked) * 100);
                const total = marked + b.counts.notMarked;
                return (
                  <div key={b.name} className="card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-app-fg">{b.name}</h3>
                        <p className="text-xs text-app-fg-muted">{total} staff</p>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-semibold tabular-nums text-app-fg">{pct}%</div>
                        <div className="text-[0.65rem] uppercase tracking-wide text-app-fg-muted">present</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-5 gap-1 text-center">
                      <BranchStat label="P" value={b.counts.present} className="text-green-600 dark:text-green-400" />
                      <BranchStat label="A" value={b.counts.absent} className="font-semibold text-red-600 dark:text-red-400" />
                      <BranchStat label="O" value={b.counts.offDuty} className="text-amber-600 dark:text-amber-400" />
                      <BranchStat label="S" value={b.counts.sick} className="text-blue-600 dark:text-blue-400" />
                      <BranchStat label="-" value={b.counts.notMarked} className="text-app-fg-muted" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Single staff table + status filter. */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-app-fg">
                Staff ({filteredRows.length}{filteredRows.length !== rows.length ? ` of ${rows.length}` : ''})
              </h2>
              <FormSelect
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="w-full sm:w-48"
              >
                <option value="ALL">All statuses</option>
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
                <option value="OFF_DUTY">Off duty</option>
                <option value="SICK">Sick leave</option>
                <option value="NONE">Not marked</option>
              </FormSelect>
            </div>
            {filteredRows.length === 0 ? (
              <EmptyState title="No staff" description="No staff match this filter for the selected date." variant="card" />
            ) : (
              <>
                {/* Desktop: ONE shared header, branch groups as tbody sections. */}
                <div className="hidden overflow-x-auto rounded-lg border border-app-border md:block">
                  <table className="w-full table-fixed border-collapse text-sm">
                    <colgroup>
                      <col style={{ width: '22%' }} />
                      {isRange ? (
                        <>
                          <col style={{ width: '34%' }} />
                          <col style={{ width: '22%' }} />
                          <col style={{ width: '9%' }} />
                          <col style={{ width: '9%' }} />
                          <col style={{ width: '9%' }} />
                          <col style={{ width: '9%' }} />
                          <col />
                        </>
                      ) : (
                        <>
                          <col style={{ width: '22%' }} />
                          <col style={{ width: '18%' }} />
                          <col style={{ width: '18%' }} />
                          <col style={{ width: '18%' }} />
                          <col />
                        </>
                      )}
                    </colgroup>
                    <thead className="border-b border-app-border bg-app-elevated">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-medium text-app-fg-muted">Staff</th>
                        <th className="px-3 py-2.5 text-left font-medium text-app-fg-muted">Role</th>
                        {isRange ? (
                          <>
                            <th className="px-3 py-2.5 text-center font-medium text-app-fg-muted">P</th>
                            <th className="px-3 py-2.5 text-center font-medium text-app-fg-muted">A</th>
                            <th className="px-3 py-2.5 text-center font-medium text-app-fg-muted">O</th>
                            <th className="px-3 py-2.5 text-center font-medium text-app-fg-muted">S</th>
                            <th className="px-3 py-2.5 text-center font-medium text-app-fg-muted">%</th>
                          </>
                        ) : (
                          <>
                            <th className="px-3 py-2.5 text-left font-medium text-app-fg-muted">Status</th>
                            <th className="px-3 py-2.5 text-left font-medium text-app-fg-muted">Marked at</th>
                            <th className="px-3 py-2.5 text-left font-medium text-app-fg-muted">Remark</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    {staffGroups.map((group) => {
                      const open = expandedBranches.has(group.key);
                      const t = groupCounts(group.rows);
                      // Branch header spans everything up to the trailing counts area.
                      const labelSpan = isRange ? 2 : 4;
                      return (
                        <tbody key={group.key} className="border-b border-app-border last:border-b-0">
                          <tr className="bg-app-hover/80 dark:bg-app-hover/60">
                            <td colSpan={labelSpan} className="px-3 py-2">
                              <button type="button" onClick={() => toggleBranch(group.key)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
                                <svg className={`h-4 w-4 shrink-0 text-brand-600 transition-transform dark:text-brand-400 ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                                <span className="text-sm font-semibold text-app-fg">{group.name}</span>
                                <span className="rounded-full bg-app-elevated px-1.5 py-0.5 text-xs font-medium text-app-fg-muted">{group.rows.length}</span>
                              </button>
                            </td>
                            {isRange ? (
                              <>
                                <td className="px-3 py-2 text-center text-xs tabular-nums text-green-600 dark:text-green-400">{t.present}</td>
                                <td className="px-3 py-2 text-center text-xs font-semibold tabular-nums text-red-600 dark:text-red-400">{t.absent}</td>
                                <td className="px-3 py-2 text-center text-xs tabular-nums text-amber-600 dark:text-amber-400">{t.offDuty}</td>
                                <td className="px-3 py-2 text-center text-xs tabular-nums text-blue-600 dark:text-blue-400">{t.sick}</td>
                                <td className="px-3 py-2 text-center text-xs tabular-nums text-app-fg">{pctOf(t)}%</td>
                              </>
                            ) : (
                              <td className="px-3 py-2 text-left">
                                <span className="flex gap-1.5 text-xs tabular-nums">
                                  <span className="text-green-600 dark:text-green-400">{t.present}</span>
                                  <span className="font-semibold text-red-600 dark:text-red-400">{t.absent}</span>
                                  <span className="text-amber-600 dark:text-amber-400">{t.offDuty}</span>
                                  <span className="text-blue-600 dark:text-blue-400">{t.sick}</span>
                                  {t.notMarked > 0 && <span className="text-app-fg-muted">{t.notMarked}</span>}
                                </span>
                              </td>
                            )}
                          </tr>
                          {open && group.rows.map((r) => {
                            const rc = isRange ? rangeCounts(r, startDate, endDate, workDays) : null;
                            return (
                              <tr key={r.staffId} className="border-t border-app-border/60">
                                <td className="truncate px-3 py-2 font-medium text-app-fg">{r.name}</td>
                                <td className="px-3 py-2"><RoleBadge role={r.role} size="sm" /></td>
                                {isRange && rc ? (
                                  <>
                                    <td className="px-3 py-2 text-center tabular-nums text-green-600 dark:text-green-400">{rc.present}</td>
                                    <td className="px-3 py-2 text-center font-semibold tabular-nums text-red-600 dark:text-red-400">{rc.absent}</td>
                                    <td className="px-3 py-2 text-center tabular-nums text-amber-600 dark:text-amber-400">{rc.offDuty}</td>
                                    <td className="px-3 py-2 text-center tabular-nums text-blue-600 dark:text-blue-400">{rc.sick}</td>
                                    <td className="px-3 py-2 text-center tabular-nums text-app-fg">{pctOf(rc)}%</td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-3 py-2"><StatusPill status={statusOn(r, date)} /></td>
                                    <td className="px-3 py-2 text-app-fg-muted tabular-nums">{markedTime(r.exceptions[date]?.markedAt) || '-'}</td>
                                    <td className="truncate px-3 py-2 text-app-fg-muted">{r.exceptions[date]?.remark ?? '-'}</td>
                                  </>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      );
                    })}
                  </table>
                </div>

                {/* Mobile: accordion of branch sections with staff cards. */}
                <div className="space-y-3 md:hidden">
                  {staffGroups.map((group) => {
                    const open = expandedBranches.has(group.key);
                    const t = groupCounts(group.rows);
                    return (
                      <div key={group.key} className="overflow-hidden rounded-lg border border-app-border">
                        <button type="button" onClick={() => toggleBranch(group.key)} aria-expanded={open} className="flex w-full items-center gap-2 bg-app-hover/80 px-3 py-2 text-left dark:bg-app-hover/60">
                          <svg className={`h-4 w-4 shrink-0 text-brand-600 transition-transform dark:text-brand-400 ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="text-sm font-semibold text-app-fg">{group.name}</span>
                          <span className="rounded-full bg-app-elevated px-1.5 py-0.5 text-xs font-medium text-app-fg-muted">{group.rows.length}</span>
                          <span className="ml-auto flex shrink-0 gap-1.5 text-xs tabular-nums">
                            <span className="text-green-600 dark:text-green-400">{t.present}</span>
                            <span className="font-semibold text-red-600 dark:text-red-400">{t.absent}</span>
                            <span className="text-amber-600 dark:text-amber-400">{t.offDuty}</span>
                            <span className="text-blue-600 dark:text-blue-400">{t.sick}</span>
                          </span>
                        </button>
                        {open && (
                          <div className="divide-y divide-app-border/60">
                            {group.rows.map((r) => {
                              const rc = isRange ? rangeCounts(r, startDate, endDate, workDays) : null;
                              return (
                                <div key={r.staffId} className="flex items-center justify-between gap-2 p-3">
                                  <div className="min-w-0">
                                    <div className="truncate font-medium text-app-fg">{r.name}</div>
                                    <div className="mt-0.5"><RoleBadge role={r.role} size="sm" /></div>
                                  </div>
                                  {isRange && rc ? (
                                    <span className="flex shrink-0 gap-1.5 text-xs tabular-nums">
                                      <span className="text-green-600 dark:text-green-400">{rc.present}P</span>
                                      <span className="font-semibold text-red-600 dark:text-red-400">{rc.absent}A</span>
                                      <span className="text-amber-600 dark:text-amber-400">{rc.offDuty}O</span>
                                      <span className="text-blue-600 dark:text-blue-400">{rc.sick}S</span>
                                    </span>
                                  ) : (
                                    <StatusPill status={statusOn(r, date)} />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
