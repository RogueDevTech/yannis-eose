import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatusBadge } from '~/components/ui/status-badge';
import { TableActionButton } from '~/components/ui/table-action-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { NairaPrice } from '~/components/ui/naira-price';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import type { HRUser, StaffAllowance } from './types';

function currentMonthValue(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function allowancePeriodLabel(periodMonth?: string | null): string | null {
  if (!periodMonth) return null;
  const m = /^(\d{4})-(\d{2})/.exec(periodMonth);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-01T00:00:00Z`).toLocaleDateString('en-NG', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A taxable allowance is locked the moment it is swept into a payout. */
function isAllowanceLocked(a: StaffAllowance): boolean {
  return a.payoutId != null;
}

interface StaffAllowancesTabProps {
  users: HRUser[];
  /** True when the viewer may record/void allowances (hr.write). */
  canWrite: boolean;
}

/**
 * Per-staff ad-hoc allowance management (doc §3). Allowances are TAXABLE earnings
 * added to gross before PAYE. HR records them (approved on creation); they sweep
 * into the target month's batch on generation/recalculation. Once swept they are
 * locked here (recalculate the batch to change them).
 */
export function StaffAllowancesTab({ users, canWrite }: StaffAllowancesTabProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const submitting = fetcher.state !== 'idle';

  const [allowances, setAllowances] = useState<StaffAllowance[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [editTarget, setEditTarget] = useState<StaffAllowance | null>(null);
  const [voidTarget, setVoidTarget] = useState<StaffAllowance | null>(null);
  const modalOpen = showCreate || editTarget != null;

  const staffById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const staffOptions = useMemo(() => users.map((u) => ({ value: u.id, label: u.name })), [users]);

  const loadAllowances = useCallback(async () => {
    setLoading(true);
    try {
      const url = `${getBrowserApiBaseUrl()}/trpc/hr.listStaffAllowances?input=${encodeURIComponent(
        JSON.stringify({ pageSize: 200 }),
      )}`;
      const res = await fetch(url, { credentials: 'include' });
      const json = (await res.json()) as { result?: { data?: { items?: StaffAllowance[] } } };
      setAllowances(json.result?.data?.items ?? []);
    } catch {
      setAllowances([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllowances();
  }, [loadAllowances]);

  useCloseOnFetcherSuccess(
    fetcher,
    () => {
      setShowCreate(false);
      setEditTarget(null);
      setSelectedStaffId('');
    },
    { intent: ['createStaffAllowance', 'updateStaffAllowance'] },
  );

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setVoidTarget(null);
      void loadAllowances();
    }
  }, [fetcher.state, fetcher.data, loadAllowances]);

  useFetcherToast(fetcher.data, { successMessage: 'Allowance saved' });

  const columns: CompactTableColumn<StaffAllowance>[] = [
    { key: 'staff', header: 'Staff', render: (a) => staffById.get(a.staffId)?.name ?? 'Unknown' },
    { key: 'name', header: 'Allowance', render: (a) => a.name },
    { key: 'amount', header: 'Amount', render: (a) => <NairaPrice amount={Number(a.amount)} /> },
    {
      key: 'recurring',
      header: 'Type',
      render: (a) => (a.recurring ? 'Recurring' : 'One-time'),
    },
    {
      key: 'period',
      header: 'Month',
      render: (a) => allowancePeriodLabel(a.periodMonth) ?? 'Next batch',
    },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      tight: true,
      align: 'right',
      render: (a) =>
        canWrite && a.status === 'APPROVED' && !isAllowanceLocked(a) ? (
          <div className="flex justify-end gap-1">
            <TableActionButton variant="neutral" onClick={() => setEditTarget(a)}>
              Edit
            </TableActionButton>
            <TableActionButton variant="danger" onClick={() => setVoidTarget(a)}>
              Void
            </TableActionButton>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-app-fg-muted">
          Taxable earnings added to gross before PAYE. Recurring allowances prorate for part-month staff.
        </p>
        {canWrite ? (
          <Button onClick={() => setShowCreate(true)} disabled={users.length === 0}>
            Add allowance
          </Button>
        ) : null}
      </div>

      <CompactTable
        rows={allowances}
        columns={columns}
        rowKey={(a) => a.id}
        loading={loading}
        emptyTitle="No allowances yet"
        emptyDescription="Recorded allowances appear here."
      />

      {modalOpen ? (
        <Modal
          open
          onClose={() => {
            setShowCreate(false);
            setEditTarget(null);
          }}
        >
          <fetcher.Form method="post" className="space-y-4" key={editTarget?.id ?? 'create'}>
            <h2 className="text-lg font-semibold text-app-fg">
              {editTarget ? 'Edit allowance' : 'Add allowance'}
            </h2>
            <input
              type="hidden"
              name="intent"
              value={editTarget ? 'updateStaffAllowance' : 'createStaffAllowance'}
            />
            {editTarget ? (
              <>
                <input type="hidden" name="allowanceId" value={editTarget.id} />
                <div className="space-y-1">
                  <label className="text-sm font-medium text-app-fg">Staff member</label>
                  <p className="text-sm text-app-fg-muted">
                    {staffById.get(editTarget.staffId)?.name ?? 'Unknown'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <input type="hidden" name="staffId" value={selectedStaffId} />
                <div className="space-y-1">
                  <label className="text-sm font-medium text-app-fg">Staff member</label>
                  <SearchableSelect
                    value={selectedStaffId}
                    onChange={setSelectedStaffId}
                    options={staffOptions}
                    placeholder="Select staff"
                  />
                </div>
              </>
            )}
            <TextInput
              name="name"
              label="Allowance name"
              required
              minLength={2}
              maxLength={100}
              placeholder="e.g. Transport"
              defaultValue={editTarget?.name}
            />
            <div className="space-y-1">
              <label className="text-sm font-medium text-app-fg">Amount</label>
              <AmountInput
                name="amount"
                prefix="₦"
                required
                defaultValue={editTarget ? String(Number(editTarget.amount)) : undefined}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-app-fg">
              <input
                type="checkbox"
                name="recurring"
                value="true"
                defaultChecked={editTarget?.recurring ?? false}
                className="rounded border-app-border"
              />
              Recurring monthly (prorate for part-month staff)
            </label>
            <TextInput
              name="notes"
              label="Notes (optional)"
              maxLength={1000}
              defaultValue={editTarget?.notes ?? undefined}
            />
            <TextInput
              name="periodMonth"
              label="Target payroll month"
              type="month"
              required
              defaultValue={
                editTarget?.periodMonth ? editTarget.periodMonth.slice(0, 7) : currentMonthValue()
              }
              hint="The month whose payroll this allowance is paid in."
            />
            {fetcher.data?.error ? (
              <p className="text-sm text-danger-600 dark:text-danger-400">{fetcher.data.error}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowCreate(false);
                  setEditTarget(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || (!editTarget && !selectedStaffId)}>
                {submitting ? 'Saving…' : editTarget ? 'Save changes' : 'Add allowance'}
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      ) : null}

      <ConfirmActionModal
        open={!!voidTarget}
        onClose={() => setVoidTarget(null)}
        title="Void allowance"
        description={
          voidTarget
            ? `Void the "${voidTarget.name}" allowance for ${
                staffById.get(voidTarget.staffId)?.name ?? 'this staff member'
              }? This keeps the record but removes it from upcoming payroll.`
            : ''
        }
        details={
          voidTarget ? (
            <ul className="list-disc pl-4 space-y-1 text-sm">
              <li>
                Amount <NairaPrice amount={Number(voidTarget.amount)} />
              </li>
              <li>{voidTarget.recurring ? 'Recurring monthly' : 'One-time'}</li>
            </ul>
          ) : null
        }
        confirmLabel="Void allowance"
        variant="danger"
        loading={fetcher.state === 'submitting'}
        onConfirm={() => {
          if (!voidTarget) return;
          fetcher.submit(
            { intent: 'voidStaffAllowance', allowanceId: voidTarget.id },
            { method: 'post' },
          );
        }}
      />
    </div>
  );
}
