import { useMemo, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import {
  type AttendanceGridData,
  type AttendanceGridRow,
  type AttendanceStatus,
  type PayRoleConfigRow,
  STATUS_LETTER,
  STATUS_LABEL,
  STATUS_CYCLE,
} from './attendance-types';
import { AttendanceConfigModal } from './AttendanceConfigModal';

interface Props {
  grid: AttendanceGridData | null;
  payRoles: PayRoleConfigRow[];
  canManage: boolean;
  month: string; // YYYY-MM
  search: string;
}

/** Cell tone by status — Present is muted, exceptions stand out. */
function cellClasses(status: AttendanceStatus, atRisk: boolean): string {
  switch (status) {
    case 'ABSENT':
      return atRisk
        ? 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300 font-semibold'
        : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300';
    case 'OFF_DUTY':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300';
    case 'SICK':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300';
    default:
      return 'text-gray-300 dark:text-gray-600';
  }
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

export function AttendancePage({ grid, payRoles, canManage, month, search }: Props) {
  const [, setSearchParams] = useSearchParams();
  const markFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [configOpen, setConfigOpen] = useState(false);
  const [editing, setEditing] = useState<{
    row: AttendanceGridRow;
    date: string;
    current: AttendanceStatus;
  } | null>(null);

  useFetcherToast(markFetcher.data, { successMessage: 'Attendance updated' });
  useCloseOnFetcherSuccess(markFetcher, () => setEditing(null), { intent: 'markAttendance' });

  const days = grid?.days ?? 0;
  const dayList = useMemo(() => Array.from({ length: days }, (_, i) => i + 1), [days]);

  function setMonth(next: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('month', next);
      return p;
    });
  }

  function onSearch(value: string) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (value) p.set('search', value);
      else p.delete('search');
      return p;
    });
  }

  function statusFor(row: AttendanceGridRow, day: number): AttendanceStatus {
    const key = `${month}-${String(day).padStart(2, '0')}`;
    return row.exceptions[key]?.status ?? 'PRESENT';
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        description="Mark daily attendance. Days default to Present: set only the exceptions. Only absences affect pay."
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
            {canManage && (
              <TableActionButton variant="primary" onClick={() => setConfigOpen(true)}>
                Pay rules
              </TableActionButton>
            )}
          </div>
        }
      >
        <div className="w-full sm:max-w-xs">
          <SearchInput
            defaultValue={search}
            placeholder="Search staff"
            onChange={onSearch}
            debounceMs={350}
          />
        </div>
      </PageHeader>

      {!grid || grid.staff.length === 0 ? (
        <EmptyState
          title="No staff to show"
          description="No payroll staff match this month or search."
          variant="card"
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="min-w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="sticky left-0 z-20 min-w-[11rem] bg-gray-50 px-3 py-2 text-left font-medium dark:bg-gray-900">
                  Staff
                </th>
                {dayList.map((d) => (
                  <th key={d} className="w-8 px-0 py-2 text-center font-normal text-gray-500">
                    {d}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-medium">P</th>
                <th className="px-3 py-2 text-center font-medium">A</th>
                <th className="px-3 py-2 text-center font-medium">O</th>
                <th className="px-3 py-2 text-center font-medium">S</th>
                <th className="px-3 py-2 text-center font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {grid.staff.map((row) => (
                <tr key={row.staffId} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="sticky left-0 z-10 min-w-[11rem] bg-white px-3 py-2 dark:bg-gray-950">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{row.name}</span>
                      {row.baseAtRisk && (
                        <StatusBadge
                          status="At risk"
                          variant="danger"
                          size="sm"
                          pill
                          label={`-${row.deductionPercent}% base`}
                        />
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{row.role.replaceAll('_', ' ')}</div>
                  </td>
                  {dayList.map((d) => {
                    const status = statusFor(row, d);
                    const date = `${month}-${String(d).padStart(2, '0')}`;
                    return (
                      <td key={d} className="p-0 text-center">
                        <button
                          type="button"
                          disabled={!canManage}
                          onClick={() => setEditing({ row, date, current: status })}
                          title={`${row.name} — ${date}: ${STATUS_LABEL[status]}`}
                          className={`h-8 w-8 text-xs ${cellClasses(status, row.baseAtRisk)} ${
                            canManage ? 'cursor-pointer hover:ring-2 hover:ring-brand-400' : 'cursor-default'
                          }`}
                        >
                          {STATUS_LETTER[status]}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center tabular-nums">{row.summary.present}</td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums text-red-600 dark:text-red-400">
                    {row.summary.absent}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{row.summary.offDuty}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{row.summary.sick}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{row.summary.attendancePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mark-cell modal */}
      <Modal
        open={!!editing}
        onClose={() => {
          if (markFetcher.state !== 'idle') return;
          setEditing(null);
        }}
        maxWidth="max-w-sm"
      >
        {editing && (
          <markFetcher.Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="markAttendance" />
            <input type="hidden" name="staffId" value={editing.row.staffId} />
            <input type="hidden" name="attendanceDate" value={editing.date} />
            <div>
              <h2 className="text-base font-semibold">{editing.row.name}</h2>
              <p className="text-sm text-gray-500">{editing.date}</p>
            </div>
            <FormSelect
              label="Status"
              name="status"
              defaultValue={editing.current}
              options={STATUS_CYCLE.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            />
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="remark">
                Remark (optional)
              </label>
              <input
                id="remark"
                name="remark"
                type="text"
                maxLength={500}
                defaultValue={editing.row.exceptions[editing.date]?.remark ?? ''}
                placeholder="e.g. approved leave"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
              />
            </div>
            {markFetcher.data?.error && (
              <p className="text-sm text-red-600">{markFetcher.data.error}</p>
            )}
            <div className="flex justify-end gap-2">
              <TableActionButton
                variant="neutral"
                type="button"
                onClick={() => setEditing(null)}
                disabled={markFetcher.state !== 'idle'}
              >
                Cancel
              </TableActionButton>
              <TableActionButton variant="primary" type="submit" disabled={markFetcher.state !== 'idle'}>
                {markFetcher.state !== 'idle' ? 'Saving…' : 'Save'}
              </TableActionButton>
            </div>
          </markFetcher.Form>
        )}
      </Modal>

      {canManage && (
        <AttendanceConfigModal open={configOpen} onClose={() => setConfigOpen(false)} payRoles={payRoles} />
      )}
    </div>
  );
}
