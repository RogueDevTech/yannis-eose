import { useCallback, useMemo, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useOptimisticListPatches, applyOptimisticPatches } from '~/hooks/useOptimisticListPatches';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { Tabs } from '~/components/ui/tabs';
import { StatusBadge } from '~/components/ui/status-badge';
import { RoleBadge } from '~/components/ui/role-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Textarea } from '~/components/ui/textarea';
import { FundingFlowTimeline } from './FundingFlowTimeline';
import type { FundingDisputeRecord, FundingDisputeStatus, FundingDisputesLoaderData } from './types';

const STATUS_TABS: { value: FundingDisputeStatus; label: string }[] = [
  { value: 'DISPUTED', label: 'Disputed' },
  { value: 'SENT', label: 'Awaiting receipt' },
  { value: 'COMPLETED', label: 'Received' },
  { value: 'REVERSED', label: 'Reversed' },
];

const EMPTY_COPY: Record<FundingDisputeStatus, string> = {
  DISPUTED: 'No disputed funding.',
  SENT: 'No funding awaiting receipt.',
  COMPLETED: 'No received funding.',
  REVERSED: 'No reversals yet.',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function naira(amount: string): string {
  return `₦${Number(amount).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

/** The note that matters for a row: dispute reason, or the reversal reason once reversed. */
function rowNote(row: FundingDisputeRecord): string | null {
  return row.status === 'REVERSED' ? row.reversalReason : row.disputeReason ?? row.notes;
}

export function FundingDisputesPage({
  canReverseAny,
  status,
  search,
  records,
  page,
  limit,
  total,
  filteredTotalAmount,
  statusCounts,
}: FundingDisputesLoaderData) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Mirrors the API rule: received funding is admin-only to claw back.
  const canReverse = useCallback(
    (row: FundingDisputeRecord) => row.status !== 'REVERSED' && (canReverseAny || row.status !== 'COMPLETED'),
    [canReverseAny],
  );
  const fetcher = useFetcher();
  const surface = useFetcherActionSurface(fetcher);
  const [peekRow, setPeekRow] = useState<FundingDisputeRecord | null>(null);
  // `?reverse=<id>` (from the Funding page row action) opens the confirm modal directly.
  const [reverseRow, setReverseRow] = useState<FundingDisputeRecord | null>(() => {
    const id = searchParams.get('reverse');
    const row = id ? records.find((r) => r.id === id) : undefined;
    return row && row.status !== 'REVERSED' && (canReverseAny || row.status !== 'COMPLETED') ? row : null;
  });

  useFetcherToast(fetcher.data, { successMessage: 'Funding reversed', skipErrorToast: reverseRow != null });
  const handleSuccess = useCallback(() => {
    setReverseRow(null);
    setPeekRow(null);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleSuccess);

  const buildPatches = useCallback((fd: FormData, intent: string) => {
    if (intent !== 'reverseFunding') return null;
    const id = fd.get('fundingId')?.toString();
    return id ? [{ id, patch: { status: 'REVERSED' as const } }] : null;
  }, []);
  const patches = useOptimisticListPatches<FundingDisputeRecord>(fetcher, buildPatches);
  const rows = useMemo(() => applyOptimisticPatches(records, patches), [records, patches]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearchParams(next, { preventScrollReset: true });
  };

  const columns = useMemo<CompactTableColumn<FundingDisputeRecord>[]>(
    () => [
      {
        key: 'from',
        header: 'From',
        nowrap: true,
        render: (row) => <span className="text-sm text-app-fg">{row.senderName ?? 'Unknown'}</span>,
      },
      {
        key: 'to',
        header: 'To',
        nowrap: true,
        render: (row) => <span className="text-sm text-app-fg">{row.receiverName ?? 'Unknown'}</span>,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (row) => (
          <span className="font-medium tabular-nums">
            <NairaPrice amount={Number(row.amount)} />
          </span>
        ),
      },
      {
        key: 'note',
        header: status === 'REVERSED' ? 'Reversal reason' : 'Reason',
        render: (row) => (
          <span className="line-clamp-2 max-w-[22rem] text-sm text-app-fg-muted" title={rowNote(row) ?? undefined}>
            {rowNote(row) ?? ''}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'date',
        header: status === 'REVERSED' ? 'Reversed' : 'Sent',
        nowrap: true,
        render: (row) => (
          <span className="text-sm text-app-fg-muted">
            {formatDate(row.status === 'REVERSED' ? row.reversedAt : row.sentAt)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        mobileShowLabel: false,
        render: (row) => (
          <span className="inline-flex gap-1.5">
            <TableActionButton onClick={() => setPeekRow(row)} variant="neutral">
              View
            </TableActionButton>
            {canReverse(row) && (
              <TableActionButton onClick={() => setReverseRow(row)} variant="danger">
                Reverse
              </TableActionButton>
            )}
          </span>
        ),
      },
    ],
    [status, canReverse],
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding Disputes"
        backTo="/admin/marketing/funding"
        mobileInlineActions
        description={canReverseAny ? 'Reverse erroneous funding back to the sender.' : 'Resolve disputes on funding you sent.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel="Dispute tools"
            desktop={<PageRefreshButton />}
            sheet={<PageRefreshButton className="w-full justify-center py-2" />}
          />
        }
      />

      <div className="list-panel">
        <div className="flex flex-col gap-2 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            variant="pill"
            value={status}
            onChange={(v) => setParam('status', v === 'DISPUTED' ? null : v)}
            tabs={STATUS_TABS.map((t) => ({ value: t.value, label: t.label, badge: statusCounts[t.value] }))}
          />
          <PageSearchControl
            value={search}
            onApply={(q) => setParam('search', q || null)}
            placeholder="Sender, receiver or funding ID"
            title="Search funding"
          />
        </div>
        <div className="px-4 pb-1 pt-2 text-xs text-app-fg-muted">
          {total} {total === 1 ? 'entry' : 'entries'} · {naira(filteredTotalAmount)}
        </div>
        <CompactTable<FundingDisputeRecord>
          columnVisibilityKey="admin.marketing.funding-disputes"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          emptyTitle={EMPTY_COPY[status]}
          renderMobileCard={(row) => (
            <button
              type="button"
              onClick={() => setPeekRow(row)}
              className="w-full space-y-1 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-app-fg">
                  {row.senderName ?? 'Unknown'} → {row.receiverName ?? 'Unknown'}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  <NairaPrice amount={Number(row.amount)} />
                </span>
              </div>
              {rowNote(row) && <p className="line-clamp-2 text-xs text-app-fg-muted">{rowNote(row)}</p>}
              <div className="flex items-center justify-between gap-2">
                <StatusBadge status={row.status} size="sm" />
                <span className="text-xs text-app-fg-muted">
                  {formatDate(row.status === 'REVERSED' ? row.reversedAt : row.sentAt)}
                </span>
              </div>
            </button>
          )}
          pagination={{
            page,
            totalPages,
            pageParam: 'page',
            pageSize: limit,
            pageSizeParam: 'perPage',
          }}
        />
      </div>

      {/* Peek: full flow (sent / disputed / reversed) for one funding */}
      {peekRow && !reverseRow && (
        <Modal open onClose={() => setPeekRow(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-app-fg">
                <NairaPrice amount={Number(peekRow.amount)} />
              </h3>
              <p className="text-sm text-app-fg-muted">
                {peekRow.senderName ?? 'Unknown'} → {peekRow.receiverName ?? 'Unknown'}
              </p>
            </div>
            <StatusBadge status={peekRow.status} />
          </div>
          <FundingFlowTimeline transferId={peekRow.id} hideSummary />
          <div className="flex gap-2">
            {canReverse(peekRow) && (
              <Button variant="danger" size="sm" onClick={() => setReverseRow(peekRow)}>
                Reverse
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => setPeekRow(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}

      {reverseRow && (
        <Modal open onClose={() => setReverseRow(null)} maxWidth="max-w-md" contentClassName="p-6 space-y-4 bg-app-elevated">
          <h3 className="text-lg font-semibold text-app-fg">Reverse {naira(reverseRow.amount)}?</h3>
          <dl className="space-y-1.5 rounded-lg border border-app-border bg-app-hover p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-app-fg-muted">From</dt>
              <dd className="flex items-center gap-1.5 text-app-fg">
                {reverseRow.senderName ?? 'Unknown'}
                {reverseRow.senderRole && <RoleBadge role={reverseRow.senderRole} size="sm" />}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-app-fg-muted">To</dt>
              <dd className="flex items-center gap-1.5 text-app-fg">
                {reverseRow.receiverName ?? 'Unknown'}
                {reverseRow.receiverRole && <RoleBadge role={reverseRow.receiverRole} size="sm" />}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-app-fg-muted">Sent</dt>
              <dd className="text-app-fg">{formatDate(reverseRow.sentAt)}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-app-fg-muted">Status</dt>
              <dd><StatusBadge status={reverseRow.status} size="sm" /></dd>
            </div>
            {reverseRow.disputeReason && (
              <div className="pt-1">
                <dt className="text-app-fg-muted">Dispute reason</dt>
                <dd className="text-app-fg">{reverseRow.disputeReason}</dd>
              </div>
            )}
          </dl>
          <ul className="list-disc space-y-1 pl-5 text-sm text-app-fg">
            <li>
              {reverseRow.senderName ?? 'The sender'} is credited back {naira(reverseRow.amount)}.
            </li>
            <li>
              {reverseRow.status === 'COMPLETED'
                ? `${reverseRow.receiverName ?? 'The receiver'} is debited ${naira(reverseRow.amount)}. Blocked if their balance no longer covers it.`
                : `${reverseRow.receiverName ?? 'The receiver'} was never credited, so their balance does not change.`}
            </li>
            <li>The original entry is kept and marked Reversed. This cannot be undone.</li>
          </ul>
          <ModalFetcherInlineError message={surface.errorMatchingIntent('reverseFunding')} />
          <fetcher.Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="reverseFunding" />
            <input type="hidden" name="fundingId" value={reverseRow.id} />
            <Textarea
              label="Reason"
              name="reason"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder="e.g. Sent to the wrong media buyer (min 10 chars)"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="danger"
                size="sm"
                loading={fetcher.state === 'submitting'}
                loadingText="Reversing..."
              >
                Reverse {naira(reverseRow.amount)}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setReverseRow(null)}>
                Cancel
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}
    </div>
  );
}
