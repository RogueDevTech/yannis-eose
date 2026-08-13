import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useFetcher, useLocation, useRevalidator, useSearchParams } from '@remix-run/react';
import { invalidateCachedLoader } from '~/lib/loader-cache';
import { PageHeader } from '~/components/ui/page-header';
import { Modal } from '~/components/ui/modal';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { TextInput } from '~/components/ui/text-input';
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
import type { AttendancePolicyInput } from '@yannis/shared';
import {
  type AttendanceGridData,
  type AttendanceGridRow,
  type AttendanceStatus,
  type CellStatus,
  type WeekCell,
  STATUS_LETTER,
  STATUS_LABEL,
  STATUS_THEME,
  MARK_CYCLE,
  weeksOfMonth,
  WEEKDAY_HEADERS,
  WEEKDAY_INDEX,
} from './attendance-types';

interface Props {
  grid: AttendanceGridData | null;
  policy: AttendancePolicyInput;
  canManage: boolean;
  /** HR/admin only — gates the Configure button (attendance policy). Branch admins: false. */
  canConfigure: boolean;
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

type ViewMode = 'daily' | 'weekly';
const VIEW_MODES: Array<{ value: ViewMode; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

/** Index of the week (in weeksOfMonth) that contains a given day-of-month. */
function weekIndexOfDay(weeks: Array<Array<{ day: number; inMonth: boolean }>>, day: number): number {
  const idx = weeks.findIndex((w) => w.some((c) => c.inMonth && c.day === day));
  return idx >= 0 ? idx : 0;
}

/** Today's day-of-month if the viewed month is the current one; else 1. */
function defaultDayForMonth(month: string): number {
  const now = new Date();
  const nowMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return month === nowMonth ? now.getDate() : 1;
}

/**
 * The daily view's selected day. Prefer TODAY: the daily view should land on
 * today whenever today is inside the viewed month, even when the date filter
 * spans the whole month (e.g. the "This month" preset sets startDate to the 1st).
 * Only honour the filter's day when a SINGLE day was explicitly picked
 * (start === end) within the viewed month. Otherwise fall back to today/1st.
 */
function dayFromStartDate(startDate: string, endDate: string, month: string): number {
  const isSingleDay =
    /^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate === endDate && startDate.slice(0, 7) === month;
  if (isSingleDay) return Number(startDate.slice(8, 10));
  return defaultDayForMonth(month);
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

/** Short marked-at time in Nigeria time, e.g. "9:14 AM". Empty when null. */
function markedTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos',
  });
}

/**
 * Fixed column widths for the branch-grouped table (table-fixed). Keeping widths
 * fixed means expanding/collapsing a branch never reflows the shared header.
 * Staff is the flexible column (no width → absorbs remaining space).
 */
function colWidth(col: CompactTableColumn<AttendanceGridRow>): CSSProperties {
  if (col.key === 'select') return { width: '2.5rem' };
  // Layout: Staff (fixed) + Role hug the LEFT; the day column(s) + P/A/O/S
  // summary hug the RIGHT. Role FLEXES (its badge stays left-aligned next to
  // Staff and the empty space absorbs the middle gap), so the day column stays
  // adjacent to the summary instead of being pushed apart.
  if (col.key === 'staff') return { width: '16rem' };
  if (col.key === 'role') return {}; // flexes → absorbs the middle gap
  if (col.key === 'view') return { width: '5rem' };
  if (col.key === 'summary') return { width: '7rem' };
  // Daily 'today' column: fixed so it sits right next to the summary.
  if (col.key === 'today') return { width: '6rem' };
  // Weekly day cells: fixed each so the week block hugs the summary.
  if (col.key.startsWith('d')) return { width: '3rem' };
  // monthly count columns (p/a/o/s/pct)
  return { width: '5.5rem' };
}

