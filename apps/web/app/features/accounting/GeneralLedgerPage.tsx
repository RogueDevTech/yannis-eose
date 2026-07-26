import { useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { StatusBadge } from '~/components/ui/status-badge';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { FormSelect } from '~/components/ui/form-select';
import { NairaPrice } from '~/components/ui/naira-price';
import { JournalEntryViewModal } from './JournalEntryViewModal';

interface JournalEntryRow {
  id: string;
  entryNumber: number;
  postingDate: string;
  description: string;
  totalDebit: string;
  totalCredit: string;
  status: 'POSTED' | 'CANCELLED' | 'DRAFT';
}

export interface GeneralLedgerPageProps {
  records: JournalEntryRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  filters: {
    startDate: string;
    endDate: string;
    status: string;
    search: string;
  };
}

export function GeneralLedgerPage({ records, pagination, filters }: GeneralLedgerPageProps) {
  const [, setSearchParams] = useSearchParams();
  const [viewTarget, setViewTarget] = useState<JournalEntryRow | null>(null);

  const setFilter = (key: string, value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value) next.delete(key);
        else next.set(key, value);
        next.delete('page');
        return next;
      },
      { preventScrollReset: true },
    );
  };

  const filterBadgeCount = [filters.status, filters.search].filter(Boolean).length;

  const totalDebit = useMemo(
    () => records.reduce((s, r) => s + Number(r.totalDebit || 0), 0),
    [records],
  );
  const totalCredit = useMemo(
    () => records.reduce((s, r) => s + Number(r.totalCredit || 0), 0),
    [records],
  );

  const statusSelect = (
    <FormSelect
      label="Status"
      value={filters.status}
      onChange={(e) => setFilter('status', e.target.value)}
      options={[
        { value: '', label: 'All' },
        { value: 'POSTED', label: 'Posted' },
        { value: 'CANCELLED', label: 'Cancelled' },
        { value: 'DRAFT', label: 'Draft' },
      ]}
      className="w-full md:w-32"
    />
  );

  const searchControl = (
    <PageSearchControl
      value={filters.search}
      placeholder="Search description"
      title="Search ledger"
      onApply={(query) => setFilter('search', query)}
    />
  );

  const columns: CompactTableColumn<JournalEntryRow>[] = [
    {
      key: 'entryNumber',
      header: 'JE #',
      className: 'w-20',
      render: (r) => (
        <span className="text-xs font-mono text-brand-600 dark:text-brand-400">
          JE-{String(r.entryNumber).padStart(4, '0')}
        </span>
      ),
    },
    {
      key: 'postingDate',
      header: 'Date',
      className: 'w-28',
      render: (r) => (
        <span className="text-xs text-app-fg-muted">
          {new Date(r.postingDate).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      render: (r) => (
        <span className="text-sm text-app-fg line-clamp-1">{r.description}</span>
      ),
    },
    {
      key: 'debit',
      header: 'Debit',
      align: 'right',
      hideOnMobile: true,
      render: (r) =>
        Number(r.totalDebit) > 0 ? <NairaPrice amount={r.totalDebit} className="text-danger-600 dark:text-danger-400" /> : null,
    },
    {
      key: 'credit',
      header: 'Credit',
      align: 'right',
      hideOnMobile: true,
      render: (r) =>
        Number(r.totalCredit) > 0 ? <NairaPrice amount={r.totalCredit} className="text-success-600 dark:text-success-400" /> : null,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      mobileShowLabel: false,
      render: (r) => (
        <div className="flex justify-end">
          <CompactTableActionButton tone="brand" onClick={() => setViewTarget(r)}>
            View
          </CompactTableActionButton>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="General Ledger"
        description="Append-only book of record for all posted journal entries."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Filters"
            triggerAriaLabel="General ledger toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  chrome="pill"
                />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow startDate={filters.startDate} endDate={filters.endDate} />

      <OverviewStatStrip
        items={[
          { label: 'Entries', value: String(pagination.total) },
          { label: 'Total Debit', value: <NairaPrice amount={totalDebit} />, plainValue: true },
          { label: 'Total Credit', value: <NairaPrice amount={totalCredit} />, plainValue: true },
          {
            label: 'Balance',
            value: totalDebit === totalCredit ? 'Balanced' : <><span>Off by </span><NairaPrice amount={Math.abs(totalDebit - totalCredit)} /></>,
            plainValue: totalDebit !== totalCredit,
            valueClassName: totalDebit === totalCredit ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400',
          },
        ]}
      />

      <ToolbarFiltersCollapsible
        badgeCount={filterBadgeCount}
        searchRow={searchControl}
        desktopInlineFilters={statusSelect}
        sheetFilterBody={statusSelect}
      />

      {records.length === 0 ? (
        <EmptyState
          title="No entries found"
          description="No journal entries match the current filters. Try widening the date range."
        />
      ) : (
        <>
          <CompactTable
            columns={columns}
            rows={records}
            rowKey={(r) => r.id}
            renderMobileCard={(r) => (
              <button
                type="button"
                onClick={() => setViewTarget(r)}
                className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1 text-left"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-brand-600 dark:text-brand-400">
                    JE-{String(r.entryNumber).padStart(4, '0')}
                  </span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-sm font-medium text-app-fg truncate">{r.description}</p>
                <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                  <span>{new Date(r.postingDate).toLocaleDateString()}</span>
                  <NairaPrice amount={r.totalDebit} className="font-medium text-app-fg" />
                </div>
              </button>
            )}
          />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} />
        </>
      )}

      <JournalEntryViewModal entry={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}
