import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { DateInput } from '~/components/ui/date-input';
import { NairaPrice } from '~/components/ui/naira-price';
import { ConsolidatedToggle } from './ConsolidatedToggle';

interface CashFlowRow {
  code: string;
  name: string;
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
}

export interface CashFlowPageProps {
  accounts: CashFlowRow[];
  totals: { opening: number; inflow: number; outflow: number; closing: number };
  period: { startDate: string | null; endDate: string | null };
}

export function CashFlowPage({ accounts, totals, consolidated, filters }: CashFlowPageProps & { consolidated?: boolean; filters?: { startDate: string; endDate: string } }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };
  const columns: CompactTableColumn<CashFlowRow>[] = [
    { key: 'name', header: 'Account', render: (r) => <span className="text-app-fg">{r.name}</span> },
    { key: 'opening', header: 'Opening', align: 'right', render: (r) => <NairaPrice amount={r.opening} zeroAsDash /> },
    { key: 'inflow', header: 'Inflow', align: 'right', render: (r) => <NairaPrice amount={r.inflow} zeroAsDash /> },
    { key: 'outflow', header: 'Outflow', align: 'right', render: (r) => <NairaPrice amount={r.outflow} zeroAsDash /> },
    { key: 'closing', header: 'Closing', align: 'right', render: (r) => <NairaPrice amount={r.closing} /> },
  ];

  return (
    <>
      <PageHeader
        title={consolidated ? 'Consolidated Cash Flow' : 'Cash Flow'}
        description="Movement across bank and cash accounts over the period."
        actions={<ConsolidatedToggle active={consolidated} />}
      />

      <div className="flex items-center gap-3">
        <label htmlFor="cf-from" className="text-sm text-app-fg-muted">From</label>
        <DateInput
          id="cf-from"
          value={filters?.startDate ?? ''}
          onChange={(e) => setFilter('startDate', e.target.value)}
          wrapperClassName="w-44"
        />
        <label htmlFor="cf-to" className="text-sm text-app-fg-muted">To</label>
        <DateInput
          id="cf-to"
          value={filters?.endDate ?? ''}
          onChange={(e) => setFilter('endDate', e.target.value)}
          wrapperClassName="w-44"
        />
      </div>

      <OverviewStatStrip
        items={[
          { label: 'Total Inflow', value: <NairaPrice amount={totals.inflow} /> },
          { label: 'Total Outflow', value: <NairaPrice amount={totals.outflow} /> },
          { label: 'Net Change', value: <NairaPrice amount={totals.inflow - totals.outflow} colorize /> },
          { label: 'Closing Cash', value: <NairaPrice amount={totals.closing} /> },
        ]}
      />

      {accounts.length === 0 ? (
        <EmptyState title="No cash accounts" description="Add a bank or cash account to the chart of accounts." />
      ) : (
        <>
          <CompactTable columns={columns} rows={accounts} rowKey={(r) => r.code} />
          <div className="mt-1 flex justify-end gap-8 border-t-2 border-app-border pt-3 pr-4 text-sm font-semibold">
            <span>Net change <NairaPrice amount={totals.inflow - totals.outflow} colorize className="ml-1" /></span>
            <span>Closing cash <NairaPrice amount={totals.closing} className="ml-1" /></span>
          </div>
        </>
      )}
    </>
  );
}
