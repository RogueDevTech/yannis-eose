import { useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { TextInput } from '~/components/ui/text-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { FormSelect } from '~/components/ui/form-select';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { TableActionButton } from '~/components/ui/table-action-button';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

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
  filters?: { status: string; search: string; startDate: string; endDate: string };
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
      render: (r) => {
        if (r.status === 'DRAFT' && canApprove) {
          return (
            <div className="flex justify-end gap-1">
              <TableActionButton type="button" onClick={() => setApproveTarget(r)}>
                Approve
              </TableActionButton>
              <TableActionButton type="button" onClick={() => setRejectTarget(r)}>
                Reject
              </TableActionButton>
            </div>
          );
        }
        if (canWrite && r.status === 'POSTED') {
          return (
            <TableActionButton type="button" onClick={() => setReverseTarget(r)}>
              Reverse
            </TableActionButton>
          );
        }
        return null;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Journal Entries"
        description="Manual balanced postings to the general ledger."
        actions={
          canWrite ? (
            <Link to="/admin/finance/journal-entries/new">
              <Button type="button">New Entry</Button>
            </Link>
          ) : undefined
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Entries', value: String(pagination.total) },
          { label: 'Posted value', value: <NairaPrice amount={postedTotal} /> },
          ...(draftCount > 0 ? [{ label: 'Draft (page)', value: String(draftCount) }] : []),
        ]}
      />

      {filters && (
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
              { value: 'DRAFT', label: 'Draft' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
            className="w-32"
          />
          <PageSearchControl
            value={filters.search}
            placeholder="Search description"
            title="Search journal entries"
            onApply={(query) => setFilter('search', query)}
          />
        </div>
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
          <CompactTable columns={columns} rows={records} rowKey={(r) => r.id} />
          <Pagination page={pagination.page} totalPages={pagination.totalPages} />
        </>
      )}

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
    </>
  );
}
