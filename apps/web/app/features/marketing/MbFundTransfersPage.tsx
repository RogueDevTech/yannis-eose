import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher, useSearchParams } from '@remix-run/react';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Pagination } from '~/components/ui/pagination';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { TableActionButton } from '~/components/ui/table-action-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { AmountInput } from '~/components/ui/amount-input';
import { Textarea } from '~/components/ui/textarea';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { PageSearchControl } from '~/components/ui/page-search-control';
import { FormSelect } from '~/components/ui/form-select';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import type { MarketingDateFilters } from './types';

// ── Types ───────────────────────────────────────────────────────────────

export interface MbFundTransferRecord {
  id: string;
  senderMbId: string;
  senderName: string | null;
  receiverMbId: string;
  receiverName: string | null;
  amount: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACCEPTED';
  branchId: string | null;
  createdAt: string;
  approvedBy: string | null;
  approverName: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  acceptedAt: string | null;
}

export interface MbFundTransfersLoaderData {
  transfers: MbFundTransferRecord[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
  currentUserId: string;
  currentUserRole: string;
  canApprove: boolean;
  mediaBuyers: Array<{ id: string; name: string }>;
  filters: MarketingDateFilters;
  direction: string;
  statusCounts: { PENDING: number; APPROVED: number; REJECTED: number; ACCEPTED: number; ALL: number };
}

type TransferTab = 'all' | 'sent' | 'received' | 'pending_approval';

const STATUS_MAP: Record<string, { label: string; variant: 'warning' | 'info' | 'danger' | 'success' }> = {
  PENDING: { label: 'Pending', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'info' },
  REJECTED: { label: 'Rejected', variant: 'danger' },
  ACCEPTED: { label: 'Accepted', variant: 'success' },
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ── Panel (embedded on Funding page, or standalone route) ───────────────

export function PeerTransfersPanel({
  transfers,
  total,
  page,
  totalPages,
  limit: _limit,
  currentUserId,
  currentUserRole: _currentUserRole,
  canApprove,
  mediaBuyers,
  filters,
  direction,
  statusCounts,
  embedded = false,
  createOpen,
  onCreateOpenChange,
}: MbFundTransfersLoaderData & {
  embedded?: boolean;
  /** Controlled create modal (Funding header "Send to peer"). */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const showCreateModal = createOpen ?? internalCreateOpen;
  const setShowCreateModal = onCreateOpenChange ?? setInternalCreateOpen;
  const [detailTransfer, setDetailTransfer] = useState<MbFundTransferRecord | null>(null);
  const [rejectTransferId, setRejectTransferId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') ?? '');
  const { busy: isRefreshing } = useLoaderRefetchBusy();

  useEffect(() => {
    setSearchQuery(searchParams.get('search') ?? '');
  }, [searchParams]);

  const activeTab = direction as TransferTab;
  const statusFilter = searchParams.get('status') ?? 'ALL';

  /** Approver inbox status select (maps to direction=pending_approval or direction=all+status). */
  const approverStatusValue =
    activeTab === 'pending_approval' || statusFilter === 'PENDING'
      ? 'PENDING'
      : statusFilter === 'APPROVED' ||
          statusFilter === 'ACCEPTED' ||
          statusFilter === 'REJECTED'
        ? statusFilter
        : 'ALL';

  const directionOptions = useMemo(
    () => [
      { value: 'all', label: `All (${statusCounts.ALL})` },
      { value: 'sent', label: 'Sent' },
      { value: 'received', label: 'Received' },
    ],
    [statusCounts.ALL],
  );

  const mbStatusOptions = useMemo(
    () => [
      { value: 'ALL', label: `All Status (${statusCounts.ALL})` },
      { value: 'PENDING', label: `Pending (${statusCounts.PENDING})` },
      { value: 'APPROVED', label: `Approved (${statusCounts.APPROVED})` },
      { value: 'ACCEPTED', label: `Accepted (${statusCounts.ACCEPTED})` },
      { value: 'REJECTED', label: `Rejected (${statusCounts.REJECTED})` },
    ],
    [statusCounts],
  );

  const approverStatusOptions = useMemo(
    () => [
      { value: 'PENDING', label: `Pending approval (${statusCounts.PENDING})` },
      { value: 'APPROVED', label: `Approved / awaiting accept (${statusCounts.APPROVED})` },
      { value: 'ACCEPTED', label: `Accepted (${statusCounts.ACCEPTED})` },
      { value: 'REJECTED', label: `Rejected (${statusCounts.REJECTED})` },
      { value: 'ALL', label: `All (${statusCounts.ALL})` },
    ],
    [statusCounts],
  );

  const updateParam = useCallback(
    (key: 'direction' | 'status' | 'search' | 'page', value: string | undefined) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === 'ALL') {
          if (key === 'direction') next.set('direction', 'all');
          else next.delete(key);
        } else {
          next.set(key, value);
        }
        if (key !== 'page') next.delete('page');
        return next;
      }, { preventScrollReset: true });
    },
    [setSearchParams],
  );

