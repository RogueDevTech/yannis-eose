import { useMemo } from 'react';
import { useSearchParams, Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { FormField } from '~/components/ui/form-field';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';
import { EmptyState } from '~/components/ui/empty-state';
import { InlineNotification } from '~/components/ui/inline-notification';
import { formatOrderTimestamp } from '~/lib/format-date';

export interface ShipmentOption {
  id: string;
  referenceNumber: string;
  label: string | null;
  status: string;
  arrivedAt: string | null;
  createdAt: string;
}

export interface ProfitByShipmentLine {
  lineId: string;
  productId: string | null;
  productName: string | null;
  expectedQuantity: number;
  receivedQuantity: number;
  factoryCost: number;
  allocatedLandingCost: number;
  totalCostIn: number;
  unitsSold: number;
  unitsRemaining: number;
  avgUnitPrice: number;
  estimatedRevenue: number;
  estimatedProfit: number;
}

export interface ProfitByShipmentPayload {
  shipment: {
    id: string;
    referenceNumber: string;
    label: string | null;
    status: string;
    supplierName: string | null;
    supplierReference: string | null;
    totalLandingCost: number;
    arrivedAt: string | null;
    verifiedAt: string | null;
    createdAt: string;
  };
  lines: ProfitByShipmentLine[];
  totals: {
    receivedQuantity: number;
    factoryCostTotal: number;
    landingCostTotal: number;
    totalCostIn: number;
    unitsSold: number;
    unitsRemaining: number;
    estimatedRevenue: number;
    estimatedProfit: number;
  };
  revenueIsEstimated: boolean;
}

interface Props {
  shipments: ShipmentOption[];
  shipmentId: string;
  profit: ProfitByShipmentPayload | null;
}

export function ProfitByShipmentPage({ shipments, shipmentId, profit }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const shipmentOptions = useMemo(
    () =>
      [{ value: '', label: 'Pick a shipment…' }].concat(
        shipments.map((s) => ({
          value: s.id,
          label: `${s.referenceNumber}${s.label ? ` · ${s.label}` : ''} · ${s.status}`,
        })),
      ),
    [shipments],
  );

  const setShipment = (id: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set('shipmentId', id);
        else next.delete('shipmentId');
        return next;
      },
      { preventScrollReset: true },
    );
  };

  const lineColumns: CompactTableColumn<ProfitByShipmentLine>[] = useMemo(
    () => [
      {
        key: 'product',
        header: 'Product',
        render: (l) =>
          l.productId ? (
            <Link to={`/admin/products/${l.productId}`} className="text-brand-500 hover:text-brand-600">
              {l.productName ?? '—'}
            </Link>
          ) : (
            <span className="text-app-fg-muted">{l.productName ?? '—'}</span>
          ),
      },
      {
        key: 'qty',
        header: 'Received',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span className="tabular-nums text-app-fg-muted">
            {l.receivedQuantity}
            <span className="text-[10px] ml-1 text-app-fg-muted/70">/ {l.expectedQuantity} exp</span>
          </span>
        ),
      },
      {
        key: 'factory',
        header: 'Factory',
        align: 'right',
        nowrap: true,
        render: (l) => <NairaPrice amount={Math.round(l.factoryCost)} />,
      },
      {
        key: 'landing',
        header: 'Landing',
        align: 'right',
        nowrap: true,
        render: (l) => <NairaPrice amount={Math.round(l.allocatedLandingCost)} />,
      },
      {
        key: 'totalIn',
        header: 'Cost in',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span className="font-medium tabular-nums">
            <NairaPrice amount={Math.round(l.totalCostIn)} />
          </span>
        ),
      },
      {
        key: 'sold',
        header: 'Sold',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span className="tabular-nums text-app-fg-muted">
            {l.unitsSold}
            <span className="text-[10px] ml-1 text-app-fg-muted/70">{l.unitsRemaining} left</span>
          </span>
        ),
      },
      {
        key: 'avgPrice',
        header: 'Avg price',
        align: 'right',
        nowrap: true,
        render: (l) =>
          l.avgUnitPrice > 0 ? (
            <NairaPrice amount={Math.round(l.avgUnitPrice)} />
          ) : (
            <span className="text-app-fg-muted">—</span>
          ),
      },
      {
        key: 'revenue',
        header: 'Est. revenue',
        align: 'right',
        nowrap: true,
        render: (l) => <NairaPrice amount={Math.round(l.estimatedRevenue)} />,
      },
      {
        key: 'profit',
        header: 'Est. profit',
        align: 'right',
        nowrap: true,
        render: (l) => (
          <span
            className={
              l.estimatedProfit >= 0
                ? 'text-success-600 dark:text-success-400 font-medium tabular-nums'
                : 'text-danger-600 dark:text-danger-400 font-medium tabular-nums'
            }
          >
            <NairaPrice amount={Math.round(l.estimatedProfit)} />
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profit by shipment"
        description="Pick an inbound shipment to see what it cost to bring in vs what we've earned selling it. Cost layers are exact (factory + landing); revenue is an estimate based on the average delivered price for each product."
        actions={<PageRefreshButton />}
      />

      <div className="card !p-3">
        <FormField label="Shipment" htmlFor="profit-shipment-picker" required>
          <SearchableSelect
            id="profit-shipment-picker"
            value={shipmentId}
            onChange={setShipment}
            options={shipmentOptions}
            placeholder="Pick a shipment…"
            searchPlaceholder="Search by reference number or label…"
          />
        </FormField>
      </div>

      {!shipmentId ? (
        <EmptyState
          title="Pick a shipment to see the P&L"
          description="Cost in (factory × received qty + allocated landing cost) is exact. Revenue is approximated from average delivered price × units sold from the shipment's batch — best read as a planning number."
        />
      ) : !profit ? (
        <EmptyState
          title="Could not load this shipment"
          description="Check that the shipment exists and you have finance read access."
        />
      ) : (
        <div className="space-y-4">
          {/* Shipment header */}
          <div className="card !p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-app-fg">
                {profit.shipment.referenceNumber}
                {profit.shipment.label ? (
                  <span className="text-app-fg-muted font-normal ml-2">· {profit.shipment.label}</span>
                ) : null}
              </p>
              <p className="text-xs text-app-fg-muted mt-0.5">
                {profit.shipment.supplierName ?? 'No supplier on file'}
                {profit.shipment.supplierReference ? ` · ${profit.shipment.supplierReference}` : ''}
                {profit.shipment.arrivedAt
                  ? ` · arrived ${formatOrderTimestamp(profit.shipment.arrivedAt)}`
                  : ` · created ${formatOrderTimestamp(profit.shipment.createdAt)}`}
              </p>
            </div>
            <StatusBadge status={profit.shipment.status} />
          </div>

          {profit.revenueIsEstimated && (
            <InlineNotification
              variant="info"
              message="Revenue and profit on this page are estimates: average delivered price × units sold from this shipment's batches. Costs (factory + landing) are exact."
            />
          )}

          <OverviewStatStrip
            items={[
              {
                label: 'Cost in (total)',
                value: <NairaPrice amount={Math.round(profit.totals.totalCostIn)} />,
                valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums',
                title: `${profit.totals.factoryCostTotal.toLocaleString()} factory + ${profit.totals.landingCostTotal.toLocaleString()} landing`,
              },
              {
                label: 'Units received',
                value: profit.totals.receivedQuantity.toLocaleString(),
                valueClassName: 'text-app-fg tabular-nums',
              },
              {
                label: 'Units sold',
                value: profit.totals.unitsSold.toLocaleString(),
                valueClassName: 'text-success-600 dark:text-success-400 tabular-nums',
                title: `${profit.totals.unitsRemaining.toLocaleString()} still on hand`,
              },
              {
                label: 'Est. revenue',
                value: <NairaPrice amount={Math.round(profit.totals.estimatedRevenue)} />,
                valueClassName: 'text-app-fg tabular-nums',
              },
              {
                label: 'Est. profit',
                value: <NairaPrice amount={Math.round(profit.totals.estimatedProfit)} />,
                valueClassName:
                  profit.totals.estimatedProfit >= 0
                    ? 'text-success-600 dark:text-success-400 tabular-nums'
                    : 'text-danger-600 dark:text-danger-400 tabular-nums',
              },
            ]}
          />

          <CompactTable<ProfitByShipmentLine>
            columns={lineColumns}
            rows={profit.lines}
            rowKey={(l) => l.lineId}
            caption="Per-line unit economics"
            emptyTitle="No lines on this shipment"
            emptyDescription="The shipment has no SKU lines yet."
          />
        </div>
      )}
    </div>
  );
}
