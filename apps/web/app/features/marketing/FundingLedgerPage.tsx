import { useMemo } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Tabs } from '~/components/ui/tabs';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Pagination } from '~/components/ui/pagination';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { FormSelect } from '~/components/ui/form-select';
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
  summary,
  selectedUserId,
  selectedUserName,
  mediaBuyers,
  filters,
  entryTypeFilter,
}: FundingLedgerLoaderData) {
  const [searchParams, setSearchParams] = useSearchParams();

  const columns = useMemo(
    (): CompactTableColumn<FundingLedgerEntry>[] => [
      {
        key: 'date',
        header: 'Date',
        nowrap: true,
        render: (e) => (
          <span className="text-xs text-app-fg-muted">
            {new Date(e.eventDate).toLocaleDateString('en-NG', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        ),
      },
      {
        key: 'type',
        header: 'Type',
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
          <span className="text-sm text-app-fg line-clamp-1">{e.description}</span>
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
          ) : e.entryType === 'request' ? (
            <span className="text-sm text-app-fg-muted">—</span>
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
    ],
    [],
  );

  const closingBal = Number(summary.closingBalance);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding Ledger"
        backTo="/admin/marketing/funding"
        mobileInlineActions
        description={selectedUserName ? `${selectedUserName}` : 'Select a media buyer to view their funding history.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel="Ledger tools"
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
          label="Media Buyer"
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
            { value: '', label: 'Select a media buyer…' },
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
              { label: 'Total Credits', value: formatNaira(Number(summary.totalCredits)), valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
              { label: 'Total Debits', value: formatNaira(Number(summary.totalDebits)), valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums' },
              {
                label: 'Closing Balance',
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
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium ${TYPE_COLORS[e.entryType] ?? ''}`}>
                      {TYPE_LABELS[e.entryType]}
                    </span>
                    <span className="text-xs text-app-fg-muted">
                      {new Date(e.eventDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
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
              )}
            />
          )}

          {totalPages > 1 && (
            <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-app-fg-muted">
                Showing {entries.length} of {total} transactions
              </p>
              <Pagination page={page} totalPages={totalPages} pageParam="page" />
            </div>
          )}
        </>
      ) : (
        <EmptyState
          title="Select a media buyer"
          description="Pick a media buyer above to view their complete funding history."
        />
      )}
    </div>
  );
}
