import { Link } from '@remix-run/react';
import { formatNaira } from '~/lib/format-amount';
import type { FundingBalanceRow } from './types';
import {
  confirmationRateColorClass,
  deliveryRateColorClass,
} from '~/lib/rate-color';

export interface MediaBuyerBalanceCardProps {
  row: FundingBalanceRow;
  className?: string;
  compact?: boolean;
  /**
   * Optional date filter forwarded to the "View orders" deep link so the orders page
   * loads with the same range the user picked on the parent page.
   */
  ordersDateFilters?: { startDate: string; endDate: string; periodAllTime: boolean };
  /** Org-wide green/red threshold for the Profitability score color. Default 2.5x. */
  profitabilityGreenThreshold?: number;
}

function buildOrdersHref(
  userId: string,
  filters?: { startDate: string; endDate: string; periodAllTime: boolean },
): string {
  const params = new URLSearchParams();
  params.set('mediaBuyerId', userId);
  if (filters) {
    if (filters.periodAllTime) {
      params.set('period', 'all_time');
    } else {
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
    }
  }
  return `/admin/marketing/orders?${params.toString()}`;
}

/**
 * Card used on Live Activities (Marketing) and Team page to represent a media buyer
 * with funding balance. Matches the card style used in the media buyer strip.
 */
