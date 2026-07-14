import { useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { Pagination } from '~/components/ui/pagination';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { StatusBadge } from '~/components/ui/status-badge';
import { SearchInput } from '~/components/ui/search-input';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { Modal } from '~/components/ui/modal';
import { LocalExportModal } from '~/components/ui/local-export-modal';
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
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') ?? '');
  const [showExport, setShowExport] = useState(false);

  const columns = useMemo(
    (): CompactTableColumn<FundingLedgerEntry>[] => [
      {
        key: 'txnId',
        header: 'Transaction ID',
        nowrap: true,
        hideable: false,
        render: (e) => {
          if (e.id === '__opening_balance__' || e.id === '__closing_balance__') return null;
          const shortId = `TXN-${e.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
          return <OrderIdBadge id={shortId} length={20} ellipsis="" textClassName="font-mono text-xs text-app-fg-muted" />;
        },
      },
      {
        key: 'date',
        header: 'Date',
        nowrap: true,
        render: (e) => {
          if (e.id === '__opening_balance__' || e.id === '__closing_balance__') {
            if (!e.eventDate) return null;
            const d = new Date(e.eventDate);
            return (
              <span className="text-xs text-brand-600 dark:text-brand-400">
                {d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            );
          }
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
        render: (e) => {
          if (e.id === '__opening_balance__') {
            return <span className="text-xs font-medium text-brand-600 dark:text-brand-400">Opening</span>;
          }
          if (e.id === '__closing_balance__') {
            return <span className="text-xs font-medium text-brand-600 dark:text-brand-400">Closing</span>;
          }
          return (
            <span className={`text-xs font-medium ${TYPE_COLORS[e.entryType] ?? 'text-app-fg'}`}>
              {TYPE_LABELS[e.entryType] ?? e.entryType}
            </span>
          );
        },
      },
      {
        key: 'description',
        header: 'Description',
        render: (e) => {
          if (e.id === '__opening_balance__') {
            return <span className="text-xs font-semibold text-brand-600 dark:text-brand-400 uppercase tracking-wider">Opening Balance</span>;
          }
          if (e.id === '__closing_balance__') {
            return <span className="text-xs font-semibold text-brand-600 dark:text-brand-400 uppercase tracking-wider">Closing Balance</span>;
          }
          return <span className="text-sm text-app-fg truncate block max-w-[8rem] sm:max-w-[14rem] lg:max-w-[20rem]" title={e.description}>{e.description}</span>;
        },
      },
      {
        key: 'counterparty',
        header: 'From / To',
        render: (e) => {
          if (e.id === '__opening_balance__' || e.id === '__closing_balance__') return null;
          if (e.counterpartyName && (e.entryType === 'transfer_in' || e.entryType === 'transfer_out')) {
            const prefix = e.entryType === 'transfer_in' ? 'From' : 'To';
            return (
              <span className="text-sm text-app-fg truncate block max-w-[10rem]" title={`${prefix}: ${e.counterpartyName}`}>
                <span className="text-app-fg-muted">{prefix}:</span> {e.counterpartyName}
              </span>
            );
          }
          if (e.counterpartyName) {
            return <span className="text-sm text-app-fg truncate block max-w-[10rem]" title={e.counterpartyName}>{e.counterpartyName}</span>;
          }
          if (e.entryType === 'expense') return <span className="text-sm text-app-fg-muted">Ad platform</span>;
          if (e.entryType === 'request') return <span className="text-sm text-app-fg-muted">HoM</span>;
          return <span className="text-sm text-app-fg-muted">—</span>;
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (e) => (e.id === '__opening_balance__' || e.id === '__closing_balance__') ? null : <StatusBadge status={e.status} textOnly />,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        nowrap: true,
        render: (e) => {
          if (e.id === '__opening_balance__' || e.id === '__closing_balance__') return null;
          if (e.balanceEffect > 0) {
            return (
              <span className="text-sm font-medium text-success-600 dark:text-success-400 tabular-nums">
                +<NairaPrice amount={e.balanceEffect} />
              </span>
            );
          }
          if (e.balanceEffect < 0) {
            return (
              <span className="text-sm font-medium text-danger-600 dark:text-danger-400 tabular-nums">
                -<NairaPrice amount={Math.abs(e.balanceEffect)} />
              </span>
            );
          }
          return <span className="text-sm text-app-fg-muted tabular-nums"><NairaPrice amount={0} /></span>;
        },
      },
      {
        key: 'balance',
        header: 'Balance',
        align: 'right',
        nowrap: true,
        render: (e) => {
          if (e.id === '__opening_balance__' || e.id === '__closing_balance__') {
            return (
              <span className="text-sm font-semibold tabular-nums text-brand-600 dark:text-brand-400">
                <NairaPrice amount={e.runningBalance} />
              </span>
            );
          }
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
        hideable: false,
        render: (e) => (e.id === '__opening_balance__' || e.id === '__closing_balance__') ? null : (
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
                {entries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowExport(true)}
                    className="btn-secondary btn-sm gap-1.5"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Export
                  </button>
                )}
              </>
            }
            sheet={
              <>
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
                {entries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowExport(true)}
                    className="btn-secondary btn-sm gap-1.5"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Export
                  </button>
                )}
                <PageRefreshButton />
              </>
            }
          />
        }
      />

      {selectedUserId ? (
        <>
          <OverviewStatStrip
            mobileGrid
            items={[
              {
                label: hasDateFilter ? 'Opening Balance' : 'Starting Balance',
                value: formatNaira(openingBal),
                valueClassName: `tabular-nums ${openingBal < 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg'}`,
              },
              { label: 'Total Credits', value: formatNaira(Number(summary.totalCredits)), valueClassName: 'text-success-600 dark:text-success-400 tabular-nums' },
              { label: 'Total Debits', value: formatNaira(Number(summary.totalDebits)), valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums' },
              {
                label: 'Net Movement',
                value: formatNaira(Number(summary.totalCredits) - Number(summary.totalDebits)),
                valueClassName: `tabular-nums ${Number(summary.totalCredits) - Number(summary.totalDebits) >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`,
              },
              {
                label: hasDateFilter ? 'Closing Balance' : 'Current Balance',
                value: formatNaira(closingBal),
                valueClassName: `tabular-nums ${closingBal < 50000 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`,
              },
              { label: 'Transactions', value: total.toString() },
            ]}
          />

          <ToolbarFiltersCollapsible
            badgeCount={(entryTypeFilter !== 'all' ? 1 : 0) + (mediaBuyers.length > 1 && selectedUserId ? 1 : 0)}
            desktopInlineFilters={
              <>
                <form
                  className="contents"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSearchParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('page', '1');
                      if (searchQuery.trim()) next.set('search', searchQuery.trim());
                      else next.delete('search');
                      return next;
                    });
                  }}
                >
                  <SearchInput
                    name="search"
                    placeholder="Search by name or description..."
                    value={searchQuery}
                    onChange={(val) => {
                      setSearchQuery(val);
                      if (!val.trim() && searchParams.get('search')) {
                        setSearchParams((p) => {
                          const next = new URLSearchParams(p);
                          next.delete('search');
                          next.set('page', '1');
                          return next;
                        });
                      }
                    }}
                    withSubmitButton
                    wrapperClassName="w-full sm:min-w-[280px]"
                  />
                </form>
                {mediaBuyers.length > 1 && (
                  <SearchableSelect
                    id="ledger-user-filter"
                    value={selectedUserId}
                    onChange={(val) => {
                      const next = new URLSearchParams(searchParams);
                      if (val) next.set('userId', val);
                      else next.delete('userId');
                      next.delete('page');
                      setSearchParams(next);
                    }}
                    options={[
                      { value: '', label: 'All users' },
                      ...mediaBuyers.map((m) => ({ value: m.id, label: m.name })),
                    ]}
                    placeholder="All users"
                    clearable
                    wrapperClassName="w-full sm:w-52"
                  />
                )}
                <FormSelect
                  label=""
                  value={entryTypeFilter}
                  onChange={(e) => {
                    const next = new URLSearchParams(searchParams);
                    next.set('entryType', e.target.value);
                    next.delete('page');
                    setSearchParams(next);
                  }}
                  options={ENTRY_TYPE_TABS.map((t) => ({ value: t.value, label: t.label }))}
                  wrapperClassName="w-full sm:w-36"
                />
              </>
            }
            sheetFilterBody={
              <>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Search</span>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.set('page', '1');
                        if (searchQuery.trim()) next.set('search', searchQuery.trim());
                        else next.delete('search');
                        return next;
                      });
                    }}
                  >
                    <SearchInput
                      name="search"
                      placeholder="Search..."
                      value={searchQuery}
                      onChange={(val) => {
                        setSearchQuery(val);
                        if (!val.trim() && searchParams.get('search')) {
                          setSearchParams((p) => {
                            const next = new URLSearchParams(p);
                            next.delete('search');
                            next.set('page', '1');
                            return next;
                          });
                        }
                      }}
                      withSubmitButton
                      wrapperClassName="w-full"
                    />
                  </form>
                </div>
                {mediaBuyers.length > 1 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">User</span>
                    <SearchableSelect
                      id="ledger-user-filter-sheet"
                      value={selectedUserId}
                      onChange={(val) => {
                        const next = new URLSearchParams(searchParams);
                        if (val) next.set('userId', val);
                        else next.delete('userId');
                        next.delete('page');
                        setSearchParams(next);
                      }}
                      options={[
                        { value: '', label: 'All users' },
                        ...mediaBuyers.map((m) => ({ value: m.id, label: m.name })),
                      ]}
                      placeholder="All users"
                      clearable
                      wrapperClassName="w-full"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Type</span>
                  <FormSelect
                    label=""
                    value={entryTypeFilter}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams);
                      next.set('entryType', e.target.value);
                      next.delete('page');
                      setSearchParams(next);
                    }}
                    options={ENTRY_TYPE_TABS.map((t) => ({ value: t.value, label: t.label }))}
                    wrapperClassName="w-full"
                  />
                </div>
              </>
            }
          />

          {entries.length === 0 ? (
            <EmptyState
              title="No transactions"
              description="No funding events found for the selected period and filters."
            />
          ) : (
            <CompactTable<FundingLedgerEntry>
              columnVisibilityKey="admin.marketing.funding-ledger"
              columns={columns}
              rows={(() => {
                if (page !== 1 || !selectedUserId) return entries;
                // Date: filter start date when date-filtered, or first transaction date for all-time
                const openingDate = hasDateFilter && filters.startDate
                  ? new Date(filters.startDate + 'T00:00:00').toISOString()
                  : entries.length > 0 ? entries[0]!.eventDate : '';
                const openingRow: FundingLedgerEntry = {
                  id: '__opening_balance__',
                  entryType: 'transfer_in' as const,
                  eventDate: openingDate,
                  amount: String(openingBal),
                  balanceEffect: 0,
                  runningBalance: openingBal,
                  status: '',
                  description: 'OPENING BALANCE',
                  counterpartyName: null,
                };
                // Closing balance row — shown on the last page
                const isLastPage = page >= totalPages;
                const closingDate = hasDateFilter && filters.endDate
                  ? new Date(filters.endDate + 'T23:59:59').toISOString()
                  : entries.length > 0 ? entries[entries.length - 1]!.eventDate : '';
                const closingRow: FundingLedgerEntry = {
                  id: '__closing_balance__',
                  entryType: 'transfer_in' as const,
                  eventDate: closingDate,
                  amount: String(closingBal),
                  balanceEffect: 0,
                  runningBalance: closingBal,
                  status: '',
                  description: 'CLOSING BALANCE',
                  counterpartyName: null,
                };
                const rows = [openingRow, ...entries];
                if (isLastPage) rows.push(closingRow);
                return rows;
              })()}
              rowKey={(e) => `${e.entryType}-${e.id}`}
              rowClassName={(e) => (e.id === '__opening_balance__' || e.id === '__closing_balance__') ? 'bg-brand-50/40 dark:bg-brand-900/10' : ''}
              renderMobileCard={(e) => {
                // Opening / Closing balance — branded standalone card
                if (e.id === '__opening_balance__' || e.id === '__closing_balance__') {
                  return (
                    <div className="-mx-3 -my-2.5 w-[calc(100%+1.5rem)] px-3 py-3 bg-brand-50/40 dark:bg-brand-900/10 border-l-2 border-brand-500">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-brand-600 dark:text-brand-400 uppercase tracking-wider">
                          {e.id === '__opening_balance__' ? 'Opening Balance' : 'Closing Balance'}
                        </span>
                        {e.eventDate && (
                          <span className="text-xs text-brand-500 dark:text-brand-400">
                            {new Date(e.eventDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                      <span className="text-base font-bold tabular-nums text-brand-600 dark:text-brand-400 mt-1 block">
                        <NairaPrice amount={e.runningBalance} />
                      </span>
                    </div>
                  );
                }
                // Regular transaction card
                return (
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
                    <StatusBadge status={e.status} textOnly />
                  </div>
                  </button>
                );
              }}
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
        <>
          {mediaBuyers.length > 1 && (
            <div className="max-w-xs">
              <label className="block text-xs font-medium text-app-fg-muted mb-1">Team Member</label>
              <SearchableSelect
                id="ledger-user-select"
                value=""
                onChange={(val) => {
                  const next = new URLSearchParams(searchParams);
                  if (val) next.set('userId', val);
                  next.delete('page');
                  setSearchParams(next);
                }}
                options={mediaBuyers.map((m) => ({ value: m.id, label: m.name }))}
                placeholder="Select a team member…"
              />
            </div>
          )}
          <EmptyState
            title="Select a team member"
            description="Pick a team member to view their funding history."
          />
        </>
      )}

      {/* Export modal */}
      <LocalExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        title="Export Funding Ledger"
        description={`${selectedUserName ?? 'All members'}: ${filters.periodAllTime ? 'All time' : `${filters.startDate} to ${filters.endDate}`}`}
        rows={entries.map((e) => ({
          txnId: `TXN-${e.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
          date: new Date(e.eventDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }),
          type: TYPE_LABELS[e.entryType] ?? e.entryType,
          description: e.description,
          counterparty: e.counterpartyName ?? '',
          amount: e.balanceEffect > 0 ? `+₦${Math.abs(e.balanceEffect).toLocaleString()}` : e.balanceEffect < 0 ? `-₦${Math.abs(e.balanceEffect).toLocaleString()}` : '₦0',
          status: e.status,
          balance: e.runningBalance,
        }))}
        columns={[
          { key: 'txnId', label: 'Transaction ID' },
          { key: 'date', label: 'Date' },
          { key: 'type', label: 'Type' },
          { key: 'description', label: 'Description' },
          { key: 'counterparty', label: 'Counterparty' },
          { key: 'amount', label: 'Amount' },
          { key: 'status', label: 'Status' },
          { key: 'balance', label: 'Balance' },
        ]}
        defaultColumns={['txnId', 'date', 'type', 'description', 'counterparty', 'status', 'amount', 'balance']}
        filenamePrefix={`funding-ledger-${selectedUserName?.replace(/\s+/g, '-').toLowerCase() ?? 'all'}`}
      />

      {/* Detail modal */}
      <Modal
        open={!!detailEntry}
        onClose={() => setDetailEntry(null)}
        maxWidth="max-w-md"
        contentClassName="p-5 md:p-6"
      >
        {detailEntry && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-app-fg">Transaction Detail</h2>
              <div className="mt-1">
                <OrderIdBadge id={`TXN-${detailEntry.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`} length={20} ellipsis="" textClassName="font-mono text-xs text-app-fg-muted" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">Type</p>
                <p className={`font-medium ${TYPE_COLORS[detailEntry.entryType] ?? 'text-app-fg'}`}>
                  {TYPE_LABELS[detailEntry.entryType] ?? detailEntry.entryType}
                </p>
              </div>
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">Date</p>
                <p className="text-app-fg">
                  {new Date(detailEntry.eventDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' '}
                  {new Date(detailEntry.eventDate).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </p>
              </div>
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">Amount</p>
                <p className="font-medium tabular-nums text-app-fg">
                  <NairaPrice amount={Number(detailEntry.amount)} />
                </p>
              </div>
              <div>
                <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">Status</p>
                <StatusBadge status={detailEntry.status} />
              </div>
              {detailEntry.balanceEffect !== 0 && (
                <div>
                  <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">
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
                  <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">Running Balance</p>
                  <p className={`font-semibold tabular-nums ${detailEntry.runningBalance < 50000 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                    <NairaPrice amount={detailEntry.runningBalance} />
                  </p>
                </div>
              )}
            </div>

            {(detailEntry.description || detailEntry.counterpartyName) && (
              <div className="space-y-3 pt-3 border-t border-app-border">
                {detailEntry.counterpartyName && (detailEntry.entryType === 'transfer_in' || detailEntry.entryType === 'transfer_out') ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">From</p>
                      <p className="text-sm font-medium text-app-fg">
                        {detailEntry.entryType === 'transfer_in' ? detailEntry.counterpartyName : selectedUserName}
                      </p>
                    </div>
                    <div>
                      <p className="text-app-fg-muted text-xs uppercase tracking-wider mb-1">To</p>
                      <p className="text-sm font-medium text-app-fg">
                        {detailEntry.entryType === 'transfer_out' ? detailEntry.counterpartyName : selectedUserName}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
