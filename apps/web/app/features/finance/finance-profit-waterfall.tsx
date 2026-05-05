import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { NairaPrice } from '~/components/ui/naira-price';
import type { ProfitReport } from './types';

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

export function FinanceProfitWaterfall({ profit }: { profit: ProfitReport }) {
  const rev = profit.revenue;
  const denom = rev > 0 ? rev : 1;

  const deductions = [
    { key: 'landed', label: 'Landed COGS', amount: profit.landedCost, className: 'bg-rose-500/85 dark:bg-rose-600/90' },
    { key: 'delivery', label: 'Delivery fees', amount: profit.deliveryFee, className: 'bg-orange-500/85 dark:bg-orange-600/90' },
    { key: 'ad', label: 'Ad spend (approved)', amount: profit.adSpend, className: 'bg-amber-500/85 dark:bg-amber-600/90' },
    { key: 'comm', label: 'Commission', amount: profit.commission, className: 'bg-violet-500/85 dark:bg-violet-600/90' },
    { key: 'fulfill', label: '3PL / fulfillment', amount: profit.fulfillmentCost, className: 'bg-sky-500/85 dark:bg-sky-600/90' },
    { key: 'ops', label: 'Operational loss', amount: profit.operationalLoss, className: 'bg-slate-500/85 dark:bg-slate-600/90' },
  ];

  return (
    <Card>
      <CardHeader
        title="True profit bridge"
        description="Delivered orders in range — bar width is share of revenue. Same formula as True Profit KPI."
      />
      <CardBody className="-mt-2 space-y-4">
        <div>
          <div className="flex items-center justify-between text-xs text-app-fg-muted mb-1">
            <span>Revenue</span>
            <NairaPrice amount={Math.round(rev)} className="font-medium text-app-fg tabular-nums" />
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-app-border">
            <div
              className="h-full rounded-full bg-emerald-500/90 dark:bg-emerald-600/90"
              style={{ width: `${rev > 0 ? 100 : 0}%` }}
            />
          </div>
        </div>

        <div className="space-y-2.5">
          <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wide">Costs</p>
          {deductions.map((d) => (
            <div key={d.key}>
              <div className="flex items-center justify-between text-xs text-app-fg-muted mb-1">
                <span>{d.label}</span>
                <NairaPrice amount={Math.round(d.amount)} className="tabular-nums text-app-fg" />
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-app-border">
                <div className={`h-full rounded-full ${d.className}`} style={{ width: `${pct(d.amount, denom)}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-app-border pt-3">
          <div className="flex items-center justify-between text-sm font-semibold text-app-fg mb-1">
            <span>True profit</span>
            <NairaPrice
              amount={Math.round(profit.trueProfit)}
              className={
                profit.trueProfit >= 0
                  ? 'text-success-600 dark:text-success-400 tabular-nums'
                  : 'text-danger-600 dark:text-danger-400 tabular-nums'
              }
            />
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-app-border">
            <div
              className={`h-full rounded-full ${
                profit.trueProfit >= 0
                  ? 'bg-success-500/90 dark:bg-success-600/90'
                  : 'bg-danger-500/90 dark:bg-danger-600/90'
              }`}
              style={{ width: `${pct(Math.abs(profit.trueProfit), denom)}%` }}
            />
          </div>
          <p className="text-xs text-app-fg-muted mt-1.5">
            Net margin {profit.margin.toFixed(1)}% · {profit.orderCount} delivered order(s)
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
