import { useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Pagination } from '~/components/ui/pagination';
import { TextInput } from '~/components/ui/text-input';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

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

  useCloseOnFetcherSuccess(fetcher, onClose);

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
              className="h-10 w-full rounded-lg border border-app-border bg-app-bg px-3 text-sm text-app-fg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:[color-scheme:dark] md:h-9"
            >
              <option value="">Select account</option>
              {bankAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name.replace(/\s*[—–]\s*/g, ' · ')}
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
              className="h-10 w-full rounded-lg border border-app-border bg-app-bg px-3 text-sm text-app-fg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:[color-scheme:dark] md:h-9"
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
              className="h-10 w-full rounded-lg border border-app-border bg-app-bg px-3 text-sm text-app-fg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:[color-scheme:dark] md:h-9"
            />
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-app-fg-muted">Statement Lines</h3>
          <button
            type="button"
            onClick={addLine}
            className="text-xs font-medium text-brand-600 hover:underline"
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
                className="h-10 w-28 rounded-lg border border-app-border bg-app-bg px-2 text-xs text-app-fg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:[color-scheme:dark] md:h-9"
              />
              <input
                type="text"
                value={line.description}
                onChange={(e) => updateLine(i, 'description', e.target.value)}
                placeholder="Description"
                className="h-10 min-w-0 flex-1 rounded-lg border border-app-border bg-app-bg px-2 text-xs text-app-fg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:[color-scheme:dark] md:h-9"
              />
              <input
                type="number"
                step="0.01"
                value={line.amount}
                onChange={(e) => updateLine(i, 'amount', e.target.value)}
                placeholder="Amount"
                className="h-10 w-28 rounded-lg border border-app-border bg-app-bg px-2 text-xs text-app-fg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:[color-scheme:dark] md:h-9"
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
            className="h-10 rounded-lg border border-app-border bg-app-bg px-4 text-sm text-app-fg hover:bg-app-hover md:h-9"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="h-10 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 md:h-9"
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
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [unmatchTarget, setUnmatchTarget] = useState<ReconLine | null>(null);
  const [matchLineId, setMatchLineId] = useState<string | null>(null);
  const [matchGlEntryId, setMatchGlEntryId] = useState('');

  const handleMatch = (lineId: string) => {
    setMatchLineId(lineId);
    setMatchGlEntryId('');
  };

  const submitMatch = () => {
    if (!matchLineId || !matchGlEntryId.trim()) return;
    fetcher.submit(
      { intent: 'matchLine', lineId: matchLineId, glEntryId: matchGlEntryId.trim() },
      { method: 'POST' },
    );
    setMatchLineId(null);
    setMatchGlEntryId('');
  };

  const handleUnmatchConfirm = () => {
    if (!unmatchTarget) return;
    fetcher.submit(
      { intent: 'unmatchLine', lineId: unmatchTarget.id },
      { method: 'POST' },
    );
    setUnmatchTarget(null);
  };

  const handleCompleteConfirm = () => {
    fetcher.submit(
      { intent: 'completeReconciliation', reconciliationId: detail.id },
      { method: 'POST' },
    );
    setShowCompleteConfirm(false);
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
            <CompactTableActionButton onClick={() => handleMatch(r.id)} tone="brand">
              Match
            </CompactTableActionButton>
          ) : (
            <CompactTableActionButton onClick={() => setUnmatchTarget(r)} tone="danger">
              Unmatch
            </CompactTableActionButton>
          )
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Reconciliation: ${(detail.bankAccountName ?? 'Bank Account').replace(/\s*[—–]\s*/g, ' · ')}`}
        description={`Statement date: ${detail.statementDate}`}
        backTo="/admin/finance/bank-reconciliation"
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Reconciliation tools"
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                {detail.status === 'IN_PROGRESS' ? (
                  <Button type="button" size="sm" onClick={() => setShowCompleteConfirm(true)}>
                    Complete
                  </Button>
                ) : (
                  <StatusBadge status="COMPLETED" label="Completed" variant="success" />
                )}
              </div>
            }
            sheet={
              detail.status === 'IN_PROGRESS' ? (
                <Button type="button" className="w-full" onClick={() => setShowCompleteConfirm(true)}>
                  Complete
                </Button>
              ) : (
                <StatusBadge status="COMPLETED" label="Completed" variant="success" />
              )
            }
          />
        }
      />

      <MobileDateFilterRow
        hideDate
        actionsSheet={
          detail.status === 'IN_PROGRESS' ? (
            <Button type="button" className="w-full" onClick={() => setShowCompleteConfirm(true)}>
              Complete
            </Button>
          ) : undefined
        }
        actionsSheetTitle="Actions"
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

      <CompactTable
        columns={lineColumns}
        rows={detail.lines}
        rowKey={(r) => r.id}
        renderMobileCard={(r) => {
          const s = LINE_STATUS[r.status] ?? { label: r.status, variant: 'warning' as const };
          return (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-app-fg truncate">{r.statementDescription ?? r.glDescription ?? '-'}</span>
                <StatusBadge status={r.status} label={s.label} variant={s.variant} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                <span>{r.statementDate ?? r.glDate ?? '-'}</span>
                <NairaPrice amount={r.statementAmount ?? r.glAmount ?? 0} className="font-medium text-app-fg" />
              </div>
            </div>
          );
        }}
      />

      <ConfirmActionModal
        open={showCompleteConfirm}
        onClose={() => setShowCompleteConfirm(false)}
        title="Complete reconciliation"
        description={
          <>
            Mark this bank reconciliation as complete? This locks matching for{' '}
            <strong>{(detail.bankAccountName ?? 'this account').replace(/\s*[—–]\s*/g, ' · ')}</strong>{' '}
            (statement date {detail.statementDate}).
          </>
        }
        details={
          <ul className="list-disc pl-4 space-y-1 text-sm">
            <li>{matchedCount} of {detail.lines.length} lines matched</li>
            {unmatchedCount > 0 ? (
              <li>{unmatchedCount} unmatched line{unmatchedCount === 1 ? '' : 's'} will remain unmatched</li>
            ) : (
              <li>All lines are matched</li>
            )}
            <li>Completed reconciliations cannot be edited further</li>
          </ul>
        }
        confirmLabel="Complete"
        variant="warning"
        loading={fetcher.state !== 'idle'}
        onConfirm={handleCompleteConfirm}
      />

      <ConfirmActionModal
        open={!!unmatchTarget}
        onClose={() => setUnmatchTarget(null)}
        title="Unmatch line"
        description="Remove the GL match from this statement line? You can match it again later while the reconciliation is in progress."
        details={
          unmatchTarget ? (
            <p className="text-sm">
              {unmatchTarget.statementDescription ?? 'Statement line'}
              {unmatchTarget.statementAmount !== null ? (
                <> · <NairaPrice amount={unmatchTarget.statementAmount} /></>
              ) : null}
            </p>
          ) : null
        }
        confirmLabel="Unmatch"
        variant="warning"
        loading={fetcher.state !== 'idle'}
        onConfirm={handleUnmatchConfirm}
      />

      {/* Match GL entry modal */}
      <Modal open={!!matchLineId} onClose={() => setMatchLineId(null)} maxWidth="max-w-sm" contentClassName="p-6 space-y-4">
        <h3 className="text-base font-semibold text-app-fg">Match GL entry</h3>
        <p className="text-sm text-app-fg-muted">Paste the GL entry ID to match against this statement line.</p>
        <TextInput
          type="text"
          value={matchGlEntryId}
          onChange={(e) => setMatchGlEntryId(e.target.value)}
          placeholder="GL entry ID (UUID)"
          autoFocus
        />
        <div className="flex gap-2">
          <button type="button" onClick={submitMatch} disabled={!matchGlEntryId.trim() || fetcher.state !== 'idle'} className="btn-primary px-4 py-2 text-sm">
            Match
          </button>
          <button type="button" onClick={() => setMatchLineId(null)} className="btn-secondary px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </Modal>
    </div>
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
      render: (r) => <span className="font-medium text-app-fg">{(r.bankAccountName ?? '-').replace(/\s*[—–]\s*/g, ' · ')}</span>,
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
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      mobileShowLabel: false,
      render: (r) => (
        <div className="flex justify-end">
          <CompactTableActionButton to={`?id=${r.id}`} tone="brand">
            View
          </CompactTableActionButton>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bank Reconciliation"
        description="Match bank statements against ledger entries."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Bank reconciliation tools"
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <Button type="button" size="sm" onClick={() => setShowCreate(true)}>
                  New Reconciliation
                </Button>
              </div>
            }
            sheet={
              <Button type="button" className="w-full" onClick={() => setShowCreate(true)}>
                New Reconciliation
              </Button>
            }
          />
        }
      />

      <MobileDateFilterRow
        hideDate
        actionsSheet={
          <Button type="button" className="w-full" onClick={() => setShowCreate(true)}>
            New Reconciliation
          </Button>
        }
        actionsSheetTitle="Actions"
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
            renderMobileCard={(r) => {
              const s = RECON_STATUS[r.status] ?? { label: r.status, variant: 'info' as const };
              return (
                <Link
                  to={`?id=${r.id}`}
                  className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-app-fg truncate">
                      {(r.bankAccountName ?? 'Bank account').replace(/\s*[—–]\s*/g, ' · ')}
                    </span>
                    <StatusBadge status={r.status} label={s.label} variant={s.variant} />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                    <span>{r.statementDate}</span>
                    <NairaPrice amount={r.statementBalance} className="font-medium text-app-fg" />
                  </div>
                </Link>
              );
            }}
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
    </div>
  );
}
