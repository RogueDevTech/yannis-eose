import { useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Tabs } from '~/components/ui/tabs';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { Pagination } from '~/components/ui/pagination';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { FormSelect } from '~/components/ui/form-select';
import { Modal } from '~/components/ui/modal';
import type { FundingLedgerEntry, FundingLedgerLoaderData } from './types';

const ENTRY_TYPE_TABS = [
  { value: 'all', label: 'All' },
  { value: 'transfer_in', label: 'Transfers In' },
  { value: 'transfer_out', label: 'Transfers Out' },
  { value: 'expense', label: 'Expenses' },
  { value: 'request', label: 'Requests' },
] as const;

const TYPE_LABELS: Record<string, string> = {
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  expense: 'Expense',
  request: 'Request',
};

const TYPE_COLORS: Record<string, string> = {
  transfer_in: 'text-success-600 dark:text-success-400',
  transfer_out: 'text-danger-600 dark:text-danger-400',
  expense: 'text-warning-600 dark:text-warning-400',
  request: 'text-brand-600 dark:text-brand-400',
};

function formatNaira(n: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export function FundingLedgerPage({
  entries,
  total,
  page,
  totalPages,
  limit,
  summary,
  selectedUserId,
  selectedUserName,
  mediaBuyers,
  filters,
  entryTypeFilter,
}: FundingLedgerLoaderData) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailEntry, setDetailEntry] = useState<FundingLedgerEntry | null>(null);

  const columns = useMemo(
    (): CompactTableColumn<FundingLedgerEntry>[] => [
      {
        key: 'date',
        header: 'Date',
        nowrap: true,
        render: (e) => {
          const d = new Date(e.eventDate);
          return (
            <span className="text-xs text-app-fg-muted">
              {d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
              <span className="ml-1 text-app-fg-muted/60">
                {d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </span>
            </span>
          );
        },
      },
      {
        key: 'type',
        header: 'Type',
        nowrap: true,
        minWidth: 'min-w-[6rem]',
        render: (e) => (
          <span className={`text-xs font-medium ${TYPE_COLORS[e.entryType] ?? 'text-app-fg'}`}>
            {TYPE_LABELS[e.entryType] ?? e.entryType}
          </span>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        render: (e) => (
          <span className="text-sm text-app-fg truncate block max-w-[20rem]" title={e.description}>{e.description}</span>
        ),
      },
      {
        key: 'credit',
        header: 'Credit',
        align: 'right',
        nowrap: true,
        render: (e) =>
          e.balanceEffect > 0 ? (
            <span className="text-sm font-medium text-success-600 dark:text-success-400 tabular-nums">
              +<NairaPrice amount={e.balanceEffect} />
            </span>
          ) : (
            <span className="text-sm text-app-fg-muted">—</span>
          ),
      },
      {
        key: 'debit',
        header: 'Debit',
        align: 'right',
        nowrap: true,
        render: (e) =>
          e.balanceEffect < 0 ? (
            <span className="text-sm font-medium text-danger-600 dark:text-danger-400 tabular-nums">
              -<NairaPrice amount={Math.abs(e.balanceEffect)} />
            </span>
          ) : e.balanceEffect === 0 && (e.entryType === 'expense' || e.entryType === 'transfer_out') ? (
            <span className="text-sm font-medium text-app-fg-muted tabular-nums">
              <NairaPrice amount={0} />
            </span>
          ) : (
            <span className="text-sm text-app-fg-muted">—</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (e) => <StatusBadge status={e.status} />,
      },
      {
        key: 'balance',
        header: 'Balance',
        align: 'right',
        nowrap: true,
        render: (e) => {
          if (e.entryType === 'request') return <span className="text-sm text-app-fg-muted">—</span>;
          const bal = e.runningBalance;
          return (
            <span
              className={`text-sm font-semibold tabular-nums ${
                bal < 50000
                  ? 'text-danger-600 dark:text-danger-400'
                  : 'text-success-600 dark:text-success-400'
              }`}
            >
              <NairaPrice amount={bal} />
            </span>
          );
        },
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        render: (e) => (
          <TableActionButton onClick={() => setDetailEntry(e)}>View</TableActionButton>
        ),
      },
    ],
    [],
  );

  const closingBal = Number(summary.closingBalance);
  const openingBal = Number(summary.openingBalance ?? '0');
  const hasDateFilter = !filters.periodAllTime;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding Ledger"
        backTo="/admin/marketing/funding"
        mobileInlineActions
        description={selectedUserName ? `${selectedUserName}` : 'Select a team member to view their funding history.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel="Ledger tools"
            saveFilterKey
            desktop={
              <>
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
                <PageRefreshButton />
              </>
            }
            sheet={<PageRefreshButton />}
          />
        }
      />

      {/* MB Picker */}
      {mediaBuyers.length > 1 && (
        <FormSelect
          label="Team Member"
          value={selectedUserId}
          onChange={(e) => {
            const next = new URLSearchParams(searchParams);
            if (e.target.value) {
              next.set('userId', e.target.value);
            } else {
              next.delete('userId');
            }
            next.delete('page');
            setSearchParams(next);
          }}
          options={[
            { value: '', label: 'Select a team member…' },
            ...mediaBuyers.map((m) => ({ value: m.id, label: m.name })),
          ]}
          wrapperClassName="max-w-xs"
        />
      )}

      {selectedUserId ? (
        <>
          <OverviewStatStrip
            mobileGrid
            items={[
              ...(hasDateFilter ? [{
                label: 'Opening Balance',
                value: formatNaira(openingBal),
                valueClassName: `tabular-nums ${openingBal < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`,
              }] : []),
              { label: 'Total Credits', value: formatNaira(Number(summary.totalCredits)), valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
              { label: 'Total Debits', value: formatNaira(Number(summary.totalDebits)), valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums' },
              {
                label: hasDateFilter ? 'Closing Balance' : 'Current Balance',
                value: formatNaira(closingBal),
                valueClassName: `tabular-nums ${closingBal < 50000 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`,
              },
              { label: 'Transactions', value: total.toString() },
            ]}
          />

          <Tabs
            value={entryTypeFilter}
            onChange={(v) => {
              const next = new URLSearchParams(searchParams);
              next.set('entryType', v);
              next.delete('page');
              setSearchParams(next);
            }}
            tabs={ENTRY_TYPE_TABS.map((t) => ({ value: t.value, label: t.label }))}
          />

          {/* Opening balance row — shown when a date filter is active and on the first page */}
          {hasDateFilter && page === 1 && selectedUserId && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-app-border bg-app-hover/40 px-4 py-2.5">
              <span className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Opening Balance</span>
              <span className={`text-sm font-semibold tabular-nums ${openingBal < 0 ? 'text-danger-600 dark:text-danger-400' : openingBal > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg-muted'}`}>
                <NairaPrice amount={openingBal} />
              </span>
            </div>
          )}

          {entries.length === 0 ? (
            <EmptyState
              title="No transactions"
              description="No funding events found for the selected period and filters."
            />
          ) : (
            <CompactTable<FundingLedgerEntry>
              columns={columns}
              rows={entries}
              rowKey={(e) => `${e.entryType}-${e.id}`}
              renderMobileCard={(e) => (
                <button
                  type="button"
                  onClick={() => setDetailEntry(e)}
                  className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 text-left"
                >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium ${TYPE_COLORS[e.entryType] ?? ''}`}>
                      {TYPE_LABELS[e.entryType]}
                    </span>
                    <span className="text-xs text-app-fg-muted">
                      {new Date(e.eventDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                      <span className="ml-1 text-app-fg-muted/60">
                        {new Date(e.eventDate).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })}
                      </span>
                    </span>
                  </div>
                  <p className="text-sm text-app-fg truncate">{e.description}</p>
                  <div className="flex items-center justify-between gap-2">
                    {e.balanceEffect > 0 ? (
                      <span className="text-sm font-medium text-success-600 dark:text-success-400 tabular-nums">
                        +<NairaPrice amount={e.balanceEffect} />
                      </span>
                    ) : e.balanceEffect < 0 ? (
                      <span className="text-sm font-medium text-danger-600 dark:text-danger-400 tabular-nums">
                        -<NairaPrice amount={Math.abs(e.balanceEffect)} />
                      </span>
                    ) : (
                      <span className="text-sm text-app-fg-muted">
                        <NairaPrice amount={Number(e.amount)} />
                      </span>
                    )}
                    {e.entryType !== 'request' && (
                      <span
                        className={`text-xs font-semibold tabular-nums ${
                          e.runningBalance < 50000
                            ? 'text-danger-600 dark:text-danger-400'
                            : 'text-success-600 dark:text-success-400'
                        }`}
                      >
                        Bal: <NairaPrice amount={e.runningBalance} />
                      </span>
                    )}
                  </div>
                  <StatusBadge status={e.status} />
                </div>
                </button>
              )}
            />
          )}

          {totalPages > 1 && (
            <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-app-fg-muted">
                Showing {entries.length} of {total} transactions
              </p>
              <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} pageSizeParam="perPage" />
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="Select a team member"
          description="Pick a team member above to view their complete funding history."
        />
      )}

      {/* Detail modal */}
      <Modal
        open={!!detailEntry}
        onClose={() => setDetailEntry(null)}
      >
        {detailEntry && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-app-fg">Transaction Detail</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider">Type</p>
                <p className={`font-medium ${TYPE_COLORS[detailEntry.entryType] ?? 'text-app-fg'}`}>
                  {TYPE_LABELS[detailEntry.entryType] ?? detailEntry.entryType}
                </p>
              </div>
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider">Date</p>
                <p className="text-app-fg">
                  {new Date(detailEntry.eventDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' '}
                  {new Date(detailEntry.eventDate).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </p>
              </div>
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider">Amount</p>
                <p className="font-medium tabular-nums text-app-fg">
                  <NairaPrice amount={Number(detailEntry.amount)} />
                </p>
              </div>
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider">Status</p>
                <StatusBadge status={detailEntry.status} />
              </div>
              {detailEntry.balanceEffect !== 0 && (
                <div>
                  <p className="text-app-fg-muted text-xs uppercase tracking-wider">
                    {detailEntry.balanceEffect > 0 ? 'Credit' : 'Debit'}
                  </p>
                  <p className={`font-medium tabular-nums ${detailEntry.balanceEffect > 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
                    {detailEntry.balanceEffect > 0 ? '+' : '-'}
                    <NairaPrice amount={Math.abs(detailEntry.balanceEffect)} />
                  </p>
                </div>
              )}
              {detailEntry.entryType !== 'request' && (
                <div>
                  <p className="text-app-fg-muted text-xs uppercase tracking-wider">Running Balance</p>
                  <p className={`font-semibold tabular-nums ${detailEntry.runningBalance < 50000 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                    <NairaPrice amount={detailEntry.runningBalance} />
                  </p>
                </div>
              )}
            </div>
            {detailEntry.description && (
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">Description</p>
                <p className="text-sm text-app-fg">{detailEntry.description}</p>
              </div>
            )}
            {detailEntry.counterpartyName && (
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">Counterparty</p>
                <p className="text-sm text-app-fg">{detailEntry.counterpartyName}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
