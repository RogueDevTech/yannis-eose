import { PageHeader } from '~/components/ui/page-header';
import { StatusBadge } from '~/components/ui/status-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { CompactTableActionButton } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';

interface DuplicateOrder {
  id: string;
  orderNumber: number | null;
  customerName: string;
  totalAmount: string;
  deliveryFee: string | null;
  status: string;
  orderSource: string | null;
  isFollowUp: boolean;
  isOriginal: boolean;
  isDuplicate: string | null;
  createdAt: string;
  confirmedAt: string | null;
  deliveredAt: string | null;
  closerName: string | null;
  mediaBuyerName: string | null;
  locationName: string | null;
  providerName: string | null;
  invoice: {
    id: string;
    referenceNumber: number;
    totalAmount: string;
    status: string;
    createdAt: string;
  } | null;
  remittance: {
    id: string;
    status: string;
    sentAt: string;
    receivedAt: string | null;
  } | null;
}

interface DuplicateGroupData {
  originalOrderId: string;
  products: Array<{ id: string; name: string }>;
  orders: DuplicateOrder[];
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-NG', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function sourceLabel(source: string | null, isFollowUp: boolean): string {
  if (isFollowUp) return 'Follow-up';
  if (source === 'offline') return 'Offline';
  if (source === 'online') return 'Cart';
  return 'Form';
}

const REMITTANCE_STATUS_LABEL: Record<string, string> = {
  SENT: 'Pending',
  RECEIVED: 'Received',
  DISPUTED: 'Disputed',
};

function OrderCard({ order, isFirst }: { order: DuplicateOrder; isFirst: boolean }) {
  const net = Number(order.totalAmount || 0) - Number(order.deliveryFee || 0);
  const orderLabel = order.orderNumber ? `YNS-${order.orderNumber}` : order.id.slice(0, 12);
  const source = sourceLabel(order.orderSource, order.isFollowUp);

  return (
    <div
      className={[
        'card !py-3 !px-4 space-y-2',
        isFirst ? 'border-success-500/50 dark:border-success-500/30' : '',
        order.isDuplicate && !isFirst ? 'border-warning-500/50 dark:border-warning-500/30 bg-warning-50/30 dark:bg-warning-950/10' : '',
      ].filter(Boolean).join(' ')}
    >
      {/* Row 1: Order ID + badges + amounts + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-app-fg shrink-0">{orderLabel}</span>
          {isFirst && <span className="rounded bg-success-100 dark:bg-success-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-success-700 dark:text-success-300">Original</span>}
          {order.isDuplicate && !isFirst && <span className="rounded bg-warning-100 dark:bg-warning-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300">Duplicate</span>}
          <span className="rounded bg-app-hover px-1.5 py-0.5 text-[10px] font-medium text-app-fg-muted">{source}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-app-fg-muted tabular-nums">Gross <NairaPrice amount={Number(order.totalAmount || 0)} className="text-xs font-medium text-app-fg" /></span>
          {order.deliveryFee && Number(order.deliveryFee) > 0 && (
            <span className="text-xs text-app-fg-muted tabular-nums">Fee <NairaPrice amount={Number(order.deliveryFee)} className="text-xs font-medium text-danger-600 dark:text-danger-400" /></span>
          )}
          <NairaPrice amount={net} className="text-sm font-semibold tabular-nums" />
          <StatusBadge status={order.status} />
        </div>
      </div>

      {/* Row 2: Dates + invoice + remittance + action */}
      <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Created {formatDate(order.createdAt)}</span>
          {order.deliveredAt && <span>Delivered {formatDate(order.deliveredAt)}</span>}
          {order.invoice && (
            <span>INV-{String(order.invoice.referenceNumber).padStart(6, '0')} · <NairaPrice amount={Number(order.invoice.totalAmount || 0)} className="text-xs" /></span>
          )}
          {order.remittance && (
            <span>Remittance: {REMITTANCE_STATUS_LABEL[order.remittance.status] ?? order.remittance.status}</span>
          )}
        </div>
        <CompactTableActionButton to={`/admin/orders/${order.id}`}>View</CompactTableActionButton>
      </div>
    </div>
  );
}

export function DuplicateComparisonPage({ data }: { data: DuplicateGroupData }) {
  const { orders, products } = data;
  const original = orders.find((o) => o.isOriginal) ?? orders[0];
  const duplicates = orders.filter((o) => o.id !== original?.id);
  const totalGross = orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0);
  const totalNet = orders.reduce(
    (s, o) => s + Number(o.totalAmount || 0) - Number(o.deliveryFee || 0),
    0,
  );


  return (
    <div className="space-y-6">
      <PageHeader
        title="Duplicate Order Analysis"
        backTo="/admin/finance/delivery-remittances?tab=remittances&view=orders"
        description={
          products.length > 0
            ? `${orders.length} orders for the same customer and product: ${products.map((p) => p.name).join(', ')}`
            : `${orders.length} potentially duplicate orders`
        }
      />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total Orders', value: orders.length, valueClassName: 'text-app-fg' },
          { label: 'Duplicates', value: duplicates.length, valueClassName: duplicates.length > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg' },
          { label: 'Total Gross', value: <NairaPrice amount={totalGross} />, valueClassName: 'text-app-fg' },
          { label: 'Total Net', value: <NairaPrice amount={totalNet} />, valueClassName: 'text-app-fg' },
        ]}
      />

      {/* Common details — shared across all orders in the group */}
      {original && (
        <div className="card !py-3 !px-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="font-medium text-app-fg">{original.customerName}</span>
            {original.closerName && <span className="text-app-fg-muted">Closer: <span className="text-app-fg">{original.closerName}</span></span>}
            {original.mediaBuyerName && <span className="text-app-fg-muted">MB: <span className="text-app-fg">{original.mediaBuyerName}</span></span>}
            {original.locationName && <span className="text-app-fg-muted">{original.locationName}{original.providerName ? `: ${original.providerName}` : ''}</span>}
          </div>
        </div>
      )}

      {/* All orders listed */}
      {orders.length > 0 && (
        <div className="space-y-2">
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} isFirst={o.id === original?.id} />
          ))}
        </div>
      )}

      {orders.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-app-fg-muted">No duplicate orders found for this order.</p>
        </div>
      )}
    </div>
  );
}
