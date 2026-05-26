import { Link } from '@remix-run/react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { formatNaira } from '~/lib/format-amount';
import { formatOrderTimestampShort } from '~/lib/format-date';
import { StatCard } from '~/components/ui/card';
import type { TplDashboardData } from './types';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

interface TplDashboardPageProps {
  data: TplDashboardData;
  userName: string;
}

export function TplDashboardPage({ data, userName }: TplDashboardPageProps) {
  const firstName = userName?.split(' ')[0] ?? 'User';
  const counts = data.orderCounts;
  const allocated = counts['AGENT_ASSIGNED'] ?? 0;
  const dispatched = counts['DISPATCHED'] ?? 0;
  const inTransit = counts['IN_TRANSIT'] ?? 0;
  const delivered = (counts['DELIVERED'] ?? 0) + (counts['REMITTED'] ?? 0);
  const returned = counts['RETURNED'] ?? 0;
  const cancelled = counts['CANCELLED'] ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        mobileInlineActions
        description="Your location's stock and deliveries."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Dashboard tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="TPL dashboard date range"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={data.filters.startDate}
                    endDate={data.filters.endDate}
                    periodAllTime={data.filters.periodAllTime} chrome="pill" />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={data.filters.startDate}
        endDate={data.filters.endDate}
        periodAllTime={data.filters.periodAllTime}
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Agent assigned"
          value={allocated.toString()}
          icon={<TplStatIcon type="allocated" />}
          accent={allocated > 10 ? 'warning' : 'brand'}
        />
        <StatCard
          label="In Transit"
          value={inTransit.toString()}
          icon={<TplStatIcon type="transit" />}
          accent="brand"
        />
        <StatCard
          label="Delivered"
          value={delivered.toString()}
          icon={<TplStatIcon type="delivered" />}
          accent="success"
        />
        <StatCard
          label="Returns Queue"
          value={data.returnsQueue.toString()}
          icon={<TplStatIcon type="returns" />}
          accent={data.returnsQueue > 0 ? 'danger' : 'brand'}
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          label="Dispatched"
          value={dispatched.toString()}
          icon={<TplStatIcon type="dispatched" />}
          accent="brand"
        />
        <StatCard
          label="Stock Transfers"
          value={data.inTransitTransfers.toString()}
          icon={<TplStatIcon type="transfers" />}
          accent={data.inTransitTransfers > 0 ? 'warning' : 'brand'}
        />
        <StatCard
          label="Total Orders"
          value={data.totalOrders.toString()}
          icon={<TplStatIcon type="orders" />}
          accent="brand"
        />
      </div>

      {/* Alerts */}
      {data.returnsQueue > 0 && (
        <div className="card border-danger-200 dark:border-danger-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-danger-50 dark:bg-danger-700/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-app-fg">
                  {data.returnsQueue} {data.returnsQueue === 1 ? 'return' : 'returns'} pending processing
                </h3>
                <p className="text-sm text-app-fg-muted">
                  Returned orders need to be marked as Sellable or Damaged.
                </p>
              </div>
            </div>
            <Link to="/tpl/inventory" prefetch="intent" className="btn-primary btn-sm shrink-0">
              Process
            </Link>
          </div>
        </div>
      )}

      {data.inTransitTransfers > 0 && (
        <div className="card border-warning-200 dark:border-warning-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-warning-50 dark:bg-warning-700/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-warning-600 dark:text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-app-fg">
                  {data.inTransitTransfers} {data.inTransitTransfers === 1 ? 'transfer' : 'transfers'} in transit
                </h3>
                <p className="text-sm text-app-fg-muted">
                  Incoming stock transfers awaiting verification.
                </p>
              </div>
            </div>
            <Link to="/tpl/inventory" prefetch="intent" className="btn-primary btn-sm shrink-0">
              Verify
            </Link>
          </div>
        </div>
      )}

      {/* Delivery Pipeline + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pipeline */}
        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold text-app-fg mb-4">Delivery Pipeline</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Agent assigned', value: allocated, color: 'text-brand-600 dark:text-brand-400' },
              { label: 'Dispatched', value: dispatched, color: 'text-brand-600 dark:text-brand-400' },
              { label: 'In Transit', value: inTransit, color: 'text-warning-600 dark:text-warning-400' },
              { label: 'Delivered', value: delivered, color: 'text-success-600 dark:text-success-400' },
              { label: 'Returned', value: returned, color: 'text-danger-600 dark:text-danger-400' },
              { label: 'Cancelled', value: cancelled, color: 'text-app-fg-muted' },
            ].map((item) => (
              <div key={item.label} className="text-center p-3 rounded-lg bg-app-hover">
                <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
                <p className="text-sm text-app-fg-muted mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h2 className="text-lg font-semibold text-app-fg mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {[
              { href: '/tpl/orders', label: 'Manage Orders', description: `${data.totalOrders} total orders`, icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z', bg: 'bg-brand-50 dark:bg-brand-700/20 text-brand-600 dark:text-brand-400' },
              { href: '/tpl/inventory', label: 'Inventory', description: 'Stock, transfers & returns', icon: 'M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9', bg: 'bg-info-50 dark:bg-info-700/20 text-info-600 dark:text-info-400' },
              { href: '/tpl/remit', label: 'Remittance', description: 'Payment records', icon: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z', bg: 'bg-success-50 dark:bg-success-700/20 text-success-600 dark:text-success-400' },
              { href: '/tpl/settings', label: 'Settings', description: 'Account preferences', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z', bg: 'bg-app-hover text-app-fg-muted' },
            ].map((action) => (
              <Link
                key={action.href}
                to={action.href}
                prefetch="intent"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-app-hover/50 transition-colors"
              >
                <div className={`w-9 h-9 rounded-lg ${action.bg} flex items-center justify-center shrink-0`}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={action.icon} />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-app-fg">{action.label}</p>
                  <p className="text-sm text-app-fg-muted">{action.description}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-app-fg">Recent Orders</h2>
          <Link to="/tpl/orders" prefetch="intent" className="text-sm text-brand-500 hover:text-brand-600 font-medium">
            View All
          </Link>
        </div>
        {data.recentOrders.length > 0 ? (
          <div className="space-y-2">
            {data.recentOrders.map((order) => (
              <Link
                key={order.id}
                to={`/tpl/orders/${order.id}`}
                prefetch="intent"
                className="flex items-center justify-between p-3 rounded-lg hover:bg-app-hover/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-app-fg truncate">{order.customerName}</p>
                  <div className="flex items-center gap-2 text-sm text-app-fg-muted">
                    <span>
                      {formatOrderTimestampShort(order.createdAt)}
                    </span>
                    {order.preferredDeliveryDate && (
                      <>
                        <span className="text-app-border">|</span>
                        <span className="text-xs">
                          Deliver by {new Date(order.preferredDeliveryDate).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-3">
                  {order.totalAmount && (
                    <span className="text-sm font-medium text-app-fg hidden sm:inline">
                      {formatNaira(Number(order.totalAmount))}
                    </span>
                  )}
                  <OrderStatusBadge status={order.status} expanded />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-app-fg-muted text-sm">
            No orders yet
          </div>
        )}
      </div>
    </div>
  );
}

/* ── TPL dashboard stat icons (paired with shared StatCard) ───────────────── */

const TPL_STAT_PATHS: Record<string, string> = {
  allocated: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z',
  dispatched: 'M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5',
  transit: 'M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12',
  delivered: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  returns: 'M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3',
  transfers: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  orders: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z',
};

function TplStatIcon({ type }: { type: string }) {
  const d = TPL_STAT_PATHS[type] ?? TPL_STAT_PATHS.orders;
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}