  const setApproverStatus = useCallback(
    (value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('page');
        if (value === 'PENDING') {
          next.set('direction', 'pending_approval');
          next.delete('status');
        } else if (value === 'ALL') {
          next.set('direction', 'all');
          next.delete('status');
        } else {
          next.set('direction', 'all');
          next.set('status', value);
        }
        return next;
      }, { preventScrollReset: true });
    },
    [setSearchParams],
  );

  const handlePageChange = useCallback(
    (p: number) => updateParam('page', String(p)),
    [updateParam],
  );

  const filteredTransfers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return transfers;
    return transfers.filter((t) => {
      const hay = `${t.senderName ?? ''} ${t.receiverName ?? ''} ${t.reason ?? ''} ${t.amount}`.toLowerCase();
      return hay.includes(q);
    });
  }, [transfers, searchQuery]);

  const statItems = useMemo(
    (): OverviewStatStripItem[] => [
      { label: 'Total', value: String(statusCounts.ALL) },
      { label: 'Pending', value: String(statusCounts.PENDING) },
      { label: 'Approved', value: String(statusCounts.APPROVED) },
      { label: 'Accepted', value: String(statusCounts.ACCEPTED) },
      { label: 'Rejected', value: String(statusCounts.REJECTED) },
    ],
    [statusCounts],
  );

  const columns = useMemo(
    (): CompactTableColumn<MbFundTransferRecord>[] => [
      {
        key: 'sender',
        header: 'From',
        render: (t) => (
          <span className="font-medium text-sm text-app-fg">
            {t.senderMbId === currentUserId ? 'You' : (t.senderName ?? 'Unknown')}
          </span>
        ),
      },
      {
        key: 'receiver',
        header: 'To',
        render: (t) => (
          <span className="font-medium text-sm text-app-fg">
            {t.receiverMbId === currentUserId ? 'You' : (t.receiverName ?? 'Unknown')}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        headerClassName: 'text-right',
        render: (t) => (
          <span className="text-sm tabular-nums">
            <NairaPrice amount={Number(t.amount)} />
          </span>
        ),
      },
      {
        key: 'reason',
        header: 'Reason',
        render: (t) => (
          <span className="text-sm text-app-fg-muted line-clamp-1">{t.reason?.trim() || '-'}</span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (t) => {
          const s = STATUS_MAP[t.status] ?? { label: t.status, variant: 'warning' as const };
          return <StatusBadge status={s.label} variant={s.variant} />;
        },
      },
      {
        key: 'date',
        header: 'Date',
        render: (t) => (
          <span className="text-xs text-app-fg-muted tabular-nums">{formatDate(t.createdAt)}</span>
        ),
      },
      {
        key: 'actions',
        header: '',
        mobileShowLabel: false,
        align: 'right',
        render: (t) => (
          <TransferActions
            transfer={t}
            currentUserId={currentUserId}
            canApprove={canApprove}
            onReject={(id) => { setRejectTransferId(id); setRejectReason(''); }}
          />
        ),
      },
    ],
    [currentUserId, canApprove],
  );

  const filterBadge = canApprove
    ? (approverStatusValue !== 'PENDING' ? 1 : 0) + (searchQuery.trim() ? 1 : 0)
    : (activeTab !== 'all' ? 1 : 0) +
      (statusFilter !== 'ALL' ? 1 : 0) +
      (searchQuery.trim() ? 1 : 0);

  const filterBar = (
    <ToolbarFiltersCollapsible
      hideMobileSheet
      badgeCount={filterBadge}
      searchRow={
        <PageSearchControl
          value={searchQuery}
          placeholder="Search by sender, recipient, or reason..."
          title="Search peer transfers"
          onApply={(q) => {
            setSearchQuery(q);
            updateParam('search', q || undefined);
          }}
        />
      }
      desktopInlineFilters={
        canApprove ? (
          <div className="relative">
            {approverStatusValue !== 'PENDING' && (
              <FilterDismiss onClear={() => setApproverStatus('PENDING')} />
            )}
            <FormSelect
              value={approverStatusValue}
              onChange={(e) => setApproverStatus(e.target.value)}
              options={approverStatusOptions}
              wrapperClassName="w-auto min-w-[14rem]"
            />
          </div>
        ) : (
          <>
            <div className="relative">
              {activeTab !== 'all' && (
                <FilterDismiss onClear={() => updateParam('direction', 'all')} />
              )}
              <FormSelect
                value={activeTab}
                onChange={(e) => updateParam('direction', e.target.value)}
                options={directionOptions}
                wrapperClassName="w-auto min-w-[12rem]"
              />
            </div>
            <div className="relative">
              {statusFilter !== 'ALL' && (
                <FilterDismiss onClear={() => updateParam('status', 'ALL')} />
              )}
              <FormSelect
                value={statusFilter}
                onChange={(e) => updateParam('status', e.target.value)}
                options={mbStatusOptions}
                wrapperClassName="w-auto min-w-[11rem]"
              />
            </div>
          </>
        )
      }
      sheetFilterBody={null}
    />
  );

  const tableBlock = (
    <>
      <CompactTable
        columns={columns}
        rows={filteredTransfers}
        rowKey={(r) => r.id}
        loading={isRefreshing}
        emptyTitle="No transfers"
        emptyDescription={
          activeTab === 'pending_approval'
            ? 'No transfers pending your approval.'
            : 'No peer fund transfers found for this period.'
        }
      />
      {totalPages > 1 && (
        <div className="px-4 py-3 border-t border-app-border">
          <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
        </div>
      )}
    </>
  );

  const modals = (
    <>
      <CreateTransferModal
        open={showCreateModal}
        mediaBuyers={mediaBuyers}
        currentUserId={currentUserId}
        onClose={() => setShowCreateModal(false)}
      />
      <TransferDetailModal
        open={!!detailTransfer}
        transfer={detailTransfer}
        currentUserId={currentUserId}
        canApprove={canApprove}
        onClose={() => setDetailTransfer(null)}
        onReject={(id) => { setDetailTransfer(null); setRejectTransferId(id); setRejectReason(''); }}
      />
      <RejectTransferModal
        open={!!rejectTransferId}
        transferId={rejectTransferId ?? ''}
        reason={rejectReason}
        onReasonChange={setRejectReason}
        onClose={() => setRejectTransferId(null)}
      />
    </>
  );

  if (embedded) {
    return (
      <div className="space-y-0">
        {filterBar}
        {tableBlock}
        {modals}
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <PageHeader
        title="MB Fund Transfers"
        description="Peer-to-peer fund transfers between media buyers."
        backTo="/admin/marketing/funding"
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Tools"
            triggerAriaLabel="Transfer tools"
            desktop={
              <>
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  chrome="pill"
                />
                <PageRefreshButton />
                <Button size="sm" onClick={() => setShowCreateModal(true)}>
                  Send to peer
                </Button>
              </>
            }
            sheet={
              <Button className="w-full" onClick={() => setShowCreateModal(true)}>
                Send to peer
              </Button>
            }
          />
        }
      />

      <div className="space-y-4 pb-8">
        <div className="px-4 md:px-6 space-y-4">
          <MobileDateFilterRow
            startDate={filters.startDate}
            endDate={filters.endDate}
            periodAllTime={filters.periodAllTime}
          />
          <OverviewStatStrip items={statItems} mobileGrid />
        </div>
        <div className="list-panel mx-4 md:mx-6">
          {filterBar}
          {tableBlock}
        </div>
        {modals}
      </div>
    </div>
  );
}

export function MbFundTransfersPage(props: MbFundTransfersLoaderData) {
  return <PeerTransfersPanel {...props} />;
}

// ── Inline Action Buttons (desktop table) ───────────────────────────────

function TransferActions({
  transfer,
  currentUserId,
  canApprove,
  onReject,
}: {
  transfer: MbFundTransferRecord;
  currentUserId: string;
  canApprove: boolean;
  onReject: (id: string) => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher.data);
  const busy = fetcher.state !== 'idle';

  if (canApprove && transfer.status === 'PENDING') {
    return (
      <div className="flex items-center gap-1.5">
        <TableActionButton
          onClick={() =>
            fetcher.submit(
              { intent: 'approve', transferId: transfer.id },
              { method: 'post' },
            )
          }
          disabled={busy}
        >
          Approve
        </TableActionButton>
        <TableActionButton variant="danger" onClick={() => onReject(transfer.id)} disabled={busy}>
          Reject
        </TableActionButton>
      </div>
    );
  }

  if (transfer.status === 'APPROVED' && transfer.receiverMbId === currentUserId) {
    return (
      <TableActionButton
        onClick={() =>
          fetcher.submit(
            { intent: 'accept', transferId: transfer.id },
            { method: 'post' },
          )
        }
        disabled={busy}
      >
        Accept
      </TableActionButton>
    );
  }

  return null;
}

// ── Create Transfer Modal ───────────────────────────────────────────────

function CreateTransferModal({
  open,
  mediaBuyers,
  currentUserId,
  onClose,
}: {
  open: boolean;
  mediaBuyers: Array<{ id: string; name: string }>;
  currentUserId: string;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher.data);
  useCloseOnFetcherSuccess(fetcher, () => onClose());

  const [receiverId, setReceiverId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const busy = fetcher.state !== 'idle';

  const recipientOptions = useMemo(
    () => mediaBuyers.filter((mb) => mb.id !== currentUserId).map((mb) => ({ value: mb.id, label: mb.name })),
    [mediaBuyers, currentUserId],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!receiverId || !amount) return;
      fetcher.submit(
        { intent: 'create', receiverMbId: receiverId, amount, ...(reason.trim() ? { reason: reason.trim() } : {}) },
        { method: 'post' },
      );
    },
    [fetcher, receiverId, amount, reason],
  );

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md" contentClassName="p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-lg font-semibold text-app-fg">Send Funds</h3>
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Recipient</label>
          <SearchableSelect
            options={recipientOptions}
            value={receiverId}
            onChange={setReceiverId}
            placeholder="Select recipient..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Amount</label>
          <AmountInput value={amount} onChange={setAmount} placeholder="0.00" />
        </div>
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Reason (optional)</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you sending this?"
            rows={2}
            maxLength={500}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !receiverId || !amount} loading={busy} loadingText="Sending...">
            Send
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Detail Peek Modal (mobile) ──────────────────────────────────────────

