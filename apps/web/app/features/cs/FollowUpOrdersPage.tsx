import { useState } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { CompactTable } from '~/components/ui/compact-table';
import { StatusBadge } from '~/components/ui/status-badge';
import { SearchInput } from '~/components/ui/search-input';
import { Pagination } from '~/components/ui/pagination';
import { Modal } from '~/components/ui/modal';
import { NairaPrice } from '~/components/ui/naira-price';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { EmptyState } from '~/components/ui/empty-state';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useFetcherToast } from '~/components/ui/toast';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';

// ── Types ────────────────────────────────────────────────────────────

interface OrderItem {
  productId: string;
  productName: string | null;
  quantity: number;
  unitPrice: string;
  offerLabel: string | null;
}

interface FollowUpOrder {
  id: string;
  orderNumber: number;
  customerName: string;
  status: string;
  assignedCsId: string | null;
  assignedCsName: string | null;
  mediaBuyerId: string | null;
  mediaBuyerName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  servicingBranchId: string | null;
  totalAmount: string | null;
  createdAt: string;
  confirmedAt: string | null;
  deliveredAt: string | null;
  sourceOrderId: string;
  callbackScheduledAt: string | null;
  preferredDeliveryDate: string | null;
  orderSource: string | null;
  primaryProductName: string | null;
  itemCount: number;
  items: OrderItem[];
}

interface Closer {
  agentId: string;
  agentName: string;
}

interface Props {
  orders: FollowUpOrder[];
  total: number;
  statusCounts: Record<string, number>;
  closers: Closer[];
  page: number;
  isCloser: boolean;
  statusFilter: string;
  searchFilter: string;
  deferredLoading?: boolean;
}

// ── Status labels ────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  UNPROCESSED: 'Unprocessed',
  CS_ASSIGNED: 'Assigned',
  CS_ENGAGED: 'Engaged',
  CONFIRMED: 'Confirmed',
  AGENT_ASSIGNED: 'Agent Assigned',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  REMITTED: 'Remitted',
  DELETED: 'Deleted',
};

function formatOrderId(n: number) {
  return `YNS-${String(n).padStart(5, '0')}`;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' });
}

// ── Component ────────────────────────────────────────────────────────

