import { useState, useEffect } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Spinner } from '~/components/ui/spinner';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import { fetchDuplicateComparisonPhones } from '~/lib/trpc-browser';
import { formatOrderTimestamp } from '~/lib/format-date';
import type { OrderDetail } from './types';

type TrpcEnvelope<T> = { result?: { data?: T } };

interface ComparisonOrder {
  id: string;
  orderNumber?: number | null;
  customerName: string;
  customerPhoneDisplay: string;
  customerAddress: string | null;
  deliveryAddress: string | null;
  deliveryState?: string | null;
  status: string;
  totalAmount: string | null;
  createdAt: string;
  paymentMethod?: string | null;
  assignedCsName?: string | null;
  mediaBuyerName?: string | null;
  campaignName?: string | null;
  logisticsLocationName?: string | null;
  riderName?: string | null;
  deliveryFee?: string | null;
  orderItems: Array<{
    productId: string;
    quantity: number;
    unitPrice: string;
    productName?: string | null;
    offerLabel?: string | null;
  }>;
}

interface DuplicateComparisonModalProps {
  open: boolean;
  onClose: () => void;
  currentOrder: OrderDetail;
}

function formatItems(items: ComparisonOrder['orderItems']): string {
  if (items.length === 0) return '—';
  return items
    .map((i) => {
      const name = i.productName?.trim() || 'Unknown';
      const offer = i.offerLabel ? ` (${i.offerLabel})` : '';
      return `${name}${offer} × ${i.quantity}`;
    })
    .join(', ');
}

interface FieldRow {
  label: string;
  newValue: React.ReactNode;
  origValue: React.ReactNode;
  /** String form for difference detection */
  newStr?: string;
  origStr?: string;
}

/** Row with diff highlighting — desktop: 3-col side-by-side, mobile: stacked label → original → new */
function CompareRow({ label, newValue, origValue, newStr, origStr }: FieldRow) {
  const isDiff =
    newStr != null && origStr != null && newStr !== origStr && newStr !== '—' && origStr !== '—';
  const bg = isDiff ? 'bg-warning-50/60 dark:bg-warning-900/15' : '';
  return (
    <div className={bg}>
      {/* Desktop */}
      <div className="hidden md:grid grid-cols-[140px_1fr_1fr] gap-x-3 px-3 py-2">
        <dt className="text-xs font-medium text-app-fg-muted truncate self-center">{label}</dt>
        <dd className="text-sm text-app-fg min-w-0 break-words">{newValue}</dd>
        <dd className="text-sm text-app-fg min-w-0 break-words">{origValue}</dd>
      </div>
      {/* Mobile: stacked — label, original, new */}
      <div className="md:hidden px-3 py-2.5 space-y-1">
        <dt className="text-micro font-semibold text-app-fg-muted uppercase tracking-wider">{label}</dt>
        <dd className="flex items-start gap-2 text-sm text-app-fg min-w-0">
          <span className="inline-flex shrink-0 items-center rounded bg-brand-100 dark:bg-brand-900/30 px-1.5 py-0.5 text-micro font-bold text-brand-700 dark:text-brand-300">OLD</span>
          <span className="min-w-0 break-words">{origValue}</span>
        </dd>
        <dd className="flex items-start gap-2 text-sm text-app-fg min-w-0">
          <span className="inline-flex shrink-0 items-center rounded bg-warning-100 dark:bg-warning-900/40 px-1.5 py-0.5 text-micro font-bold text-warning-700 dark:text-warning-300">NEW</span>
          <span className="min-w-0 break-words">{newValue}</span>
        </dd>
      </div>
    </div>
  );
}