function TransferDetailModal({
  open,
  transfer,
  currentUserId,
  canApprove,
  onClose,
  onReject,
}: {
  open: boolean;
  transfer: MbFundTransferRecord | null;
  currentUserId: string;
  canApprove: boolean;
  onClose: () => void;
  onReject: (id: string) => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher.data);
  useCloseOnFetcherSuccess(fetcher, () => onClose());
  const busy = fetcher.state !== 'idle';

  if (!transfer) return <Modal open={false} onClose={onClose}>{null}</Modal>;

  const s = STATUS_MAP[transfer.status] ?? { label: transfer.status, variant: 'warning' as const };

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md" contentClassName="p-6">
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-app-fg">Transfer Details</h3>
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">Status</span>
          <StatusBadge status={s.label} variant={s.variant} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">Amount</span>
          <NairaPrice amount={Number(transfer.amount)} className="text-sm font-semibold" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">From</span>
          <span className="text-sm font-medium text-app-fg">
            {transfer.senderMbId === currentUserId ? 'You' : (transfer.senderName ?? 'Unknown')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">To</span>
          <span className="text-sm font-medium text-app-fg">
            {transfer.receiverMbId === currentUserId ? 'You' : (transfer.receiverName ?? 'Unknown')}
          </span>
        </div>
        {transfer.reason && (
          <div>
            <span className="text-sm text-app-fg-muted">Reason</span>
            <p className="mt-0.5 text-sm text-app-fg">{transfer.reason}</p>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm text-app-fg-muted">Date</span>
          <span className="text-sm text-app-fg tabular-nums">{formatDate(transfer.createdAt)}</span>
        </div>
        {transfer.approverName && transfer.approvedAt && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-app-fg-muted">Approved by</span>
            <span className="text-sm text-app-fg">{transfer.approverName} on {formatDate(transfer.approvedAt)}</span>
          </div>
        )}
        {transfer.rejectionReason && (
          <div>
            <span className="text-sm text-app-fg-muted">Rejection reason</span>
            <p className="mt-0.5 text-sm text-danger-600 dark:text-danger-400">{transfer.rejectionReason}</p>
          </div>
        )}
        {transfer.acceptedAt && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-app-fg-muted">Accepted</span>
            <span className="text-sm text-app-fg tabular-nums">{formatDate(transfer.acceptedAt)}</span>
          </div>
        )}
      </div>

      {canApprove && transfer.status === 'PENDING' && (
        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1"
            onClick={() =>
              fetcher.submit({ intent: 'approve', transferId: transfer.id }, { method: 'post' })
            }
            disabled={busy}
          >
            {busy ? 'Approving...' : 'Approve'}
          </Button>
          <Button className="flex-1" variant="danger" onClick={() => onReject(transfer.id)} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
      {transfer.status === 'APPROVED' && transfer.receiverMbId === currentUserId && (
        <div className="mt-4">
          <Button
            className="w-full"
            onClick={() =>
              fetcher.submit({ intent: 'accept', transferId: transfer.id }, { method: 'post' })
            }
            disabled={busy}
          >
            {busy ? 'Accepting...' : 'Accept Transfer'}
          </Button>
        </div>
      )}
    </Modal>
  );
}

// ── Reject Reason Modal ─────────────────────────────────────────────────

function RejectTransferModal({
  open,
  transferId,
  reason,
  onReasonChange,
  onClose,
}: {
  open: boolean;
  transferId: string;
  reason: string;
  onReasonChange: (v: string) => void;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  useFetcherToast(fetcher.data);
  useCloseOnFetcherSuccess(fetcher, () => onClose());
  const busy = fetcher.state !== 'idle';

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!reason.trim()) return;
      fetcher.submit(
        { intent: 'reject', transferId, rejectionReason: reason.trim() },
        { method: 'post' },
      );
    },
    [fetcher, transferId, reason],
  );

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md" contentClassName="p-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="text-lg font-semibold text-app-fg">Reject Transfer</h3>
        <div>
          <label className="block text-sm font-medium text-app-fg mb-1">Reason for rejection</label>
          <Textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Explain why this transfer is being rejected..."
            rows={3}
            maxLength={500}
            required
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy || !reason.trim()} loading={busy} loadingText="Rejecting...">
            Reject
          </Button>
        </div>
      </form>
    </Modal>
  );
}
