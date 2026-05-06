import { Link } from '@remix-run/react';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { NairaPrice } from '~/components/ui/naira-price';
import type { ProductProfitBreakdownRow, ProfitReport } from './types';

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

export function FinanceProfitWaterfall({ profit }: { profit: ProfitReport }) {
  const rev = profit.revenue;
  const denom = rev > 0 ? rev : 1;

  const deductions = [
    {
      key: 'landed',
      label: 'Landed COGS',
      amount: profit.landedCost,
      className: 'bg-rose-500/55 dark:bg-rose-600/65',
    },
    {
      key: 'delivery',
      label: 'Delivery fees',
      amount: profit.deliveryFee,
      className: 'bg-orange-500/55 dark:bg-orange-600/65',
    },
    {
      key: 'ad',
      label: 'Ad spend (approved)',
      amount: profit.adSpend,
      className: 'bg-amber-500/55 dark:bg-amber-600/65',
    },
    { key: 'comm', label: 'Commission', amount: profit.commission, className: 'bg-violet-500/55 dark:bg-violet-600/65' },
    {
      key: 'fulfill',
      label: '3PL / fulfillment',
      amount: profit.fulfillmentCost,
      className: 'bg-sky-500/55 dark:bg-sky-600/65',
    },
    {
      key: 'ops',
      label: 'Operational loss',
      amount: profit.operationalLoss,
      className: 'bg-slate-500/55 dark:bg-slate-600/65',
    },
  ];

  const topProducts = (profit.byProduct ?? []).slice(0, 9);

  function productTitle(r: ProductProfitBreakdownRow) {
    return `${r.productName} · ${r.orderCount} order(s) · Margin ${r.marginPct.toFixed(1)}%`;
  }

  return (
    <Card>
      <CardHeader
        title="True profit bridge"
        description="Delivered orders in range — bar width is share of revenue. Same formula as True Profit KPI."
      />
      <CardBody className="-mt-2 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-app-border bg-app-hover/60 p-3">
            <div className="flex items-center justify-between text-xs text-app-fg-muted">
              <span>Revenue</span>
              <NairaPrice amount={Math.round(rev)} className="font-semibold text-app-fg tabular-nums" />
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-app-border">
              <div
                className="h-full rounded-full bg-emerald-500/70 dark:bg-emerald-600/75"
                style={{ width: `${rev > 0 ? 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg border border-app-border bg-app-hover/60 p-3 lg:col-span-2">
            <div className="flex items-center justify-between text-xs text-app-fg-muted">
              <span className="font-medium uppercase tracking-wide">True profit</span>
              <NairaPrice
                amount={Math.round(profit.trueProfit)}
                className={
                  profit.trueProfit >= 0
                    ? 'font-semibold text-success-600 dark:text-success-400 tabular-nums'
                    : 'font-semibold text-danger-600 dark:text-danger-400 tabular-nums'
                }
              />
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-app-border">
              <div
                className={`h-full rounded-full ${
                  profit.trueProfit >= 0
                    ? 'bg-success-500/70 dark:bg-success-600/75'
                    : 'bg-danger-500/70 dark:bg-danger-600/75'
                }`}
                style={{ width: `${pct(Math.abs(profit.trueProfit), denom)}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-app-fg-muted">
              Net margin {profit.margin.toFixed(1)}% · {profit.orderCount} delivered order(s)
            </p>
          </div>
        </div>

        <div className="border-t border-app-border pt-3">
          <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wide">Costs</p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {deductions.map((d) => (
              <div key={d.key} className="rounded-lg border border-app-border bg-app-hover/60 p-3">
                <div className="flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                  <span className="min-w-0 truncate" title={d.label}>
                    {d.label}
                  </span>
                  <NairaPrice amount={Math.round(d.amount)} className="shrink-0 font-semibold tabular-nums text-app-fg" />
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-app-border">
                  <div className={`h-full rounded-full ${d.className}`} style={{ width: `${pct(d.amount, denom)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {topProducts.length > 0 ? (
          <div className="border-t border-app-border pt-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-app-fg uppercase tracking-wide">Product contribution</p>
                <p className="text-xs text-app-fg-muted mt-0.5">
                  Top products by contribution (delivered orders). Shared costs allocated by revenue share.
                </p>
              </div>
              <Link to="/admin/products" className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline">
                Products
              </Link>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topProducts.map((r) => (
                <Link
                  key={r.productId}
                  to={`/admin/products/${r.productId}`}
                  title={productTitle(r)}
                  className="group relative bg-app-elevated rounded-xl border border-app-border p-4 shadow-sm hover:shadow-md hover:border-app-border transition-all duration-200 min-w-0"
                >
                  <p className="text-xs font-medium text-app-fg line-clamp-2">{r.productName}</p>

                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <p className="text-xs text-app-fg-muted">Contribution</p>
                    <NairaPrice
                      amount={Math.round(r.contribution)}
                      className={`text-sm font-semibold tabular-nums ${
                        r.contribution >= 0
                          ? 'text-success-600 dark:text-success-400'
                          : 'text-danger-600 dark:text-danger-400'
                      }`}
                    />
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-app-fg-muted">
                    <span className="tabular-nums">{r.orderCount} order(s)</span>
                    <span className="tabular-nums">{r.marginPct.toFixed(1)}% margin</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
