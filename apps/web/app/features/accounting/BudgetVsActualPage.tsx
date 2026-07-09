import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { DateInput } from '~/components/ui/date-input';
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
  const [searchParams, setSearchParams] = useSearchParams();

  const onDateChange = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const totalBudget = rows.reduce((s, r) => s + r.budgetAmount, 0);
  const totalActual = rows.reduce((s, r) => s + r.actualSpend, 0);
  const totalVariance = totalBudget - totalActual;

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

  return (
    <>
      <PageHeader
        title="Budget vs Actual"
        description="Compare departmental budgets against GL expense postings."
        actions={
          rows.length > 0 ? (
            <button
              onClick={handleExport}
              className="rounded-lg bg-app-primary px-3 py-2 text-sm font-medium text-white hover:bg-app-primary/90"
            >
              Export CSV
            </button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="bva-start" className="text-sm text-app-fg-muted">From</label>
          <DateInput
            id="bva-start"
            value={filters.startDate}
            onChange={(e) => onDateChange('startDate', e.target.value)}
            wrapperClassName="w-44"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="bva-end" className="text-sm text-app-fg-muted">To</label>
          <DateInput
            id="bva-end"
            value={filters.endDate}
            onChange={(e) => onDateChange('endDate', e.target.value)}
            wrapperClassName="w-44"
          />
        </div>
      </div>

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
    </>
  );
}
