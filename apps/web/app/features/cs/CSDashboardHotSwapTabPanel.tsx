import { useEffect, useRef } from 'react';
import { Link } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StripToolbar } from '~/components/ui/strip-toolbar';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import type { AgentWorkload, CSOrder } from './types';

export function CSDashboardHotSwapTabPanel({
  hotSwapFrom,
  hotSwapTo,
  hotSwapOrderIds,
  hotSwapListLoading,
  hotSwapSourceOrders,
  hotSwapSourceTotal,
  workloads,
  fetcherSubmitting,
  onClearSelection,
  onReassign,
  onFromCloserChange,
  onToCloserChange,
  toggleHotSwapOrder,
  selectAllHotSwap,
}: {
  hotSwapFrom: string;
  hotSwapTo: string;
  hotSwapOrderIds: string[];
  hotSwapListLoading: boolean;
  hotSwapSourceOrders: CSOrder[];
  hotSwapSourceTotal: number;
  workloads: AgentWorkload[];
  fetcherSubmitting: boolean;
  onClearSelection: () => void;
  onReassign: () => void;
  onFromCloserChange: (v: string) => void;
  onToCloserChange: (v: string) => void;
  toggleHotSwapOrder: (orderId: string) => void;
  selectAllHotSwap: () => void;
}) {
  // When the user clicks the Hot Swap icon on a workload card the URL flips to
  // `?tab=hotswap&hotSwapFrom=<id>`. The card is at the top of the page so the
  // form below is often off-screen — scroll the panel into view so the user
  // sees the pre-selected closer + the swap form without hunting for it.
  const sectionRef = useRef<HTMLDivElement>(null);
  const ordersScrollRef = useRef<HTMLDivElement>(null);
  const scrollOrdersBy = (delta: number) =>
    ordersScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  useEffect(() => {
    if (!hotSwapFrom || !sectionRef.current) return;
    sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hotSwapFrom]);

  return (
    <div ref={sectionRef} className="h-[28rem] overflow-auto scroll-mt-16" id="hotswap-section">
      <div className="space-y-4">
        <div className="card">
          <StripToolbar
            title="Hot Swap"
            description="Move orders between closers in bulk. Pick a source, target, and orders."
            onScrollLeft={hotSwapFrom && hotSwapSourceOrders.length > 0 ? () => scrollOrdersBy(-280) : undefined}
            onScrollRight={hotSwapFrom && hotSwapSourceOrders.length > 0 ? () => scrollOrdersBy(280) : undefined}
            scrollAriaSubject="hot swap orders"
            viewAllTo={hotSwapFrom ? `/admin/cs/orders?csCloserId=${hotSwapFrom}&period=all_time` : undefined}
            viewAllLabel="View all closer's orders"
          />
          {hotSwapOrderIds.length > 0 && hotSwapTo && (
            <div className="flex items-center justify-end gap-3 mb-4">
              <Button variant="secondary" onClick={onClearSelection}>
                Clear Selection
              </Button>
              <Button
                variant="primary"
                onClick={onReassign}
                disabled={fetcherSubmitting}
                loading={fetcherSubmitting}
                loadingText="Reassigning..."
              >
                {`Reassign ${hotSwapOrderIds.length} Order${hotSwapOrderIds.length > 1 ? 's' : ''}`}
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <SearchableSelect
                id="hotswap-from"
                label="From closer"
                value={hotSwapFrom}
                onChange={onFromCloserChange}
                placeholder="Select source closer..."
                searchPlaceholder="Search closers..."
                options={workloads.map((w: AgentWorkload) => ({
                  value: w.agentId,
                  label: `${w.agentName} (${w.pendingCount} orders)`,
                }))}
              />
            </div>
            <div>
              <SearchableSelect
                id="hotswap-to"
                label="To closer"
                value={hotSwapTo}
                onChange={onToCloserChange}
                placeholder="Select target closer..."
                searchPlaceholder="Search closers..."
                options={workloads
                  .filter((w: AgentWorkload) => w.agentId !== hotSwapFrom)
                  .map((w: AgentWorkload) => ({
                    value: w.agentId,
                    label: `${w.agentName} (${w.pendingCount}/${w.capacity})`,
                  }))}
              />
            </div>
          </div>

          {hotSwapFrom && (
            <TableLoadingOverlay show={hotSwapListLoading}>
              {hotSwapSourceOrders.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-app-fg-muted">
                      {hotSwapOrderIds.length} of {hotSwapSourceOrders.length} selected
                    </p>
                    <button
                      type="button"
                      onClick={selectAllHotSwap}
                      className="text-xs text-brand-500 hover:text-brand-600 font-medium"
                    >
                      Select All
                    </button>
                  </div>
                  {hotSwapSourceTotal > hotSwapSourceOrders.length ? (
                    <p className="text-xs text-warning-600 dark:text-warning-400 mb-2">
                      Showing {hotSwapSourceOrders.length} of {hotSwapSourceTotal} — reassign in batches
                    </p>
                  ) : null}
                  <div
                    ref={ordersScrollRef}
                    className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
                  >
                    {hotSwapSourceOrders.map((order: CSOrder) => {
                      const isSelected = hotSwapOrderIds.includes(order.id);
                      return (
                        <div
                          key={order.id}
                          onClick={() => toggleHotSwapOrder(order.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleHotSwapOrder(order.id);
                            }
                          }}
                          role="checkbox"
                          aria-checked={isSelected}
                          tabIndex={0}
                          className={`group relative shrink-0 w-48 text-left rounded-xl border bg-app-elevated transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                            isSelected
                              ? 'border-brand-500 ring-1 ring-brand-500/40 shadow-md'
                              : 'border-warning-200 dark:border-warning-800/60 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                          }`}
                        >
                          <div
                            className="absolute top-1.5 left-1.5 z-10"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Checkbox checked={isSelected} onChange={() => toggleHotSwapOrder(order.id)} />
                          </div>
                          <span className="absolute top-2 right-2 flex h-2 w-2 pointer-events-none">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning-400 opacity-60" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-warning-500" />
                          </span>
                          <div className="px-2.5 py-2 pl-7 pr-5">
                            <div className="flex items-baseline justify-between gap-2 mb-1">
                              <p className="text-xs font-semibold text-app-fg truncate leading-tight min-w-0 flex-1">
                                {order.customerName}
                              </p>
                              {order.totalAmount ? (
                                <NairaPrice amount={order.totalAmount} className="text-mini font-bold text-app-fg shrink-0 tabular-nums" />
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1.5 mb-1 min-w-0">
                              <OrderStatusBadge status={order.status} />
                              <span className="text-micro font-medium text-app-fg-muted truncate">
                                {new Date(order.createdAt).toLocaleString('en-NG', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <OrderIdBadge
                              id={order.id}
                              length={8}
                              ellipsis=""
                              textClassName="text-micro text-app-fg-muted"
                              className="inline-flex"
                            />
                            <div className="mt-1.5">
                              <Link
                                to={`/admin/orders/${order.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-mini font-medium text-brand-600 dark:text-brand-400 hover:underline"
                              >
                                View
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : !hotSwapListLoading ? (
                <p className="text-sm text-app-fg-muted text-center py-4">
                  No open CS-queue orders for this closer (nothing in Unprocessed / Assigned / Engaged with them as
                  assignee). If you expected more, confirm branch context and that orders are still in the CS stage.
                </p>
              ) : (
                <div className="flex flex-nowrap gap-3 overflow-x-hidden pb-1" aria-busy="true">
                  {[1, 2, 3, 4].map((k) => (
                    <div
                      key={k}
                      className="shrink-0 w-48 rounded-xl border border-warning-200 dark:border-warning-800/60 bg-app-elevated p-2.5 space-y-2 animate-pulse"
                    >
                      <div className="flex items-center justify-between">
                        <div className="h-3 w-24 rounded bg-app-hover" />
                        <div className="h-3 w-12 rounded bg-app-hover" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-4 w-16 rounded-full bg-app-hover" />
                        <div className="h-3 w-14 rounded bg-app-hover" />
                      </div>
                      <div className="h-3 w-20 rounded bg-app-hover" />
                    </div>
                  ))}
                </div>
              )}
            </TableLoadingOverlay>
          )}
        </div>
      </div>
    </div>
  );
}
