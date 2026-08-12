import { useCallback, useMemo, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Modal } from '~/components/ui/modal';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { RoleBadge } from '~/components/ui/role-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TableActionButton } from '~/components/ui/table-action-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
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

export function AttendancePage({ grid, canManage, month, search, branchId, role, statuses }: Props) {
  const [, setSearchParams] = useSearchParams();
  const markFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const bulkFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [viewMode, setViewMode] = useState<ViewMode>('weekly');
  const [weekIndex, setWeekIndex] = useState(0);
  const [selectedDay, setSelectedDay] = useState<number>(() => defaultDayForMonth(month));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<{ row: AttendanceGridRow; date: string; current: CellStatus } | null>(null);

  useFetcherToast(markFetcher.data, { successMessage: 'Attendance updated' });
  useFetcherToast(bulkFetcher.data, { successMessage: 'Attendance updated for selected staff' });
  useCloseOnFetcherSuccess(markFetcher, () => setEditing(null), { intent: 'markAttendance' });
  useCloseOnFetcherSuccess(bulkFetcher, () => {
    setBulkOpen(false);
    setSelected(new Set());
  }, { intent: 'markAttendanceBulk' });

  const { y, m } = parseMonth(month);
  const weeks = useMemo(() => weeksOfMonth(y, m), [y, m]);
  const safeWeekIndex = Math.min(weekIndex, Math.max(0, weeks.length - 1));
  const weekDays = weeks[safeWeekIndex] ?? [];

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

  const statusSet = useMemo(() => new Set(statuses), [statuses]);
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

  const statusFilterChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {MARK_CYCLE.map((s) => {
        const active = statusSet.has(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => toggleStatusFilter(s)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
              active ? `${STATUS_THEME[s].cell} border-transparent` : 'border-app-border text-app-fg-muted hover:bg-app-muted'
            }`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_THEME[s].dot}`} />
            {STATUS_LABEL[s]}
          </button>
        );
      })}
    </div>
  );

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

  // ── Table columns ────────────────────────────────────────────
  const columns: CompactTableColumn<AttendanceGridRow>[] = useMemo(() => {
    const cols: CompactTableColumn<AttendanceGridRow>[] = [];

    if (canManage) {
      cols.push({
        key: 'select',
        header: (
          <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" className="h-4 w-4" />
        ),
        align: 'center',
        tight: true,
        hideOnMobile: true,
        render: (row) => (
          <input
            type="checkbox"
            checked={selected.has(row.staffId)}
            onChange={() => toggleOne(row.staffId)}
            aria-label={`Select ${row.name}`}
            className="h-4 w-4"
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

    const dayCols: CompactTableColumn<AttendanceGridRow>[] = weekDays.map((d, slot) => ({
      key: `d${slot}`,
      header: (
        <div className="flex flex-col items-center leading-tight">
          <span className="text-[0.6rem] font-normal text-app-fg-muted">{WEEKDAY_HEADERS[slot]}</span>
          <span>{d ?? ''}</span>
        </div>
      ),
      align: 'center',
      tight: true,
      hideOnMobile: true,
      render: (row) => {
        if (d == null) return <span className="text-app-fg-muted/20">·</span>;
        const status = statusFor(row, d);
        const date = dateFor(d);
        const isBlank = status === 'NONE';
        return (
          <button
            type="button"
            disabled={!canManage}
            onClick={() => setEditing({ row, date, current: status })}
            title={`${row.name} — ${date}: ${STATUS_LABEL[status]}`}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold ${STATUS_THEME[status].cell} ${
              canManage ? 'cursor-pointer' : 'cursor-default'
            } ${!isBlank && canManage ? 'hover:ring-2 hover:ring-brand-400' : ''}`}
          >
            {STATUS_LETTER[status]}
          </button>
        );
      },
    }));

    cols.push(...dayCols, {
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

    return cols;
  }, [weekDays, month, canManage, selected, allSelected, staff]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        description="Mark attendance week by week. Unmarked days are blank: set Present, Absent, Off duty, or Sick. Only absences affect pay."
        mobileInlineActions
        actions={
          <div className="flex items-center gap-2">
            <TableActionButton variant="neutral" onClick={() => setMonth(shiftMonth(month, -1))}>‹</TableActionButton>
            <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel(month)}</span>
            <TableActionButton variant="neutral" onClick={() => setMonth(shiftMonth(month, 1))}>›</TableActionButton>
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
                  {statusFilterChips}
                </div>
              </>
            }
          />
          <div className="hidden sm:flex sm:items-center sm:gap-2">
            <span className="text-xs text-app-fg-muted">Has status:</span>
            {statusFilterChips}
          </div>
        </div>
      </PageHeader>

      {/* Week navigator + legend */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TableActionButton variant="neutral" onClick={() => setWeekIndex((i) => Math.max(0, i - 1))} disabled={safeWeekIndex === 0}>
            ‹ Prev week
          </TableActionButton>
          <span className="text-sm font-medium">Week {safeWeekIndex + 1} of {weeks.length}</span>
          <TableActionButton variant="neutral" onClick={() => setWeekIndex((i) => Math.min(weeks.length - 1, i + 1))} disabled={safeWeekIndex >= weeks.length - 1}>
            Next week ›
          </TableActionButton>
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
          <TableActionButton variant="primary" onClick={() => setBulkOpen(true)}>Bulk mark</TableActionButton>
          <TableActionButton variant="neutral" onClick={() => setSelected(new Set())}>Clear</TableActionButton>
        </div>
      )}

      {staff.length === 0 ? (
        <EmptyState title="No staff to show" description="No payroll staff match these filters for this month." variant="card" />
      ) : (
        <CompactTable<AttendanceGridRow>
          columns={columns}
          rows={staff}
          rowKey={(row) => row.staffId}
          renderMobileCard={(row) => (
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
                  <span className="font-medium text-app-fg">{row.name}</span>
                </div>
                {row.baseAtRisk && <StatusBadge status="At risk" variant="danger" size="sm" pill label={`-${row.deductionPercent}%`} />}
              </div>
              <RoleBadge role={row.role} size="sm" />
              <div className="flex flex-wrap gap-1">
                {weekDays.map((d, slot) =>
                  d == null ? null : (
                    <button
                      key={slot}
                      type="button"
                      disabled={!canManage}
                      onClick={() => setEditing({ row, date: dateFor(d), current: statusFor(row, d) })}
                      title={`${dateFor(d)}: ${STATUS_LABEL[statusFor(row, d)]}`}
                      className={`flex h-9 w-9 flex-col items-center justify-center rounded text-[0.65rem] ${STATUS_THEME[statusFor(row, d)].cell} ${canManage ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <span>{d}</span>
                      <span className="font-medium">{STATUS_LETTER[statusFor(row, d)]}</span>
                    </button>
                  ),
                )}
              </div>
              <div className="flex gap-2 text-xs text-app-fg-muted">
                <span className="text-green-600 dark:text-green-400">{row.summary.present}P</span>
                <span className="font-semibold text-red-600 dark:text-red-400">{row.summary.absent}A</span>
                <span className="text-amber-600 dark:text-amber-400">{row.summary.offDuty}O</span>
                <span className="text-blue-600 dark:text-blue-400">{row.summary.sick}S</span>
              </div>
            </div>
          )}
        />
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
              <TableActionButton variant="neutral" type="button" onClick={() => setEditing(null)} disabled={markFetcher.state !== 'idle'}>Cancel</TableActionButton>
              <TableActionButton variant="primary" type="submit" disabled={markFetcher.state !== 'idle'}>
                {markFetcher.state !== 'idle' ? 'Saving…' : 'Save'}
              </TableActionButton>
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
        <TableActionButton variant="neutral" type="button" onClick={onCancel} disabled={fetcher.state !== 'idle'}>Cancel</TableActionButton>
        <TableActionButton variant="primary" type="submit" disabled={fetcher.state !== 'idle'}>
          {fetcher.state !== 'idle' ? 'Applying…' : `Apply to ${count}`}
        </TableActionButton>
      </div>
    </fetcher.Form>
  );
}
