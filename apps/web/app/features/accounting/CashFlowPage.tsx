import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { RealMoneyTag } from '~/components/ui/real-money-tag';
import { ConsolidatedToggle } from './ConsolidatedToggle';

interface CashFlowRow {
  code: string;
  name: string;
  accountType?: string | null;
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

export function CashFlowPage({ accounts, totals, consolidated, filters }: CashFlowPageProps & { consolidated?: boolean; filters?: { startDate: string; endDate: string; periodAllTime?: boolean } }) {
  const columns: CompactTableColumn<CashFlowRow>[] = [
    { key: 'name', header: 'Account', render: (r) => <span className="text-app-fg">{r.name.replace(/\s*[—–]\s*/g, ' · ')}<RealMoneyTag accountType={r.accountType} /></span> },
    { key: 'opening', header: 'Opening', align: 'right', render: (r) => <NairaPrice amount={r.opening} zeroAsDash /> },
    { key: 'inflow', header: 'Inflow', align: 'right', render: (r) => <NairaPrice amount={r.inflow} zeroAsDash /> },
    { key: 'outflow', header: 'Outflow', align: 'right', render: (r) => <NairaPrice amount={r.outflow} zeroAsDash /> },
    { key: 'closing', header: 'Closing', align: 'right', render: (r) => <NairaPrice amount={r.closing} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={consolidated ? 'Consolidated Cash Flow' : 'Cash Flow'}
        description="Movement across bank and cash accounts over the period."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Cash flow toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters?.startDate}
                  endDate={filters?.endDate}
                  periodAllTime={filters?.periodAllTime}
                  chrome="pill"
                />
                <ConsolidatedToggle active={consolidated} />
              </>
            }
            sheet={<ConsolidatedToggle active={consolidated} />}
          />
        }
      />

      <MobileDateFilterRow startDate={filters?.startDate} endDate={filters?.endDate} />

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
          <CompactTable
            columns={columns}
            rows={accounts}
            rowKey={(r) => r.code}
            renderMobileCard={(r) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-app-fg truncate">{r.name.replace(/\s*[—–]\s*/g, ' · ')}</span>
                  <RealMoneyTag accountType={r.accountType} />
                </div>
                <div className="flex items-center justify-between gap-4 text-xs text-app-fg-muted">
                  <span>In <NairaPrice amount={r.inflow} zeroAsDash className="ml-1 text-app-fg" /></span>
                  <span>Out <NairaPrice amount={r.outflow} zeroAsDash className="ml-1 text-app-fg" /></span>
                  <span>Close <NairaPrice amount={r.closing} className="ml-1 font-medium text-app-fg" /></span>
                </div>
              </div>
            )}
          />
          <div className="mt-1 flex justify-end gap-8 border-t-2 border-app-border pt-3 pr-4 text-sm font-semibold">
            <span>Net change <NairaPrice amount={totals.inflow - totals.outflow} colorize className="ml-1" /></span>
            <span>Closing cash <NairaPrice amount={totals.closing} className="ml-1" /></span>
          </div>
        </>
      )}
    </div>
  );
}
