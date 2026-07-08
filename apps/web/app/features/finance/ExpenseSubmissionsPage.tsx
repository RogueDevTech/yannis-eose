import { useMemo, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { TextInput } from '~/components/ui/text-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { Tabs } from '~/components/ui/tabs';
import { TableActionButton } from '~/components/ui/table-action-button';
import { SearchableSelect, type SearchableSelectOption } from '~/components/ui/searchable-select';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

// ── Types ────────────────────────────────────────────────────────────

export interface ExpenseRow {
  id: string;
  vendorName: string;
  description: string;
  amount: string;
  receiptUrl: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  submitterId: string;
  glAccountId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  glVoucherId: string | null;
  branchId: string | null;
  createdAt: string;
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
}

export interface ExpenseSubmissionsPageProps {
  expenses: ExpenseRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  accounts: AccountOption[];
  canWrite: boolean;
}

// ── Constants ────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

// ── Component ────────────────────────────────────────────────────────

export function ExpenseSubmissionsPage({
  expenses,
  pagination,
  accounts,
  canWrite,
}: ExpenseSubmissionsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('status') || 'PENDING';

  // Modal state
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [approveTarget, setApproveTarget] = useState<ExpenseRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ExpenseRow | null>(null);

  // GL account selection for approve modal
  const [selectedGlAccountId, setSelectedGlAccountId] = useState('');

  // Fetchers
  const submitFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const approveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const rejectFetcher = useFetcher<{ success?: boolean; error?: string }>();

  useFetcherToast(submitFetcher.data);
  useFetcherToast(approveFetcher.data);
  useFetcherToast(rejectFetcher.data);

  useCloseOnFetcherSuccess(submitFetcher, () => setShowSubmitModal(false));
  useCloseOnFetcherSuccess(approveFetcher, () => {
    setApproveTarget(null);
    setSelectedGlAccountId('');
  });
  useCloseOnFetcherSuccess(rejectFetcher, () => setRejectTarget(null));

  // ── Tab handler ──────────────────────────────────────────────────

  function handleTabChange(value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === 'all') {
        next.delete('status');
      } else {
        next.set('status', value);
      }
      next.delete('page');
      return next;
    });
  }

  // ── Account options for SearchableSelect ─────────────────────────

  const accountOptions: SearchableSelectOption[] = useMemo(
    () =>
      accounts.map((a) => ({
        value: a.id,
        label: `${a.code} — ${a.name}`,
      })),
    [accounts],
  );

  // ── Columns ────────────────────────────────────────────────────────

  const columns = useMemo(
    (): CompactTableColumn<ExpenseRow>[] => [
      {
        key: 'vendorName',
        header: 'Vendor',
        render: (r) => <span className="font-medium text-app-fg">{r.vendorName}</span>,
      },
      {
        key: 'description',
        header: 'Description',
        render: (r) => (
          <span className="text-app-fg truncate max-w-[200px] inline-block">{r.description}</span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (r) => <NairaPrice amount={r.amount} />,
      },
      {
        key: 'receipt',
        header: 'Receipt',
        render: (r) =>
          r.receiptUrl ? (
            <a
              href={r.receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline text-xs"
            >
              View
            </a>
          ) : (
            <span className="text-xs text-app-fg-muted">None</span>
          ),
      },
      {
        key: 'createdAt',
        header: 'Submitted',
        render: (r) => (
          <span className="text-app-fg text-xs">
            {new Date(r.createdAt).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: (r) =>
          canWrite && r.status === 'PENDING' ? (
            <div className="flex items-center gap-1">
              <TableActionButton onClick={() => setApproveTarget(r)}>Approve</TableActionButton>
              <TableActionButton onClick={() => setRejectTarget(r)} variant="danger">
                Reject
              </TableActionButton>
            </div>
          ) : null,
      },
    ],
    [canWrite],
  );

  // ── Mobile card ────────────────────────────────────────────────────

  const renderMobileCard = useMemo(
    () => (r: ExpenseRow) => (
      <button
        type="button"
        className="w-full text-left p-3 space-y-1"
        onClick={() => {
          if (canWrite && r.status === 'PENDING') setApproveTarget(r);
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-app-fg truncate">{r.vendorName}</span>
          <StatusBadge status={r.status} />
        </div>
        <div className="text-xs text-app-fg-muted truncate">{r.description}</div>
        <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
          <span>
            {new Date(r.createdAt).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </span>
          <NairaPrice amount={r.amount} className="font-medium" />
        </div>
      </button>
    ),
    [canWrite],
  );

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader
        title="Expense Submissions"
        description="Submit and review vendor expense claims."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <Button type="button" onClick={() => setShowSubmitModal(true)}>
                  + Submit Expense
                </Button>
              </div>
            }
            sheet={
              <div className="flex flex-col gap-2">
                <Button type="button" onClick={() => setShowSubmitModal(true)}>
                  + Submit Expense
                </Button>
              </div>
            }
            sheetTitle="Expense Submissions"
            triggerAriaLabel="Expense actions"
          />
        }
      >
        <Tabs value={activeTab} onChange={handleTabChange} tabs={STATUS_TABS} variant="pill" />
      </PageHeader>

      {expenses.length === 0 ? (
        <EmptyState
          title="No expense submissions"
          description="Submit your first vendor expense to get started."
          action={
            <Button type="button" onClick={() => setShowSubmitModal(true)}>
              + Submit Expense
            </Button>
          }
        />
      ) : (
        <>
          <CompactTable
            columns={columns}
            rows={expenses}
            rowKey={(r) => r.id}
            renderMobileCard={renderMobileCard}
          />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} />
        </>
      )}

      {/* ── Submit Expense Modal ─────────────────────────────────────── */}
      {showSubmitModal && (
        <Modal open onClose={() => setShowSubmitModal(false)} maxWidth="max-w-lg">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Submit Expense</h2>
            <submitFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="submitExpense" />

              <TextInput label="Vendor Name" name="vendorName" required />
              <TextInput label="Description" name="description" required />
              <TextInput label="Amount" name="amount" type="number" min="0.01" step="0.01" required />
              <TextInput label="Receipt URL" name="receiptUrl" placeholder="https://..." />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowSubmitModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitFetcher.state !== 'idle'}>
                  {submitFetcher.state !== 'idle' ? 'Submitting...' : 'Submit Expense'}
                </Button>
              </div>
            </submitFetcher.Form>
          </div>
        </Modal>
      )}

      {/* ── Approve Expense Modal ────────────────────────────────────── */}
      {approveTarget && (
        <Modal open onClose={() => { setApproveTarget(null); setSelectedGlAccountId(''); }} maxWidth="max-w-lg">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Approve Expense</h2>
            <div className="text-sm text-app-fg-muted space-y-1">
              <p>
                <span className="font-medium text-app-fg">Vendor:</span> {approveTarget.vendorName}
              </p>
              <p>
                <span className="font-medium text-app-fg">Description:</span> {approveTarget.description}
              </p>
              <p>
                <span className="font-medium text-app-fg">Amount:</span>{' '}
                <NairaPrice amount={approveTarget.amount} />
              </p>
              {approveTarget.receiptUrl && (
                <p>
                  <a
                    href={approveTarget.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    View Receipt
                  </a>
                </p>
              )}
            </div>
            <approveFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="approveExpense" />
              <input type="hidden" name="expenseId" value={approveTarget.id} />
              <input type="hidden" name="glAccountId" value={selectedGlAccountId} />

              <SearchableSelect
                label="GL Account (code to)"
                value={selectedGlAccountId}
                onChange={setSelectedGlAccountId}
                options={accountOptions}
                placeholder="Select GL account..."
                searchPlaceholder="Search accounts..."
                emptyText="No accounts found"
                required
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setApproveTarget(null); setSelectedGlAccountId(''); }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={approveFetcher.state !== 'idle' || !selectedGlAccountId}
                >
                  {approveFetcher.state !== 'idle' ? 'Approving...' : 'Approve & Post'}
                </Button>
              </div>
            </approveFetcher.Form>
          </div>
        </Modal>
      )}

      {/* ── Reject Expense Modal ─────────────────────────────────────── */}
      {rejectTarget && (
        <Modal open onClose={() => setRejectTarget(null)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Reject Expense</h2>
            <div className="text-sm text-app-fg-muted">
              <p>
                <span className="font-medium text-app-fg">Vendor:</span> {rejectTarget.vendorName}
              </p>
              <p>
                <span className="font-medium text-app-fg">Amount:</span>{' '}
                <NairaPrice amount={rejectTarget.amount} />
              </p>
            </div>
            <rejectFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="rejectExpense" />
              <input type="hidden" name="expenseId" value={rejectTarget.id} />

              <TextInput
                label="Reason for rejection"
                name="reason"
                required
                minLength={5}
                placeholder="Explain why this expense is being rejected..."
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setRejectTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={rejectFetcher.state !== 'idle'}>
                  {rejectFetcher.state !== 'idle' ? 'Rejecting...' : 'Reject'}
                </Button>
              </div>
            </rejectFetcher.Form>
          </div>
        </Modal>
      )}
    </>
  );
}