export function DuplicateComparisonModal({
  open,
  onClose,
  currentOrder,
}: DuplicateComparisonModalProps) {
  const [original, setOriginal] = useState<ComparisonOrder | null>(null);
  const [phones, setPhones] = useState<{ orderPhone: string; originalPhone: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !currentOrder.duplicateOfId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOriginal(null);
    setPhones(null);

    const origId = currentOrder.duplicateOfId;

    const fetchOriginal = async () => {
      const base = getBrowserApiBaseUrl();
      if (!base) throw new Error('API URL not configured');
      const url = `${base}/trpc/orders.getById?input=${encodeURIComponent(
        JSON.stringify({ orderId: origId }),
      )}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Could not load original order');
      const json = (await res.json()) as TrpcEnvelope<ComparisonOrder>;
      return json.result?.data ?? null;
    };

    Promise.all([
      fetchOriginal(),
      fetchDuplicateComparisonPhones(currentOrder.id, origId),
    ])
      .then(([orig, ph]) => {
        if (cancelled) return;
        if (!orig) {
          setError('The original order could not be found. It may have been archived.');
        } else {
          setOriginal(orig);
        }
        setPhones(ph);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load comparison data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, currentOrder.id, currentOrder.duplicateOfId]);

  const isSoft = currentOrder.isDuplicate === 'POSSIBLY_DUPLICATE';
  const n = currentOrder; // new order alias

  /** Build field rows used by both desktop and mobile layouts */
  function buildFields(orig: ComparisonOrder) {
    const newPhone = phones?.orderPhone || n.customerPhoneDisplay || '—';
    const origPhone = phones?.originalPhone || orig.customerPhoneDisplay || '—';
    const newItems = formatItems(n.orderItems);
    const origItems = formatItems(orig.orderItems);

    return [
      {
        label: 'Order',
        newValue: (
          <OrderIdBadge id={n.id} orderNumber={n.orderNumber} length={8} textClassName="font-mono text-xs" className="inline-flex" />
        ),
        origValue: (
          <OrderIdBadge id={orig.id} orderNumber={orig.orderNumber} length={8} linkTo={`/admin/orders/${orig.id}`} newTab textClassName="font-mono text-xs text-brand-600 dark:text-brand-400 hover:underline" className="inline-flex" />
        ),
      },
      {
        label: 'Status',
        newValue: <OrderStatusBadge status={n.status} />,
        origValue: <OrderStatusBadge status={orig.status} />,
        newStr: n.status,
        origStr: orig.status,
      },
      { label: 'Customer', newValue: n.customerName, origValue: orig.customerName, newStr: n.customerName, origStr: orig.customerName },
      {
        label: 'Phone',
        newValue: <span className="font-mono text-xs">{newPhone}</span>,
        origValue: <span className="font-mono text-xs">{origPhone}</span>,
        newStr: newPhone,
        origStr: origPhone,
      },
      { label: 'Items / Offer', newValue: newItems, origValue: origItems, newStr: newItems, origStr: origItems },
      {
        label: 'Total',
        newValue: n.totalAmount ? <span className="font-semibold"><NairaPrice amount={Number(n.totalAmount)} /></span> : '—',
        origValue: orig.totalAmount ? <span className="font-semibold"><NairaPrice amount={Number(orig.totalAmount)} /></span> : '—',
        newStr: n.totalAmount ?? '—',
        origStr: orig.totalAmount ?? '—',
      },
      {
        label: 'Delivery fee',
        newValue: n.deliveryFee && Number(n.deliveryFee) > 0 ? <NairaPrice amount={Number(n.deliveryFee)} /> : '—',
        origValue: orig.deliveryFee && Number(orig.deliveryFee) > 0 ? <NairaPrice amount={Number(orig.deliveryFee)} /> : '—',
        newStr: n.deliveryFee ?? '—',
        origStr: orig.deliveryFee ?? '—',
      },
      { label: 'Payment', newValue: n.paymentMethod ?? '—', origValue: orig.paymentMethod ?? '—', newStr: n.paymentMethod ?? '—', origStr: orig.paymentMethod ?? '—' },
      { label: 'Created', newValue: formatOrderTimestamp(n.createdAt), origValue: formatOrderTimestamp(orig.createdAt), newStr: n.createdAt, origStr: orig.createdAt },
      { label: 'Delivery address', newValue: n.deliveryAddress ?? '—', origValue: orig.deliveryAddress ?? '—', newStr: n.deliveryAddress ?? '—', origStr: orig.deliveryAddress ?? '—' },
      { label: 'State', newValue: n.deliveryState ?? '—', origValue: orig.deliveryState ?? '—', newStr: n.deliveryState ?? '—', origStr: orig.deliveryState ?? '—' },
      { label: 'Media buyer', newValue: n.mediaBuyerName ?? '—', origValue: orig.mediaBuyerName ?? '—', newStr: n.mediaBuyerName ?? '—', origStr: orig.mediaBuyerName ?? '—' },
      { label: 'Form', newValue: n.campaignName ?? '—', origValue: orig.campaignName ?? '—', newStr: n.campaignName ?? '—', origStr: orig.campaignName ?? '—' },
      { label: 'Assigned CS', newValue: n.assignedCsName ?? '—', origValue: orig.assignedCsName ?? '—', newStr: n.assignedCsName ?? '—', origStr: orig.assignedCsName ?? '—' },
      { label: '3PL location', newValue: n.logisticsLocationName ?? '—', origValue: orig.logisticsLocationName ?? '—', newStr: n.logisticsLocationName ?? '—', origStr: orig.logisticsLocationName ?? '—' },
      { label: 'Rider', newValue: n.riderName ?? '—', origValue: orig.riderName ?? '—', newStr: n.riderName ?? '—', origStr: orig.riderName ?? '—' },
    ] satisfies FieldRow[];
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth="max-w-3xl"
      contentClassName="p-0 !max-h-[95dvh] md:!max-h-[92dvh] flex flex-col"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-app-border">
        <h2 className="text-lg font-semibold text-app-fg">Duplicate Comparison</h2>
        <p
          className={`text-xs mt-0.5 ${
            isSoft
              ? 'text-warning-700 dark:text-warning-400'
              : 'text-danger-700 dark:text-danger-400'
          }`}
        >
          {isSoft
            ? 'Possibly duplicate — same phone within 30 days'
            : 'Flagged — same phone in the last 24 hours'}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner />
            <span className="ml-2 text-sm text-app-fg-muted">Loading original order…</span>
          </div>
        ) : error ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-danger-700 dark:text-danger-300">{error}</p>
          </div>
        ) : original ? (
          <>
            {/* Desktop column headers */}
            <div className="hidden md:grid grid-cols-[140px_1fr_1fr] gap-x-3 px-3 py-2.5 border-b border-app-border bg-app-hover/60 sticky top-0 z-10">
              <div />
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-warning-100 dark:bg-warning-900/40 px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-warning-700 dark:text-warning-300">
                  New
                </span>
                <span className="text-xs text-app-fg-muted">This order</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-brand-100 dark:bg-brand-900/30 px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
                  Original
                </span>
                <span className="text-xs text-app-fg-muted">Existing order</span>
              </div>
            </div>

            <dl className="divide-y divide-app-border/60">
              {buildFields(original).map((f) => (
                <CompareRow key={f.label} {...f} />
              ))}
            </dl>
          </>
        ) : null}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-app-border flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
