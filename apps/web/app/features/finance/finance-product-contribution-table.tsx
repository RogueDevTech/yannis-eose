import { useMemo } from 'react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { NairaPrice } from '~/components/ui/naira-price';
import type { ProductProfitBreakdownRow } from './types';

export function FinanceProductContributionTable({ rows }: { rows: ProductProfitBreakdownRow[] }) {
  const display = useMemo(() => rows.slice(0, 25), [rows]);

  const columns: CompactTableColumn<ProductProfitBreakdownRow>[] = useMemo(
    () => [
      {
        key: 'product',
        header: 'Product',
        render: (r) => (
          <span className="text-sm text-app-fg line-clamp-2 max-w-[14rem]" title={r.productName}>
            {r.productName}
          </span>
        ),
      },
      {
        key: 'orders',
        header: 'Orders',
        align: 'right',
        tight: true,
        render: (r) => <span className="tabular-nums text-sm">{r.orderCount}</span>,
      },
      {
        key: 'revenue',
        header: 'Revenue',
        align: 'right',
        nowrap: true,
        render: (r) => <NairaPrice amount={Math.round(r.revenue)} className="text-sm tabular-nums" />,
      },
      {
        key: 'direct',
        header: 'Direct costs',
        align: 'right',
        nowrap: true,
        render: (r) => (
          <NairaPrice
            amount={Math.round(r.landedCost + r.deliveryFee + r.adSpend)}
            className="text-sm tabular-nums text-app-fg-muted"
          />
        ),
      },
      {
        key: 'allocated',
        header: 'Allocated shared',
        align: 'right',
        nowrap: true,
        render: (r) => (
          <NairaPrice
            amount={Math.round(
              r.allocatedCommission + r.allocatedFulfillment + r.allocatedOperationalLoss,
            )}
            className="text-sm tabular-nums text-app-fg-muted"
          />
        ),
      },
      {
        key: 'contribution',
        header: 'Contribution',
        align: 'right',
        nowrap: true,
        render: (r) => (
          <NairaPrice
            amount={Math.round(r.contribution)}
            className={`text-sm font-medium tabular-nums ${
              r.contribution >= 0
                ? 'text-success-600 dark:text-success-400'
                : 'text-danger-600 dark:text-danger-400'
            }`}
          />
        ),
      },
      {
        key: 'margin',
        header: 'Margin',
        align: 'right',
        tight: true,
        render: (r) => (
          <span
            className={`text-sm tabular-nums ${
              r.marginPct >= 15
                ? 'text-success-600 dark:text-success-400'
                : r.marginPct >= 0
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-danger-600 dark:text-danger-400'
            }`}
          >
            {r.marginPct.toFixed(1)}%
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        render: (r) => (
          <CompactTableActionButton to={`/admin/products/${r.productId}`}>
            View
          </CompactTableActionButton>
        ),
      },
    ],
    [],
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="list-panel">
      <div className="px-4 py-3 border-b border-app-border">
        <h2 className="text-sm font-semibold text-app-fg">Product contribution</h2>
        <p className="text-xs text-app-fg-muted mt-0.5">
          Line revenue on delivered orders; commission, fulfillment, and operational loss allocated by share of
          revenue. Ad spend is actual per product (approved) in range.
        </p>
      </div>
      <CompactTable<ProductProfitBreakdownRow>
        withCard={false}
        columns={columns}
        rows={display}
        rowKey={(r) => r.productId}
        emptyTitle="No product lines"
        emptyDescription="No delivered order line items in this date range."
      />
      {rows.length > 25 ? (
        <p className="px-4 py-2 text-xs text-app-fg-muted border-t border-app-border">
          Showing top 25 of {rows.length} products by contribution.
        </p>
      ) : null}
    </div>
  );
}
