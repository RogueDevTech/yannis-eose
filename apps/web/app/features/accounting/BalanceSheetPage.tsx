import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { DateInput } from '~/components/ui/date-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { ConsolidatedToggle } from './ConsolidatedToggle';

interface BSRow {
  code: string;
  name: string;
  amount: number;
}

export interface BalanceSheetPageProps {
  assets: BSRow[];
  liabilities: BSRow[];
  equity: BSRow[];
  retainedEarnings: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  balanced: boolean;
  asOfDate: string | null;
}

export function BalanceSheetPage(props: BalanceSheetPageProps & { consolidated?: boolean; filters?: { asOfDate: string } }) {
  const { assets, liabilities, equity, retainedEarnings, totalAssets, totalLiabilities, totalEquity, balanced, consolidated, filters } = props;
  const [searchParams, setSearchParams] = useSearchParams();

  const onAsOfChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('asOfDate', value);
    else next.delete('asOfDate');
    setSearchParams(next);
  };

  const columns: CompactTableColumn<BSRow>[] = [
    { key: 'name', header: 'Account', render: (r) => <span className="text-app-fg">{r.name}</span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <NairaPrice amount={r.amount} /> },
  ];

  const hasData = assets.length > 0 || liabilities.length > 0 || equity.length > 0;

  const section = (title: string, rows: BSRow[], total: number, extra?: { label: string; amount: number }) => (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-fg-muted">{title}</h3>
      <CompactTable columns={columns} rows={rows} rowKey={(r) => r.code} />
      {extra && (
        <div className="mt-1 flex justify-between px-4 text-sm text-app-fg-muted">
          <span>{extra.label}</span>
          <NairaPrice amount={extra.amount} className="text-app-fg" />
        </div>
      )}
      <div className="mt-1 flex justify-end pr-4 text-sm font-semibold">
        Total {title.toLowerCase()} <NairaPrice amount={total} className="ml-2" />
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title={consolidated ? 'Consolidated Balance Sheet' : 'Balance Sheet'}
        description="Assets versus liabilities and equity, as of a date."
        actions={
          <div className="flex items-center gap-2">
            <ConsolidatedToggle active={consolidated} />
            <span
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold',
                balanced
                  ? 'bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                  : 'bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300',
              ].join(' ')}
            >
              {balanced ? 'Balanced' : 'Out of balance'}
            </span>
          </div>
        }
      />

      <div className="flex items-center gap-2">
        <label htmlFor="bs-asof" className="text-sm text-app-fg-muted">As of</label>
        <DateInput
          id="bs-asof"
          value={filters?.asOfDate ?? ''}
          onChange={(e) => onAsOfChange(e.target.value)}
          wrapperClassName="w-44"
        />
      </div>

      <OverviewStatStrip
        items={[
          { label: 'Total Assets', value: <NairaPrice amount={totalAssets} /> },
          { label: 'Total Liabilities', value: <NairaPrice amount={totalLiabilities} /> },
          { label: 'Total Equity', value: <NairaPrice amount={totalEquity} /> },
        ]}
      />

      {!hasData ? (
        <EmptyState title="Nothing on the balance sheet yet" description="Post entries to populate balances." />
      ) : (
        <div className="space-y-6">
          {section('Assets', assets, totalAssets)}
          {section('Liabilities', liabilities, totalLiabilities)}
          {section('Equity', equity, totalEquity, { label: 'Current-period earnings', amount: retainedEarnings })}
        </div>
      )}
    </>
  );
}