/** "6 – 12" style label for a week's first/last real day. */
function weekRangeLabel(_month: string, weekDays: WeekCell[]): string {
  const real = weekDays.filter((c) => c.inMonth).map((c) => c.day);
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

export function AttendancePage({ grid, policy, canManage, canConfigure, month, startDate, endDate, search, branchId, role, statuses }: Props) {
  const [, setSearchParams] = useSearchParams();
  const markFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const bulkFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [weekIndex, setWeekIndex] = useState(0);
  const [weekPickerOpen, setWeekPickerOpen] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  // The daily view's selected day is DERIVED from the global date filter
  // (startDate) so the "Thu 13" picker and the DateFilterBar stay in sync. When
  // startDate lands outside the viewed month we fall back to today/1.
  const selectedDay = dayFromStartDate(startDate, endDate, month);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<{ row: AttendanceGridRow; date: string; current: CellStatus } | null>(null);
  // Shown when a locked / non-work day is tapped: a modal explaining why it can't
  // be marked (instead of a transient toast).
  const [lockNotice, setLockNotice] = useState<string | null>(null);

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

  // Pick a day in the daily view → drive the GLOBAL date filter (single-day
  // range) so the DateFilterBar and the "Thu 13" picker stay in sync.
  const selectDay = useCallback(
    (day: number) => {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('startDate', date);
          next.set('endDate', date);
          return next;
        },
        { replace: true },
      );
    },
    [month, setSearchParams],
  );

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
  // the collapsible filters sheet and the desktop inline row: each instance owns
  // its own open state / outside-click ref so the two never fight over one popover.
  function StatusFilterDropdown({ fullWidth = false }: { fullWidth?: boolean }) {
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

    const optionList = (
      <>
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
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? 'border-transparent bg-info-600 text-white' : 'border-app-border'}`}>
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
      </>
    );

    // In the filters sheet, render the options INLINE (no popover): a popover
    // there gets clipped by the sheet's scroll container / hidden under it.
    if (fullWidth) {
      return (
        <div className="w-full overflow-hidden rounded-lg border border-app-border">
          {optionList}
        </div>
      );
    }

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
            className="absolute left-0 z-[100] mt-1 w-full min-w-[12rem] overflow-hidden rounded-lg border border-app-border bg-app-elevated shadow-lg"
          >
            {optionList}
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

  // ── Policy: work days + locking ──────────────────────────────
  // Mirror the server's assertDateEditable so the UI disables cells that a save
  // would reject. Non-work weekdays are always non-editable + greyed.
  const nowLagos = useMemo(() => {
    const now = new Date();
    const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    return { today: d, hhmm: t };
  }, []);
  const workDaySet = useMemo(() => new Set(policy.workDays), [policy.workDays]);
  function weekdayOf(date: string): number {
    const parts = date.split('-');
    const yy = Number(parts[0]);
    const mm = Number(parts[1]);
    const dd = Number(parts[2]);
    return new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay(); // 0=Sun..6=Sat
  }
  function isWorkDay(date: string): boolean {
    return workDaySet.has(weekdayOf(date));
  }
  /** True when a save to `date` would be rejected by the policy (non-work / locked). */
  function isLocked(date: string): boolean {
    if (!isWorkDay(date)) return true;
    if (policy.lockPreviousDays && date < nowLagos.today) return true;
    if (policy.autoAbsentEnabled && date === nowLagos.today && nowLagos.hhmm >= policy.autoAbsentCutoff) return true;
    if (date > nowLagos.today) return true; // can't mark the future
    return false;
  }
  /** Specific reason a cell can't be marked (for the click-explainer toast). Empty = editable. */
  function lockReasonFor(date: string): string {
    if (!isWorkDay(date)) return 'This is not a work day. Adjust work days in Attendance rules.';
    if (date > nowLagos.today) return 'You cannot mark attendance for a future date.';
    if (policy.lockPreviousDays && date < nowLagos.today) {
      return 'Previous days are locked. Turn off "Lock previous days" in Attendance rules to edit past days.';
    }
    if (policy.autoAbsentEnabled && date === nowLagos.today && nowLagos.hhmm >= policy.autoAbsentCutoff) {
      return `Today is locked after the ${policy.autoAbsentCutoff} cutoff.`;
    }
    return '';
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

  // All branch accordions start COLLAPSED — the user expands the branch they
  // want. (Previously the first group auto-expanded on load.)
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());
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

  // Mobile card = a peek. The whole card is tappable: in DAILY it opens the mark
  // modal for the selected day; in WEEKLY it opens the staff's full record (where
  // any day can be marked). No checkbox — bulk selection stays desktop-only.
  const renderStaffCard = (row: AttendanceGridRow) => {
    const dayStatus = statusFor(row, selectedDay);
    const openPeek = () => {
      if (viewMode === 'daily') {
        setEditing({ row, date: dateFor(selectedDay), current: dayStatus });
      }
    };
    const content = (
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-app-fg">{row.name}</span>
            {row.baseAtRisk && <StatusBadge status="At risk" variant="danger" size="sm" pill label={`-${row.deductionPercent}%`} />}
          </div>
          <div className="mt-1">
            <RoleBadge role={row.role} size="sm" />
          </div>
        </div>
        {/* Right: the selected day's status pill (daily). */}
        {viewMode === 'daily' && (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_THEME[dayStatus].cell}`}>
            <span className={`h-2 w-2 rounded-full ${STATUS_THEME[dayStatus].dot}`} />
            {STATUS_LABEL[dayStatus]}
          </span>
        )}
        <svg className="h-4 w-4 shrink-0 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    );
    return viewMode === 'daily' ? (
      <button type="button" onClick={openPeek} className="w-full text-left">
        {content}
      </button>
    ) : (
      <Link to={`/hr/attendance/${row.staffId}`} className="block">
        {content}
      </Link>
    );
  };

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

    // A tappable day cell (shared by daily + weekly modes). Marked time is NOT
    // shown on the grid cell (kept compact): it lives in the cell-detail modal
    // and the report page. The tooltip still surfaces it on hover.
    const dayCell = (row: AttendanceGridRow, d: number) => {
      const status = statusFor(row, d);
      const date = dateFor(d);
      const isBlank = status === 'NONE';
      const time = markedTime(row.exceptions[date]?.markedAt ?? null);
      const nonWork = !isWorkDay(date);
      const locked = isLocked(date);
      const editable = canManage && !locked;
      const lockReason = lockReasonFor(date);
      // Locked cells stay CLICKABLE (not disabled) so tapping them explains WHY
      // via a modal — a disabled button swallows the click and gives no feedback.
      // Only genuinely non-manageable viewers get a truly disabled cell.
      return (
        <button
          type="button"
          disabled={!canManage}
          onClick={() =>
            editable
              ? setEditing({ row, date, current: status })
              : setLockNotice(lockReason || 'This day is locked.')
          }
          title={`${row.name}, ${date}: ${STATUS_LABEL[status]}${time ? ` (marked ${time})` : ''}${lockReason ? ` (${lockReason})` : ''}`}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold ${STATUS_THEME[status].cell} ${
            editable ? 'cursor-pointer' : 'cursor-help'
          } ${nonWork ? 'opacity-30' : locked ? 'opacity-60' : ''} ${!isBlank && editable ? 'hover:ring-2 hover:ring-brand-400' : ''}`}
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
      // Non-work days (per the policy) are HIDDEN entirely — only work-day columns
      // render. Each surviving column keeps its own weekday label (Mon/Tue/…).
      cols.push(
        ...weekDays
          .map((cell, slot) => ({ cell, slot }))
          .filter(({ slot }) => workDaySet.has(WEEKDAY_INDEX[slot]!))
          .map(({ cell, slot }) => ({
            key: `d${slot}`,
            header: (
              <div className="flex flex-col items-center leading-tight">
                <span className="text-[0.6rem] font-normal text-app-fg-muted">{WEEKDAY_HEADERS[slot]}</span>
                <span className={cell.inMonth ? '' : 'text-app-fg-muted/40'}>{cell.day}</span>
              </div>
            ),
            align: 'center' as const,
            tight: true,
            hideOnMobile: true,
            render: (row: AttendanceGridRow) =>
              cell.inMonth ? (
                dayCell(row, cell.day)
              ) : (
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-xs text-app-fg-muted/40" title="Not in this month">
                  {cell.day}
                </span>
              ),
          })),
      );
    }

    // View action: always the LAST column, as a text link.
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
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateFilterBar startDate={startDate} endDate={endDate} chrome="pill" />
            <Link to={`/hr/attendance/report?startDate=${reportDate}&endDate=${reportDate}`} className="btn-secondary btn-sm">
              Report
            </Link>
            {canConfigure && (
              <Link to="/hr/attendance/config" className="btn-primary btn-sm">
                Configure
              </Link>
            )}
          </div>
        }
      >
        <div className="space-y-2">
          <ToolbarFiltersCollapsible
            className="!border-0 md:!px-0"
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
                  <StatusFilterDropdown fullWidth />
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
                onClick={() => {
                  // Switching to Weekly lands on the week containing the currently
                  // selected day (usually today), not week 1.
                  if (vm.value === 'weekly') setWeekIndex(weekIndexOfDay(weeks, selectedDay));
                  setViewMode(vm.value);
                }}
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
              className={`${CONTROL_HEIGHT_CLASS} inline-flex min-w-[6rem] items-center justify-center gap-2 rounded-lg bg-app-elevated px-4 text-sm font-semibold text-app-fg shadow-sm transition hover:bg-app-muted`}
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
              className={`${CONTROL_HEIGHT_CLASS} inline-flex items-center gap-2 rounded-lg bg-app-elevated px-4 text-sm font-semibold text-app-fg shadow-sm transition hover:bg-app-muted`}
            >
              <span>Week {safeWeekIndex + 1} of {weeks.length}</span>
              <span className="text-xs font-normal text-app-fg-muted">{weekRangeLabel(month, weekDays)}</span>
              <svg className="h-3.5 w-3.5 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
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
                // No summary column any more, so no trailing totals cell. The
                // label spans everything between the leading checkbox and the
                // trailing View column.
                const labelSpan = columns.length - (canManage ? 1 : 0) - 1;
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
                      {/* Trailing cell: right-edge expand/collapse text toggle. */}
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => toggleBranch(group.key)}
                          aria-expanded={open}
                          className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {open ? 'Collapse' : 'Expand'}
                        </button>
                      </td>
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
                  <div className="flex items-center gap-2 bg-app-hover/80 px-3 py-2 dark:bg-app-hover/60">
                    <button
                      type="button"
                      onClick={() => toggleBranch(group.key)}
                      className="flex flex-1 items-center gap-2 text-left"
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
                    {/* Branch month totals: only in weekly/monthly (a daily view is
                        about one day, so month totals would mislead). */}
                    {viewMode !== 'daily' && (() => {
                      const t = branchTotals(group.rows);
                      return (
                        <span className="flex shrink-0 gap-1 text-[0.7rem] tabular-nums">
                          <span className="text-green-600 dark:text-green-400">{t.present}</span>
                          <span className="font-semibold text-red-600 dark:text-red-400">{t.absent}</span>
                          <span className="text-amber-600 dark:text-amber-400">{t.offDuty}</span>
                          <span className="text-blue-600 dark:text-blue-400">{t.sick}</span>
                        </span>
                      );
                    })()}
                  </div>
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
              {(() => {
                const time = markedTime(editing.row.exceptions[editing.date]?.markedAt ?? null);
                return time ? <p className="text-xs text-app-fg-muted">Marked at {time}</p> : null;
              })()}
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

      {/* Locked-day notice modal */}
      <Modal open={!!lockNotice} onClose={() => setLockNotice(null)} maxWidth="max-w-sm">
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </span>
            <div>
              <h2 className="text-base font-semibold text-app-fg">Cannot mark this day</h2>
              <p className="mt-1 text-sm text-app-fg-muted">{lockNotice}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={() => setLockNotice(null)}>Got it</Button>
          </div>
        </div>
      </Modal>

      {/* Bulk mark modal */}
      <Modal open={bulkOpen} onClose={() => { if (bulkFetcher.state !== 'idle') return; setBulkOpen(false); }} maxWidth="max-w-sm">
        <BulkMarkForm
          key={`${bulkOpen}-${selectedDay}`}
          fetcher={bulkFetcher}
          count={selected.size}
          staffIds={[...selected]}
          month={month}
          maxDay={grid?.days ?? 31}
          initialDay={selectedDay}
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
                  onClick={() => { selectDay(d); setDayPickerOpen(false); }}
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
    <TextInput
      label="Remark (optional)"
      id="remark"
      name="remark"
      type="text"
      maxLength={500}
      defaultValue={defaultValue}
      placeholder="e.g. approved leave"
    />
  );
}

function BulkMarkForm({
  fetcher,
  count,
  staffIds,
  month,
  maxDay,
  initialDay,
  onCancel,
}: {
  fetcher: ReturnType<typeof useFetcher<{ success?: boolean; error?: string }>>;
  count: number;
  staffIds: string[];
  month: string;
  maxDay: number;
  /** Default day = the day the page is currently viewing. */
  initialDay: number;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<AttendanceStatus>('PRESENT');
  const [day, setDay] = useState<number>(() => Math.min(Math.max(1, initialDay), maxDay));
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
