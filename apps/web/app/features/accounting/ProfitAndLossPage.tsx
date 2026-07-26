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

interface PLRow {
  code: string;
  name: string;
  accountType?: string | null;
  amount: number;
}


export interface ProfitAndLossPageProps {
  income: PLRow[];
  expense: PLRow[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  period: { startDate: string | null; endDate: string | null };
}

export function ProfitAndLossPage({
  income,
  expense,
  totalIncome,
  totalExpense,
  netProfit,
  filters,
}: ProfitAndLossPageProps & { filters?: { startDate: string; endDate: string } }) {
  const columns: CompactTableColumn<PLRow>[] = [
    { key: 'name', header: 'Account', render: (r) => <span className="text-app-fg">{r.name.replace(/\s*[—–]\s*/g, ' · ')}<RealMoneyTag accountType={r.accountType} /></span> },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => <NairaPrice amount={r.amount} /> },
  ];

  const hasData = income.length > 0 || expense.length > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profit & Loss"
        description="Income less expenses over the period, straight from the ledger."
        mobileInlineActions
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Profit and loss toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                  startDate={filters?.startDate}
                  endDate={filters?.endDate}
                  chrome="pill"
                />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow startDate={filters?.startDate} endDate={filters?.endDate} />

      <OverviewStatStrip
        items={[
          { label: 'Total Income', value: <NairaPrice amount={totalIncome} /> },
          { label: 'Total Expense', value: <NairaPrice amount={totalExpense} /> },
          {
            label: 'Net Profit',
            value: <NairaPrice amount={netProfit} colorize />,
          },
        ]}
      />

      {!hasData ? (
        <EmptyState title="No income or expense yet" description="Post entries to populate the P&L." />
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-fg-muted">Income</h3>
            <CompactTable
              columns={columns}
              rows={income}
              rowKey={(r) => r.code}
              renderMobileCard={(r) => (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-app-fg truncate">{r.name.replace(/\s*[—–]\s*/g, ' · ')}<RealMoneyTag accountType={r.accountType} /></span>
                  <NairaPrice amount={r.amount} className="shrink-0 font-medium text-app-fg" />
                </div>
              )}
            />
            <div className="mt-1 flex justify-end pr-4 text-sm font-semibold">
              Total income <NairaPrice amount={totalIncome} className="ml-2" />
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-fg-muted">Expenses</h3>
            <CompactTable
              columns={columns}
              rows={expense}
              rowKey={(r) => r.code}
              renderMobileCard={(r) => (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-app-fg truncate">{r.name.replace(/\s*[—–]\s*/g, ' · ')}<RealMoneyTag accountType={r.accountType} /></span>
                  <NairaPrice amount={r.amount} className="shrink-0 font-medium text-app-fg" />
                </div>
              )}
            />
            <div className="mt-1 flex justify-end pr-4 text-sm font-semibold">
              Total expense <NairaPrice amount={totalExpense} className="ml-2" />
            </div>
          </div>
          <div className="flex justify-end border-t-2 border-app-border pt-3 pr-4 text-base font-semibold">
            Net profit <NairaPrice amount={netProfit} colorize className="ml-2" />
          </div>
        </div>
      )}
    </div>
  );
}