export function MediaBuyerBalanceCard({
  row,
  className = '',
  compact = false,
  ordersDateFilters,
  profitabilityGreenThreshold = 2.5,
}: MediaBuyerBalanceCardProps) {
  const profitabilityColorClass =
    row.profitabilityScore != null && row.trueRoas != null
      ? row.trueRoas >= profitabilityGreenThreshold
        ? 'text-success-600 dark:text-success-400 font-semibold'
        : 'text-danger-600 dark:text-danger-400 font-semibold'
      : 'text-app-fg';
  const ordersHref = buildOrdersHref(row.userId, ordersDateFilters);
  const initials = row.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (compact) {
    return (
      <div
        className={`rounded-xl border border-app-border bg-app-elevated transition-all duration-200 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 ${className}`}
      >
        <div className="px-2.5 py-2">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
              <span className="text-mini font-bold text-brand-600 dark:text-brand-400">{initials}</span>
            </div>
            <div className="min-w-0 flex-1">
              <Link
                to={`/hr/users/${row.userId}`}
                prefetch="intent"
                className="text-xs font-semibold text-app-fg truncate block hover:text-brand-600 dark:hover:text-brand-400"
              >
                {row.name}
              </Link>
              <p className="text-micro text-app-fg-muted truncate">Media Buyer</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-micro leading-4">
            <div className="min-w-0">
              <div className="text-app-fg-muted">Balance</div>
              <div className="font-semibold text-brand-600 dark:text-brand-400 truncate">
                {formatNaira(Number(row.balance))}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-app-fg-muted">Orders</div>
              {row.totalOrders != null ? (
                <Link
                  to={ordersHref}
                  prefetch="intent"
                  className="font-semibold tabular-nums text-app-fg hover:text-brand-600 dark:hover:text-brand-400"
                >
                  {row.totalOrders.toLocaleString()}
                </Link>
              ) : (
                <div className="font-semibold tabular-nums text-app-fg">—</div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-app-fg-muted">{row.confirmationRate != null ? 'Confirm' : 'Received'}</div>
              <div
                className={
                  row.confirmationRate != null
                    ? `font-medium tabular-nums ${confirmationRateColorClass(row.confirmationRate)}`
                    : 'font-medium text-app-fg truncate'
                }
              >
                {row.confirmationRate != null ? `${Math.round(row.confirmationRate)}%` : formatNaira(Number(row.totalReceived))}
              </div>
            </div>
            <div className="min-w-0 text-right">
              <div className="text-app-fg-muted">{row.deliveryRate != null ? 'Delivery' : 'Spent'}</div>
              <div
                className={
                  row.deliveryRate != null
                    ? `font-medium tabular-nums ${deliveryRateColorClass(row.deliveryRate)}`
                    : 'font-medium text-app-fg truncate'
                }
              >
                {row.deliveryRate != null ? `${Math.round(row.deliveryRate)}%` : formatNaira(Number(row.totalSpend))}
              </div>
            </div>
          </div>

          <div className="mt-2.5 border-t border-app-border pt-2.5">
            <div className="flex items-center justify-start gap-2">
              <Link
                to={ordersHref}
                prefetch="intent"
                className="btn-primary btn-sm inline-flex flex-1 items-center justify-center"
              >
                View orders
              </Link>
              <Link
                to={`/hr/users/${row.userId}`}
                prefetch="intent"
                className="btn-secondary btn-sm inline-flex flex-1 items-center justify-center"
              >
                View profile
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`card ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to={`/hr/users/${row.userId}`}
            prefetch="intent"
            className="text-sm font-medium text-app-fg truncate block hover:text-brand-600 dark:hover:text-brand-400"
          >
            {row.name}
          </Link>
          <p className="text-xs text-app-fg-muted">Media Buyer</p>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-app-fg-muted">Balance</span>
          <span className="font-medium text-brand-600 dark:text-brand-400">
            {formatNaira(Number(row.balance))}
          </span>
        </div>
        <div className="flex justify-between text-app-fg-muted">
          <span>Received</span>
          <span>{formatNaira(Number(row.totalReceived))}</span>
        </div>
        <div className="flex justify-between text-app-fg-muted">
          <span>Spent</span>
          <span>{formatNaira(Number(row.totalSpend))}</span>
        </div>
        <div className="flex justify-between text-app-fg-muted">
          <span>Orders</span>
          {row.totalOrders != null ? (
            <Link
              to={buildOrdersHref(row.userId, ordersDateFilters)}
              prefetch="intent"
              className="font-medium tabular-nums text-app-fg hover:text-brand-600 dark:hover:text-brand-400"
            >
              {row.totalOrders.toLocaleString()}
            </Link>
          ) : (
            <span className="tabular-nums">{'\u2014'}</span>
          )}
        </div>
        {row.confirmationRate != null && (
          <div className="flex justify-between text-app-fg-muted">
            <span>Confirmation rate</span>
            <span className={`font-medium tabular-nums ${confirmationRateColorClass(row.confirmationRate)}`}>
              {Math.round(row.confirmationRate)}%
            </span>
          </div>
        )}
        {row.deliveryRate != null && (
          <div className="flex justify-between text-app-fg-muted">
            <span>Delivery rate</span>
            <span className={`font-medium tabular-nums ${deliveryRateColorClass(row.deliveryRate)}`}>
              {Math.round(row.deliveryRate)}%
            </span>
          </div>
        )}
        {row.cpa != null && (
          <div className="flex justify-between text-app-fg-muted">
            <span>CPA</span>
            <span className="font-medium text-app-fg">{formatNaira(row.cpa)}</span>
          </div>
        )}
        {row.profitabilityScore != null && (
          <div className="flex justify-between text-app-fg-muted">
            <span>Profitability</span>
            <span className={`tabular-nums ${profitabilityColorClass}`}>{row.profitabilityScore.toFixed(1)}</span>
          </div>
        )}
      </div>
      <div className="mt-3 border-t border-app-border pt-3">
        <div className="flex items-center justify-start gap-2">
          <Link
            to={ordersHref}
            prefetch="intent"
            className="btn-primary btn-sm inline-flex flex-1 items-center justify-center"
          >
            View orders
          </Link>
          <Link
            to={`/hr/users/${row.userId}`}
            prefetch="intent"
            className="btn-secondary btn-sm inline-flex flex-1 items-center justify-center"
          >
            View profile
          </Link>
        </div>
      </div>
    </div>
  );
}
