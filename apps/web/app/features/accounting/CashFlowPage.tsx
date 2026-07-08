import { PageHeader } from '~/components/ui/page-header';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';

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

export function CashFlowPage({ accounts, totals }: CashFlowPageProps) {
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
        title="Cash Flow"
        description="Movement across bank and cash accounts over the period."
      />

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
