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
import { DateTimeText } from '~/components/ui/date-time-text';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import type { HRUser, Refund } from './types';

/** Current month as YYYY-MM for the target-month input default. */
function currentMonthValue(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Today as YYYY-MM-DD for the refund-date input default. */
function todayValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function refundPeriodLabel(periodMonth?: string | null): string | null {
  if (!periodMonth) return null;
  const m = /^(\d{4})-(\d{2})/.exec(periodMonth);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-01T00:00:00Z`).toLocaleDateString('en-NG', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A refund is locked once its batch has left HR (PENDING_FINANCE / PAID). */
function isRefundLocked(refund: Refund): boolean {
  return refund.batchStatus === 'PENDING_FINANCE' || refund.batchStatus === 'PAID';
}

interface RefundsTabProps {
  users: HRUser[];
  /** True when the viewer may record/void refunds (hr.write). Read-only otherwise. */
  canWrite: boolean;
}

/**
 * Staff Refunds management (doc §2). Refunds are post-tax cash owed back to a
 * staff member, added to net pay and never taxed. HR records them (approved on
 * creation); they sweep into the target month's open batch and can be voided
 * until that batch leaves HR review.
 */
export function RefundsTab({ users, canWrite }: RefundsTabProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const submitting = fetcher.state !== 'idle';

  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [editTarget, setEditTarget] = useState<Refund | null>(null);
  const [voidTarget, setVoidTarget] = useState<Refund | null>(null);
  const modalOpen = showCreate || editTarget != null;

  const staffById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const staffOptions = useMemo(
    () => users.map((u) => ({ value: u.id, label: u.name })),
    [users],
  );

  const loadRefunds = useCallback(async () => {
    setLoading(true);
    try {
      const url = `${getBrowserApiBaseUrl()}/trpc/hr.listRefunds?input=${encodeURIComponent(
        JSON.stringify({ pageSize: 200 }),
      )}`;
      const res = await fetch(url, { credentials: 'include' });
      const json = (await res.json()) as { result?: { data?: { items?: Refund[] } } };
      setRefunds(json.result?.data?.items ?? []);
    } catch {
      setRefunds([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRefunds();
  }, [loadRefunds]);

  // Close the create/edit modal on a successful create or update.
  useCloseOnFetcherSuccess(
    fetcher,
    () => {
      setShowCreate(false);
      setEditTarget(null);
      setSelectedStaffId('');
    },
    { intent: ['createRefund', 'updateRefund'] },
  );

  // Refresh the list + close the void confirm after any successful mutation.
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.success) {
      setVoidTarget(null);
      void loadRefunds();
    }
  }, [fetcher.state, fetcher.data, loadRefunds]);

  useFetcherToast(fetcher.data, { successMessage: 'Refund saved' });

  const columns: CompactTableColumn<Refund>[] = [
    {
      key: 'staff',
      header: 'Staff',
      render: (r) => staffById.get(r.staffId)?.name ?? 'Unknown',
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (r) => <NairaPrice amount={Number(r.amount)} />,
    },
    { key: 'reason', header: 'Reason', render: (r) => r.reason },
    {
      key: 'period',
      header: 'Month',
      render: (r) => refundPeriodLabel(r.periodMonth) ?? 'Next batch',
    },
    {
      key: 'date',
      header: 'Refund date',
      render: (r) => <DateTimeText dateOnly={r.refundDate} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      tight: true,
      align: 'right',
      render: (r) =>
        canWrite && r.status === 'APPROVED' && !isRefundLocked(r) ? (
          <div className="flex justify-end gap-1">
            <TableActionButton variant="neutral" onClick={() => setEditTarget(r)}>
              Edit
            </TableActionButton>
            <TableActionButton variant="danger" onClick={() => setVoidTarget(r)}>
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
          Post-tax cash owed back to staff. Added on top of net pay, never taxed.
        </p>
        {canWrite ? (
          <Button onClick={() => setShowCreate(true)} disabled={users.length === 0}>
            Add refund
          </Button>
        ) : null}
      </div>

      <CompactTable
        rows={refunds}
        columns={columns}
        rowKey={(r) => r.id}
        loading={loading}
        emptyTitle="No refunds yet"
        emptyDescription="Recorded refunds appear here."
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
              {editTarget ? 'Edit refund' : 'Add refund'}
            </h2>
            <input type="hidden" name="intent" value={editTarget ? 'updateRefund' : 'createRefund'} />
            {editTarget ? (
              <>
                <input type="hidden" name="refundId" value={editTarget.id} />
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
            <div className="space-y-1">
              <label className="text-sm font-medium text-app-fg">Refund amount</label>
              <AmountInput
                name="amount"
                prefix="₦"
                required
                defaultValue={editTarget ? String(Number(editTarget.amount)) : undefined}
              />
            </div>
            <TextInput
              name="reason"
              label="Reason"
              required
              minLength={3}
              maxLength={200}
              placeholder="e.g. Out-of-pocket delivery expense"
              defaultValue={editTarget?.reason}
            />
            <TextInput
              name="notes"
              label="Notes (optional)"
              maxLength={1000}
              placeholder="Any extra detail"
              defaultValue={editTarget?.notes ?? undefined}
            />
            <TextInput
              name="refundDate"
              label="Refund date"
              type="date"
              required
              defaultValue={editTarget ? editTarget.refundDate.slice(0, 10) : todayValue()}
            />
            <TextInput
              name="periodMonth"
              label="Target payroll month"
              type="month"
              required
              defaultValue={
                editTarget?.periodMonth ? editTarget.periodMonth.slice(0, 7) : currentMonthValue()
              }
              hint="The month whose payroll this refund is paid in."
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
                {submitting ? 'Saving…' : editTarget ? 'Save changes' : 'Add refund'}
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      ) : null}

      <ConfirmActionModal
        open={!!voidTarget}
        onClose={() => setVoidTarget(null)}
        title="Void refund"
        description={
          voidTarget
            ? `Void the refund for ${
                staffById.get(voidTarget.staffId)?.name ?? 'this staff member'
              }? This removes it from payroll but keeps the record.`
            : ''
        }
        details={
          voidTarget ? (
            <ul className="list-disc pl-4 space-y-1 text-sm">
              <li>
                Amount <NairaPrice amount={Number(voidTarget.amount)} />
              </li>
              <li>{voidTarget.reason}</li>
            </ul>
          ) : null
        }
        confirmLabel="Void refund"
        variant="danger"
        loading={fetcher.state === 'submitting'}
        onConfirm={() => {
          if (!voidTarget) return;
          fetcher.submit({ intent: 'voidRefund', refundId: voidTarget.id }, { method: 'post' });
        }}
      />
    </div>
  );
}
