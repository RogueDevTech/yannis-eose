import { useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { FormSelect } from '~/components/ui/form-select';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import type { AbsenceBand, PayRoleConfigRow } from './attendance-types';

interface Props {
  open: boolean;
  onClose: () => void;
  payRoles: PayRoleConfigRow[];
}

/** Default band template shown when a role has none configured. */
const DEFAULT_BANDS: AbsenceBand[] = [
  { minAbsences: 0, deductionPercent: 0 },
  { minAbsences: 4, deductionPercent: 50 },
  { minAbsences: 7, deductionPercent: 100 },
];

export function AttendanceConfigModal({ open, onClose, payRoles }: Props) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const [roleId, setRoleId] = useState<string>(payRoles[0]?.id ?? '');

  const selected = useMemo(() => payRoles.find((r) => r.id === roleId) ?? null, [payRoles, roleId]);
  const [enabled, setEnabled] = useState<boolean>(selected?.attendanceConfig?.enabled ?? false);
  const [bands, setBands] = useState<AbsenceBand[]>(
    selected?.attendanceConfig?.bands?.length ? selected.attendanceConfig.bands : DEFAULT_BANDS,
  );

  // Re-seed local state when the selected role changes.
  const [lastRole, setLastRole] = useState(roleId);
  if (roleId !== lastRole) {
    setLastRole(roleId);
    setEnabled(selected?.attendanceConfig?.enabled ?? false);
    setBands(selected?.attendanceConfig?.bands?.length ? selected.attendanceConfig.bands : DEFAULT_BANDS);
  }

  useFetcherToast(fetcher.data, { successMessage: 'Attendance rules saved' });
  useCloseOnFetcherSuccess(fetcher, onClose, { intent: 'savePayRoleAttendanceConfig' });

  function updateBand(i: number, patch: Partial<AbsenceBand>) {
    setBands((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function addBand() {
    setBands((prev) => [...prev, { minAbsences: 0, deductionPercent: 0 }]);
  }
  function removeBand(i: number) {
    setBands((prev) => prev.filter((_, idx) => idx !== i));
  }

  const sortedBands = useMemo(
    () => [...bands].sort((a, b) => a.minAbsences - b.minAbsences),
    [bands],
  );

  return (
    <Modal open={open} onClose={() => (fetcher.state === 'idle' ? onClose() : undefined)} maxWidth="max-w-xl">
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value="savePayRoleAttendanceConfig" />
        <input type="hidden" name="payRoleId" value={roleId} />
        <input type="hidden" name="enabled" value={String(enabled)} />
        <input type="hidden" name="bandsJson" value={JSON.stringify(sortedBands)} />

        <div>
          <h2 className="text-base font-semibold">Attendance pay rules</h2>
          <p className="text-sm text-gray-500">
            Set how absences reduce base salary, per pay role. Only absences count. Off duty and sick
            leave never affect pay.
          </p>
        </div>

        <FormSelect
          label="Pay role"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          options={payRoles.map((r) => ({ value: r.id, label: r.name }))}
          placeholder="Select a pay role"
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          Attendance affects pay for this role
        </label>

        {enabled && (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-gray-500">
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
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={band.deductionPercent}
                  onChange={(e) => updateBand(i, { deductionPercent: Number(e.target.value) })}
                  className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
                <TableActionButton variant="danger" type="button" onClick={() => removeBand(i)}>
                  Remove
                </TableActionButton>
              </div>
            ))}
            <TableActionButton variant="neutral" type="button" onClick={addBand}>
              + Add band
            </TableActionButton>
            <p className="text-xs text-gray-500">
              Example: 0 to 3 absences deduct 0%, 4 to 6 deduct 50%, 7 or more deduct 100%. PAYE follows
              the reduced base automatically.
            </p>
          </div>
        )}

        {fetcher.data?.error && <p className="text-sm text-red-600">{fetcher.data.error}</p>}

        <div className="flex justify-end gap-2">
          <TableActionButton variant="neutral" type="button" onClick={onClose} disabled={fetcher.state !== 'idle'}>
            Cancel
          </TableActionButton>
          <TableActionButton variant="primary" type="submit" disabled={fetcher.state !== 'idle' || !roleId}>
            {fetcher.state !== 'idle' ? 'Saving…' : 'Save rules'}
          </TableActionButton>
        </div>
      </fetcher.Form>
    </Modal>
  );
}
