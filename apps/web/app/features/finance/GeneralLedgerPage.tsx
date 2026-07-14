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
import { Modal } from '~/components/ui/modal';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import type { GeneralLedgerEntry, GeneralLedgerLoaderData } from './types';

const ENTRY_TYPE_OPTIONS = [
  { value: 'all', label: 'All transactions' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'remittance_in', label: 'Remittance In' },
  { value: 'remittance_out', label: 'Remittance Fees' },
  { value: 'disbursement', label: 'Disbursements' },
  { value: 'ad_spend', label: 'Ad Spend' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'funding_transfer', label: 'Fund Transfers' },
] as const;

const TYPE_COLORS: Record<string, string> = {
  revenue: 'text-success-600 dark:text-success-400',
  remittance_in: 'text-success-600 dark:text-success-400',
  remittance_out: 'text-danger-600 dark:text-danger-400',
  disbursement: 'text-warning-600 dark:text-warning-400',
  ad_spend: 'text-danger-600 dark:text-danger-400',
  payroll: 'text-brand-600 dark:text-brand-400',
  funding_transfer: 'text-info-600 dark:text-info-400',
};

const TYPE_LABELS: Record<string, string> = {
  revenue: 'Revenue',
  remittance_in: 'Remittance In',
  remittance_out: 'Remittance Fee',
  disbursement: 'Disbursement',
  ad_spend: 'Ad Spend',
  payroll: 'Payroll',
  funding_transfer: 'Fund Transfer',
};

function formatNaira(n: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}



