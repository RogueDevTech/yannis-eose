import { useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { Pagination } from '~/components/ui/pagination';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { StatusBadge } from '~/components/ui/status-badge';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { FormSelect } from '~/components/ui/form-select';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { InlineFilter } from '~/components/ui/inline-filter';
import { Modal } from '~/components/ui/modal';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import type { GeneralLedgerEntry, GeneralLedgerLoaderData } from './types';

const ENTRY_TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'journal_entry', label: 'Journal Entries' },
  { value: 'sales_invoice', label: 'Sales Invoices' },
  { value: 'payment', label: 'Payments' },
  { value: 'purchase_receipt', label: 'Purchase Receipts' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'expense', label: 'Expenses' },
] as const;

const TYPE_COLORS: Record<string, string> = {
  journal_entry: 'text-brand-600 dark:text-brand-400',
  sales_invoice: 'text-success-600 dark:text-success-400',
  payment: 'text-info-600 dark:text-info-400',
  purchase_receipt: 'text-cyan-600 dark:text-cyan-400',
  payroll: 'text-warning-600 dark:text-warning-400',
  expense: 'text-orange-600 dark:text-orange-400',
};

const TYPE_LABELS: Record<string, string> = {
  journal_entry: 'Journal Entry',
  sales_invoice: 'Sales Invoice',
  payment: 'Payment',
  purchase_receipt: 'Purchase Receipt',
  payroll: 'Payroll',
  expense: 'Expense',
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
  filters,
  entryTypeFilter,
  searchFilter,
}: GeneralLedgerLoaderData) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailEntry, setDetailEntry] = useState<GeneralLedgerEntry | null>(null);
  const appliedSearch = searchFilter ?? searchParams.get('search') ?? '';
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
        key: 'account',
        header: 'Account',
        render: (e) => (
          <span className="text-sm text-app-fg truncate block max-w-[10rem]" title={`${e.accountCode} ${e.accountName}`}>
            <span className="text-xs font-mono text-app-fg-muted">{e.accountCode}</span>{' '}
            {e.accountName}
          </span>
        ),
      },
      {
        key: 'debit',
        header: 'Debit',
        align: 'right',
        nowrap: true,
        render: (e) => {
          const debit = Number(e.amount);
          return e.balanceEffect > 0 || (e.balanceEffect === 0 && debit > 0) ? (
            <span className="text-sm font-medium tabular-nums text-danger-600 dark:text-danger-400">
              <NairaPrice amount={debit} />
            </span>
          ) : null;
        },
      },
      {
        key: 'credit',
        header: 'Credit',
        align: 'right',
        nowrap: true,
        render: (e) => {
          const credit = Number(e.amount);
          return e.balanceEffect < 0 || (e.balanceEffect === 0 && credit > 0) ? (
            <span className="text-sm font-medium tabular-nums text-success-600 dark:text-success-400">
              <NairaPrice amount={credit} />
            </span>
          ) : null;
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
                <FormSelect
                  label="Type"
                  value={entryTypeFilter ?? 'all'}
                  onChange={(e) => {
                    const next = new URLSearchParams(searchParams);
                    next.set('entryType', e.target.value);
                    next.delete('page');
                    setSearchParams(next);
                  }}
                  options={ENTRY_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
              </>
            }
            filtersBadgeCount={entryTypeFilter && entryTypeFilter !== 'all' ? 1 : 0}
            sheet={
              entries.length > 0 ? (
                ({ closeSheet }) => (
                  <button
                    type="button"
                    onClick={() => {
                      closeSheet();
                      setShowExport(true);
                    }}
                    className="btn-secondary h-12 w-full justify-center gap-1.5"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Export
                  </button>
                )
              ) : undefined
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.startDate}
        endDate={filters.endDate}
        periodAllTime={filters.periodAllTime}
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

      <div className="list-panel">
        <ToolbarFiltersCollapsible
          className="!border-0"
          hideMobileSheet
          badgeCount={entryTypeFilter && entryTypeFilter !== 'all' ? 1 : 0}
          searchRow={
            <PageSearchControl
              value={appliedSearch}
              placeholder="Search by description..."
              title="Search ledger"
              onApply={(query) => {
                setSearchParams((p) => {
                  const next = new URLSearchParams(p);
                  next.set('page', '1');
                  if (query) next.set('search', query);
                  else next.delete('search');
                  return next;
                });
              }}
            />
          }
          desktopInlineFilters={
            <InlineFilter
              type="select"
              value={entryTypeFilter ?? 'all'}
              defaultValue="all"
              onChange={(v) => {
                const next = new URLSearchParams(searchParams);
                next.set('entryType', v);
                next.delete('page');
                setSearchParams(next);
              }}
              options={ENTRY_TYPE_OPTIONS.map((t) => ({ value: t.value, label: t.label }))}
              width="status"
            />
          }
          sheetFilterBody={null}
        />
      </div>

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
          accountCode: e.accountCode ?? '',
          accountName: e.accountName ?? '',
          description: e.description,
          debit: e.balanceEffect > 0 ? Number(e.amount).toLocaleString() : '',
          credit: e.balanceEffect < 0 ? Number(e.amount).toLocaleString() : '',
          status: e.status,
        }))}
        columns={[
          { key: 'txnId', label: 'Transaction ID' },
          { key: 'date', label: 'Date' },
          { key: 'type', label: 'Type' },
          { key: 'accountCode', label: 'Account Code' },
          { key: 'accountName', label: 'Account Name' },
          { key: 'description', label: 'Description' },
          { key: 'debit', label: 'Debit' },
          { key: 'credit', label: 'Credit' },
          { key: 'status', label: 'Status' },
        ]}
        defaultColumns={[
          'txnId',
          'date',
          'type',
          'accountCode',
          'accountName',
          'description',
          'debit',
          'credit',
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
