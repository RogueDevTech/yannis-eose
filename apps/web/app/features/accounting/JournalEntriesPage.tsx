import { useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
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
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { TextInput } from '~/components/ui/text-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { FormSelect } from '~/components/ui/form-select';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { JournalEntryViewModal } from './JournalEntryViewModal';

export interface JournalEntryRow {
  id: string;
  entryNumber: number;
  postingDate: string;
  description: string;
  totalDebit: string;
  status: 'POSTED' | 'CANCELLED' | 'DRAFT';
}

export interface JournalEntriesPageProps {
  records: JournalEntryRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  canWrite: boolean;
  canApprove?: boolean;
  filters?: { status: string; search: string; startDate: string; endDate: string; periodAllTime?: boolean };
}

export function JournalEntriesPage({
  records,
  pagination,
  canWrite,
  canApprove = false,
  filters,
}: JournalEntriesPageProps) {
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
  const [viewTarget, setViewTarget] = useState<JournalEntryRow | null>(null);
  const [reverseTarget, setReverseTarget] = useState<JournalEntryRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<JournalEntryRow | null>(null);
  const [approveTarget, setApproveTarget] = useState<JournalEntryRow | null>(null);
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data);
  useCloseOnFetcherSuccess(fetcher, () => {
    setReverseTarget(null);
    setApproveTarget(null);
    setRejectTarget(null);
  });

  const postedTotal = records
    .filter((r) => r.status === 'POSTED')
    .reduce((s, r) => s + Number(r.totalDebit), 0);
  const draftCount = records.filter((r) => r.status === 'DRAFT').length;

  const columns: CompactTableColumn<JournalEntryRow>[] = [
    {
      key: 'entryNumber',
      header: 'JE #',
      render: (r) => <span className="font-mono text-xs text-app-fg-muted">#{r.entryNumber}</span>,
    },
    { key: 'postingDate', header: 'Date', render: (r) => <span className="text-app-fg">{r.postingDate}</span> },
    {
      key: 'description',
      header: 'Description',
      render: (r) => <span className="text-app-fg">{r.description}</span>,
    },
    {
      key: 'total',
      header: 'Amount',
      align: 'right',
      render: (r) => <NairaPrice amount={r.totalDebit} />,
    },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      mobileShowLabel: false,
      render: (r) => (
        <div className="flex justify-end gap-1">
          <CompactTableActionButton tone="brand" onClick={() => setViewTarget(r)}>
            View
          </CompactTableActionButton>
          {r.status === 'DRAFT' && canApprove ? (
            <>
              <CompactTableActionButton tone="success" onClick={() => setApproveTarget(r)}>
                Approve
              </CompactTableActionButton>
              <CompactTableActionButton tone="danger" onClick={() => setRejectTarget(r)}>
                Reject
              </CompactTableActionButton>
            </>
          ) : null}
          {canWrite && r.status === 'POSTED' ? (
            <CompactTableActionButton onClick={() => setReverseTarget(r)}>
              Reverse
            </CompactTableActionButton>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Journal Entries"
        description="Manual balanced postings to the general ledger."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Journal entries tools"
            desktop={
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                {filters ? (
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    chrome="pill"
                  />
                ) : null}
                <PageRefreshButton />
                {canWrite ? (
                  <Link to="/admin/finance/journal-entries/new" prefetch="intent">
                    <Button type="button" size="sm">New Entry</Button>
                  </Link>
                ) : null}
              </div>
            }
            sheet={
              canWrite ? (
                <Link to="/admin/finance/journal-entries/new" prefetch="intent" className="block">
                  <Button type="button" className="w-full">New Entry</Button>
                </Link>
              ) : undefined
            }
          />
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Entries', value: String(pagination.total) },
          { label: 'Posted value (page)', value: <NairaPrice amount={postedTotal} /> },
          ...(draftCount > 0 ? [{ label: 'Drafts (page)', value: String(draftCount) }] : []),
        ]}
      />

      {filters ? (
        <MobileDateFilterRow startDate={filters.startDate} endDate={filters.endDate} />
      ) : null}

      {filters && (
        <ToolbarFiltersCollapsible
          badgeCount={[filters.status, filters.search].filter(Boolean).length}
          searchRow={
            <PageSearchControl
              value={filters.search}
              placeholder="Search description"
              title="Search journal entries"
              onApply={(query) => setFilter('search', query)}
            />
          }
          desktopInlineFilters={
            <FormSelect
              label=""
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'POSTED', label: 'Posted' },
                { value: 'DRAFT', label: 'Draft' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
              className="w-36"
            />
          }
          sheetFilterBody={
            <FormSelect
              label="Status"
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'POSTED', label: 'Posted' },
                { value: 'DRAFT', label: 'Draft' },
                { value: 'CANCELLED', label: 'Cancelled' },
              ]}
            />
          }
        />
      )}

      {records.length === 0 ? (
        <EmptyState
          title="No journal entries yet"
          description="Create a balanced entry to post to the ledger."
          action={
            canWrite ? (
              <Link to="/admin/finance/journal-entries/new">
                <Button type="button">New Entry</Button>
              </Link>
            ) : undefined
          }
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
                  <span className="font-mono text-xs text-app-fg-muted">#{r.entryNumber}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-sm font-medium text-app-fg truncate">{r.description}</p>
                <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                  <span>{r.postingDate}</span>
                  <NairaPrice amount={r.totalDebit} className="font-medium text-app-fg" />
                </div>
              </button>
            )}
          />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} />
        </>
      )}

      <JournalEntryViewModal entry={viewTarget} onClose={() => setViewTarget(null)} />

      {reverseTarget && (
        <Modal open onClose={() => setReverseTarget(null)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Reverse JE #{reverseTarget.entryNumber}?</h2>
            <p className="text-sm text-app-fg-muted">
              This creates a new entry with debit and credit swapped, and marks the original cancelled.
              The ledger is never edited; the reversal nets the original to zero.
            </p>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="reverseEntry" />
              <input type="hidden" name="journalEntryId" value={reverseTarget.id} />
              <TextInput label="Reason (optional)" name="reason" />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setReverseTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={fetcher.state !== 'idle'}>
                  {fetcher.state !== 'idle' ? 'Reversing…' : 'Reverse entry'}
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </Modal>
      )}

      {approveTarget && (
        <Modal open onClose={() => setApproveTarget(null)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Approve JE #{approveTarget.entryNumber}?</h2>
            <p className="text-sm text-app-fg-muted">
              Posts <NairaPrice amount={approveTarget.totalDebit} /> to the general ledger:{' '}
              {approveTarget.description}
            </p>
            <fetcher.Form method="post" className="flex justify-end gap-2 pt-2">
              <input type="hidden" name="intent" value="approveEntry" />
              <input type="hidden" name="journalEntryId" value={approveTarget.id} />
              <Button type="button" variant="secondary" onClick={() => setApproveTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={fetcher.state !== 'idle'}>
                {fetcher.state !== 'idle' ? 'Approving…' : 'Approve and post'}
              </Button>
            </fetcher.Form>
          </div>
        </Modal>
      )}

      {rejectTarget && (
        <Modal open onClose={() => setRejectTarget(null)} maxWidth="max-w-md">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-app-fg">Reject JE #{rejectTarget.entryNumber}?</h2>
            <p className="text-sm text-app-fg-muted">
              The draft will be cancelled and will not post to the ledger.
            </p>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="rejectEntry" />
              <input type="hidden" name="journalEntryId" value={rejectTarget.id} />
              <TextInput label="Reason" name="reason" required minLength={1} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setRejectTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="danger" disabled={fetcher.state !== 'idle'}>
                  {fetcher.state !== 'idle' ? 'Rejecting…' : 'Reject draft'}
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </Modal>
      )}
    </div>
  );
}