export function FollowUpOrdersPage({
  orders = [],
  total = 0,
  statusCounts = {},
  closers = [],
  page = 1,
  isCloser = false,
  statusFilter = '',
  searchFilter = '',
  deferredLoading,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [assignCloserId, setAssignCloserId] = useState('');

  const assignFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(assignFetcher.data, { successMessage: 'Orders assigned' });
  useCloseOnFetcherSuccess(assignFetcher, () => {
    setAssignModalOpen(false);
    setSelectedOrderIds(new Set());
  });

  const totalPages = Math.ceil(total / 50) || 1;

  const countEntries = Object.entries(statusCounts).sort(([a], [b]) => {
    const order = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED'];
    return order.indexOf(a) - order.indexOf(b);
  });
  const grandTotal = countEntries.reduce((sum, [, c]) => sum + c, 0);

  const closerOptions = closers.map((c) => ({ value: c.agentId, label: c.agentName }));

  const updateParam = (key: string, val: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('view', 'orders');
      if (val) next.set(key, val);
      else next.delete(key);
      next.set('page', '1');
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkAssign = () => {
    if (!assignCloserId || selectedOrderIds.size === 0) return;
    const fd = new FormData();
    fd.set('intent', 'bulkAssignFollowUpOrders');
    fd.set('orderIds', JSON.stringify([...selectedOrderIds]));
    fd.set('closerIds', JSON.stringify([assignCloserId]));
    assignFetcher.submit(fd, { method: 'post' });
  };

  // Build the detail link — navigates to the follow-up order detail page
  const detailLink = (o: FollowUpOrder) => `/admin/cs/follow-up/orders/${o.id}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow-Up Orders"
        description="Orders pulled by follow-up config rules."
        backTo="/admin/cs/follow-up"
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Follow-up tools"
            desktop={<PageRefreshButton />}
          />
        }
      />

      {/* ── Status pills ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => updateParam('status', '')}
          className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${!statusFilter ? 'bg-brand-600 text-white border-brand-600' : 'border-app-border text-app-fg-muted hover:bg-app-hover'}`}
        >
          All ({grandTotal})
        </button>
        {countEntries.map(([status, cnt]) => (
          <button
            key={status}
            type="button"
            onClick={() => updateParam('status', status)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${statusFilter === status ? 'bg-brand-600 text-white border-brand-600' : 'border-app-border text-app-fg-muted hover:bg-app-hover'}`}
          >
            {STATUS_LABELS[status] ?? status} ({cnt})
          </button>
        ))}
      </div>

      {/* ── Search + bulk actions ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchFilter}
          onChange={(v) => updateParam('search', v)}
          placeholder="Search by name, order ID, or closer..."
          wrapperClassName="flex-1 min-w-[12rem]"
        />
        {!isCloser && selectedOrderIds.size > 0 && (
          <button
            type="button"
            onClick={() => setAssignModalOpen(true)}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            Assign ({selectedOrderIds.size})
          </button>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────────── */}
      {deferredLoading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 rounded bg-app-hover" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          title="No follow-up orders"
          description="No orders match the current filters."
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="sm:hidden space-y-2">
            {orders.map((o) => (
              <Link
                key={o.id}
                to={detailLink(o)}
                className="block rounded-lg border border-app-border bg-app-card p-3 space-y-1.5 active:bg-app-hover"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-app-fg truncate">{o.customerName}</span>
                  <span className="shrink-0 text-xs font-mono text-app-fg-muted">{formatOrderId(o.orderNumber)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={o.status} />
                  <span className="text-xs text-app-fg-muted">{formatDate(o.createdAt)}</span>
                </div>
                {o.primaryProductName && (
                  <p className="text-xs text-app-fg-muted truncate">
                    {o.primaryProductName}
                    {o.itemCount > 1 && <span className="text-app-fg-muted"> +{o.itemCount - 1} more</span>}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                  {o.assignedCsName && <span>CS: {o.assignedCsName}</span>}
                  {o.totalAmount && <NairaPrice amount={Number(o.totalAmount)} />}
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block">
            <CompactTable<FollowUpOrder>
              rowKey={(o) => o.id}
              columns={[
                ...(!isCloser
                  ? [{
                      key: 'select',
                      header: '',
                      tight: true,
                      render: (o: FollowUpOrder) => (
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.has(o.id)}
                          onChange={() => toggleSelect(o.id)}
                          className="rounded border-app-border text-brand-600 focus:ring-brand-500"
                        />
                      ),
                    }]
                  : []),
                {
                  key: 'orderNumber',
                  header: 'Order',
                  render: (o) => (
                    <Link to={detailLink(o)} className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline font-mono">
                      {formatOrderId(o.orderNumber)}
                    </Link>
                  ),
                },
                {
                  key: 'customer',
                  header: 'Customer',
                  render: (o) => (
                    <div className="min-w-0">
                      <p className="text-sm text-app-fg truncate max-w-[10rem]">{o.customerName}</p>
                      {o.campaignName && (
                        <p className="text-micro text-app-fg-muted truncate max-w-[10rem]">{o.campaignName}</p>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'product',
                  header: 'Product',
                  render: (o) => (
                    <div className="min-w-0">
                      <p className="text-sm text-app-fg truncate max-w-[10rem]">{o.primaryProductName ?? '—'}</p>
                      {o.itemCount > 1 && (
                        <p className="text-micro text-app-fg-muted">+{o.itemCount - 1} more</p>
                      )}
                      {o.items[0]?.offerLabel && (
                        <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 text-micro font-medium text-amber-700 dark:text-amber-400 mt-0.5">
                          {o.items[0].offerLabel}
                        </span>
                      )}
                    </div>
                  ),
                },
                ...(!isCloser
                  ? [{
                      key: 'closer',
                      header: 'Closer',
                      render: (o: FollowUpOrder) => (
                        <span className="text-sm text-app-fg-muted">{o.assignedCsName ?? '—'}</span>
                      ),
                    }]
                  : []),
                {
                  key: 'status',
                  header: 'Status',
                  render: (o) => <StatusBadge status={o.status} />,
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  align: 'right' as const,
                  render: (o) => o.totalAmount ? <NairaPrice amount={Number(o.totalAmount)} /> : <span className="text-app-fg-muted">—</span>,
                },
                {
                  key: 'created',
                  header: 'Created',
                  render: (o) => <span className="text-xs text-app-fg-muted">{formatDate(o.createdAt)}</span>,
                },
              ]}
              rows={orders}
            />
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-app-fg-muted">
              Showing {orders.length} of {total}
            </p>
            <Pagination page={page} totalPages={totalPages} pageParam="page" />
          </div>
        </>
      )}

      {/* ── Assign Modal ──────────────────────────────────────────── */}
      {assignModalOpen && (
        <Modal open onClose={() => setAssignModalOpen(false)}>
          <div className="space-y-4">
            <h3 className="text-base font-semibold text-app-fg">Assign {selectedOrderIds.size} orders</h3>
            <SearchableSelect
              value={assignCloserId}
              onChange={setAssignCloserId}
              options={closerOptions}
              placeholder="Select closer"
              searchPlaceholder="Search closers..."
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                className="rounded-md border border-app-border px-3 py-1.5 text-xs font-medium text-app-fg hover:bg-app-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkAssign}
                disabled={!assignCloserId || assignFetcher.state !== 'idle'}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {assignFetcher.state !== 'idle' ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
