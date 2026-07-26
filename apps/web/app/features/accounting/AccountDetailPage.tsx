import { useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { Button } from '~/components/ui/button';
import { TextInput } from '~/components/ui/text-input';
import { Modal } from '~/components/ui/modal';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import {
  CompactTable,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { NairaPrice } from '~/components/ui/naira-price';
import { RealMoneyTag } from '~/components/ui/real-money-tag';
import { StatusBadge } from '~/components/ui/status-badge';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { DateTimeText } from '~/components/ui/date-time-text';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AccountInfo {
  id: string;
  code: string;
  name: string;
  rootType: string;
  accountType: string | null;
  isGroup: boolean;
  isActive: boolean;
  balance: string;
  parentAccountId: string | null;
}

export interface LedgerEntryRow {
  id: string;
  postingDate: string;
  createdAt?: string | null;
  journalEntryNumber: number | null;
  description: string;
  debit: string;
  credit: string;
  runningBalance: string;
  voucherType: string;
  journalStatus?: string | null;
}

export interface AccountDetailPageProps {
  account: AccountInfo;
  entries: LedgerEntryRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  summary: { totalDebit: string; totalCredit: string; netBalance: string; entryCount: number };
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  canWrite?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Replace em dashes with dot separators in display names. */
function displayName(name: string): string {
  return name.replace(/\s*[—–]\s*/g, ' · ');
}

/** Normal balance based on root type per IFRS. */
function normalBalance(rootType: string): 'Debit' | 'Credit' {
  return rootType === 'ASSET' || rootType === 'EXPENSE' ? 'Debit' : 'Credit';
}

/** Human label for root type. */
const ROOT_LABELS: Record<string, string> = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expense',
};

/** Human label for a semantic account type tag. */
function typeLabel(accountType: string | null): string {
  if (!accountType) return 'General';
  const words = accountType.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatJeNumber(n: number | null): string {
  if (n == null) return '';
  return `JE-${String(n).padStart(4, '0')}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AccountDetailPage({
  account,
  entries,
  pagination,
  summary,
  filters,
  canWrite,
}: AccountDetailPageProps) {
  const [, setSearchParams] = useSearchParams();
  const [showEdit, setShowEdit] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);

  const editFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const deactivateFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(editFetcher.data, { successMessage: 'Account updated' });
  useFetcherToast(deactivateFetcher.data, { successMessage: 'Account deactivated' });
  useCloseOnFetcherSuccess(editFetcher, () => setShowEdit(false));
  useCloseOnFetcherSuccess(deactivateFetcher, () => setShowDeactivate(false));

  const netNum = Number(summary.netBalance);

  const columns: CompactTableColumn<LedgerEntryRow>[] = [
    {
      key: 'postingDate',
      header: 'Date',
      render: (r) => (
        <DateTimeText at={r.createdAt} dateOnly={r.postingDate} className="text-xs" />
      ),
    },
    {
      key: 'journalEntryNumber',
      header: 'JE #',
      render: (r) =>
        r.journalEntryNumber ? (
          <Link
            to={`/admin/finance/journal-entries?search=${encodeURIComponent(formatJeNumber(r.journalEntryNumber))}`}
            className="text-xs font-mono text-brand-600 hover:underline"
          >
            {formatJeNumber(r.journalEntryNumber)}
          </Link>
        ) : (
          <span className="text-xs text-app-fg-muted">{r.voucherType}</span>
        ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (r) => (
        <span className={`text-sm truncate max-w-[200px] md:max-w-[300px] block ${r.journalStatus === 'CANCELLED' ? 'text-app-fg-muted line-through' : 'text-app-fg'}`}>
          {r.description || 'No description'}
          {r.journalStatus === 'CANCELLED' && (
            <StatusBadge status="CANCELLED" size="sm" className="ml-1.5 no-underline" />
          )}
        </span>
      ),
    },
    {
      key: 'debit',
      header: 'Debit',
      align: 'right',
      render: (r) => Number(r.debit) > 0
        ? <span className="text-danger-600 dark:text-danger-400 tabular-nums"><NairaPrice amount={r.debit} /></span>
        : <span className="text-app-fg-muted">-</span>,
    },
    {
      key: 'credit',
      header: 'Credit',
      align: 'right',
      render: (r) => Number(r.credit) > 0
        ? <span className="text-success-600 dark:text-success-400 tabular-nums"><NairaPrice amount={r.credit} /></span>
        : <span className="text-app-fg-muted">-</span>,
    },
    {
      key: 'runningBalance',
      header: 'Balance',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums text-sm font-medium">
          <NairaPrice amount={r.runningBalance} />
        </span>
      ),
    },
  ];

  const renderMobileCard = (r: LedgerEntryRow) => {
    const net = Number(r.debit) - Number(r.credit);
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <DateTimeText at={r.createdAt} dateOnly={r.postingDate} className="text-xs" />
            {r.journalEntryNumber ? (
              <Link
                to={`/admin/finance/journal-entries?search=${encodeURIComponent(formatJeNumber(r.journalEntryNumber))}`}
                className="text-xs font-mono text-brand-600"
              >
                {formatJeNumber(r.journalEntryNumber)}
              </Link>
            ) : (
              <span className="text-[10px] text-app-fg-muted uppercase">{r.voucherType}</span>
            )}
          </div>
          <p className="text-sm text-app-fg truncate mt-0.5">{r.description || 'No description'}</p>
        </div>
        <div className="text-right shrink-0">
          <span className={`text-sm font-medium tabular-nums ${net >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
            <NairaPrice amount={Math.abs(net)} />
          </span>
          <span className="text-[10px] text-app-fg-muted uppercase block">
            {net >= 0 ? 'Dr' : 'Cr'}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={displayName(account.name)}
        description={`Account ${account.code} sub-ledger entries.`}
        backTo="/admin/finance/accounts"
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel="Account ledger toolbar"
            saveFilterKey
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
                {canWrite && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>
                      Rename
                    </Button>
                    {account.isActive && (
                      <Button variant="danger" size="sm" onClick={() => setShowDeactivate(true)}>
                        Deactivate
                      </Button>
                    )}
                  </>
                )}
              </div>
            }
            sheet={({ closeSheet }) => canWrite ? (
              <div className="space-y-2">
                <Button variant="secondary" size="sm" className="w-full justify-center h-12" onClick={() => { closeSheet(); setShowEdit(true); }}>
                  Rename
                </Button>
                {account.isActive && (
                  <Button variant="danger" size="sm" className="w-full justify-center h-12" onClick={() => { closeSheet(); setShowDeactivate(true); }}>
                    Deactivate
                  </Button>
                )}
              </div>
            ) : null}
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      {/* Account info card */}
      <div className="card p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-sm">
          <div>
            <span className="text-xs text-app-fg-muted block">Code</span>
            <span className="font-mono font-medium">{account.code}</span>
          </div>
          <div>
            <span className="text-xs text-app-fg-muted block">Root Type</span>
            <span className="font-medium">{ROOT_LABELS[account.rootType] ?? account.rootType}</span>
          </div>
          <div>
            <span className="text-xs text-app-fg-muted block">Account Type</span>
            <span className="font-medium">
              {typeLabel(account.accountType)}
              <RealMoneyTag accountType={account.accountType} />
            </span>
          </div>
          <div>
            <span className="text-xs text-app-fg-muted block">Normal Balance</span>
            <span className="font-medium">{normalBalance(account.rootType)}</span>
          </div>
          <div>
            <span className="text-xs text-app-fg-muted block">Status</span>
            <StatusBadge status={account.isActive ? 'Active' : 'Inactive'} />
          </div>
          <div>
            <span className="text-xs text-app-fg-muted block">Group</span>
            <span className="font-medium">{account.isGroup ? 'Yes (header)' : 'No (postable)'}</span>
          </div>
        </div>
      </div>

      <OverviewStatStrip
        items={[
          { label: 'Total Debit', value: <NairaPrice amount={summary.totalDebit} /> },
          { label: 'Total Credit', value: <NairaPrice amount={summary.totalCredit} /> },
          {
            label: 'Net Balance',
            value: <NairaPrice amount={summary.netBalance} />,
            valueClassName: netNum >= 0 ? 'text-success-600' : 'text-danger-600',
          },
          { label: 'Entries', value: String(summary.entryCount) },
        ]}
      />

      {entries.length === 0 ? (
        <EmptyState
          title="No entries"
          description="No GL entries found for this account in the selected period."
        />
      ) : (
        <>
          <CompactTable<LedgerEntryRow>
            rows={entries}
            columns={columns}
            rowKey={(r) => r.id}
            renderMobileCard={(r) => renderMobileCard(r)}
          />
          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            onPageChange={(p: number) =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('page', String(p));
                return next;
              })
            }
          />
        </>
      )}

      {/* Rename modal */}
      {showEdit && (
        <Modal open onClose={() => setShowEdit(false)} maxWidth="max-w-sm">
          <div className="p-5 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Rename Account</h2>
            <editFetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="updateAccount" />
              <input type="hidden" name="accountId" value={account.id} />
              <TextInput label="Name" name="name" defaultValue={account.name} required />
              {editFetcher.data?.error && (
                <p className="text-sm text-danger-600">{editFetcher.data.error}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowEdit(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" loading={editFetcher.state !== 'idle'} loadingText="Saving...">
                  Save
                </Button>
              </div>
            </editFetcher.Form>
          </div>
        </Modal>
      )}

      {/* Deactivate confirmation */}
      <ConfirmActionModal
        open={showDeactivate}
        onClose={() => setShowDeactivate(false)}
        title="Deactivate account"
        description={`Deactivate "${account.code} ${displayName(account.name)}"? It will no longer be selectable for new postings.`}
        confirmLabel="Deactivate"
        variant="danger"
        loading={deactivateFetcher.state !== 'idle'}
        onConfirm={() => {
          deactivateFetcher.submit(
            { intent: 'deactivateAccount', accountId: account.id },
            { method: 'post' },
          );
        }}
      />
    </div>
  );
}
