import { useCallback, useMemo, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { TextInput } from '~/components/ui/text-input';
import { AmountInput } from '~/components/ui/amount-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { SearchableSelect, type SearchableSelectOption } from '~/components/ui/searchable-select';
import { FormSelect } from '~/components/ui/form-select';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import {
  applyOptimisticPatches,
  useOptimisticListPatches,
} from '~/hooks/useOptimisticListPatches';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { DateTimeText } from '~/components/ui/date-time-text';

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
  { value: 'all', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

// ── Component ────────────────────────────────────────────────────────

export function ExpenseSubmissionsPage({
  expenses,
  pagination,
  accounts,
  canWrite,
}: ExpenseSubmissionsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('status') || 'all';
  const searchQuery = searchParams.get('q') ?? '';

  // Modal state
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [viewTarget, setViewTarget] = useState<ExpenseRow | null>(null);
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

  const buildApprovePatches = useCallback((fd: FormData, intent: string) => {
    if (intent !== 'approveExpense') return null;
    const id = fd.get('expenseId')?.toString();
    if (!id) return null;
    return [{ id, patch: { status: 'APPROVED' as const } }];
  }, []);
  const buildRejectPatches = useCallback((fd: FormData, intent: string) => {
    if (intent !== 'rejectExpense') return null;
    const id = fd.get('expenseId')?.toString();
    if (!id) return null;
    const rejectionReason = fd.get('reason')?.toString() ?? null;
    return [{ id, patch: { status: 'REJECTED' as const, rejectionReason } }];
  }, []);

  const approvePatches = useOptimisticListPatches<ExpenseRow>(approveFetcher, buildApprovePatches);
  const rejectPatches = useOptimisticListPatches<ExpenseRow>(rejectFetcher, buildRejectPatches);
  const displayExpenses = useMemo(() => {
    const afterApprove = applyOptimisticPatches(expenses, approvePatches);
    const patched = applyOptimisticPatches(afterApprove, rejectPatches);
    if (activeTab === 'all') return patched;
    return patched.filter((e) => e.status === activeTab);
  }, [expenses, approvePatches, rejectPatches, activeTab]);

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
        label: `${a.code} · ${a.name.replace(/\s*[—–]\s*/g, ' · ')}`,
      })),
    [accounts],
  );

  // ── Search filter ─────────────────────────────────────────────────

  function handleSearchApply(query: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (query) {
        next.set('q', query);
      } else {
        next.delete('q');
      }
      next.delete('page');
      return next;
    });
  }

  const filteredExpenses = useMemo(() => {
    if (!searchQuery.trim()) return displayExpenses;
    const lower = searchQuery.toLowerCase();
    return displayExpenses.filter(
      (e) =>
        e.vendorName.toLowerCase().includes(lower) ||
        e.description.toLowerCase().includes(lower),
    );
  }, [displayExpenses, searchQuery]);

  // ── Stat strip ────────────────────────────────────────────────────

  const statItems = useMemo((): OverviewStatStripItem[] => {
    const total = displayExpenses.length;
    const pendingAmount = displayExpenses
      .filter((e) => e.status === 'PENDING')
      .reduce((sum, e) => sum + parseFloat(e.amount || '0'), 0);
    const approvedAmount = displayExpenses
      .filter((e) => e.status === 'APPROVED')
      .reduce((sum, e) => sum + parseFloat(e.amount || '0'), 0);
    return [
      { label: 'Total Expenses', value: total.toLocaleString() },
      {
        label: 'Pending Amount',
        value: <NairaPrice amount={pendingAmount} />,
        plainValue: true,
      },
      {
        label: 'Approved Amount',
        value: <NairaPrice amount={approvedAmount} />,
        plainValue: true,
      },
    ];
  }, [displayExpenses]);

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
        render: (r) => <DateTimeText at={r.createdAt} className="text-xs" />,
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
        hideable: false,
        render: (r) => (
          <div className="flex items-center gap-1">
            <CompactTableActionButton tone="brand" onClick={() => setViewTarget(r)}>
              View
            </CompactTableActionButton>
            {canWrite && r.status === 'PENDING' && (
              <>
                <CompactTableActionButton tone="success" onClick={() => setApproveTarget(r)}>
                  Approve
                </CompactTableActionButton>
                <CompactTableActionButton tone="danger" onClick={() => setRejectTarget(r)}>
                  Reject
                </CompactTableActionButton>
              </>
            )}
          </div>
        ),
      },
    ],
    [canWrite],
  );

  // ── Mobile card ────────────────────────────────────────────────────

  const renderMobileCard = useMemo(
    () => (r: ExpenseRow) => (
      <button
        type="button"
        className="w-full text-left rounded-lg border border-app-border bg-app-elevated p-3 space-y-1 hover:bg-app-hover transition-colors"
        onClick={() => setViewTarget(r)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-app-fg truncate">{r.vendorName}</span>
          <StatusBadge status={r.status} />
        </div>
        <div className="text-xs text-app-fg-muted truncate">{r.description}</div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <DateTimeText at={r.createdAt} className="text-xs" />
          <NairaPrice amount={r.amount} className="font-medium" />
        </div>
      </button>
    ),
    [canWrite],
  );

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
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
                  Submit Expense
                </Button>
              </div>
            }
            sheet={
              <div className="flex flex-col gap-2">
                <Button type="button" onClick={() => setShowSubmitModal(true)}>
                  Submit Expense
                </Button>
              </div>
            }
            sheetTitle="Expense Submissions"
            triggerAriaLabel="Expense actions"
          />
        }
      />

      <MobileDateFilterRow hideDate />

      <OverviewStatStrip items={statItems} />

      <div className="flex items-center gap-2">
        <PageSearchControl
          value={searchQuery}
          onApply={handleSearchApply}
          placeholder="Search by vendor or description..."
          title="Search Expenses"
        />
        <FormSelect
          value={activeTab}
          onChange={(e) => handleTabChange(e.target.value)}
          options={STATUS_TABS.map((t) => ({ value: t.value, label: t.label }))}
          wrapperClassName="w-36"
        />
      </div>

      {filteredExpenses.length === 0 ? (
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
            rows={filteredExpenses}
            rowKey={(r) => r.id}
            renderMobileCard={renderMobileCard}
          />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} />
        </>
      )}

      {/* ── View Expense Modal ──────────────────────────────────────── */}
      {viewTarget && (
        <Modal open onClose={() => setViewTarget(null)} maxWidth="max-w-md">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Expense Detail</h2>
              <StatusBadge status={viewTarget.status} />
            </div>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between gap-2">
                <dt className="text-app-fg-muted">Vendor</dt>
                <dd className="text-app-fg font-medium text-right">{viewTarget.vendorName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-app-fg-muted">Amount</dt>
                <dd className="text-app-fg font-medium"><NairaPrice amount={viewTarget.amount} /></dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-app-fg-muted">Submitted</dt>
                <dd><DateTimeText at={viewTarget.createdAt} /></dd>
              </div>
              <div>
                <dt className="text-app-fg-muted mb-0.5">Description</dt>
                <dd className="text-app-fg">{viewTarget.description}</dd>
              </div>
              {viewTarget.receiptUrl && (
                <div className="flex justify-between gap-2">
                  <dt className="text-app-fg-muted">Receipt</dt>
                  <dd>
                    <a
                      href={viewTarget.receiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 dark:text-brand-400 hover:underline text-sm"
                    >
                      View receipt
                    </a>
                  </dd>
                </div>
              )}
              {viewTarget.approvedAt && (
                <div className="flex justify-between gap-2">
                  <dt className="text-app-fg-muted">Approved</dt>
                  <dd><DateTimeText at={viewTarget.approvedAt} /></dd>
                </div>
              )}
              {viewTarget.rejectionReason && (
                <div>
                  <dt className="text-app-fg-muted mb-0.5">Rejection reason</dt>
                  <dd className="text-app-fg">{viewTarget.rejectionReason}</dd>
                </div>
              )}
            </dl>
            <div className="flex gap-2 pt-1">
              {canWrite && viewTarget.status === 'PENDING' && (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setViewTarget(null);
                      setApproveTarget(viewTarget);
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setViewTarget(null);
                      setRejectTarget(viewTarget);
                    }}
                  >
                    Reject
                  </Button>
                </>
              )}
              <Button size="sm" variant="secondary" onClick={() => setViewTarget(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
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
              <div className="space-y-1">
                <label className="block text-sm font-medium text-app-fg">Amount</label>
                <AmountInput name="amount" prefix="₦" required />
              </div>
              <TextInput label="Receipt URL" name="receiptUrl" placeholder="https://..." />

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setShowSubmitModal(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={submitFetcher.state !== 'idle'}
                  loadingText="Submitting..."
                >
                  Submit Expense
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
    </div>
  );
}
