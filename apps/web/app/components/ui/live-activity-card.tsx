import { Link } from '@remix-run/react';
import { Modal } from '~/components/ui/modal';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import type { LiveActivityItem } from '~/features/cs/types';

// ─── Activity status helpers ───

export type ActivityStage =
  | 'browsing'      // PENDING cart
  | 'abandoned'     // ABANDONED cart
  | 'order_placed'  // CONVERTED → order UNPROCESSED / CS_ASSIGNED
  | 'with_cs'       // CS_ENGAGED
  | 'confirmed'     // CONFIRMED
  | 'in_delivery'   // ALLOCATED / DISPATCHED / IN_TRANSIT
  | 'delivered'     // DELIVERED / COMPLETED
  | 'returned';     // RETURNED / PARTIALLY_DELIVERED

export function resolveStage(item: LiveActivityItem): ActivityStage {
  if (item.cartStatus === 'ABANDONED') return 'abandoned';
  if (item.cartStatus === 'PENDING') return 'browsing';
  // CONVERTED cart or direct order — check order status
  const s = item.orderStatus ?? '';
  if (s === 'DELIVERED' || s === 'REMITTED') return 'delivered';
  if (s === 'RETURNED' || s === 'PARTIALLY_DELIVERED' || s === 'WRITTEN_OFF') return 'returned';
  if (s === 'AGENT_ASSIGNED' || s === 'DISPATCHED' || s === 'IN_TRANSIT') return 'in_delivery';
  if (s === 'CONFIRMED') return 'confirmed';
  if (s === 'CS_ENGAGED') return 'with_cs';
  return 'order_placed';
}

