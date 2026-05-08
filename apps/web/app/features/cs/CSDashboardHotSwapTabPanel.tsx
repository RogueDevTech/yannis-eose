import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { SearchableSelect } from '~/components/ui/searchable-select';
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
  return (
    <div className="h-[28rem] overflow-auto">
      <div className="space-y-4">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-app-fg">Hot Swap</h2>
            {hotSwapOrderIds.length > 0 && hotSwapTo && (
              <div className="flex items-center gap-3">
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
          </div>

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
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-app-fg-muted">
                      Select orders to reassign ({hotSwapOrderIds.length} selected)
                      {hotSwapSourceTotal > hotSwapSourceOrders.length ? (
                        <span className="block text-xs mt-0.5 text-warning-600 dark:text-warning-400">
                          Showing {hotSwapSourceOrders.length} of {hotSwapSourceTotal} — narrow by reassigning in batches
                          or use CS Orders with filters for the full list.
                        </span>
                      ) : null}
                    </p>
                    <button
                      type="button"
                      onClick={selectAllHotSwap}
                      className="text-sm text-brand-500 hover:text-brand-600 font-medium"
                    >
                      Select All ({hotSwapSourceOrders.length})
                    </button>
                  </div>

                  <p className="text-xs text-app-fg-muted mb-2">Click cards to select — same layout as Unassigned Queue</p>
                  <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
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
                          className={`group relative shrink-0 w-64 text-left rounded-xl border bg-app-elevated transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                            isSelected
                              ? 'border-brand-500 ring-1 ring-brand-500/40 shadow-md'
                              : 'border-warning-200 dark:border-warning-800/60 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                          }`}
                        >
                          <div
                            className="absolute top-3 left-3 z-10"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Checkbox checked={isSelected} onChange={() => toggleHotSwapOrder(order.id)} />
                          </div>
                          <span className="absolute top-3 right-3 flex h-2.5 w-2.5 pointer-events-none">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning-400 opacity-60" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning-500" />
                          </span>
                          <div className="p-3.5 pl-10 pr-8">
                            <div className="mb-2">
                              <OrderStatusBadge status={order.status} />
                            </div>
                            <p className="text-sm font-semibold text-app-fg truncate leading-tight mb-2 pr-1">
                              {order.customerName}
                            </p>
                            {order.totalAmount ? (
                              <div className="mb-2">
                                <NairaPrice amount={order.totalAmount} className="text-[11px] font-bold text-app-fg" />
                              </div>
                            ) : null}
                            <div className="text-[11px] font-medium text-app-fg-muted">
                              {new Date(order.createdAt).toLocaleString('en-NG', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                            <div className="mt-2 pt-2 border-t border-app-border/80">
                              <OrderIdBadge
                                id={order.id}
                                length={8}
                                ellipsis=""
                                textClassName="text-[10px] text-app-fg-muted"
                                className="inline-flex"
                              />
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
                <div className="min-h-[12rem]" aria-hidden />
              )}
            </TableLoadingOverlay>
          )}
        </div>
      </div>
    </div>
  );
}
