import { useMemo } from 'react';
import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { StatusBadge } from '~/components/ui/status-badge';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { NairaPrice } from '~/components/ui/naira-price';

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

  const totalDebit = useMemo(
    () => records.reduce((s, r) => s + Number(r.totalDebit || 0), 0),
    [records],
  );
  const totalCredit = useMemo(
    () => records.reduce((s, r) => s + Number(r.totalCredit || 0), 0),
    [records],
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
        Number(r.totalDebit) > 0 ? <NairaPrice amount={r.totalDebit} /> : null,
    },
    {
      key: 'credit',
      header: 'Credit',
      align: 'right',
      hideOnMobile: true,
      render: (r) =>
        Number(r.totalCredit) > 0 ? <NairaPrice amount={r.totalCredit} /> : null,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      render: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="General Ledger"
        description="Append-only book of record for all posted journal entries."
      />

      <OverviewStatStrip
        items={[
          { label: 'Entries', value: String(pagination.total) },
          { label: 'Total Debit', value: `₦${totalDebit.toLocaleString()}` },
          { label: 'Total Credit', value: `₦${totalCredit.toLocaleString()}` },
          {
            label: 'Balance',
            value: totalDebit === totalCredit ? 'Balanced' : `Off by ₦${Math.abs(totalDebit - totalCredit).toLocaleString()}`,
            valueClassName: totalDebit === totalCredit ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400',
          },
        ]}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <TextInput
          type="date"
          label="From"
          value={filters.startDate}
          onChange={(e) => setFilter('startDate', e.target.value)}
          className="w-36"
        />
        <TextInput
          type="date"
          label="To"
          value={filters.endDate}
          onChange={(e) => setFilter('endDate', e.target.value)}
          className="w-36"
        />
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
          className="w-32"
        />
        <SearchInput
          value={filters.search}
          onChange={(v) => setFilter('search', v)}
          placeholder="Search description"
          className="max-w-xs"
        />
      </div>

      {records.length === 0 ? (
        <EmptyState
          title="No entries found"
          description="No journal entries match the current filters. Try widening the date range."
        />
      ) : (
        <>
          <CompactTable columns={columns} rows={records} rowKey={(r) => r.id} />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} />
        </>
      )}
    </div>
  );
}