export const STAGE_CONFIG: Record<ActivityStage, {
  label: string;
  dotColor: string;
  ping: boolean;
  cardBg: string;
  borderColor: string;
  badgeColor: string;
  textColor: string;
}> = {
  browsing:     { label: 'Browsing',         dotColor: 'bg-amber-400',   ping: true,  cardBg: 'bg-app-elevated',  borderColor: 'border-amber-200 dark:border-amber-800',     badgeColor: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',       textColor: 'text-amber-600 dark:text-amber-400' },
  abandoned:    { label: 'Dropped off',      dotColor: 'bg-surface-400', ping: false, cardBg: 'bg-app-elevated',  borderColor: 'border-app-border',                          badgeColor: 'bg-app-hover text-app-fg-muted',                                             textColor: 'text-app-fg-muted' },
  order_placed: { label: 'Order placed',     dotColor: 'bg-blue-500',    ping: true,  cardBg: 'bg-app-elevated',  borderColor: 'border-blue-200 dark:border-blue-800',       badgeColor: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',           textColor: 'text-blue-600 dark:text-blue-400' },
  with_cs:      { label: 'With CS',          dotColor: 'bg-purple-500',  ping: true,  cardBg: 'bg-app-elevated',  borderColor: 'border-purple-200 dark:border-purple-800',   badgeColor: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',   textColor: 'text-purple-600 dark:text-purple-400' },
  confirmed:    { label: 'Confirmed',        dotColor: 'bg-cyan-500',    ping: true,  cardBg: 'bg-app-elevated',  borderColor: 'border-cyan-200 dark:border-cyan-800',       badgeColor: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400',           textColor: 'text-cyan-600 dark:text-cyan-400' },
  in_delivery:  { label: 'Out for delivery', dotColor: 'bg-orange-500',  ping: true,  cardBg: 'bg-app-elevated',  borderColor: 'border-orange-200 dark:border-orange-800',   badgeColor: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',   textColor: 'text-orange-600 dark:text-orange-400' },
  delivered:    { label: 'Delivered ✓',      dotColor: 'bg-emerald-500', ping: false, cardBg: 'bg-app-elevated',  borderColor: 'border-emerald-200 dark:border-emerald-800', badgeColor: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400', textColor: 'text-emerald-600 dark:text-emerald-400' },
  returned:     { label: 'Returned',         dotColor: 'bg-rose-500',    ping: false, cardBg: 'bg-app-elevated',  borderColor: 'border-rose-200 dark:border-rose-800',       badgeColor: 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',           textColor: 'text-rose-600 dark:text-rose-400' },
};

// ─── Live activity card ───

export function LiveActivityCard({
  item,
  isNew,
  isUpdated,
  onOpen,
}: {
  item: LiveActivityItem;
  isNew?: boolean;
  isUpdated?: boolean;
  onOpen: (item: LiveActivityItem) => void;
}) {
  const stage = resolveStage(item);
  const cfg = STAGE_CONFIG[stage];

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`
        group relative w-full text-left rounded-xl border transition-all duration-200 cursor-pointer
        ${isNew
          ? 'animate-slide-in-up border-success-400 dark:border-success-500 bg-gradient-to-br from-success-50 to-white dark:from-success-900/20 dark:to-surface-800 shadow-md'
          : `${cfg.cardBg} ${cfg.borderColor} hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700`
        }
        ${(isNew || isUpdated) ? 'row-new-highlight' : ''}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
      `}
    >
      {/* Stage indicator dot */}
      <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
        {cfg.ping && !isNew ? (
          <>
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dotColor} opacity-60`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.dotColor}`} />
          </>
        ) : isNew ? (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success-500" />
          </>
        ) : (
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.dotColor}`} />
        )}
      </span>

      <div className="p-3.5 pr-8">
        {/* Status pill */}
        <div className="mb-2">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cfg.badgeColor}`}>
            {cfg.label}
          </span>
        </div>

        {/* Name */}
        <div className="mb-2">
          <p className="text-sm font-semibold text-app-fg truncate leading-tight">
            {item.customerName}
          </p>
        </div>

        {/* Product pill — always rendered on its own line; name truncates */}
        <div className="mb-1.5 min-w-0">
          <span className="inline-flex max-w-full items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-app-hover text-app-fg-muted">
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="truncate min-w-0">{item.productName ?? '—'}</span>
          </span>
        </div>

        {/* Amount — always on its own new line so card height is uniform */}
        <div className="mb-2 text-[11px] font-bold text-app-fg">
          <NairaPrice amount={item.totalAmount} className="font-bold text-app-fg" />
        </div>

        {/* Timestamp */}
        <div className="text-[11px] font-medium text-app-fg-muted">
          {new Date(item.updatedAt).toLocaleString('en-NG', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          })}
        </div>

        {/* NEW / UPDATED flash */}
        {(isNew || isUpdated) && (
          <div className={`mt-2 pt-2 border-t flex items-center gap-1.5 ${isNew ? 'border-success-200 dark:border-success-800/50' : 'border-success-200/60 dark:border-success-800/30'}`}>
            <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-success-500 text-white">
              {isNew ? 'JUST NOW' : 'UPDATED'}
            </span>
            <span className={`text-[11px] ${cfg.textColor}`}>
              {isNew ? cfg.label : 'Status changed'}
            </span>
          </div>
        )}
      </div>

      {/* Hover arrow */}
      <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}

// ─── Live activity detail modal ───

export function LiveActivityDetailModal({ item, onClose }: { item: LiveActivityItem | null; onClose: () => void }) {
  const stage = item ? resolveStage(item) : 'browsing';
  const cfg = item ? STAGE_CONFIG[stage] : STAGE_CONFIG.browsing;

  return (
    <Modal open={item != null} onClose={onClose} maxWidth="max-w-sm" backdropBlur>
      {item && (
        <div>
          {/* Header */}
          <div className="relative bg-gradient-to-br from-brand-600 to-brand-700 dark:from-brand-700 dark:to-brand-900 px-5 pt-5 pb-8 rounded-t-2xl md:rounded-t-xl">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="min-w-0 pr-8">
              <p className="text-base font-bold text-white truncate">{item.customerName}</p>
              <p className="text-sm font-mono text-brand-200 truncate">{item.customerPhoneDisplay}</p>
            </div>
            <div className="mt-3">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${cfg.badgeColor}`}>
                {cfg.label}
              </span>
            </div>
          </div>

          {/* Current status indicator — only shows the live stage, not the full journey */}
          {stage !== 'abandoned' && stage !== 'returned' && (
            <div className="px-5 pt-4 pb-0 -mt-2">
              <div className="bg-app-elevated rounded-xl border border-app-border px-4 py-3 flex items-center gap-3">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dotColor} opacity-60`} />
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${cfg.dotColor}`} />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-app-fg-muted">Current status</p>
                  <p className={`text-sm font-bold leading-tight ${cfg.textColor}`}>{cfg.label}</p>
                </div>
              </div>
            </div>
          )}

          {/* Body */}
          <div className="px-5 pt-3 pb-5">
            <div className="bg-app-elevated rounded-xl shadow-sm border border-app-border divide-y divide-app-border mb-3">
              <DetailRow label="Product" value={item.productName ?? '—'} icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              } />
              <DetailRow
                label="Amount"
                value={<NairaPrice amount={item.totalAmount} className="text-sm font-semibold text-app-fg" />}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
              {item.offerLabel && (
                <DetailRow label="Offer" value={item.offerLabel} icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                } />
              )}
              {item.linkedOrderId && (
                <DetailRow label="Order ID" value={<OrderIdBadge id={item.linkedOrderId} uppercase ellipsis="" textClassName="text-app-fg" />} icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                } />
              )}
              <DetailRow
                label="Last activity"
                value={new Date(item.updatedAt).toLocaleString('en-NG', {
                  weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </div>

            <div className="flex flex-col gap-2 mb-3">
              {item.linkedOrderId ? (
                <Link
                  to={`/admin/orders/${item.linkedOrderId}`}
                  prefetch="intent"
                  onClick={onClose}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  View order
                </Link>
              ) : (
                <Link
                  to="/admin/cs/queue?tab=queue"
                  prefetch="intent"
                  onClick={onClose}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h10" />
                  </svg>
                  Open unassigned queue
                </Link>
              )}
              <Link
                to="/admin/cs/orders?period=all_time"
                prefetch="intent"
                onClick={onClose}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-app-fg bg-app-hover hover:bg-app-hover/80 border border-app-border transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                All CS orders
              </Link>
            </div>

            <p className="text-xs text-center text-app-fg-muted">
              {stage === 'browsing' && 'Customer is actively browsing — they may convert soon.'}
              {stage === 'abandoned' && 'Customer left without placing an order.'}
              {stage === 'order_placed' && 'Order created — waiting for CS assignment.'}
              {stage === 'with_cs' && 'A closer is engaged with this customer.'}
              {stage === 'confirmed' && 'Order confirmed — awaiting logistics allocation.'}
              {stage === 'in_delivery' && 'Out for delivery.'}
              {stage === 'delivered' && 'Successfully delivered.'}
              {stage === 'returned' && 'Order was returned.'}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function DetailRow({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon ? <span className="shrink-0 text-app-fg-muted">{icon}</span> : <span className="shrink-0 w-4" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider font-medium text-app-fg-muted">{label}</p>
        <div className="text-sm font-medium text-app-fg truncate mt-0.5">{value}</div>
      </div>
    </div>
  );
}