export function GeneralLedgerPage({
  entries,
  total,
  page,
  totalPages,
  limit,
  summary,
  users,
  selectedUserId,
  selectedUserName: _selectedUserName,
  filters,
  entryTypeFilter,
  searchFilter,
}: GeneralLedgerLoaderData) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailEntry, setDetailEntry] = useState<GeneralLedgerEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchFilter ?? searchParams.get('search') ?? '');
  const [showExport, setShowExport] = useState(false);


  const columns = useMemo(
    (): CompactTableColumn<GeneralLedgerEntry>[] => [
      {
        key: 'txnId',
        header: 'Transaction ID',
        hideable: false,
        nowrap: true,
        render: (e) => {
          const shortId = `TXN-${e.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
          return (
            <OrderIdBadge
              id={shortId}
              length={20}
              ellipsis=""
              textClassName="font-mono text-xs text-app-fg-muted"
            />
          );
        },
      },
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
        minWidth: 'min-w-[7rem]',
        render: (e) => {
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
          return (
            <span
              className="text-sm text-app-fg truncate block max-w-[8rem] sm:max-w-[14rem] lg:max-w-[20rem]"
              title={e.description}
            >
              {e.description}
            </span>
          );
        },
      },
      {
        key: 'counterparty',
        header: 'Counterparty',
        render: (e) => {
          return e.counterpartyName ? (
            <span className="text-sm text-app-fg truncate block max-w-[10rem]" title={e.counterpartyName}>
              {e.counterpartyName}
            </span>
          ) : (
            <span className="text-sm text-app-fg-muted">—</span>
          );
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (e) =>
          <StatusBadge status={e.status} textOnly />,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        nowrap: true,
        render: (e) => {
          if (e.balanceEffect > 0) {
            return (
              <span className="text-sm font-medium text-success-600 dark:text-success-400 tabular-nums">
                +<NairaPrice amount={e.balanceEffect} />
              </span>
            );
          }
          return (
            <span className="text-sm font-medium text-danger-600 dark:text-danger-400 tabular-nums">
              -<NairaPrice amount={Math.abs(e.balanceEffect)} />
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
        render: (e) =>
          <TableActionButton onClick={() => setDetailEntry(e)}>View</TableActionButton>,
      },
    ],
    [],
  );


  return (
    <div className="space-y-4">
      <PageHeader
        title="General Ledger"
        mobileInlineActions
        description="Company-wide financial transactions."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel="General Ledger tools"
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
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Export
                  </button>
                )}
              </>
            }
            filters={
              <>
                {users.length > 0 && (
                  <FormSelect
                    label="User"
                    value={selectedUserId}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams);
                      if (e.target.value) next.set('userId', e.target.value);
                      else next.delete('userId');
                      next.delete('page');
                      setSearchParams(next);
                    }}
                    options={[
                      { value: '', label: 'All users' },
                      ...users.map((u) => ({ value: u.id, label: u.name })),
                    ]}
                  />
                )}
                <FormSelect
                  label="Type"
                  value={entryTypeFilter}
                  onChange={(e) => {
                    const next = new URLSearchParams(searchParams);
                    next.set('entryType', e.target.value);
                    next.delete('page');
                    setSearchParams(next);
                  }}
                  options={ENTRY_TYPE_OPTIONS}
                />
              </>
            }
            sheet={<PageRefreshButton />}
          />
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          {
            label: 'Total Credits',
            value: formatNaira(Number(summary.totalCredits)),
            valueClassName: 'text-success-600 dark:text-success-400 tabular-nums',
          },
          {
            label: 'Total Debits',
            value: formatNaira(Number(summary.totalDebits)),
            valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums',
          },
          {
            label: 'Net',
            value: formatNaira(Number(summary.totalCredits) - Number(summary.totalDebits)),
            valueClassName: `tabular-nums ${Number(summary.totalCredits) - Number(summary.totalDebits) >= 0 ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`,
          },
          { label: 'Transactions', value: total.toString() },
        ]}
      />

      {/* Filter row — desktop only; mobile uses PageHeaderMobileTools filters */}
      <div className="hidden md:flex flex-row gap-2">
        {users.length > 0 && (
          <FormSelect
            label=""
            value={selectedUserId}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.value) next.set('userId', e.target.value);
              else next.delete('userId');
              next.delete('page');
              setSearchParams(next);
            }}
            options={[
              { value: '', label: 'All users' },
              ...users.map((u) => ({ value: u.id, label: u.name })),
            ]}
            wrapperClassName="w-52"
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
          options={ENTRY_TYPE_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
          wrapperClassName="w-48"
        />
      </div>

      <form
        method="get"
        className="flex min-w-0 w-full gap-2 items-center"
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
          placeholder="Search by description..."
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
          wrapperClassName="min-w-0 w-full flex-1"
        />
      </form>

      {entries.length === 0 ? (
        <EmptyState
          title="No transactions"
          description="No ledger entries found for the selected period and filters."
        />
      ) : (
        <CompactTable<GeneralLedgerEntry>
          columnVisibilityKey="admin.finance.general-ledger"
          columns={columns}
          rows={entries}
          rowKey={(e) => `${e.entryType}-${e.id}`}
          renderMobileCard={(e) => {
            return (
              <button
                type="button"
                onClick={() => setDetailEntry(e)}
                className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 text-left"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs font-medium ${TYPE_COLORS[e.entryType] ?? ''}`}>
                      {TYPE_LABELS[e.entryType] ?? e.entryType}
                    </span>
                    <span className="text-xs text-app-fg-muted">
                      {new Date(e.eventDate).toLocaleDateString('en-NG', {
                        month: 'short',
                        day: 'numeric',
                      })}
                      <span className="ml-1 text-app-fg-muted/60">
                        {new Date(e.eventDate).toLocaleTimeString('en-NG', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })}
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

                  </div>
                  <StatusBadge status={e.status} textOnly />
                </div>
              </button>
            );
          }}
        />
      )}

      <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-app-fg-muted">
          {total > 0
            ? `Showing ${Math.min((page - 1) * limit + 1, total)}–${Math.min(page * limit, total)} of ${total} transactions`
            : '0 transactions'}
        </p>
        <Pagination
          page={page}
          totalPages={totalPages}
          pageParam="page"
          pageSize={limit}
          pageSizeParam="perPage"
        />
      </div>

      {/* Export modal */}
      <LocalExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        title="Export General Ledger"
        description={`${filters.periodAllTime ? 'All time' : `${filters.startDate} to ${filters.endDate}`}`}
        rows={entries.map((e) => ({
          txnId: `TXN-${e.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
          date: new Date(e.eventDate).toLocaleDateString('en-NG', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
          type: TYPE_LABELS[e.entryType] ?? e.entryType,
          description: e.description,
          counterparty: e.counterpartyName ?? '',
          amount: e.balanceEffect > 0 ? `+₦${Math.abs(e.balanceEffect).toLocaleString()}` : `-₦${Math.abs(e.balanceEffect).toLocaleString()}`,
          status: e.status,
        }))}
        columns={[
          { key: 'txnId', label: 'Transaction ID' },
          { key: 'date', label: 'Date' },
          { key: 'type', label: 'Type' },
          { key: 'description', label: 'Description' },
          { key: 'counterparty', label: 'Counterparty' },
          { key: 'status', label: 'Status' },
          { key: 'amount', label: 'Amount' },
        ]}
        defaultColumns={[
          'txnId',
          'date',
          'type',
          'description',
          'counterparty',
          'status',
          'amount',
        ]}
        filenamePrefix="general-ledger"
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
                <OrderIdBadge
                  id={`TXN-${detailEntry.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`}
                  length={20}
                  ellipsis=""
                  textClassName="font-mono text-xs text-app-fg-muted"
                />
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
                  {new Date(detailEntry.eventDate).toLocaleDateString('en-NG', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  {new Date(detailEntry.eventDate).toLocaleTimeString('en-NG', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })}
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
                  <p
                    className={`font-medium tabular-nums ${
                      detailEntry.balanceEffect > 0
                        ? 'text-success-600 dark:text-success-400'
                        : 'text-danger-600 dark:text-danger-400'
                    }`}
                  >
                    {detailEntry.balanceEffect > 0 ? '+' : '-'}
                    <NairaPrice amount={Math.abs(detailEntry.balanceEffect)} />
                  </p>
                </div>
              )}

            </div>

            {(detailEntry.description || detailEntry.counterpartyName) && (
              <div className="space-y-3 pt-3 border-t border-app-border">
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
          </div>
        )}
      </Modal>
    </div>
  );
}
