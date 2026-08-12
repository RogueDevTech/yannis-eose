import { useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { TableActionButton } from '~/components/ui/table-action-button';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { useFetcherToast } from '~/components/ui/toast';
import type { AbsenceBand, PayRoleConfigRow } from './attendance-types';

interface Props {
  payRoles: PayRoleConfigRow[];
}

const DEFAULT_BANDS: AbsenceBand[] = [
  { minAbsences: 0, deductionPercent: 0 },
  { minAbsences: 4, deductionPercent: 50 },
  { minAbsences: 7, deductionPercent: 100 },
];

export function AttendanceConfigPage({ payRoles }: Props) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance rules"
        description="Set how absences reduce base salary, per pay role. Only absences count: off duty and sick leave never affect pay."
        backTo="/hr/attendance"
      />
      {payRoles.length === 0 ? (
        <EmptyState title="No pay roles" description="Create pay roles in Payroll Config first." variant="card" />
      ) : (
        <div className="space-y-3">
          {payRoles.map((role) => (
            <RoleConfigCard key={role.id} role={role} />
          ))}
        </div>
      )}
    </div>
  );
}

function RoleConfigCard({ role }: { role: PayRoleConfigRow }) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [enabled, setEnabled] = useState<boolean>(role.attendanceConfig?.enabled ?? false);
  const [bands, setBands] = useState<AbsenceBand[]>(
    role.attendanceConfig?.bands?.length ? role.attendanceConfig.bands : DEFAULT_BANDS,
  );

  useFetcherToast(fetcher.data, { successMessage: `${role.name} rules saved` });

  const sortedBands = [...bands].sort((a, b) => a.minAbsences - b.minAbsences);

  function updateBand(i: number, patch: Partial<AbsenceBand>) {
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  return (
    <div className="card p-4">
      <fetcher.Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="savePayRoleAttendanceConfig" />
        <input type="hidden" name="payRoleId" value={role.id} />
        <input type="hidden" name="enabled" value={String(enabled)} />
        <input type="hidden" name="bandsJson" value={JSON.stringify(sortedBands)} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-app-fg">{role.name}</h3>
            {enabled ? (
              <StatusBadge status="On" variant="success" size="sm" pill label="Attendance affects pay" />
            ) : (
              <StatusBadge status="Off" variant="neutral" size="sm" pill label="Not affected" />
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            Attendance affects pay
          </label>
        </div>

        {enabled && (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-app-fg-muted">
              <span>Absences (at least)</span>
              <span>Deduct % of base</span>
              <span />
            </div>
            {bands.map((band, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={band.minAbsences}
                  onChange={(e) => updateBand(i, { minAbsences: Number(e.target.value) })}
                  className="rounded-md border border-app-border px-2 py-1.5 text-sm dark:bg-gray-900"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={band.deductionPercent}
                  onChange={(e) => updateBand(i, { deductionPercent: Number(e.target.value) })}
                  className="rounded-md border border-app-border px-2 py-1.5 text-sm dark:bg-gray-900"
                />
                <TableActionButton
                  variant="danger"
                  type="button"
                  onClick={() => setBands((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  Remove
                </TableActionButton>
              </div>
            ))}
            <TableActionButton
              variant="neutral"
              type="button"
              onClick={() => setBands((prev) => [...prev, { minAbsences: 0, deductionPercent: 0 }])}
            >
              + Add band
            </TableActionButton>
            <p className="text-xs text-app-fg-muted">
              Example: 0 to 3 absences deduct 0%, 4 to 6 deduct 50%, 7 or more deduct 100%. PAYE follows the reduced base.
            </p>
          </div>
        )}

        {fetcher.data?.error && <p className="text-sm text-red-600">{fetcher.data.error}</p>}

        <div className="flex justify-end">
          <TableActionButton variant="primary" type="submit" disabled={fetcher.state !== 'idle'}>
            {fetcher.state !== 'idle' ? 'Saving…' : 'Save'}
          </TableActionButton>
        </div>
      </fetcher.Form>
    </div>
  );
}
