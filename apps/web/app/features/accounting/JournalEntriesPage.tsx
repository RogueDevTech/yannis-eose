import { useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { useFetcherToast } from '~/components/ui/toast';

export interface JournalEntryRow {
  id: string;
  entryNumber: number;
  postingDate: string;
  description: string;
  totalDebit: string;
  status: 'POSTED' | 'CANCELLED';
}

export interface JournalEntriesPageProps {
  records: JournalEntryRow[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
  canWrite: boolean;
}

export function JournalEntriesPage({ records, pagination, canWrite }: JournalEntriesPageProps) {
  const [reverseTarget, setReverseTarget] = useState<JournalEntryRow | null>(null);
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(fetcher.data);

  if (fetcher.data && (fetcher.data as { success?: boolean }).success && reverseTarget) {
    // Close the confirm modal on success (edge-triggered by data change).
    setReverseTarget(null);
  }

  const postedTotal = records
    .filter((r) => r.status === 'POSTED')
    .reduce((s, r) => s + Number(r.totalDebit), 0);

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
      render: (r) =>
        canWrite && r.status === 'POSTED' ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setReverseTarget(r)}>
            Reverse
          </Button>
        ) : null,
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
        ]}
      />

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
              The ledger is never edited — the reversal nets the original to zero.
            </p>
            <fetcher.Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="reverseEntry" />
              <input type="hidden" name="journalEntryId" value={reverseTarget.id} />
              <div>
                <label className="mb-1 block text-sm font-medium text-app-fg">Reason (optional)</label>
                <input name="reason" className="w-full h-10 rounded-lg border border-app-border bg-app-bg px-3 text-sm" />
              </div>
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
    </>
  );
}
