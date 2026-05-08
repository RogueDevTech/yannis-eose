import { Link } from '@remix-run/react';
import type { AgentWorkload, CSOrder } from './types';

export function CSDashboardCallbacksTabPanel({
  orders,
  workloads,
}: {
  orders: CSOrder[];
  workloads: AgentWorkload[];
}) {
  return (
    <div className="space-y-3">
      {orders.length === 0 ? (
        <div className="rounded-xl border border-app-border bg-app-elevated p-10 text-center text-app-fg-muted">
          No callbacks scheduled
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-xs text-app-fg-muted">
              Orders awaiting callback retry after &ldquo;No Answer&rdquo; — click View for details, Call Now to retry.
            </p>
          </div>
          <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
            {orders.map((order: CSOrder) => {
              const isDue = order.callbackScheduledAt && new Date(order.callbackScheduledAt) <= new Date();
              const agent = workloads.find((w: AgentWorkload) => w.agentId === order.assignedCsId);
              return (
                <div
                  key={order.id}
                  className={`group relative shrink-0 w-64 rounded-xl border bg-app-elevated transition-all duration-200 ${
                    isDue
                      ? 'border-danger-300 dark:border-danger-700 hover:shadow-md hover:border-danger-400 dark:hover:border-danger-600'
                      : 'border-warning-200 dark:border-warning-800/60 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                  }`}
                >
                  <span className="absolute top-3 right-3 flex h-2.5 w-2.5 pointer-events-none">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${
                        isDue ? 'bg-danger-400' : 'bg-warning-400'
                      }`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                        isDue ? 'bg-danger-500' : 'bg-warning-500'
                      }`}
                    />
                  </span>

                  <div className="p-3.5 pr-8">
                    <div className="mb-2 flex flex-wrap items-center gap-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                          isDue
                            ? 'bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400'
                            : 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400'
                        }`}
                      >
                        {isDue ? 'Due now' : `Attempt ${order.callbackAttempts ?? 0}/3`}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-app-fg truncate leading-tight mb-2 pr-1">
                      {order.customerName}
                    </p>
                    {order.totalAmount ? (
                      <div className="mb-2">
                        <span className="text-[11px] font-bold text-app-fg">
                          &#8358;{Number(order.totalAmount).toLocaleString('en-NG')}
                        </span>
                      </div>
                    ) : null}
                    {agent ? (
                      <p className="text-[11px] text-app-fg-muted truncate mb-1">Closer: {agent.agentName}</p>
                    ) : null}
                    {order.callbackScheduledAt ? (
                      <div className="text-[11px] font-medium text-app-fg-muted">
                        {new Date(order.callbackScheduledAt).toLocaleString('en-NG', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    ) : null}
                    {order.callbackNotes ? (
                      <p className="text-[11px] text-app-fg-muted mt-1 italic truncate">
                        Note: {order.callbackNotes}
                      </p>
                    ) : null}

                    <div className="mt-2 pt-2 border-t border-app-border/80 flex flex-wrap items-center gap-2.5">
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        View details
                      </Link>
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="text-xs font-medium text-success-600 dark:text-success-400 hover:underline"
                      >
                        Call now
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
