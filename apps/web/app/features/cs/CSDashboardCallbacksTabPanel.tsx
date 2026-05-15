import { useRef } from 'react';
import { Link } from '@remix-run/react';
import { StripToolbar } from '~/components/ui/strip-toolbar';
import type { AgentWorkload, CSOrder } from './types';

export function CSDashboardCallbacksTabPanel({
  orders,
  workloads,
}: {
  orders: CSOrder[];
  workloads: AgentWorkload[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollBy = (delta: number) =>
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });

  return (
    <div className="space-y-3">
      {orders.length === 0 ? (
        <div className="rounded-xl border border-app-border bg-app-elevated p-10 text-center text-app-fg-muted">
          No callbacks scheduled
        </div>
      ) : (
        <div>
          <StripToolbar
            title="Callbacks"
            description="Retry no-answer orders. Open details or call now."
            onScrollLeft={() => scrollBy(-280)}
            onScrollRight={() => scrollBy(280)}
            scrollAriaSubject="callbacks"
            viewAllTo="/admin/cs/orders?scheduleKind=callback_due&period=all_time"
          />
          <div
            ref={scrollRef}
            className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
          >
            {orders.map((order: CSOrder) => {
              const isDue = order.callbackScheduledAt && new Date(order.callbackScheduledAt) <= new Date();
              const agent = workloads.find((w: AgentWorkload) => w.agentId === order.assignedCsId);
              return (
                <div
                  key={order.id}
                  className={`group relative shrink-0 w-48 rounded-xl border bg-app-elevated transition-all duration-200 ${
                    isDue
                      ? 'border-danger-300 dark:border-danger-700 hover:shadow-md hover:border-danger-400 dark:hover:border-danger-600'
                      : 'border-warning-200 dark:border-warning-800/60 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                  }`}
                >
                  <span className="absolute top-2 right-2 flex h-2 w-2 pointer-events-none">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${
                        isDue ? 'bg-danger-400' : 'bg-warning-400'
                      }`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ${
                        isDue ? 'bg-danger-500' : 'bg-warning-500'
                      }`}
                    />
                  </span>

                  <div className="px-2.5 py-2 pr-5">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-app-fg truncate leading-tight min-w-0 flex-1">
                        {order.customerName}
                      </p>
                      {order.totalAmount ? (
                        <span className="text-[11px] font-bold text-app-fg shrink-0 tabular-nums">
                          &#8358;{Number(order.totalAmount).toLocaleString('en-NG')}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5 mb-1 min-w-0">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide shrink-0 ${
                          isDue
                            ? 'bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400'
                            : 'bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400'
                        }`}
                      >
                        {isDue ? 'Due' : `${order.callbackAttempts ?? 0}/3`}
                      </span>
                      {order.callbackScheduledAt ? (
                        <span className="text-[10px] font-medium text-app-fg-muted truncate">
                          {new Date(order.callbackScheduledAt).toLocaleString('en-NG', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      ) : null}
                    </div>
                    {agent ? (
                      <p className="text-[10px] text-app-fg-muted truncate mb-1">{agent.agentName}</p>
                    ) : null}
                    {order.callbackNotes ? (
                      <p className="text-[10px] text-app-fg-muted italic truncate mb-1.5" title={order.callbackNotes}>
                        {order.callbackNotes}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        View
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
