import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { Button } from '~/components/ui/button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { StatusBadge } from '~/components/ui/status-badge';

export interface BudgetVsActualRow {
  budgetId: string;
  budgetName: string;
  department: string;
  budgetAmount: number;
  actualSpend: number;
  variance: number;
  variancePct: number;
  status: 'under' | 'warning' | 'over';
}

export interface BudgetVsActualPageProps {
  rows: BudgetVsActualRow[];
  filters: { startDate: string; endDate: string };
}

const STATUS_MAP: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  under: { label: 'Under Budget', variant: 'success' },
  warning: { label: 'Warning', variant: 'warning' },
  over: { label: 'Over Budget', variant: 'danger' },
};

export function BudgetVsActualPage({ rows, filters }: BudgetVsActualPageProps) {
  const totalBudget = rows.reduce((s, r) => s + r.budgetAmount, 0);
  const totalActual = rows.reduce((s, r) => s + r.actualSpend, 0);
  const totalVariance = totalBudget - totalActual;

  const handleExport = () => {
    const header = 'Department,Budget Name,Budget (NGN),Actual (NGN),Variance (NGN),% Used,Status';
    const csv = rows.map((r) =>
      [r.department, r.budgetName, r.budgetAmount, r.actualSpend, r.variance, r.variancePct, r.status].join(','),
    );
    const blob = new Blob([header + '\n' + csv.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-vs-actual-${filters.startDate || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportButton =
    rows.length > 0 ? (
      <Button variant="primary" size="sm" onClick={handleExport}>
        Export CSV
      </Button>
    ) : null;

  const columns: CompactTableColumn<BudgetVsActualRow>[] = [
    {
      key: 'department',
      header: 'Department',
      render: (r) => (
        <div>
          <span className="font-medium text-app-fg">{r.budgetName}</span>
          <span className="ml-2 text-xs text-app-fg-muted">{r.department}</span>
        </div>
      ),
    },
    {
      key: 'budgetAmount',
      header: 'Budget',
      align: 'right',
      render: (r) => <NairaPrice amount={r.budgetAmount} className="tabular-nums" />,
    },
    {
      key: 'actualSpend',
      header: 'Actual',
      align: 'right',
      render: (r) => <NairaPrice amount={r.actualSpend} className="tabular-nums" />,
    },
    {
      key: 'variance',
      header: 'Variance',
      align: 'right',
      render: (r) => (
        <span className={r.variance < 0 ? 'text-danger-600' : 'text-success-600'}>
          <NairaPrice amount={r.variance} className="tabular-nums" />
        </span>
      ),
    },
    {
      key: 'variancePct',
      header: '% Used',
      align: 'right',
      render: (r) => (
        <span
          className={[
            'tabular-nums font-medium',
            r.status === 'over'
              ? 'text-danger-600'
              : r.status === 'warning'
                ? 'text-amber-600'
                : 'text-success-600',
          ].join(' ')}
        >
          {r.variancePct.toFixed(1)}%
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        const s = STATUS_MAP[r.status] ?? STATUS_MAP.under!;
        return <StatusBadge status={s.label} variant={s.variant} />;
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Budget vs Actual"
        description="Compare departmental budgets against GL expense postings."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Budget vs actual toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  chrome="pill"
                />
                {exportButton}
              </>
            }
            sheet={
              exportButton ? (
                <Button variant="secondary" size="sm" className="h-12 w-full justify-center" onClick={handleExport}>
                  Export CSV
                </Button>
              ) : null
            }
          />
        }
      />

      <MobileDateFilterRow startDate={filters.startDate} endDate={filters.endDate} />

      <OverviewStatStrip
        items={[
          { label: 'Total Budget', value: <NairaPrice amount={totalBudget} /> },
          { label: 'Total Actual', value: <NairaPrice amount={totalActual} /> },
          {
            label: 'Net Variance',
            value: (
              <span className={totalVariance < 0 ? 'text-danger-600' : 'text-success-600'}>
                <NairaPrice amount={totalVariance} />
              </span>
            ),
          },
          { label: 'Budgets', value: String(rows.length) },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No budgets found"
          description="Create budgets to see comparison with actual spend."
        />
      ) : (
        <CompactTable columns={columns} rows={rows} rowKey={(r) => r.budgetId} />
      )}
    </div>
  );
}
