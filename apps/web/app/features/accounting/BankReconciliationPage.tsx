import { useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { Modal } from '~/components/ui/modal';
import { Pagination } from '~/components/ui/pagination';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ReconLine {
  id: string;
  statementDate: string | null;
  statementDescription: string | null;
  statementAmount: number | null;
  glEntryId: string | null;
  glDate: string | null;
  glDescription: string | null;
  glAmount: number | null;
  status: 'MATCHED' | 'UNMATCHED';
  matchedAt: string | null;
}

interface ReconDetail {
  id: string;
  bankAccountName: string | null;
  statementDate: string;
  statementBalance: number;
  glBalance: number;
  difference: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
  lines: ReconLine[];
}

interface ReconListItem {
  id: string;
  bankAccountId: string;
  bankAccountName: string | null;
  statementDate: string;
  statementBalance: number;
  glBalance: number;
  difference: number;
  status: 'IN_PROGRESS' | 'COMPLETED';
  createdAt: string;
}

interface BankAccount {
  id: string;
  code: string;
  name: string;
}

export interface BankReconciliationPageProps {
  reconciliations: ReconListItem[];
  pagination: { page: number; limit: number; total: number };
  bankAccounts: BankAccount[];
  detail?: ReconDetail | null;
}

// ─── Status mapping ──────────────────────────────────────────────────────────

const RECON_STATUS: Record<string, { label: string; variant: 'success' | 'info' }> = {
  IN_PROGRESS: { label: 'In Progress', variant: 'info' },
  COMPLETED: { label: 'Completed', variant: 'success' },
};

const LINE_STATUS: Record<string, { label: string; variant: 'success' | 'warning' }> = {
  MATCHED: { label: 'Matched', variant: 'success' },
  UNMATCHED: { label: 'Unmatched', variant: 'warning' },
};

// ─── Create Reconciliation Modal ─────────────────────────────────────────────

interface StatementLine {
  date: string;
  description: string;
  amount: string;
}

function CreateReconciliationModal({
  open,
  onClose,
  bankAccounts,
}: {
  open: boolean;
  onClose: () => void;
  bankAccounts: BankAccount[];
}) {
  const fetcher = useFetcher();
  const [bankAccountId, setBankAccountId] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [statementBalance, setStatementBalance] = useState('');
  const [lines, setLines] = useState<StatementLine[]>([
    { date: '', description: '', amount: '' },
  ]);

  const addLine = () => setLines((prev) => [...prev, { date: '', description: '', amount: '' }]);

  const updateLine = (index: number, field: keyof StatementLine, value: string) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const removeLine = (index: number) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const isSubmitting = fetcher.state !== 'idle';

  // Close on success
  const data = fetcher.data as { success?: boolean } | undefined;
  if (data?.success && open) {
    onClose();
  }

  const handleSubmit = () => {
    const validLines = lines.filter((l) => l.date && l.amount);
    if (!bankAccountId || !statementDate || !statementBalance || validLines.length === 0) return;

    fetcher.submit(
      {
        intent: 'createReconciliation',
        bankAccountId,
        statementDate,
        statementBalance,
        statementLines: JSON.stringify(
          validLines.map((l) => ({
            date: l.date,
            description: l.description,
            amount: parseFloat(l.amount),
          })),
        ),
      },
      { method: 'POST' },
    );
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl">
      <div className="p-4 md:p-6">
        <h2 className="mb-4 text-lg font-semibold text-app-fg">New Bank Reconciliation</h2>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-app-fg-muted">Bank Account</label>
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="h-10 w-full rounded-md border border-app-border bg-app-bg px-3 text-sm text-app-fg md:h-9"
            >
              <option value="">Select account</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-app-fg-muted">Statement Date</label>
            <input
              type="date"
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
              className="h-10 w-full rounded-md border border-app-border bg-app-bg px-3 text-sm text-app-fg md:h-9"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-app-fg-muted">Statement Balance</label>
            <input
              type="number"
              step="0.01"
              value={statementBalance}
              onChange={(e) => setStatementBalance(e.target.value)}
              placeholder="0.00"
              className="h-10 w-full rounded-md border border-app-border bg-app-bg px-3 text-sm text-app-fg md:h-9"
            />
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-app-fg-muted">Statement Lines</h3>
          <button
            type="button"
            onClick={addLine}
            className="text-xs font-medium text-primary-600 hover:underline"
          >
            + Add row
          </button>
        </div>

        <div className="mb-4 max-h-64 space-y-2 overflow-y-auto">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="date"
                value={line.date}
                onChange={(e) => updateLine(i, 'date', e.target.value)}
                className="h-10 w-28 rounded-md border border-app-border bg-app-bg px-2 text-xs text-app-fg md:h-9"
              />
              <input
                type="text"
                value={line.description}
                onChange={(e) => updateLine(i, 'description', e.target.value)}
                placeholder="Description"
                className="h-10 min-w-0 flex-1 rounded-md border border-app-border bg-app-bg px-2 text-xs text-app-fg md:h-9"
              />
              <input
                type="number"
                step="0.01"
                value={line.amount}
                onChange={(e) => updateLine(i, 'amount', e.target.value)}
                placeholder="Amount"
                className="h-10 w-28 rounded-md border border-app-border bg-app-bg px-2 text-xs text-app-fg md:h-9"
              />
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  className="text-danger-500 hover:text-danger-700"
                  title="Remove"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-md border border-app-border px-4 text-sm text-app-fg md:h-9"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="h-10 rounded-md bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 md:h-9"
          >
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Detail View ────────────────────────────────────────────────────────────

function ReconciliationDetail({
  detail,
}: {
  detail: ReconDetail;
}) {
  const fetcher = useFetcher();

  const handleMatch = (lineId: string) => {
    const glEntryId = prompt('Enter GL Entry ID to match:');
    if (!glEntryId) return;
    fetcher.submit(
      { intent: 'matchLine', lineId, glEntryId },
      { method: 'POST' },
    );
  };

  const handleUnmatch = (lineId: string) => {
    fetcher.submit(
      { intent: 'unmatchLine', lineId },
      { method: 'POST' },
    );
  };

  const handleComplete = () => {
    fetcher.submit(
      { intent: 'completeReconciliation', reconciliationId: detail.id },
      { method: 'POST' },
    );
  };

  const matchedCount = detail.lines.filter((l) => l.status === 'MATCHED').length;
  const unmatchedCount = detail.lines.filter((l) => l.status === 'UNMATCHED').length;

  const lineColumns: CompactTableColumn<ReconLine>[] = [
    {
      key: 'statementDate',
      header: 'Stmt Date',
      render: (r) => <span className="text-xs">{r.statementDate ?? '-'}</span>,
    },
    {
      key: 'statementDescription',
      header: 'Stmt Desc',
      render: (r) => <span className="text-xs truncate max-w-[140px]">{r.statementDescription ?? '-'}</span>,
    },
    {
      key: 'statementAmount',
      header: 'Stmt Amount',
      align: 'right',
      render: (r) =>
        r.statementAmount !== null ? <NairaPrice amount={r.statementAmount} /> : <span>-</span>,
    },
    {
      key: 'glDate',
      header: 'GL Date',
      render: (r) => <span className="text-xs">{r.glDate ?? '-'}</span>,
    },
    {
      key: 'glDescription',
      header: 'GL Desc',
      render: (r) => <span className="text-xs truncate max-w-[140px]">{r.glDescription ?? '-'}</span>,
    },
    {
      key: 'glAmount',
      header: 'GL Amount',
      align: 'right',
      render: (r) =>
        r.glAmount !== null ? <NairaPrice amount={r.glAmount} /> : <span>-</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const s = LINE_STATUS[r.status] ?? { label: r.status, variant: 'warning' as const };
        return <StatusBadge status={r.status} label={s.label} variant={s.variant} />;
      },
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        detail.status === 'IN_PROGRESS' ? (
          r.status === 'UNMATCHED' ? (
            <button
              type="button"
              onClick={() => handleMatch(r.id)}
              className="text-xs font-medium text-primary-600 hover:underline"
            >
              Match
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleUnmatch(r.id)}
              className="text-xs font-medium text-danger-600 hover:underline"
            >
              Unmatch
            </button>
          )
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={`Reconciliation — ${detail.bankAccountName ?? 'Bank Account'}`}
        description={`Statement date: ${detail.statementDate}`}
        backTo="/admin/finance/bank-reconciliation"
        actions={
          detail.status === 'IN_PROGRESS' ? (
            <button
              type="button"
              onClick={handleComplete}
              className="h-10 rounded-md bg-success-600 px-4 text-sm font-medium text-white hover:bg-success-700 md:h-9"
            >
              Complete
            </button>
          ) : (
            <StatusBadge status="COMPLETED" label="Completed" variant="success" />
          )
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Statement Balance', value: <NairaPrice amount={detail.statementBalance} /> },
          { label: 'GL Balance', value: <NairaPrice amount={detail.glBalance} /> },
          { label: 'Difference', value: <NairaPrice amount={detail.difference} colorize /> },
          { label: 'Matched', value: `${matchedCount} / ${detail.lines.length}` },
          { label: 'Unmatched', value: String(unmatchedCount) },
        ]}
      />

      <CompactTable columns={lineColumns} rows={detail.lines} rowKey={(r) => r.id} />
    </>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function BankReconciliationPage({
  reconciliations,
  pagination,
  bankAccounts,
  detail,
}: BankReconciliationPageProps) {
  const [searchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);

  const selectedId = searchParams.get('id');
  const showDetail = !!detail && !!selectedId;

  if (showDetail && detail) {
    return <ReconciliationDetail detail={detail} />;
  }

  const columns: CompactTableColumn<ReconListItem>[] = [
    {
      key: 'bankAccountName',
      header: 'Bank Account',
      render: (r) => <span className="font-medium text-app-fg">{r.bankAccountName ?? '-'}</span>,
    },
    {
      key: 'statementDate',
      header: 'Statement Date',
      render: (r) => <span className="text-sm">{r.statementDate}</span>,
    },
    {
      key: 'statementBalance',
      header: 'Statement Bal.',
      align: 'right',
      render: (r) => <NairaPrice amount={r.statementBalance} />,
    },
    {
      key: 'glBalance',
      header: 'GL Balance',
      align: 'right',
      render: (r) => <NairaPrice amount={r.glBalance} />,
    },
    {
      key: 'difference',
      header: 'Difference',
      align: 'right',
      render: (r) => <NairaPrice amount={r.difference} colorize />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const s = RECON_STATUS[r.status] ?? { label: r.status, variant: 'info' as const };
        return <StatusBadge status={r.status} label={s.label} variant={s.variant} />;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Bank Reconciliation"
        description="Match bank statements against ledger entries."
        actions={
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="h-10 rounded-md bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 md:h-9"
          >
            New Reconciliation
          </button>
        }
      />

      {reconciliations.length === 0 ? (
        <EmptyState
          title="No reconciliations yet"
          description="Create a new reconciliation to start matching bank statement lines."
        />
      ) : (
        <>
          <CompactTable
            columns={columns}
            rows={reconciliations}
            rowKey={(r) => r.id}
            rowHref={(r) => `?id=${r.id}`}
          />
          <Pagination
            page={pagination.page}
            totalPages={Math.max(1, Math.ceil(pagination.total / pagination.limit))}
          />
        </>
      )}

      <CreateReconciliationModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        bankAccounts={bankAccounts}
      />
    </>
  );
}
