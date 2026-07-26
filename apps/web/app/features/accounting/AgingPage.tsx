import { useSearchParams } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { Tabs } from '~/components/ui/tabs';
import { NairaPrice } from '~/components/ui/naira-price';

interface AgingRow {
  party: string;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90plus: number;
  total: number;
}

export interface AgingPageProps {
  kind: 'RECEIVABLE' | 'PAYABLE';
  asOfDate: string;
  parties: AgingRow[];
  totals: { b0_30: number; b31_60: number; b61_90: number; b90plus: number; total: number };
}

export function AgingPage({ kind, parties, totals }: AgingPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isAR = kind === 'RECEIVABLE';

  const setKind = (next: 'RECEIVABLE' | 'PAYABLE') => {
    const sp = new URLSearchParams(searchParams);
    sp.set('kind', next);
    setSearchParams(sp);
  };

  const columns: CompactTableColumn<AgingRow>[] = [
    { key: 'party', header: isAR ? 'Customer' : 'Supplier', render: (r) => <span className="text-app-fg">{r.party}</span> },
    { key: 'b0_30', header: '0–30d', align: 'right', render: (r) => <NairaPrice amount={r.b0_30} zeroAsDash /> },
    { key: 'b31_60', header: '31–60d', align: 'right', render: (r) => <NairaPrice amount={r.b31_60} zeroAsDash /> },
    { key: 'b61_90', header: '61–90d', align: 'right', render: (r) => <NairaPrice amount={r.b61_90} zeroAsDash /> },
    { key: 'b90plus', header: '90d+', align: 'right', render: (r) => <NairaPrice amount={r.b90plus} zeroAsDash /> },
    { key: 'total', header: 'Total', align: 'right', render: (r) => <NairaPrice amount={r.total} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={isAR ? 'Accounts Receivable Aging' : 'Accounts Payable Aging'}
        description={isAR ? 'Outstanding customer balances by age.' : 'Outstanding supplier balances by age.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Aging toolbar"
            desktop={<PageRefreshButton />}
          />
        }
      />

      <Tabs
        variant="pill"
        value={kind}
        onChange={(v) => setKind(v as 'RECEIVABLE' | 'PAYABLE')}
        tabs={[
          { value: 'RECEIVABLE', label: 'Receivable' },
          { value: 'PAYABLE', label: 'Payable' },
        ]}
      />

      <OverviewStatStrip
        items={[
          { label: 'Current (0–30)', value: <NairaPrice amount={totals.b0_30} /> },
          { label: '90d+ overdue', value: <NairaPrice amount={totals.b90plus} colorize /> },
          { label: 'Total outstanding', value: <NairaPrice amount={totals.total} /> },
        ]}
      />

      {parties.length === 0 ? (
        <EmptyState title="Nothing outstanding" description={isAR ? 'No unpaid customer balances.' : 'No unpaid supplier balances.'} />
      ) : (
        <CompactTable
          columns={columns}
          rows={parties}
          rowKey={(r) => r.party}
          renderMobileCard={(r) => (
            <div className="flex flex-col gap-1.5 py-3 px-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-app-fg truncate">{r.party}</span>
                <NairaPrice amount={r.total} className="font-semibold text-app-fg shrink-0" />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-app-muted">
                <span>0–30d: <NairaPrice amount={r.b0_30} zeroAsDash /></span>
                <span>31–60d: <NairaPrice amount={r.b31_60} zeroAsDash /></span>
                <span>61–90d: <NairaPrice amount={r.b61_90} zeroAsDash /></span>
                <span>90d+: <NairaPrice amount={r.b90plus} zeroAsDash /></span>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}
