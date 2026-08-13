import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useFetcher, useLocation, useRevalidator, useSearchParams } from '@remix-run/react';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import { PageHeader } from '~/components/ui/page-header';
import { Modal } from '~/components/ui/modal';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { CONTROL_HEIGHT_CLASS } from '~/components/ui/_control-heights';
import { StatusBadge } from '~/components/ui/status-badge';
import { RoleBadge } from '~/components/ui/role-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TableActionButton } from '~/components/ui/table-action-button';
import { Button } from '~/components/ui/button';
import { type CompactTableColumn } from '~/components/ui/compact-table';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { useBranchesCatalog, useBranchGroupsCatalog } from '~/contexts/branches-catalog-context';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { ROLE_OPTIONS, formatRole } from '~/features/users/types';
import {
  type AttendanceGridData,
  type AttendanceGridRow,
  type AttendanceStatus,
  type CellStatus,
  STATUS_LETTER,
  STATUS_LABEL,
  STATUS_THEME,
  MARK_CYCLE,
  weeksOfMonth,
  WEEKDAY_HEADERS,
} from './attendance-types';

interface Props {
  grid: AttendanceGridData | null;
  canManage: boolean;
  month: string; // YYYY-MM
  startDate: string; // YYYY-MM-DD (global date filter)
  endDate: string; // YYYY-MM-DD (global date filter)
  search: string;
  branchId: string;
  role: string;
  statuses: string[];
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

type ViewMode = 'daily' | 'weekly' | 'monthly';
const VIEW_MODES: Array<{ value: ViewMode; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

/** Today's day-of-month if the viewed month is the current one; else 1. */
function defaultDayForMonth(month: string): number {
  const now = new Date();
  const nowMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return month === nowMonth ? now.getDate() : 1;
}

/** Header label for the single daily column, e.g. "Mon 12". */
function dailyLabel(month: string, day: number): string {
  const { y, m } = parseMonth(month);
  const weekday = new Date(Date.UTC(y, m - 1, day)).toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday} ${day}`;
}

function daysInMonthOf(month: string): number {
  const { y, m } = parseMonth(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Fixed column widths for the branch-grouped table (table-fixed). Keeping widths
 * fixed means expanding/collapsing a branch never reflows the shared header.
 * Staff is the flexible column (no width → absorbs remaining space).
 */
function colWidth(col: CompactTableColumn<AttendanceGridRow>): CSSProperties {
  if (col.key === 'select') return { width: '2.5rem' };
  if (col.key === 'role') return { width: '9rem' };
  if (col.key === 'view') return { width: '5rem' };
  if (col.key === 'summary') return { width: '7rem' };
  // Daily view: fixed day column so Staff flexes and the day + summary hug the
  // right edge (next to P/A/O/S).
  if (col.key === 'today') return { width: '5rem' };
  // Staff flexes (absorbs remaining width) so Role/day/summary align consistently.
  if (col.key === 'staff') return {};
  // Weekly day cells share the remaining space.
  if (col.key.startsWith('d')) return {};
  // monthly count columns (p/a/o/s/pct)
  return { width: '5.5rem' };
}

/** "6 – 12" style label for a week's first/last real day. */
function weekRangeLabel(month: string, weekDays: Array<number | null>): string {
  const real = weekDays.filter((d): d is number => d != null);
  if (real.length === 0) return '';
  const first = real[0];
  const last = real[real.length - 1];
  return first === last ? `${first}` : `${first} – ${last}`;
}

/** Sum P/A/O/S across a branch's staff rows (for the accordion header). */
function branchTotals(rows: AttendanceGridRow[]): { present: number; absent: number; offDuty: number; sick: number } {
  return rows.reduce(
    (acc, r) => ({
      present: acc.present + r.summary.present,
      absent: acc.absent + r.summary.absent,
      offDuty: acc.offDuty + r.summary.offDuty,
      sick: acc.sick + r.summary.sick,
    }),
    { present: 0, absent: 0, offDuty: 0, sick: 0 },
  );
}

export function AttendancePage({ grid, canManage, month, startDate, endDate, search, branchId, role, statuses }: Props) {
  const [, setSearchParams] = useSearchParams();
  const markFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const bulkFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [weekIndex, setWeekIndex] = useState(0);
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number>(() => defaultDayForMonth(month));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<{ row: AttendanceGridRow; date: string; current: CellStatus } | null>(null);

  const revalidator = useRevalidator();
  const location = useLocation();
  // After a mark/bulk-mark, the grid loader must refetch. The clientLoader is
  // cached (stale-while-revalidate), so bust its entry AND force a revalidate,
  // otherwise the grid keeps showing the pre-mutation snapshot until a hard reload.
  const refreshGrid = useCallback(() => {
    invalidateCachedLoader(location.pathname);
    revalidator.revalidate();
  }, [location.pathname, revalidator]);

  useFetcherToast(markFetcher.data, { successMessage: 'Attendance updated' });
  useFetcherToast(bulkFetcher.data, { successMessage: 'Attendance updated for selected staff' });
  useCloseOnFetcherSuccess(markFetcher, () => {
    setEditing(null);
    refreshGrid();
  }, { intent: 'markAttendance' });
  useCloseOnFetcherSuccess(bulkFetcher, () => {
    setBulkOpen(false);
    setSelected(new Set());
    refreshGrid();
  }, { intent: 'markAttendanceBulk' });

  const { y, m } = parseMonth(month);
  const weeks = useMemo(() => weeksOfMonth(y, m), [y, m]);
  const safeWeekIndex = Math.min(weekIndex, Math.max(0, weeks.length - 1));
  const weekDays = weeks[safeWeekIndex] ?? [];

  // Date the Report button opens on: the exact selected day in daily view,
  // else the start of the current date-filter range (YYYY-MM-DD).
  const reportDate =
    viewMode === 'daily'
      ? `${month}-${String(selectedDay).padStart(2, '0')}`
      : (startDate || `${month}-01`);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value == null || value === 'ALL' || value === '') next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  function setMonth(next: string) {
    setWeekIndex(0);
    setParam('month', next);
  }

  // ── Filters ──────────────────────────────────────────────────
  const branchesCatalog = useBranchesCatalog();
  const branchGroupsCatalog = useBranchGroupsCatalog();
  const branchOptions = useMemo(() => {
    const activeGroups = branchGroupsCatalog.filter((g) => g.status !== 'INACTIVE');
    if (activeGroups.length > 1) {
      const opts: Array<{ value: string; label: string; disabled?: boolean }> = [{ value: 'ALL', label: 'All branches' }];
      for (const group of activeGroups) {
        const groupBranches = branchesCatalog.filter((b) => b.groupId === group.id);
        if (groupBranches.length === 0) continue;
        opts.push({ value: `__group_${group.id}`, label: `── ${group.name} ──`, disabled: true });
        for (const b of groupBranches) opts.push({ value: b.id, label: b.name });
      }
      for (const b of branchesCatalog.filter((b) => !b.groupId)) opts.push({ value: b.id, label: b.name });
      return opts;
    }
    return [{ value: 'ALL', label: 'All branches' }, ...branchesCatalog.map((b) => ({ value: b.id, label: b.name }))];
  }, [branchesCatalog, branchGroupsCatalog]);

  const statusSet = useMemo(
    () => new Set(statuses.filter((s): s is AttendanceStatus => (MARK_CYCLE as string[]).includes(s))),
    [statuses],
  );
  function toggleStatusFilter(s: AttendanceStatus) {
    const next = new Set(statusSet);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setParam('statuses', next.size ? [...next].join(',') : null);
  }

  const activeFilters =
    (branchId !== 'ALL' ? 1 : 0) + (role !== 'ALL' ? 1 : 0) + (search ? 1 : 0) + statusSet.size;

  const searchRow = (
    <PageSearchControl
      value={search}
      placeholder="Search staff by name…"
      title="Search staff"
      onApply={(value: string) => setParam('search', value || null)}
    />
  );

  // Multi-select Status filter as a dropdown (keeps the multi-status capability
  // of the old toggle chips, just collapsed behind a trigger). Rendered in both
  // the collapsible filters sheet and the desktop inline row — each instance owns
  // its own open state / outside-click ref so the two never fight over one popover.
  function StatusFilterDropdown() {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!open) return;
      function onDocClick(e: MouseEvent) {
        if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
      }
      function onKey(e: KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
      }
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDocClick);
        document.removeEventListener('keydown', onKey);
      };
    }, [open]);

    const firstStatus = [...statusSet][0];
    const triggerLabel =
      statusSet.size === 0
        ? 'All statuses'
        : statusSet.size === 1 && firstStatus
          ? STATUS_LABEL[firstStatus]
          : `${statusSet.size} selected`;

    return (
      <div className="relative w-full sm:w-auto" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`${CONTROL_HEIGHT_CLASS} flex w-full items-center justify-between gap-2 rounded-lg border border-app-border bg-app-elevated px-3 text-sm text-app-fg transition hover:bg-app-muted sm:w-48`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {statusSet.size > 0 && (
              <span className="flex shrink-0 items-center -space-x-1">
                {[...statusSet].map((s) => (
                  <span key={s} className={`h-2.5 w-2.5 rounded-full ring-1 ring-app-elevated ${STATUS_THEME[s].dot}`} />
                ))}
              </span>
            )}
            <span className={`truncate ${statusSet.size === 0 ? 'text-app-fg-muted' : ''}`}>{triggerLabel}</span>
          </span>
          <svg className="h-4 w-4 shrink-0 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <div
            role="listbox"
            className="absolute left-0 z-30 mt-1 w-full min-w-[12rem] overflow-hidden rounded-lg border border-app-border bg-app-elevated shadow-lg"
          >
            {MARK_CYCLE.map((s) => {
              const active = statusSet.has(s);
              return (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => toggleStatusFilter(s)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-app-fg transition hover:bg-app-muted"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      active ? 'border-transparent bg-info-600 text-white' : 'border-app-border'
                    }`}
                  >
                    {active && (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_THEME[s].dot}`} />
                  <span className="flex-1">{STATUS_LABEL[s]}</span>
                </button>
              );
            })}
            {statusSet.size > 0 && (
              <button
                type="button"
                onClick={() => setParam('statuses', null)}
                className="flex w-full items-center border-t border-app-border px-3 py-2 text-left text-xs text-app-fg-muted transition hover:bg-app-muted"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Cell helpers ─────────────────────────────────────────────
  function statusFor(row: AttendanceGridRow, day: number): CellStatus {
    const key = `${month}-${String(day).padStart(2, '0')}`;
    return (row.exceptions[key]?.status as CellStatus) ?? 'NONE';
  }
  function dateFor(day: number): string {
    return `${month}-${String(day).padStart(2, '0')}`;
  }

  const staff = grid?.staff ?? [];
  const allSelected = staff.length > 0 && staff.every((s) => selected.has(s.staffId));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(staff.map((s) => s.staffId)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Group rows by branch (accordion sections) ────────────────
  const branchGroups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; rows: AttendanceGridRow[] }>();
    for (const row of staff) {
      const key = row.branchId ?? '__none';
      if (!map.has(key)) map.set(key, { key, name: row.branchName ?? 'No branch', rows: [] });
      map.get(key)!.rows.push(row);
    }
    // Named branches first (alpha), "No branch" last.
    return [...map.values()].sort((a, b) => {
      if (a.key === '__none') return 1;
      if (b.key === '__none') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [staff]);

  // First branch open by default; re-open the first whenever the group set changes.
  const firstGroupKey = branchGroups[0]?.key;
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());
  const [seededKey, setSeededKey] = useState<string | undefined>(undefined);
  if (firstGroupKey && firstGroupKey !== seededKey) {
    setSeededKey(firstGroupKey);
    setExpandedBranches(new Set([firstGroupKey]));
  }
  function toggleBranch(key: string) {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function selectBranch(rows: AttendanceGridRow[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (on) next.add(r.staffId);
        else next.delete(r.staffId);
      }
      return next;
    });
  }

  const renderStaffCard = (row: AttendanceGridRow) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {canManage && (
            <input
              type="checkbox"
              checked={selected.has(row.staffId)}
              onChange={() => toggleOne(row.staffId)}
              aria-label={`Select ${row.name}`}
              className="h-4 w-4"
            />
          )}
          <Link to={`/hr/attendance/${row.staffId}`} className="font-medium text-app-fg underline-offset-2 hover:underline">
            {row.name}
          </Link>
        </div>
        {row.baseAtRisk && <StatusBadge status="At risk" variant="danger" size="sm" pill label={`-${row.deductionPercent}%`} />}
      </div>
      <RoleBadge role={row.role} size="sm" />
      {viewMode !== 'monthly' && (
        <div className="flex flex-wrap gap-1">
          {(viewMode === 'daily' ? [selectedDay] : weekDays).map((d, slot) =>
            d == null ? null : (
              <button
                key={slot}
                type="button"
                disabled={!canManage}
                onClick={() => setEditing({ row, date: dateFor(d), current: statusFor(row, d) })}
                title={`${dateFor(d)}: ${STATUS_LABEL[statusFor(row, d)]}`}
                className={`flex h-8 w-8 flex-col items-center justify-center rounded text-[0.65rem] ${STATUS_THEME[statusFor(row, d)].cell} ${canManage ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span>{d}</span>
                <span className="font-medium">{STATUS_LETTER[statusFor(row, d)]}</span>
              </button>
            ),
          )}
        </div>
      )}
      <div className="flex gap-2 text-xs text-app-fg-muted">
        <span className="text-green-600 dark:text-green-400">{row.summary.present}P</span>
        <span className="font-semibold text-red-600 dark:text-red-400">{row.summary.absent}A</span>
        <span className="text-amber-600 dark:text-amber-400">{row.summary.offDuty}O</span>
        <span className="text-blue-600 dark:text-blue-400">{row.summary.sick}S</span>
      </div>
    </div>
  );

  // ── Table columns ────────────────────────────────────────────
  const columns: CompactTableColumn<AttendanceGridRow>[] = useMemo(() => {
    const cols: CompactTableColumn<AttendanceGridRow>[] = [];

    if (canManage) {
      cols.push({
        key: 'select',
        header: (
          <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className="h-4 w-4 align-middle" />
        ),
        align: 'left',
        tight: true,
        hideOnMobile: true,
        render: (row) => (
          <input
            type="checkbox"
            checked={selected.has(row.staffId)}
            onChange={() => toggleOne(row.staffId)}
            aria-label={`Select ${row.name}`}
            className="h-4 w-4 align-middle"
          />
        ),
      });
    }

    cols.push(
      {
        key: 'staff',
        header: 'Staff',
        render: (row) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-app-fg">{row.name}</span>
            {row.baseAtRisk && (
              <StatusBadge status="At risk" variant="danger" size="sm" pill label={`-${row.deductionPercent}% base`} />
            )}
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        mobileLabel: 'Role',
        render: (row) => <RoleBadge role={row.role} size="sm" />,
      },
    );

    // A tappable day cell (shared by daily + weekly modes).
    const dayCell = (row: AttendanceGridRow, d: number) => {
      const status = statusFor(row, d);
      const date = dateFor(d);
      const isBlank = status === 'NONE';
      return (
        <button
          type="button"
          disabled={!canManage}
          onClick={() => setEditing({ row, date, current: status })}
          title={`${row.name} — ${date}: ${STATUS_LABEL[status]}`}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${STATUS_THEME[status].cell} ${
            canManage ? 'cursor-pointer' : 'cursor-default'
          } ${!isBlank && canManage ? 'hover:ring-2 hover:ring-brand-400' : ''}`}
        >
          {STATUS_LETTER[status]}
        </button>
      );
    };

    if (viewMode === 'daily') {
      cols.push({
        key: 'today',
        header: dailyLabel(month, selectedDay),
        align: 'center',
        render: (row) => dayCell(row, selectedDay),
      });
    } else if (viewMode === 'weekly') {
      cols.push(
        ...weekDays.map((d, slot) => ({
          key: `d${slot}`,
          header: (
            <div className="flex flex-col items-center leading-tight">
              <span className="text-[0.6rem] font-normal text-app-fg-muted">{WEEKDAY_HEADERS[slot]}</span>
              <span>{d ?? ''}</span>
            </div>
          ),
          align: 'center' as const,
          tight: true,
          hideOnMobile: true,
          render: (row: AttendanceGridRow) =>
            d == null ? (
              // Out-of-month day (belongs to the previous/next month's week). Not
              // clickable — show a clearly disabled, hatched placeholder instead of
              // a bare dot so the empty Mon–Fri of a partial week reads as N/A.
              <span
                className="mx-auto block h-5 w-5 rounded bg-app-hover/40 opacity-40 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgb(var(--app-border))_3px,rgb(var(--app-border))_4px)]"
                title="Not in this month"
                aria-hidden
              />
            ) : (
              dayCell(row, d)
            ),
        })),
      );
    } else {
      // Monthly — per-status count columns (no per-day cells).
      cols.push(
        { key: 'p', header: 'Present', align: 'center', render: (row) => <span className="tabular-nums text-green-600 dark:text-green-400">{row.summary.present}</span> },
        { key: 'a', header: 'Absent', align: 'center', render: (row) => <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">{row.summary.absent}</span> },
        { key: 'o', header: 'Off duty', align: 'center', render: (row) => <span className="tabular-nums text-amber-600 dark:text-amber-400">{row.summary.offDuty}</span> },
        { key: 's', header: 'Sick', align: 'center', render: (row) => <span className="tabular-nums text-blue-600 dark:text-blue-400">{row.summary.sick}</span> },
        { key: 'pct', header: '%', align: 'center', render: (row) => <span className="tabular-nums">{row.summary.attendancePct}%</span> },
      );
    }

    // Compact P/A/O/S summary column on daily + weekly (monthly already has them).
    if (viewMode !== 'monthly') {
      cols.push({
        key: 'summary',
        header: 'P / A / O / S',
        align: 'center',
        mobileLabel: 'Summary',
        render: (row) => (
          <div className="flex items-center justify-center gap-1 text-xs tabular-nums">
            <span className="text-green-600 dark:text-green-400" title="Present">{row.summary.present}</span>
            <span className="text-app-fg-muted">/</span>
            <span className="font-semibold text-red-600 dark:text-red-400" title="Absent">{row.summary.absent}</span>
            <span className="text-app-fg-muted">/</span>
            <span className="text-amber-600 dark:text-amber-400" title="Off duty">{row.summary.offDuty}</span>
            <span className="text-app-fg-muted">/</span>
            <span className="text-blue-600 dark:text-blue-400" title="Sick">{row.summary.sick}</span>
          </div>
        ),
      });
    }

    // View action — always the LAST column, as a text link.
    cols.push({
      key: 'view',
      header: '',
      align: 'right',
      tight: true,
      render: (row) => (
        <Link
          to={`/hr/attendance/${row.staffId}`}
          className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          View
        </Link>
      ),
    });

    return cols;
  }, [viewMode, weekDays, selectedDay, month, canManage, selected, allSelected, staff]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        mobileInlineActions
        actions={
          <div className="flex items-center gap-2">
            <DateFilterBar startDate={startDate} endDate={endDate} chrome="pill" />
            <TableActionButton
              variant="neutral"
              to={`/hr/attendance/report?date=${reportDate}`}
            >
              Report
            </TableActionButton>
            {canManage && <TableActionButton variant="neutral" to="/hr/attendance/config">Configure</TableActionButton>}
          </div>
        }
      >
        <div className="space-y-2">
          <ToolbarFiltersCollapsible
            className="!border-0"
            badgeCount={activeFilters}
            searchRow={searchRow}
            desktopInlineFilters={
              <>
                <div className="relative">
                  {role !== 'ALL' && <FilterDismiss onClear={() => setParam('role', null)} />}
                  <SearchableSelect
                    id="attendance-role-filter"
                    value={role}
                    onChange={(v) => setParam('role', v)}
                    options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                    placeholder="All Roles"
                    searchPlaceholder="Search roles…"
                    wrapperClassName="w-full min-w-0 sm:w-48"
                  />
                </div>
                {branchOptions.length > 1 && (
                  <div className="relative">
                    {branchId !== 'ALL' && <FilterDismiss onClear={() => setParam('branchId', null)} />}
                    <SearchableSelect
                      id="attendance-branch-filter"
                      value={branchId}
                      onChange={(v) => setParam('branchId', v)}
                      options={branchOptions}
                      placeholder="All branches"
                      searchPlaceholder="Search branches…"
                      wrapperClassName="w-full min-w-0 sm:w-52"
                    />
                  </div>
                )}
              </>
            }
            sheetFilterBody={
              <>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Role</span>
                  <SearchableSelect
                    id="attendance-role-filter-sheet"
                    value={role}
                    onChange={(v) => setParam('role', v)}
                    options={ROLE_OPTIONS.map((r) => ({ value: r, label: r === 'ALL' ? 'All Roles' : formatRole(r) }))}
                    placeholder="All Roles"
                    searchPlaceholder="Search roles…"
                  />
                </div>
                {branchOptions.length > 1 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Branch</span>
                    <SearchableSelect
                      id="attendance-branch-filter-sheet"
                      value={branchId}
                      onChange={(v) => setParam('branchId', v)}
                      options={branchOptions}
                      placeholder="All branches"
                      searchPlaceholder="Search branches…"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Status</span>
                  <StatusFilterDropdown />
                </div>
              </>
            }
          />
        </div>
      </PageHeader>

      {/* View-mode toggle + navigator + legend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Segmented Daily / Weekly / Monthly */}
          <div className="inline-flex rounded-lg border border-app-border p-0.5">
            {VIEW_MODES.map((vm) => (
              <button
                key={vm.value}
                type="button"
                onClick={() => setViewMode(vm.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === vm.value ? 'bg-brand-500 text-white' : 'text-app-fg-muted hover:text-app-fg'
                }`}
              >
                {vm.label}
              </button>
            ))}
          </div>

          {/* Mode-specific navigation */}
          {viewMode === 'daily' && (
            <button
              type="button"
              onClick={() => setDayPickerOpen(true)}
              className="inline-flex min-w-[6rem] items-center justify-center gap-2 rounded-lg border border-app-border bg-app-muted/40 px-4 py-2 text-sm font-semibold text-app-fg transition hover:bg-app-muted"
            >
              <span>{dailyLabel(month, selectedDay)}</span>
              <svg className="h-3.5 w-3.5 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          {viewMode === 'weekly' && (
            <button
              type="button"
              onClick={() => setWeekPickerOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-app-border bg-app-muted/40 px-4 py-2 text-sm font-semibold text-app-fg transition hover:bg-app-muted"
            >
              <span>Week {safeWeekIndex + 1} of {weeks.length}</span>
              <span className="text-xs font-normal text-app-fg-muted">{weekRangeLabel(month, weekDays)}</span>
              <svg className="h-3.5 w-3.5 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          {viewMode === 'monthly' && (
            <span className="text-sm font-medium text-app-fg-muted">Whole-month totals</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-app-fg-muted">
          {MARK_CYCLE.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded ${STATUS_THEME[s].dot}`} />
              {STATUS_LABEL[s]} ({STATUS_LETTER[s]})
            </span>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {canManage && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2.5 dark:border-brand-800 dark:bg-brand-950/30">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
            <Button variant="primary" size="sm" onClick={() => setBulkOpen(true)}>Bulk mark</Button>
          </div>
        </div>
      )}

      {staff.length === 0 ? (
        <EmptyState title="No staff to show" description="No payroll staff match these filters for this month." variant="card" />
      ) : (
        <>
          {/* Desktop: ONE shared header (table-fixed so it never reflows when a
              branch expands/collapses); branch groups are tbody sections. */}
          <div className="hidden overflow-x-auto rounded-lg border border-app-border md:block">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                {columns.map((col) => (
                  <col key={col.key} style={colWidth(col)} />
                ))}
              </colgroup>
              <thead className="border-b border-app-border bg-app-elevated">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-3 py-1.5 font-medium text-app-fg-muted ${
                        col.key === 'select' ? 'text-left' : col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              {branchGroups.map((group) => {
                const open = expandedBranches.has(group.key);
                const allInGroupSelected = group.rows.every((r) => selected.has(r.staffId));
                const totals = branchTotals(group.rows);
                // Show a branch-totals cell in the P/A/O/S summary column
                // (daily/weekly). Monthly has per-status columns instead.
                const showTotals = viewMode !== 'monthly';
                // Trailing cells after the label: [totals?][view (always)]. Label
                // spans everything between the leading checkbox and those cells.
                const labelSpan = columns.length - (canManage ? 1 : 0) - (showTotals ? 1 : 0) - 1;
                return (
                  <tbody key={group.key} className="border-b border-app-border last:border-b-0">
                    <tr className="border-y border-app-border bg-app-hover/80 dark:bg-app-hover/60">
                      {/* Leading checkbox cell aligned to the select column. */}
                      {canManage && (
                        <td className="px-3 py-1.5 text-left align-middle">
                          <input
                            type="checkbox"
                            checked={allInGroupSelected}
                            onChange={(e) => selectBranch(group.rows, e.target.checked)}
                            aria-label={`Select all in ${group.name}`}
                            className="h-4 w-4 align-middle"
                          />
                        </td>
                      )}
                      <td colSpan={Math.max(1, labelSpan)} className="px-3 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleBranch(group.key)}
                          className="flex w-full items-center gap-2 text-left"
                          aria-expanded={open}
                        >
                          <svg
                            className={`h-4 w-4 shrink-0 text-brand-600 transition-transform dark:text-brand-400 ${open ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="text-sm font-semibold text-app-fg">{group.name}</span>
                          <span className="rounded-full bg-app-elevated px-1.5 py-0.5 text-xs font-medium text-app-fg-muted">{group.rows.length}</span>
                        </button>
                      </td>
                      {/* Branch totals in the trailing summary column (daily/weekly). */}
                      {showTotals && (
                        <td className="px-3 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-1 text-xs font-medium tabular-nums">
                            <span className="text-green-600 dark:text-green-400" title="Present">{totals.present}</span>
                            <span className="text-app-fg-muted">/</span>
                            <span className="font-semibold text-red-600 dark:text-red-400" title="Absent">{totals.absent}</span>
                            <span className="text-app-fg-muted">/</span>
                            <span className="text-amber-600 dark:text-amber-400" title="Off duty">{totals.offDuty}</span>
                            <span className="text-app-fg-muted">/</span>
                            <span className="text-blue-600 dark:text-blue-400" title="Sick">{totals.sick}</span>
                          </div>
                        </td>
                      )}
                      {/* Empty cell under the trailing View column. */}
                      <td className="px-3 py-1.5" />
                    </tr>
                    {open &&
                      group.rows.map((row, i) => (
                        <tr key={row.staffId} className="border-t border-app-border/60">
                          {columns.map((col) => (
                            <td
                              key={col.key}
                              className={`px-3 py-0.5 ${
                                col.key === 'select' ? 'text-left align-middle' : col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : 'text-left'
                              }`}
                            >
                              {col.render(row, i)}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                );
              })}
            </table>
          </div>

          {/* Mobile: accordion of branch sections with staff cards. */}
          <div className="space-y-3 md:hidden">
            {branchGroups.map((group) => {
              const open = expandedBranches.has(group.key);
              return (
                <div key={group.key} className="overflow-hidden rounded-lg border border-app-border">
                  <button
                    type="button"
                    onClick={() => toggleBranch(group.key)}
                    className="flex w-full items-center gap-2 bg-app-hover/80 px-3 py-1.5 text-left dark:bg-app-hover/60"
                    aria-expanded={open}
                  >
                    <svg
                      className={`h-4 w-4 shrink-0 text-brand-600 transition-transform dark:text-brand-400 ${open ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-semibold text-app-fg">{group.name}</span>
                    <span className="rounded-full bg-app-elevated px-1.5 py-0.5 text-xs font-medium text-app-fg-muted">{group.rows.length}</span>
                  </button>
                  {open && (
                    <div className="divide-y divide-app-border/60">
                      {group.rows.map((row) => (
                        <div key={row.staffId} className="p-3">
                          {renderStaffCard(row)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Single mark-cell modal */}
      <Modal open={!!editing} onClose={() => { if (markFetcher.state !== 'idle') return; setEditing(null); }} maxWidth="max-w-sm">
        {editing && (
          <markFetcher.Form method="post" className="space-y-5 p-5 sm:p-6">
            <input type="hidden" name="intent" value="markAttendance" />
            <input type="hidden" name="staffId" value={editing.row.staffId} />
            <input type="hidden" name="attendanceDate" value={editing.date} />
            <div>
              <h2 className="text-base font-semibold text-app-fg">{editing.row.name}</h2>
              <p className="text-sm text-app-fg-muted">{editing.date}</p>
            </div>
            <StatusRadioGroup value={editing.current} onChange={(s) => setEditing((prev) => (prev ? { ...prev, current: s } : prev))} />
            <RemarkInput defaultValue={editing.row.exceptions[editing.date]?.remark ?? ''} />
            {markFetcher.data?.error && <p className="text-sm text-red-600">{markFetcher.data.error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={() => setEditing(null)} disabled={markFetcher.state !== 'idle'}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={markFetcher.state !== 'idle'}>
                {markFetcher.state !== 'idle' ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </markFetcher.Form>
        )}
      </Modal>

      {/* Bulk mark modal */}
      <Modal open={bulkOpen} onClose={() => { if (bulkFetcher.state !== 'idle') return; setBulkOpen(false); }} maxWidth="max-w-sm">
        <BulkMarkForm
          fetcher={bulkFetcher}
          count={selected.size}
          staffIds={[...selected]}
          month={month}
          maxDay={grid?.days ?? 31}
          onCancel={() => setBulkOpen(false)}
        />
      </Modal>

      {/* Week picker modal */}
      <Modal open={weekPickerOpen} onClose={() => setWeekPickerOpen(false)} maxWidth="max-w-sm">
        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <h2 className="text-base font-semibold text-app-fg">Jump to week</h2>
            <p className="text-sm text-app-fg-muted">{monthLabel(month)}</p>
          </div>
          <div className="space-y-1.5">
            {weeks.map((wdays, idx) => {
              const active = idx === safeWeekIndex;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => { setWeekIndex(idx); setWeekPickerOpen(false); }}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition ${
                    active ? 'border-brand-400 bg-brand-50 dark:bg-brand-950/30' : 'border-app-border hover:bg-app-muted'
                  }`}
                >
                  <span className="font-medium text-app-fg">Week {idx + 1}</span>
                  <span className="text-xs text-app-fg-muted">
                    {weekRangeLabel(month, wdays)} {monthLabel(month).split(' ')[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* Day picker modal (daily view) */}
      <Modal open={dayPickerOpen} onClose={() => setDayPickerOpen(false)} maxWidth="max-w-sm">
        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <h2 className="text-base font-semibold text-app-fg">Jump to day</h2>
            <p className="text-sm text-app-fg-muted">{monthLabel(month)}</p>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: daysInMonthOf(month) }, (_, i) => i + 1).map((d) => {
              const active = d === selectedDay;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => { setSelectedDay(d); setDayPickerOpen(false); }}
                  className={`flex h-9 items-center justify-center rounded-lg border text-sm transition ${
                    active ? 'border-brand-400 bg-brand-50 font-semibold text-app-fg dark:bg-brand-950/30' : 'border-app-border text-app-fg-muted hover:bg-app-muted'
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function StatusRadioGroup({ value, onChange }: { value: CellStatus; onChange: (s: AttendanceStatus) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-app-fg">Status</legend>
      <div className="grid grid-cols-2 gap-2">
        {MARK_CYCLE.map((s) => {
          const active = value === s;
          return (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                active ? `${STATUS_THEME[s].cell} border-transparent ring-2 ring-brand-400` : 'border-app-border text-app-fg hover:bg-app-muted'
              }`}
            >
              <input type="radio" name="status" value={s} checked={active} onChange={() => onChange(s)} className="sr-only" />
              <span className={`h-3.5 w-3.5 rounded-full ${STATUS_THEME[s].dot}`} />
              <span className="font-medium">{STATUS_LABEL[s]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function RemarkInput({ defaultValue }: { defaultValue: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-app-fg" htmlFor="remark">Remark (optional)</label>
      <input
        id="remark"
        name="remark"
        type="text"
        maxLength={500}
        defaultValue={defaultValue}
        placeholder="e.g. approved leave"
        className="w-full rounded-md border border-app-border px-3 py-2 text-sm dark:bg-gray-900"
      />
    </div>
  );
}

function BulkMarkForm({
  fetcher,
  count,
  staffIds,
  month,
  maxDay,
  onCancel,
}: {
  fetcher: ReturnType<typeof useFetcher<{ success?: boolean; error?: string }>>;
  count: number;
  staffIds: string[];
  month: string;
  maxDay: number;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<AttendanceStatus>('PRESENT');
  const [day, setDay] = useState<number>(1);
  const date = `${month}-${String(day).padStart(2, '0')}`;

  return (
    <fetcher.Form method="post" className="space-y-5 p-5 sm:p-6">
      <input type="hidden" name="intent" value="markAttendanceBulk" />
      <input type="hidden" name="staffIds" value={staffIds.join(',')} />
      <input type="hidden" name="attendanceDate" value={date} />
      <div>
        <h2 className="text-base font-semibold text-app-fg">Bulk mark attendance</h2>
        <p className="text-sm text-app-fg-muted">{count} staff selected</p>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-app-fg" htmlFor="bulk-day">Day of {month}</label>
        <select
          id="bulk-day"
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
          className="w-full rounded-md border border-app-border px-3 py-2 text-sm dark:bg-gray-900"
        >
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{date.slice(0, 8)}{String(d).padStart(2, '0')}</option>
          ))}
        </select>
      </div>
      <StatusRadioGroup value={status} onChange={setStatus} />
      <RemarkInput defaultValue="" />
      {fetcher.data?.error && <p className="text-sm text-red-600">{fetcher.data.error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={onCancel} disabled={fetcher.state !== 'idle'}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={fetcher.state !== 'idle'}>
          {fetcher.state !== 'idle' ? 'Applying…' : `Apply to ${count}`}
        </Button>
      </div>
    </fetcher.Form>
  );
}
